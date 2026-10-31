// Server-side authorization. Every route that touches a channel, message or
// community goes through these checks; the client is never trusted to hide
// things it should not see.
import type { DB } from './db.ts';
import { badRequest, forbidden, notFound } from './http.ts';

export type Role = 'owner' | 'admin' | 'member';
export type ChannelKind = 'text' | 'announcement' | 'forum' | 'thread' | 'voice' | 'dm' | 'group';

export interface ChannelRow {
  id: string;
  community_id: string | null;
  kind: ChannelKind;
  name: string;
  topic: string;
  position: number;
  created_by: string | null;
  created_at: number;
  parent_id: string | null;
}

/** Community permissions, stored as a bit set on custom roles. */
export const PERMS = {
  manageCommunity: 1,
  manageChannels: 2,
  manageRoles: 4,
  manageMessages: 8,
  kickMembers: 16,
  createInvites: 32,
  manageEvents: 64,
  mentionEveryone: 128,
  postAnnouncements: 256,
} as const;
export type Perm = (typeof PERMS)[keyof typeof PERMS];
export const ALL_PERMS = Object.values(PERMS).reduce((a, b) => a | b, 0);

export const isModRole = (role: Role | null) => role === 'owner' || role === 'admin';

export function communityRole(db: DB, userId: string, communityId: string): Role | null {
  const row = db
    .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(communityId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

/**
 * What a member may do in a community. Owners and admins can do everything;
 * other members get the union of their custom roles. Non-members get 0.
 */
export function communityPermissions(db: DB, userId: string, communityId: string): number {
  const role = communityRole(db, userId, communityId);
  if (!role) return 0;
  if (isModRole(role)) return ALL_PERMS;
  const rows = db
    .prepare(
      `SELECT r.permissions FROM member_roles mr JOIN roles r ON r.id = mr.role_id
       WHERE mr.user_id = ? AND mr.community_id = ?`,
    )
    .all(userId, communityId) as { permissions: number }[];
  return rows.reduce((acc, r) => acc | r.permissions, 0) & ALL_PERMS;
}

export const hasPerm = (db: DB, userId: string, communityId: string, perm: Perm) =>
  (communityPermissions(db, userId, communityId) & perm) === perm;

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
    if (!hasPerm(db, userId, channel.community_id!, PERMS.postAnnouncements)) {
      throw forbidden('Only community admins can post in announcement channels');
    }
  }
  if (channel.kind === 'forum') throw badRequest('Start a new post in a forum instead');
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
  return hasPerm(db, userId, channel.community_id, PERMS.manageMessages);
}

/** Pinning is open to every member of a DM or group, and to community moderators. */
export function canPin(db: DB, userId: string, channel: ChannelRow): boolean {
  return channel.community_id ? canModerateChannel(db, userId, channel) : true;
}
