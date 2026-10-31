import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import { getChannel, isBlockedEitherWay } from '../access.ts';
import { tx } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { serializeConversation, usersById } from '../serialize.ts';

interface PostRow {
  id: string;
  author_id: string;
  game: string;
  mode: string;
  rank: string;
  region: string;
  slots: number;
  mic: number;
  note: string;
  group_channel_id: string | null;
  created_at: number;
  expires_at: number;
  closed_at: number | null;
}

const HOUR = 3_600_000;
export const REGIONS = ['NA', 'EU', 'LATAM', 'BR', 'ASIA', 'OCE', 'ME', 'AF'];

export function lfgRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  const members = (postId: string) =>
    (db.prepare('SELECT user_id FROM lfg_members WHERE post_id = ? ORDER BY joined_at').all(postId) as { user_id: string }[]).map((r) => r.user_id);

  function serialize(p: PostRow, viewerId: string) {
    const ids = members(p.id);
    const roster = usersById(rt.ctx, [p.author_id, ...ids]);
    const byId = new Map(roster.map((u) => [u.id, u]));
    return {
      id: p.id,
      host: byId.get(p.author_id) ?? null,
      players: ids.map((id) => byId.get(id)).filter(Boolean),
      game: p.game,
      mode: p.mode,
      rank: p.rank,
      region: p.region,
      slots: p.slots,
      filled: ids.length,
      mic: !!p.mic,
      note: p.note,
      createdAt: p.created_at,
      expiresAt: p.expires_at,
      closed: p.closed_at !== null || p.expires_at < Date.now(),
      groupId: p.group_channel_id && (p.author_id === viewerId || ids.includes(viewerId)) ? p.group_channel_id : null,
      mine: p.author_id === viewerId,
      joined: ids.includes(viewerId),
    };
  }

  const getPost = (id: string) => {
    const p = db.prepare('SELECT * FROM lfg_posts WHERE id = ?').get(id) as unknown as PostRow | undefined;
    if (!p) throw notFound('Post not found');
    return p;
  };
  const announce = (id: string) => rt.toAll('lfg:update', { id });

  router.get('/lfg', (req, res) => {
    const userId = me(req);
    const game = typeof req.query.game === 'string' ? req.query.game.slice(0, 40) : '';
    const region = typeof req.query.region === 'string' ? req.query.region.slice(0, 8) : '';
    const where = [
      'closed_at IS NULL',
      'expires_at > ?',
      `author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)`,
    ];
    const args: (string | number)[] = [Date.now(), userId, userId];
    if (game) {
      where.push('game = ? COLLATE NOCASE');
      args.push(game);
    }
    if (region) {
      where.push('region = ?');
      args.push(region);
    }
    const rows = db.prepare(`SELECT * FROM lfg_posts WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 100`).all(...args) as unknown as PostRow[];
    // Your own and joined posts first, then open ones, full ones last.
    const posts = rows
      .map((p) => serialize(p, userId))
      .sort((a, b) => Number(b.mine || b.joined) - Number(a.mine || a.joined) || Number(a.filled >= a.slots) - Number(b.filled >= b.slots));
    res.json({ posts });
  });

  router.post('/lfg', (req, res) => {
    const userId = me(req);
    const game = str(req.body, 'game', { min: 1, max: 40 })!;
    const mode = str(req.body, 'mode', { max: 40, optional: true }) ?? '';
    const rank = str(req.body, 'rank', { max: 40, optional: true }) ?? '';
    const region = str(req.body, 'region', { max: 8, optional: true }) ?? '';
    if (region && !REGIONS.includes(region)) throw badRequest('Unknown region');
    const note = str(req.body, 'note', { max: 300, optional: true }) ?? '';
    const slots = Number(req.body?.slots ?? 1);
    if (!Number.isInteger(slots) || slots < 1 || slots > 9) throw badRequest('Look for between 1 and 9 players');
    const hours = Number(req.body?.hours ?? 2);
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 24) throw badRequest('Posts last between 30 minutes and a day');
    const open = db.prepare('SELECT COUNT(*) AS n FROM lfg_posts WHERE author_id = ? AND closed_at IS NULL AND expires_at > ?').get(userId, Date.now()) as {
      n: number;
    };
    if (open.n >= 3) throw new HttpError(429, 'You can have up to 3 open posts');
    const id = randomUUID();
    const now = Date.now();
    db.prepare(
      'INSERT INTO lfg_posts (id, author_id, game, mode, rank, region, slots, mic, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, userId, game, mode, rank, region, slots, req.body?.mic ? 1 : 0, note, now, now + hours * HOUR);
    announce(id);
    res.status(201).json({ post: serialize(getPost(id), userId) });
  });

  router.post('/lfg/:id/join', (req, res) => {
    const userId = me(req);
    const p = getPost(req.params.id);
    if (p.closed_at !== null || p.expires_at < Date.now()) throw new HttpError(409, 'This post has closed');
    if (p.author_id === userId) throw badRequest("That's your post");
    if (isBlockedEitherWay(db, userId, p.author_id)) throw notFound('Post not found');
    if (members(p.id).length >= p.slots) throw new HttpError(409, 'The group is full');
    db.prepare('INSERT OR IGNORE INTO lfg_members (post_id, user_id, joined_at) VALUES (?, ?, ?)').run(p.id, userId, Date.now());
    // If the squad already has a chat, bring the new player in.
    if (p.group_channel_id) addToGroup(p.group_channel_id, [userId]);
    announce(p.id);
    res.json({ post: serialize(getPost(p.id), userId) });
  });

  router.post('/lfg/:id/leave', (req, res) => {
    const userId = me(req);
    const p = getPost(req.params.id);
    db.prepare('DELETE FROM lfg_members WHERE post_id = ? AND user_id = ?').run(p.id, userId);
    announce(p.id);
    res.json({ post: serialize(getPost(p.id), userId) });
  });

  router.post('/lfg/:id/close', (req, res) => {
    const userId = me(req);
    const p = getPost(req.params.id);
    if (p.author_id !== userId) throw forbidden('Only the host can close this post');
    db.prepare('UPDATE lfg_posts SET closed_at = ? WHERE id = ?').run(Date.now(), p.id);
    announce(p.id);
    res.json({ ok: true });
  });

  function addToGroup(channelId: string, userIds: string[]) {
    const add = db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)');
    for (const u of userIds) add.run(channelId, u);
    const channel = getChannel(db, channelId);
    for (const u of userIds) {
      rt.joinChannel(u, channelId);
      rt.toUser(u, 'dm:new', serializeConversation(rt.ctx, u, channel));
    }
  }

  // Turn the squad into a group chat (the host decides when).
  router.post('/lfg/:id/group', (req, res) => {
    const userId = me(req);
    const p = getPost(req.params.id);
    if (p.author_id !== userId) throw forbidden('Only the host can start the group');
    const ids = members(p.id);
    if (ids.length === 0) throw badRequest('Nobody has joined yet');
    let channelId = p.group_channel_id;
    if (!channelId) {
      channelId = randomUUID();
      const name = `${p.game}${p.mode ? ` ${p.mode}` : ''} squad`.slice(0, 48);
      tx(db, () => {
        db.prepare("INSERT INTO channels (id, kind, name, created_by, created_at) VALUES (?, 'group', ?, ?, ?)").run(channelId, name, userId, Date.now());
        db.prepare('UPDATE lfg_posts SET group_channel_id = ? WHERE id = ?').run(channelId, p.id);
      });
    }
    addToGroup(channelId, [userId, ...ids]);
    announce(p.id);
    res.json({ conversation: serializeConversation(rt.ctx, userId, getChannel(db, channelId)), post: serialize(getPost(p.id), userId) });
  });

  return router;
}
