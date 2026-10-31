// In-app notifications: mentions, replies, friend activity and events.
// Each one is stored for the inbox and pushed live to the user's sockets.
import { randomUUID } from 'node:crypto';
import { isBlockedEitherWay } from './access.ts';
import type { Realtime } from './realtime.ts';
import { getUser, publicUser, type Ctx } from './serialize.ts';

export type NotificationKind = 'mention' | 'reply' | 'friend_request' | 'friend_accept' | 'event';

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: NotificationKind;
  actor_id: string | null;
  community_id: string | null;
  channel_id: string | null;
  message_id: number | null;
  event_id: string | null;
  text: string;
  read_at: number | null;
  created_at: number;
}

interface NotifyInput {
  kind: NotificationKind;
  actorId: string;
  communityId?: string | null;
  channelId?: string | null;
  messageId?: number | null;
  eventId?: string | null;
  text?: string;
}

const MAX_KEPT = 200;

export function serializeNotification(ctx: Ctx, n: NotificationRow) {
  const actor = n.actor_id ? getUser(ctx.db, n.actor_id) : undefined;
  const community = n.community_id
    ? (ctx.db.prepare('SELECT name, accent FROM communities WHERE id = ?').get(n.community_id) as
        | { name: string; accent: string }
        | undefined)
    : undefined;
  const channel = n.channel_id
    ? (ctx.db.prepare('SELECT name, kind, parent_id FROM channels WHERE id = ?').get(n.channel_id) as
        | { name: string; kind: string; parent_id: string | null }
        | undefined)
    : undefined;
  return {
    id: n.id,
    kind: n.kind,
    actor: actor ? publicUser(ctx, actor) : null,
    communityId: n.community_id,
    communityName: community?.name ?? null,
    communityAccent: community?.accent ?? null,
    channelId: n.channel_id,
    channelName: channel?.name ?? null,
    channelKind: channel?.kind ?? null,
    parentId: channel?.parent_id ?? null,
    messageId: n.message_id,
    eventId: n.event_id,
    text: n.text,
    read: n.read_at !== null,
    createdAt: n.created_at,
  };
}

export function unreadCount(ctx: Ctx, userId: string): number {
  return (
    ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as {
      n: number;
    }
  ).n;
}

/** Notify each recipient once, skipping the actor and anyone blocked either way. */
export function notify(rt: Realtime, recipients: Iterable<string>, input: NotifyInput) {
  const { db } = rt.ctx;
  const insert = db.prepare(
    `INSERT INTO notifications (id, user_id, kind, actor_id, community_id, channel_id, message_id, event_id, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const prune = db.prepare(
    `DELETE FROM notifications WHERE user_id = ? AND id NOT IN
       (SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ${MAX_KEPT})`,
  );
  const now = Date.now();
  for (const userId of new Set(recipients)) {
    if (userId === input.actorId || isBlockedEitherWay(db, userId, input.actorId)) continue;
    const id = randomUUID();
    insert.run(
      id,
      userId,
      input.kind,
      input.actorId,
      input.communityId ?? null,
      input.channelId ?? null,
      input.messageId ?? null,
      input.eventId ?? null,
      (input.text ?? '').slice(0, 200),
      now,
    );
    prune.run(userId, userId);
    const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as unknown as NotificationRow;
    rt.toUser(userId, 'notification:new', { notification: serializeNotification(rt.ctx, row), unread: unreadCount(rt.ctx, userId) });
  }
}
