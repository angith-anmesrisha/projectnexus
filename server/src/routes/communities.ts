import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import {
  ALL_PERMS,
  PERMS,
  communityPermissions,
  communityRole,
  getChannel,
  hasPerm,
  readableChannel,
  type ChannelRow,
  type Perm,
  type Role,
} from '../access.ts';
import { tx } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { messageSummary, serializeChannel, serializeMessages, usersById, type MessageRow } from '../serialize.ts';
import { attachmentFromUpload, type UploadRow } from './media.ts';

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
const MAX_ROLES = 25;

interface RoleRow {
  id: string;
  community_id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
  hoist: number;
  created_at: number;
}

const serializeRole = (r: RoleRow) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  permissions: r.permissions,
  position: r.position,
  hoist: !!r.hoist,
});

/** Turn "Scrims & Strats" into "scrims-strats". */
const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

const newInviteCode = () => randomBytes(6).toString('base64url');

const DEFAULT_CHANNELS: { name: string; kind: 'text' | 'announcement' | 'voice'; topic: string }[] = [
  { name: 'announcements', kind: 'announcement', topic: 'News from the community team' },
  { name: 'general', kind: 'text', topic: 'Hang out and chat' },
  { name: 'looking-for-group', kind: 'text', topic: 'Find teammates for your next session' },
  { name: 'clips', kind: 'text', topic: 'Share your best plays' },
  { name: 'lounge', kind: 'voice', topic: 'Drop in and hang out' },
  { name: 'squad-up', kind: 'voice', topic: 'Voice for your next match' },
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
    const permissions = communityPermissions(db, viewerId, c.id);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      game: c.game,
      accent: c.accent,
      ownerId: c.owner_id,
      memberCount: count,
      role,
      permissions,
      // Only members allowed to invite see and share the invite code.
      inviteCode: permissions & PERMS.createInvites ? c.invite_code : undefined,
    };
  }

  /** Top-level channels; forum posts (threads) are listed by their forum instead. */
  function channelsOf(communityId: string) {
    return (
      db
        .prepare(`SELECT * FROM channels WHERE community_id = ? AND kind != 'thread' ORDER BY position, created_at`)
        .all(communityId) as unknown as ChannelRow[]
    ).map(serializeChannel);
  }

  /** Every channel id including threads, for socket room membership. */
  const allChannelIds = (communityId: string) =>
    (db.prepare('SELECT id FROM channels WHERE community_id = ?').all(communityId) as { id: string }[]).map((r) => r.id);

  const rolesOf = (communityId: string) =>
    db.prepare('SELECT * FROM roles WHERE community_id = ? ORDER BY position DESC, created_at').all(communityId) as unknown as RoleRow[];

  function detail(c: CommunityRow, viewerId: string) {
    const memberRows = db
      .prepare('SELECT user_id, role FROM community_members WHERE community_id = ?')
      .all(c.id) as { user_id: string; role: Role }[];
    const roles = new Map(memberRows.map((m) => [m.user_id, m.role]));
    const assigned = new Map<string, string[]>();
    for (const r of db.prepare('SELECT user_id, role_id FROM member_roles WHERE community_id = ?').all(c.id) as {
      user_id: string;
      role_id: string;
    }[]) {
      assigned.set(r.user_id, [...(assigned.get(r.user_id) ?? []), r.role_id]);
    }
    const members = usersById(rt.ctx, memberRows.map((m) => m.user_id)).map((u) => ({
      ...u,
      role: roles.get(u.id)!,
      roleIds: assigned.get(u.id) ?? [],
    }));
    return { ...summary(c, viewerId), channels: channelsOf(c.id), members, roles: rolesOf(c.id).map(serializeRole) };
  }

  /** Load a community the viewer belongs to, optionally requiring a permission. */
  function memberCommunity(viewerId: string, id: string, perm?: Perm) {
    const c = getCommunity(id);
    const role = c ? communityRole(db, viewerId, c.id) : null;
    if (!c || !role) throw notFound('Community not found');
    if (perm !== undefined && !hasPerm(db, viewerId, c.id, perm)) throw forbidden("Your roles don't allow that here");
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
    for (const id of allChannelIds(communityId)) rt.joinChannel(userId, id);
  }

  function removeMember(communityId: string, userId: string) {
    db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(communityId, userId);
    db.prepare('DELETE FROM member_roles WHERE community_id = ? AND user_id = ?').run(communityId, userId);
    for (const id of allChannelIds(communityId)) rt.leaveChannel(userId, id);
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
    const { community } = memberCommunity(me(req), req.params.id, PERMS.manageCommunity);
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
    const { community } = memberCommunity(me(req), req.params.id, PERMS.createInvites);
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
    const { community, role } = memberCommunity(me(req), req.params.id, PERMS.kickMembers);
    const target = communityRole(db, req.params.userId, community.id);
    if (!target) throw notFound('Member not found');
    if (req.params.userId === me(req)) throw badRequest('Use Leave to leave a community');
    if (target === 'owner' || (target === 'admin' && role !== 'owner')) {
      throw forbidden('You cannot remove that member');
    }
    removeMember(community.id, req.params.userId);
    broadcastCommunity(community.id);
    res.json({ community: detail(community, me(req)) });
  });

  // ---- Channels ----

  router.post('/communities/:id/channels', (req, res) => {
    const { community } = memberCommunity(me(req), req.params.id, PERMS.manageChannels);
    const name = slug(str(req.body, 'name', { min: 1, max: 32 })!);
    if (!CHANNEL_NAME.test(name)) throw badRequest('Channel names use lowercase letters, numbers and dashes');
    const kind = req.body?.kind ?? 'text';
    if (!['text', 'announcement', 'forum', 'voice'].includes(kind)) throw badRequest('kind must be text, announcement, forum or voice');
    const topic = str(req.body, 'topic', { max: 120, optional: true }) ?? '';
    const { n, maxPos } = db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS maxPos FROM channels WHERE community_id = ? AND kind != 'thread'`)
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
    if (!channel.community_id || channel.kind === 'thread') throw notFound('Channel not found');
    memberCommunity(me(req), channel.community_id, PERMS.manageChannels);
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
    if (channel.kind === 'thread') {
      // A forum post can be removed by its author or by moderators.
      readableChannel(db, me(req), channel.id);
      const perms = communityPermissions(db, me(req), channel.community_id);
      if (channel.created_by !== me(req) && !(perms & (PERMS.manageChannels | PERMS.manageMessages))) {
        throw forbidden('You can only delete your own posts');
      }
      db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
      rt.toChannel(channel.parent_id!, 'thread:update', { forumId: channel.parent_id, removed: channel.id });
      res.json({ ok: true });
      return;
    }
    memberCommunity(me(req), channel.community_id, PERMS.manageChannels);
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM channels WHERE community_id = ? AND kind != 'thread'`)
      .get(channel.community_id) as { n: number };
    if (n <= 1) throw new HttpError(409, 'A community needs at least one channel');
    db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
    broadcastCommunity(channel.community_id);
    res.json({ ok: true });
  });

  // ---- Custom roles ----

  function parseRoleBody(body: unknown, actorPerms: number, existing?: RoleRow) {
    const name = str(body, 'name', { min: 1, max: 32, optional: !!existing }) ?? existing!.name;
    const color = (body as any)?.color ?? existing?.color ?? '';
    if (typeof color !== 'string' || (color !== '' && !HEX.test(color))) throw badRequest('color must be a hex colour');
    const rawPerms = (body as any)?.permissions ?? existing?.permissions ?? 0;
    if (!Number.isInteger(rawPerms) || rawPerms < 0) throw badRequest('permissions must be a number');
    const permissions = rawPerms & ALL_PERMS;
    // Nobody can hand out a permission they don't have themselves.
    const before = existing?.permissions ?? 0;
    if ((permissions ^ before) & ~actorPerms) throw forbidden("You can't grant permissions you don't have");
    const hoist = (body as any)?.hoist ?? !!existing?.hoist;
    return { name, color, permissions, hoist: hoist ? 1 : 0 };
  }

  router.post('/communities/:id/roles', (req, res) => {
    const userId = me(req);
    const { community } = memberCommunity(userId, req.params.id, PERMS.manageRoles);
    const { n, maxPos } = db
      .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS maxPos FROM roles WHERE community_id = ?')
      .get(community.id) as { n: number; maxPos: number };
    if (n >= MAX_ROLES) throw badRequest(`Communities can have at most ${MAX_ROLES} roles`);
    const r = parseRoleBody(req.body, communityPermissions(db, userId, community.id));
    const id = randomUUID();
    db.prepare(
      'INSERT INTO roles (id, community_id, name, color, permissions, position, hoist, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, community.id, r.name, r.color, r.permissions, maxPos + 1, r.hoist, Date.now());
    broadcastCommunity(community.id);
    res.status(201).json({ role: serializeRole(db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as unknown as RoleRow) });
  });

  function roleForEdit(userId: string, roleId: string) {
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId) as unknown as RoleRow | undefined;
    if (!role) throw notFound('Role not found');
    memberCommunity(userId, role.community_id, PERMS.manageRoles);
    return role;
  }

  router.patch('/roles/:id', (req, res) => {
    const userId = me(req);
    const role = roleForEdit(userId, req.params.id);
    const r = parseRoleBody(req.body, communityPermissions(db, userId, role.community_id), role);
    const position = Number.isInteger(req.body?.position) ? req.body.position : role.position;
    db.prepare('UPDATE roles SET name = ?, color = ?, permissions = ?, hoist = ?, position = ? WHERE id = ?').run(
      r.name,
      r.color,
      r.permissions,
      r.hoist,
      position,
      role.id,
    );
    broadcastCommunity(role.community_id);
    res.json({ role: serializeRole(db.prepare('SELECT * FROM roles WHERE id = ?').get(role.id) as unknown as RoleRow) });
  });

  router.delete('/roles/:id', (req, res) => {
    const userId = me(req);
    const role = roleForEdit(userId, req.params.id);
    if (role.permissions & ~communityPermissions(db, userId, role.community_id)) {
      throw forbidden("You can't delete a role with permissions you don't have");
    }
    db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
    broadcastCommunity(role.community_id);
    res.json({ ok: true });
  });

  // Replace a member's set of custom roles.
  router.put('/communities/:id/members/:userId/roles', (req, res) => {
    const actor = me(req);
    const { community } = memberCommunity(actor, req.params.id, PERMS.manageRoles);
    if (!communityRole(db, req.params.userId, community.id)) throw notFound('Member not found');
    const roleIds = req.body?.roleIds;
    if (!Array.isArray(roleIds) || roleIds.some((r) => typeof r !== 'string')) throw badRequest('roleIds must be a list');
    const valid = new Map(rolesOf(community.id).map((r) => [r.id, r]));
    if (roleIds.some((id: string) => !valid.has(id))) throw badRequest('Unknown role');
    const actorPerms = communityPermissions(db, actor, community.id);
    const current = (
      db.prepare('SELECT role_id FROM member_roles WHERE community_id = ? AND user_id = ?').all(community.id, req.params.userId) as {
        role_id: string;
      }[]
    ).map((r) => r.role_id);
    const changed = [...roleIds.filter((id: string) => !current.includes(id)), ...current.filter((id) => !roleIds.includes(id))];
    if (changed.some((id) => valid.get(id)!.permissions & ~actorPerms)) {
      throw forbidden("You can't assign roles with permissions you don't have");
    }
    tx(db, () => {
      db.prepare('DELETE FROM member_roles WHERE community_id = ? AND user_id = ?').run(community.id, req.params.userId);
      const add = db.prepare('INSERT INTO member_roles (role_id, user_id, community_id) VALUES (?, ?, ?)');
      for (const id of new Set<string>(roleIds)) add.run(id, req.params.userId, community.id);
    });
    broadcastCommunity(community.id);
    res.json({ community: detail(community, actor) });
  });

  // ---- Forums: each post is a thread channel under the forum ----

  function threadSummary(t: ChannelRow, viewerId: string) {
    const first = db
      .prepare('SELECT * FROM messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1')
      .get(t.id) as unknown as MessageRow | undefined;
    const stats = db
      .prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM messages WHERE channel_id = ? AND deleted_at IS NULL')
      .get(t.id) as { n: number; last: number | null };
    const [author] = t.created_by ? usersById(rt.ctx, [t.created_by]) : [];
    const firstMsg = first ? serializeMessages(rt.ctx, viewerId, [first])[0] : null;
    const image = firstMsg?.attachments.find((a) => a.kind === 'image' || a.kind === 'gif');
    return {
      id: t.id,
      forumId: t.parent_id,
      communityId: t.community_id,
      title: t.name,
      author: author ?? null,
      createdAt: t.created_at,
      lastActivity: stats.last ?? t.created_at,
      replies: Math.max(0, stats.n - 1),
      preview: first ? messageSummary(first) : '',
      image: image?.url ?? null,
      reactions: firstMsg?.reactions ?? [],
    };
  }

  router.get('/channels/:id/threads', (req, res) => {
    const forum = readableChannel(db, me(req), req.params.id);
    if (forum.kind !== 'forum') throw badRequest('Not a forum');
    const threads = db
      .prepare(`SELECT * FROM channels WHERE parent_id = ? AND kind = 'thread'`)
      .all(forum.id) as unknown as ChannelRow[];
    const list = threads.map((t) => threadSummary(t, me(req))).sort((a, b) => b.lastActivity - a.lastActivity);
    res.json({ threads: list });
  });

  router.get('/threads/:id', (req, res) => {
    const t = readableChannel(db, me(req), req.params.id);
    if (t.kind !== 'thread') throw notFound('Post not found');
    res.json({ thread: threadSummary(t, me(req)) });
  });

  router.post('/channels/:id/threads', (req, res) => {
    const userId = me(req);
    const forum = readableChannel(db, userId, req.params.id);
    if (forum.kind !== 'forum' || !forum.community_id) throw badRequest('Not a forum');
    const title = str(req.body, 'title', { min: 1, max: 100 })!;
    const content = str(req.body, 'content', { max: 2000, optional: true }) ?? '';
    const uploads: unknown[] = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 10) : [];
    const attachments = uploads.map((a: any) => {
      const up = db.prepare('SELECT * FROM uploads WHERE id = ? AND owner_id = ?').get(a?.uploadId, userId) as UploadRow | undefined;
      if (!up) throw badRequest('Attachment not found');
      return attachmentFromUpload(up);
    });
    if (!content && attachments.length === 0) throw badRequest('Say something in your post');
    const recent = db
      .prepare(`SELECT COUNT(*) AS n FROM channels WHERE created_by = ? AND kind = 'thread' AND created_at > ?`)
      .get(userId, Date.now() - 60_000) as { n: number };
    if (recent.n >= 5) throw new HttpError(429, 'Slow down a little');

    const id = randomUUID();
    const now = Date.now();
    tx(db, () => {
      db.prepare(
        `INSERT INTO channels (id, community_id, kind, name, topic, position, created_by, created_at, parent_id)
         VALUES (?, ?, 'thread', ?, '', 0, ?, ?, ?)`,
      ).run(id, forum.community_id, title, userId, now, forum.id);
      db.prepare(
        'INSERT INTO messages (channel_id, author_id, content, attachments, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, userId, content, JSON.stringify(attachments), now);
    });
    const memberIds = db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(forum.community_id) as {
      user_id: string;
    }[];
    for (const { user_id } of memberIds) rt.joinChannel(user_id, id);
    const thread = threadSummary(getChannel(db, id), userId);
    rt.toChannel(forum.id, 'thread:update', { forumId: forum.id, thread });
    res.status(201).json({ thread });
  });

  return router;
}
