import type { DB } from './db.ts';
import type { ChannelRow } from './access.ts';
import { channelMemberIds } from './access.ts';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  bio: string;
  accent: string;
  status: 'online' | 'idle' | 'dnd' | 'invisible';
  now_playing: string;
  lfg: number;
  games: string;
  created_at: number;
}

export type Presence = 'online' | 'idle' | 'dnd' | 'offline';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  accent: string;
  presence: Presence;
  nowPlaying: string;
  lfg: boolean;
  games: string[];
  createdAt: number;
}

export interface Ctx {
  db: DB;
  isOnline: (userId: string) => boolean;
}

/**
 * Presence as other people see it. Invisible users always appear offline, and
 * "now playing" is hidden along with it.
 */
export function presenceOf(ctx: Ctx, user: UserRow): Presence {
  if (user.status === 'invisible' || !ctx.isOnline(user.id)) return 'offline';
  return user.status;
}

export function publicUser(ctx: Ctx, user: UserRow): PublicUser {
  const presence = presenceOf(ctx, user);
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    accent: user.accent,
    presence,
    nowPlaying: presence === 'offline' ? '' : user.now_playing,
    lfg: !!user.lfg,
    games: JSON.parse(user.games),
    createdAt: user.created_at,
  };
}

/** The signed-in user's own view, which includes their chosen status. */
export function selfUser(ctx: Ctx, user: UserRow) {
  return { ...publicUser(ctx, user), nowPlaying: user.now_playing, status: user.status };
}

export function getUser(db: DB, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function usersById(ctx: Ctx, ids: string[]): PublicUser[] {
  if (ids.length === 0) return [];
  const rows = ctx.db
    .prepare(`SELECT * FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as unknown as UserRow[];
  return rows.map((r) => publicUser(ctx, r));
}

export interface MessageRow {
  id: number;
  channel_id: string;
  author_id: string;
  content: string;
  reply_to_id: number | null;
  pinned: number;
  edited_at: number | null;
  deleted_at: number | null;
  created_at: number;
}

export function serializeMessages(ctx: Ctx, viewerId: string, rows: MessageRow[]) {
  if (rows.length === 0) return [];
  const { db } = ctx;
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');

  const reactionRows = db
    .prepare(
      `SELECT message_id, emoji, COUNT(*) AS count, MAX(user_id = ?) AS mine
       FROM reactions WHERE message_id IN (${marks})
       GROUP BY message_id, emoji ORDER BY MIN(rowid)`,
    )
    .all(viewerId, ...ids) as { message_id: number; emoji: string; count: number; mine: number }[];
  const reactions = new Map<number, { emoji: string; count: number; me: boolean }[]>();
  for (const r of reactionRows) {
    const list = reactions.get(r.message_id) ?? [];
    list.push({ emoji: r.emoji, count: r.count, me: !!r.mine });
    reactions.set(r.message_id, list);
  }

  const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter((v): v is number => v !== null))];
  const replies = new Map<number, MessageRow>();
  if (replyIds.length) {
    const replyRows = db
      .prepare(`SELECT * FROM messages WHERE id IN (${replyIds.map(() => '?').join(',')})`)
      .all(...replyIds) as unknown as MessageRow[];
    for (const r of replyRows) replies.set(r.id, r);
  }

  const authorIds = new Set(rows.map((r) => r.author_id));
  for (const r of replies.values()) authorIds.add(r.author_id);
  const authors = new Map(usersById(ctx, [...authorIds]).map((u) => [u.id, u]));

  return rows.map((r) => {
    const reply = r.reply_to_id !== null ? replies.get(r.reply_to_id) : undefined;
    return {
      id: r.id,
      channelId: r.channel_id,
      author: authors.get(r.author_id)!,
      content: r.content,
      pinned: !!r.pinned,
      editedAt: r.edited_at,
      createdAt: r.created_at,
      reactions: reactions.get(r.id) ?? [],
      replyTo: reply
        ? {
            id: reply.id,
            author: authors.get(reply.author_id)!,
            content: reply.deleted_at ? null : reply.content.slice(0, 200),
          }
        : null,
    };
  });
}

export function getMessageRow(db: DB, id: number): MessageRow | undefined {
  return db.prepare('SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL').get(id) as
    | MessageRow
    | undefined;
}

export function serializeChannel(c: ChannelRow) {
  return {
    id: c.id,
    communityId: c.community_id,
    kind: c.kind,
    name: c.name,
    topic: c.topic,
    position: c.position,
  };
}

/** A DM or group conversation as shown in the viewer's sidebar. */
export function serializeConversation(ctx: Ctx, viewerId: string, c: ChannelRow) {
  const members = usersById(ctx, channelMemberIds(ctx.db, c.id));
  const last = ctx.db
    .prepare(
      'SELECT created_at FROM messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
    )
    .get(c.id) as { created_at: number } | undefined;
  return {
    ...serializeChannel(c),
    members,
    others: members.filter((m) => m.id !== viewerId),
    lastActivity: last?.created_at ?? c.created_at,
  };
}
