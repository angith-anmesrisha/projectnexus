import { Router } from 'express';
import { me } from '../auth.ts';
import { badRequest } from '../http.ts';
import { serializeNotification, unreadCount, type NotificationRow } from '../notify.ts';
import type { Realtime } from '../realtime.ts';
import { serializeMessages, usersById, type MessageRow } from '../serialize.ts';

const HAS = {
  image: `m.attachments LIKE '%"kind":"image"%'`,
  video: `m.attachments LIKE '%"kind":"video"%'`,
  gif: `m.attachments LIKE '%"kind":"gif"%'`,
  file: `m.attachments LIKE '%"kind":"file"%'`,
  link: `(m.content LIKE '%http://%' OR m.content LIKE '%https://%')`,
  sticker: `m.sticker IS NOT NULL`,
} as const;

const escapeLike = (s: string) => s.replace(/[%_\\]/g, (ch) => `\\${ch}`);

export function inboxRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  // ---- Voice ----

  router.get('/voice', (req, res) => {
    res.json({ rooms: rt.voiceStates(me(req)) });
  });

  // ICE servers for WebRTC. Public STUN by default; set TURN_URL, TURN_USERNAME
  // and TURN_CREDENTIAL so calls also work behind strict NATs.
  router.get('/rtc-config', (_req, res) => {
    const iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ];
    if (process.env.TURN_URL) {
      iceServers.push({
        urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      });
    }
    res.json({ iceServers });
  });

  // ---- Notifications ----

  router.get('/notifications', (req, res) => {
    const userId = me(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as unknown as NotificationRow[];
    res.json({ notifications: rows.map((n) => serializeNotification(rt.ctx, n)), unread: unreadCount(rt.ctx, userId) });
  });

  // Mark some (ids) or all notifications as read.
  router.post('/notifications/read', (req, res) => {
    const userId = me(req);
    const ids = req.body?.ids;
    const now = Date.now();
    if (Array.isArray(ids)) {
      const mark = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL');
      for (const id of ids.slice(0, 200)) if (typeof id === 'string') mark.run(now, id, userId);
    } else if (typeof req.body?.channelId === 'string') {
      db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND channel_id = ? AND read_at IS NULL').run(
        now,
        userId,
        req.body.channelId,
      );
    } else {
      db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId);
    }
    const unread = unreadCount(rt.ctx, userId);
    rt.toUser(userId, 'notification:read', { unread });
    res.json({ unread });
  });

  router.delete('/notifications/:id', (req, res) => {
    const userId = me(req);
    db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, userId);
    const unread = unreadCount(rt.ctx, userId);
    rt.toUser(userId, 'notification:read', { unread });
    res.json({ unread });
  });

  // ---- Search across every channel the viewer can read ----

  router.get('/search', (req, res) => {
    const userId = me(req);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const from = typeof req.query.from === 'string' ? req.query.from.trim().replace(/^@/, '').slice(0, 24) : '';
    const has = typeof req.query.has === 'string' ? req.query.has : '';
    const communityId = typeof req.query.communityId === 'string' ? req.query.communityId : '';
    const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : '';
    const before = Number(req.query.before);
    if (!q && !from && !has) throw badRequest('Type something to search for');
    if (has && !(has in HAS)) throw badRequest('Unknown filter');

    const where = [
      'm.deleted_at IS NULL',
      `(c.community_id IN (SELECT community_id FROM community_members WHERE user_id = ?)
        OR c.id IN (SELECT channel_id FROM channel_members WHERE user_id = ?))`,
      // Never surface messages from people the viewer blocked, or who blocked them.
      `m.author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)`,
    ];
    const args: (string | number)[] = [userId, userId, userId, userId];
    // Every word must appear, in any order.
    for (const word of q.split(/\s+/).filter(Boolean).slice(0, 8)) {
      where.push(`m.content LIKE ? ESCAPE '\\'`);
      args.push(`%${escapeLike(word)}%`);
    }
    if (from) {
      where.push('m.author_id = (SELECT id FROM users WHERE username = ?)');
      args.push(from);
    }
    if (has) where.push(HAS[has as keyof typeof HAS]);
    if (communityId) {
      where.push('c.community_id = ?');
      args.push(communityId);
    }
    if (channelId) {
      where.push('c.id = ?');
      args.push(channelId);
    }
    if (Number.isInteger(before)) {
      where.push('m.id < ?');
      args.push(before);
    }
    const limit = 25;
    const rows = db
      .prepare(
        `SELECT m.* FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ${limit + 1}`,
      )
      .all(...args) as unknown as MessageRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // Where each result lives, so the client can label and link it.
    const channelIds = [...new Set(page.map((r) => r.channel_id))];
    const places: Record<string, unknown> = {};
    for (const id of channelIds) {
      const c = db
        .prepare(
          `SELECT ch.id, ch.kind, ch.name, ch.parent_id, ch.community_id, co.name AS community_name, co.accent
           FROM channels ch LEFT JOIN communities co ON co.id = ch.community_id WHERE ch.id = ?`,
        )
        .get(id) as {
        id: string;
        kind: string;
        name: string;
        parent_id: string | null;
        community_id: string | null;
        community_name: string | null;
        accent: string | null;
      };
      let title = c.name;
      if (c.kind === 'dm' || c.kind === 'group') {
        const others = (
          db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ? AND user_id != ?').all(id, userId) as {
            user_id: string;
          }[]
        ).map((r) => r.user_id);
        title = c.name || usersById(rt.ctx, others).map((u) => u.displayName).join(', ');
      }
      places[id] = {
        channelId: c.id,
        kind: c.kind,
        title,
        parentId: c.parent_id,
        communityId: c.community_id,
        communityName: c.community_name,
        communityAccent: c.accent,
      };
    }
    res.json({ messages: serializeMessages(rt.ctx, userId, page), places, hasMore });
  });

  return router;
}
