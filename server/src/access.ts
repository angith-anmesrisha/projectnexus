// Server-side authorization. Every route that touches a channel, message or
// community goes through these checks; the client is never trusted to hide
// things it should not see.
import type { DB } from './db.ts';
import { forbidden, notFound } from './http.ts';

export type Role = 'owner' | 'admin' | 'member';
export type ChannelKind = 'text' | 'announcement' | 'dm' | 'group';

export interface ChannelRow {
  id: string;
  community_id: string | null;
  kind: ChannelKind;
  name: string;
  topic: string;
  position: number;
  created_by: string | null;
  created_at: number;
}

export const isModRole = (role: Role | null) => role === 'owner' || role === 'admin';

export function communityRole(db: DB, userId: string, communityId: string): Role | null {
  const row = db
    .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(communityId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

export function isBlockedEitherWay(db: DB, a: string, b: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    )
    .get(a, b, b, a);
}

export function areFriends(db: DB, a: string, b: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM friendships WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
    )
    .get(a, b, b, a);
}

export function getChannel(db: DB, channelId: string): ChannelRow {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as
    | ChannelRow
    | undefined;
  if (!channel) throw notFound('Channel not found');
  return channel;
}

export function channelMemberIds(db: DB, channelId: string): string[] {
  return (
    db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ?').all(channelId) as {
      user_id: string;
    }[]
  ).map((r) => r.user_id);
}

export function canReadChannel(db: DB, userId: string, channel: ChannelRow): boolean {
  if (channel.community_id) return communityRole(db, userId, channel.community_id) !== null;
  return !!db
    .prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?')
    .get(channel.id, userId);
}

/**
 * Load a channel the user may read. Responds 404 rather than 403 so that
 * private channel ids cannot be probed.
 */
export function readableChannel(db: DB, userId: string, channelId: string): ChannelRow {
  const channel = getChannel(db, channelId);
  if (!canReadChannel(db, userId, channel)) throw notFound('Channel not found');
  return channel;
}

export function assertCanPost(db: DB, userId: string, channel: ChannelRow): void {
  if (channel.kind === 'announcement') {
    if (!isModRole(communityRole(db, userId, channel.community_id!))) {
      throw forbidden('Only community admins can post in announcement channels');
    }
  }
  if (channel.kind === 'dm') {
    const other = channelMemberIds(db, channel.id).find((id) => id !== userId);
    if (other && isBlockedEitherWay(db, userId, other)) {
      throw forbidden('You cannot message this user');
    }
  }
}

/** Moderators may delete anyone's messages; in DMs and groups nobody can. */
export function canModerateChannel(db: DB, userId: string, channel: ChannelRow): boolean {
  if (!channel.community_id) return false;
  return isModRole(communityRole(db, userId, channel.community_id));
}

/** Pinning is open to every member of a DM or group, and to community moderators. */
export function canPin(db: DB, userId: string, channel: ChannelRow): boolean {
  return channel.community_id ? canModerateChannel(db, userId, channel) : true;
}
