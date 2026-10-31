export type Presence = 'online' | 'idle' | 'dnd' | 'offline';
export type Status = 'online' | 'idle' | 'dnd' | 'invisible';
export type Role = 'owner' | 'admin' | 'member';
export type ChannelKind = 'text' | 'announcement' | 'dm' | 'group';

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
  inviteCode?: string;
}

export interface Community extends CommunitySummary {
  channels: Channel[];
  members: (User & { role: Role })[];
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
