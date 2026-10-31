export type Presence = 'online' | 'idle' | 'dnd' | 'offline';
export type Status = 'online' | 'idle' | 'dnd' | 'invisible';
export type Role = 'owner' | 'admin' | 'member';
export type ChannelKind = 'text' | 'announcement' | 'forum' | 'thread' | 'dm' | 'group';

export interface User {
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
  avatar: string | null;
  banner: string | null;
}

export interface Me extends User {
  status: Status;
}

export interface FriendLists {
  friends: User[];
  incoming: User[];
  outgoing: User[];
  blocked: User[];
}

export interface Channel {
  id: string;
  communityId: string | null;
  kind: ChannelKind;
  name: string;
  topic: string;
  position: number;
  parentId?: string | null;
}

export interface Conversation extends Channel {
  members: User[];
  others: User[];
  lastActivity: number;
  lastMessage: { authorId: string; text: string } | null;
}

export interface CommunitySummary {
  id: string;
  name: string;
  description: string;
  game: string;
  accent: string;
  ownerId: string;
  memberCount: number;
  role: Role | null;
  /** The viewer's permission bits in this community (see PERMS). */
  permissions: number;
  inviteCode?: string;
}

export interface CommunityRole {
  id: string;
  name: string;
  color: string;
  permissions: number;
  position: number;
  hoist: boolean;
}

export type Member = User & { role: Role; roleIds: string[] };

export interface Community extends CommunitySummary {
  channels: Channel[];
  members: Member[];
  roles: CommunityRole[];
}

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
export type PermKey = keyof typeof PERMS;
export const can = (c: { permissions?: number } | null | undefined, perm: PermKey) =>
  !!c && ((c.permissions ?? 0) & PERMS[perm]) === PERMS[perm];

export type NotificationKind = 'mention' | 'reply' | 'friend_request' | 'friend_accept' | 'event';

export interface Notification {
  id: string;
  kind: NotificationKind;
  actor: User | null;
  communityId: string | null;
  communityName: string | null;
  communityAccent: string | null;
  channelId: string | null;
  channelName: string | null;
  channelKind: ChannelKind | null;
  parentId: string | null;
  messageId: number | null;
  eventId: string | null;
  text: string;
  read: boolean;
  createdAt: number;
}

export interface Thread {
  id: string;
  forumId: string;
  communityId: string;
  title: string;
  author: User | null;
  createdAt: number;
  lastActivity: number;
  replies: number;
  preview: string;
  image: string | null;
  reactions: Reaction[];
}

export interface NexusEvent {
  id: string;
  communityId: string;
  communityName: string;
  communityAccent: string;
  title: string;
  description: string;
  location: string;
  startsAt: number;
  endsAt: number;
  creator: User | null;
  going: number;
  interested: number;
  attendees: User[];
  myRsvp: 'going' | 'interested' | null;
  canManage: boolean;
}

export interface SearchPlace {
  channelId: string;
  kind: ChannelKind;
  title: string;
  parentId: string | null;
  communityId: string | null;
  communityName: string | null;
  communityAccent: string | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

export interface Attachment {
  kind: 'image' | 'video' | 'gif' | 'file';
  url: string;
  name: string;
  mime: string;
  size: number | null;
  width: number | null;
  height: number | null;
}

export interface StickerRef {
  id: string;
  name?: string;
  url?: string;
}

export interface Message {
  id: number;
  channelId: string;
  author: User;
  content: string;
  attachments: Attachment[];
  sticker: StickerRef | null;
  pinned: boolean;
  editedAt: number | null;
  createdAt: number;
  reactions: Reaction[];
  replyTo: { id: number; author: User; content: string | null } | null;
}

/** Realtime message payloads carry raw reactor ids so each client can compute "me". */
export interface MessageEvent extends Message {
  reactors: { emoji: string; user_id: string }[];
}
