import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import { communityRole, getChannel, isModRole, type ChannelRow, type Role } from '../access.ts';
import { tx } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { serializeChannel, usersById } from '../serialize.ts';

interface CommunityRow {
  id: string;
  name: string;
  description: string;
  game: string;
  accent: string;
  owner_id: string;
  invite_code: string;
  created_at: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const CHANNEL_NAME = /^[a-z0-9-]{1,32}$/;
const MAX_CHANNELS = 50;

/** Turn "Scrims & Strats" into "scrims-strats". */
const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

const newInviteCode = () => randomBytes(6).toString('base64url');

const DEFAULT_CHANNELS: { name: string; kind: 'text' | 'announcement'; topic: string }[] = [
  { name: 'announcements', kind: 'announcement', topic: 'News from the community team' },
  { name: 'general', kind: 'text', topic: 'Hang out and chat' },
  { name: 'looking-for-group', kind: 'text', topic: 'Find teammates for your next session' },
  { name: 'clips', kind: 'text', topic: 'Share your best plays' },
];

export function communityRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  const getCommunity = (id: string) =>
    db.prepare('SELECT * FROM communities WHERE id = ?').get(id) as CommunityRow | undefined;

  function summary(c: CommunityRow, viewerId: string) {
    const { count } = db
      .prepare('SELECT COUNT(*) AS count FROM community_members WHERE community_id = ?')
      .get(c.id) as { count: number };
    const role = communityRole(db, viewerId, c.id);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      game: c.game,
      accent: c.accent,
      ownerId: c.owner_id,
      memberCount: count,
      role,
      // Only moderators see and share the invite code.
      inviteCode: isModRole(role) ? c.invite_code : undefined,
    };
  }

  function channelsOf(communityId: string) {
    return (
      db
        .prepare('SELECT * FROM channels WHERE community_id = ? ORDER BY position, created_at')
        .all(communityId) as unknown as ChannelRow[]
    ).map(serializeChannel);
  }

  function detail(c: CommunityRow, viewerId: string) {
    const memberRows = db
      .prepare('SELECT user_id, role FROM community_members WHERE community_id = ?')
      .all(c.id) as { user_id: string; role: Role }[];
    const roles = new Map(memberRows.map((m) => [m.user_id, m.role]));
    const members = usersById(rt.ctx, memberRows.map((m) => m.user_id)).map((u) => ({
      ...u,
      role: roles.get(u.id)!,
    }));
    return { ...summary(c, viewerId), channels: channelsOf(c.id), members };
  }

  /** Load a community the viewer belongs to, optionally requiring a moderator role. */
  function memberCommunity(viewerId: string, id: string, needMod = false) {
    const c = getCommunity(id);
    const role = c ? communityRole(db, viewerId, c.id) : null;
    if (!c || !role) throw notFound('Community not found');
    if (needMod && !isModRole(role)) throw forbidden('Only community admins can do that');
    return { community: c, role };
  }

  function broadcastCommunity(communityId: string) {
    const c = getCommunity(communityId);
    if (!c) return;
    const ids = db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(communityId) as {
      user_id: string;
    }[];
    for (const { user_id } of ids) rt.toUser(user_id, 'community:update', detail(c, user_id));
  }

  function addMember(communityId: string, userId: string, role: Role) {
    db.prepare(
      'INSERT OR IGNORE INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
    ).run(communityId, userId, role, Date.now());
    for (const ch of channelsOf(communityId)) rt.joinChannel(userId, ch.id);
  }

  function removeMember(communityId: string, userId: string) {
    db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(communityId, userId);
    for (const ch of channelsOf(communityId)) rt.leaveChannel(userId, ch.id);
    rt.toUser(userId, 'community:removed', { id: communityId });
  }

  router.get('/communities', (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.* FROM communities c JOIN community_members m ON m.community_id = c.id
         WHERE m.user_id = ? ORDER BY m.joined_at`,
      )
      .all(me(req)) as unknown as CommunityRow[];
    res.json({ communities: rows.map((c) => summary(c, me(req))) });
  });

  // Public directory for the Discover page. Every community is public in the MVP.
  router.get('/communities/browse', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 50) : '';
    const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM community_members m WHERE m.community_id = c.id) AS members
         FROM communities c
         WHERE c.name LIKE ? ESCAPE '\\' OR c.game LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\'
         ORDER BY members DESC, c.created_at DESC LIMIT 50`,
      )
      .all(like, like, like) as unknown as CommunityRow[];
    res.json({ communities: rows.map((c) => summary(c, me(req))) });
  });

  router.post('/communities', (req, res) => {
    const id = me(req);
    const name = str(req.body, 'name', { min: 2, max: 48 })!;
    const description = str(req.body, 'description', { max: 300, optional: true }) ?? '';
    const game = str(req.body, 'game', { max: 40, optional: true }) ?? '';
    const accent = req.body?.accent;
    if (accent !== undefined && (typeof accent !== 'string' || !HEX.test(accent))) {
      throw badRequest('accent must be a hex colour');
    }
    const owned = db.prepare('SELECT COUNT(*) AS n FROM communities WHERE owner_id = ?').get(id) as { n: number };
    if (owned.n >= 25) throw badRequest('You can own at most 25 communities');

    const communityId = randomUUID();
    const now = Date.now();
    tx(db, () => {
      db.prepare(
        `INSERT INTO communities (id, name, description, game, accent, owner_id, invite_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(communityId, name, description, game, accent ?? '#22d3ee', id, newInviteCode(), now);
      DEFAULT_CHANNELS.forEach((ch, i) => {
        db.prepare(
          `INSERT INTO channels (id, community_id, kind, name, topic, position, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), communityId, ch.kind, ch.name, ch.topic, i, id, now);
      });
      addMember(communityId, id, 'owner');
    });
    res.status(201).json({ community: detail(getCommunity(communityId)!, id) });
  });

  router.get('/communities/:id', (req, res) => {
    const { community } = memberCommunity(me(req), req.params.id);
    res.json({ community: detail(community, me(req)) });
  });

  router.patch('/communities/:id', (req, res) => {
    const { community } = memberCommunity(me(req), req.params.id, true);
    const name = str(req.body, 'name', { min: 2, max: 48, optional: true }) ?? community.name;
    const description = str(req.body, 'description', { max: 300, optional: true }) ?? community.description;
    const game = str(req.body, 'game', { max: 40, optional: true }) ?? community.game;
    const accent = req.body?.accent ?? community.accent;
    if (typeof accent !== 'string' || !HEX.test(accent)) throw badRequest('accent must be a hex colour');
    db.prepare('UPDATE communities SET name = ?, description = ?, game = ?, accent = ? WHERE id = ?').run(
      name,
      description,
      game,
      accent,
      community.id,
    );
    broadcastCommunity(community.id);
    res.json({ community: detail(getCommunity(community.id)!, me(req)) });
  });

  router.delete('/communities/:id', (req, res) => {
    const { community, role } = memberCommunity(me(req), req.params.id);
    if (role !== 'owner') throw forbidden('Only the owner can delete a community');
    const memberIds = (
      db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(community.id) as { user_id: string }[]
    ).map((m) => m.user_id);
    db.prepare('DELETE FROM communities WHERE id = ?').run(community.id);
    for (const uid of memberIds) rt.toUser(uid, 'community:removed', { id: community.id });
    res.json({ ok: true });
  });

  router.post('/communities/join', (req, res) => {
    const id = me(req);
    const code = str(req.body, 'inviteCode', { min: 1, max: 64 })!;
    // Accept a bare code or a pasted invite link.
    const bare = code.split('/').pop()!;
    const community = db.prepare('SELECT * FROM communities WHERE invite_code = ?').get(bare) as
      | CommunityRow
      | undefined;
    if (!community) throw notFound('That invite is invalid or has expired');
    addMember(community.id, id, 'member');
    broadcastCommunity(community.id);
    rt.broadcastPresence(id);
    res.json({ community: detail(community, id) });
  });

  // Joining from the public directory, without an invite.
  router.post('/communities/:id/join', (req, res) => {
    const id = me(req);
    const community = getCommunity(req.params.id);
    if (!community) throw notFound('Community not found');
    addMember(community.id, id, 'member');
    broadcastCommunity(community.id);
    rt.broadcastPresence(id);
    res.json({ community: detail(community, id) });
  });

  router.post('/communities/:id/leave', (req, res) => {
    const { community, role } = memberCommunity(me(req), req.params.id);
    if (role === 'owner') throw badRequest('Owners must delete the community or hand it over before leaving');
    removeMember(community.id, me(req));
    broadcastCommunity(community.id);
    res.json({ ok: true });
  });

  router.post('/communities/:id/invite', (req, res) => {
    const { community } = memberCommunity(me(req), req.params.id, true);
    const inviteCode = newInviteCode();
    db.prepare('UPDATE communities SET invite_code = ? WHERE id = ?').run(inviteCode, community.id);
    res.json({ inviteCode });
  });

  router.patch('/communities/:id/members/:userId', (req, res) => {
    const { community, role } = memberCommunity(me(req), req.params.id);
    if (role !== 'owner') throw forbidden('Only the owner can change roles');
    const newRole = req.body?.role;
    if (newRole !== 'admin' && newRole !== 'member') throw badRequest('role must be admin or member');
    const target = communityRole(db, req.params.userId, community.id);
    if (!target) throw notFound('Member not found');
    if (target === 'owner') throw badRequest("The owner's role can't be changed");
    db.prepare('UPDATE community_members SET role = ? WHERE community_id = ? AND user_id = ?').run(
      newRole,
      community.id,
      req.params.userId,
    );
    broadcastCommunity(community.id);
    res.json({ community: detail(community, me(req)) });
  });

  // Kick a member. Admins can remove members; only the owner can remove admins.
  router.delete('/communities/:id/members/:userId', (req, res) => {
    const { community, role } = memberCommunity(me(req), req.params.id, true);
    const target = communityRole(db, req.params.userId, community.id);
    if (!target) throw notFound('Member not found');
    if (target === 'owner' || (target === 'admin' && role !== 'owner')) {
      throw forbidden('You cannot remove that member');
    }
    removeMember(community.id, req.params.userId);
    broadcastCommunity(community.id);
    res.json({ community: detail(community, me(req)) });
  });

  // ---- Channels ----

  router.post('/communities/:id/channels', (req, res) => {
    const { community } = memberCommunity(me(req), req.params.id, true);
    const name = slug(str(req.body, 'name', { min: 1, max: 32 })!);
    if (!CHANNEL_NAME.test(name)) throw badRequest('Channel names use lowercase letters, numbers and dashes');
    const kind = req.body?.kind ?? 'text';
    if (kind !== 'text' && kind !== 'announcement') throw badRequest('kind must be text or announcement');
    const topic = str(req.body, 'topic', { max: 120, optional: true }) ?? '';
    const { n, maxPos } = db
      .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS maxPos FROM channels WHERE community_id = ?')
      .get(community.id) as { n: number; maxPos: number };
    if (n >= MAX_CHANNELS) throw badRequest(`Communities can have at most ${MAX_CHANNELS} channels`);

    const channelId = randomUUID();
    db.prepare(
      `INSERT INTO channels (id, community_id, kind, name, topic, position, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(channelId, community.id, kind, name, topic, maxPos + 1, me(req), Date.now());

    const memberIds = db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(community.id) as {
      user_id: string;
    }[];
    for (const { user_id } of memberIds) rt.joinChannel(user_id, channelId);
    broadcastCommunity(community.id);
    res.status(201).json({ channel: serializeChannel(getChannel(db, channelId)) });
  });

  router.patch('/channels/:id', (req, res) => {
    const channel = getChannel(db, req.params.id);
    if (!channel.community_id) throw notFound('Channel not found');
    memberCommunity(me(req), channel.community_id, true);
    const rawName = str(req.body, 'name', { min: 1, max: 32, optional: true });
    const name = rawName !== undefined ? slug(rawName) : channel.name;
    if (!CHANNEL_NAME.test(name)) throw badRequest('Channel names use lowercase letters, numbers and dashes');
    const topic = str(req.body, 'topic', { max: 120, optional: true }) ?? channel.topic;
    db.prepare('UPDATE channels SET name = ?, topic = ? WHERE id = ?').run(name, topic, channel.id);
    broadcastCommunity(channel.community_id);
    res.json({ channel: serializeChannel(getChannel(db, channel.id)) });
  });

  router.delete('/channels/:id', (req, res) => {
    const channel = getChannel(db, req.params.id);
    if (!channel.community_id) throw notFound('Channel not found');
    memberCommunity(me(req), channel.community_id, true);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM channels WHERE community_id = ?').get(channel.community_id) as {
      n: number;
    };
    if (n <= 1) throw new HttpError(409, 'A community needs at least one channel');
    db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
    broadcastCommunity(channel.community_id);
    res.json({ ok: true });
  });

  return router;
}
