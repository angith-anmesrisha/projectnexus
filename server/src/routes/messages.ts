import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import {
  areFriends,
  assertCanPost,
  canModerateChannel,
  canPin,
  channelMemberIds,
  getChannel,
  isBlockedEitherWay,
  readableChannel,
  type ChannelRow,
} from '../access.ts';
import { tx } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { getMessageRow, serializeConversation, serializeMessages, type MessageRow } from '../serialize.ts';

const MAX_MESSAGE = 2000;
const MAX_GROUP = 10;
// Keep reactions to a single emoji grapheme or a short :shortcode:.
const EMOJI = /^(\p{Extended_Pictographic}(️|‍|\p{Extended_Pictographic}|\p{Emoji_Modifier})*|:[a-z0-9_]{1,32}:)$/u;

export function messageRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  // Per-user send throttle: at most 8 messages in any 5 second window.
  const recentSends = new Map<string, number[]>();
  function throttle(userId: string) {
    const now = Date.now();
    const recent = (recentSends.get(userId) ?? []).filter((t) => now - t < 5000);
    if (recent.length >= 8) throw new HttpError(429, 'Slow down a little');
    recent.push(now);
    recentSends.set(userId, recent);
  }

  function emitMessage(event: 'message:new' | 'message:update', channel: ChannelRow, messageId: number) {
    const row = getMessageRow(db, messageId);
    if (!row) return;
    // Reactions carry a per-viewer "me" flag, so serialize once with no viewer
    // and let clients work out their own flag from the reacting user ids.
    const [msg] = serializeMessages(rt.ctx, '', [row]);
    const reactors = db
      .prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ?')
      .all(messageId) as { emoji: string; user_id: string }[];
    rt.toChannel(channel.id, event, { ...msg, reactors });
  }

  /** A message the viewer can see, plus its channel. */
  function visibleMessage(viewerId: string, rawId: string) {
    const id = Number(rawId);
    if (!Number.isInteger(id)) throw notFound('Message not found');
    const row = getMessageRow(db, id);
    if (!row) throw notFound('Message not found');
    const channel = readableChannel(db, viewerId, row.channel_id);
    return { row, channel };
  }

  // ---- Reading and posting ----

  router.get('/channels/:id/messages', (req, res) => {
    const channel = readableChannel(db, me(req), req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = Number(req.query.before);
    const rows = (
      Number.isInteger(before)
        ? db
            .prepare(
              'SELECT * FROM messages WHERE channel_id = ? AND deleted_at IS NULL AND id < ? ORDER BY id DESC LIMIT ?',
            )
            .all(channel.id, before, limit)
        : db
            .prepare('SELECT * FROM messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?')
            .all(channel.id, limit)
    ) as unknown as MessageRow[];
    rows.reverse();
    res.json({ messages: serializeMessages(rt.ctx, me(req), rows), hasMore: rows.length === limit });
  });

  router.get('/channels/:id/pins', (req, res) => {
    const channel = readableChannel(db, me(req), req.params.id);
    const rows = db
      .prepare('SELECT * FROM messages WHERE channel_id = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY id DESC')
      .all(channel.id) as unknown as MessageRow[];
    res.json({ messages: serializeMessages(rt.ctx, me(req), rows) });
  });

  router.post('/channels/:id/messages', (req, res) => {
    const userId = me(req);
    const channel = readableChannel(db, userId, req.params.id);
    assertCanPost(db, userId, channel);
    const content = str(req.body, 'content', { min: 1, max: MAX_MESSAGE })!;
    let replyTo: number | null = null;
    if (req.body?.replyToId !== undefined && req.body.replyToId !== null) {
      const target = getMessageRow(db, Number(req.body.replyToId));
      if (!target || target.channel_id !== channel.id) throw badRequest('You can only reply within the same channel');
      replyTo = target.id;
    }
    throttle(userId);

    const result = db
      .prepare('INSERT INTO messages (channel_id, author_id, content, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(channel.id, userId, content, replyTo, Date.now());
    const id = Number(result.lastInsertRowid);
    emitMessage('message:new', channel, id);
    const [message] = serializeMessages(rt.ctx, userId, [getMessageRow(db, id)!]);
    res.status(201).json({ message });
  });

  router.patch('/messages/:id', (req, res) => {
    const userId = me(req);
    const { row, channel } = visibleMessage(userId, req.params.id);
    if (row.author_id !== userId) throw forbidden('You can only edit your own messages');
    const content = str(req.body, 'content', { min: 1, max: MAX_MESSAGE })!;
    db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(content, Date.now(), row.id);
    emitMessage('message:update', channel, row.id);
    res.json({ message: serializeMessages(rt.ctx, userId, [getMessageRow(db, row.id)!])[0] });
  });

  router.delete('/messages/:id', (req, res) => {
    const userId = me(req);
    const { row, channel } = visibleMessage(userId, req.params.id);
    if (row.author_id !== userId && !canModerateChannel(db, userId, channel)) {
      throw forbidden('You can only delete your own messages');
    }
    // Soft delete so replies can say the original was removed.
    db.prepare("UPDATE messages SET content = '', pinned = 0, deleted_at = ? WHERE id = ?").run(Date.now(), row.id);
    db.prepare('DELETE FROM reactions WHERE message_id = ?').run(row.id);
    rt.toChannel(channel.id, 'message:delete', { id: row.id, channelId: channel.id });
    res.json({ ok: true });
  });

  router.post('/messages/:id/reactions', (req, res) => {
    const userId = me(req);
    const { row, channel } = visibleMessage(userId, req.params.id);
    const emoji = str(req.body, 'emoji', { min: 1, max: 34 })!;
    if (!EMOJI.test(emoji)) throw badRequest('That is not a supported reaction');
    const existing = db
      .prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .get(row.id, userId, emoji);
    if (existing) {
      db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(row.id, userId, emoji);
    } else {
      const { n } = db.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?').get(row.id) as {
        n: number;
      };
      if (n >= 20) throw badRequest('This message has too many different reactions');
      db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(row.id, userId, emoji);
    }
    emitMessage('message:update', channel, row.id);
    res.json({ message: serializeMessages(rt.ctx, userId, [getMessageRow(db, row.id)!])[0] });
  });

  router.post('/messages/:id/pin', (req, res) => {
    const userId = me(req);
    const { row, channel } = visibleMessage(userId, req.params.id);
    if (!canPin(db, userId, channel)) throw forbidden('Only community admins can pin messages');
    const pinned = req.body?.pinned === false ? 0 : 1;
    db.prepare('UPDATE messages SET pinned = ? WHERE id = ?').run(pinned, row.id);
    emitMessage('message:update', channel, row.id);
    res.json({ message: serializeMessages(rt.ctx, userId, [getMessageRow(db, row.id)!])[0] });
  });

  // ---- Direct conversations ----

  router.get('/dms', (req, res) => {
    const userId = me(req);
    const rows = db
      .prepare(
        `SELECT c.* FROM channels c JOIN channel_members m ON m.channel_id = c.id
         WHERE m.user_id = ? AND c.community_id IS NULL`,
      )
      .all(userId) as unknown as ChannelRow[];
    const conversations = rows
      .map((c) => serializeConversation(rt.ctx, userId, c))
      .sort((a, b) => b.lastActivity - a.lastActivity);
    res.json({ conversations });
  });

  router.post('/dms', (req, res) => {
    const userId = me(req);
    const raw = req.body?.userIds;
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((v) => typeof v !== 'string')) {
      throw badRequest('Pick at least one friend');
    }
    const others = [...new Set(raw as string[])].filter((id) => id !== userId);
    if (others.length === 0) throw badRequest('Pick at least one friend');
    if (others.length + 1 > MAX_GROUP) throw badRequest(`Group chats can have at most ${MAX_GROUP} people`);
    for (const other of others) {
      if (!areFriends(db, userId, other) || isBlockedEitherWay(db, userId, other)) {
        throw forbidden('You can only start conversations with friends');
      }
    }

    if (others.length === 1) {
      // Reuse the existing one-to-one conversation if there is one.
      const existing = db
        .prepare(
          `SELECT c.* FROM channels c
           JOIN channel_members a ON a.channel_id = c.id AND a.user_id = ?
           JOIN channel_members b ON b.channel_id = c.id AND b.user_id = ?
           WHERE c.kind = 'dm'`,
        )
        .get(userId, others[0]) as ChannelRow | undefined;
      if (existing) {
        res.json({ conversation: serializeConversation(rt.ctx, userId, existing) });
        return;
      }
    }

    const kind = others.length === 1 ? 'dm' : 'group';
    const name = kind === 'group' ? (str(req.body, 'name', { max: 48, optional: true }) ?? '') : '';
    const channelId = randomUUID();
    const members = [userId, ...others];
    tx(db, () => {
      db.prepare('INSERT INTO channels (id, kind, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
        channelId,
        kind,
        name,
        userId,
        Date.now(),
      );
      for (const m of members) db.prepare('INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)').run(channelId, m);
    });
    const channel = getChannel(db, channelId);
    for (const m of members) {
      rt.joinChannel(m, channelId);
      rt.toUser(m, 'dm:new', serializeConversation(rt.ctx, m, channel));
    }
    res.status(201).json({ conversation: serializeConversation(rt.ctx, userId, channel) });
  });

  router.post('/dms/:id/leave', (req, res) => {
    const userId = me(req);
    const channel = readableChannel(db, userId, req.params.id);
    if (channel.kind !== 'group') throw badRequest('Only group chats can be left');
    db.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').run(channel.id, userId);
    rt.leaveChannel(userId, channel.id);
    if (channelMemberIds(db, channel.id).length === 0) db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
    res.json({ ok: true });
  });

  return router;
}
