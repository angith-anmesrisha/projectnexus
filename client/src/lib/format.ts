import type { Conversation, Message, MessageEvent, User } from './types';

export interface TimeOpts {
  clock24?: boolean;
  relative?: boolean;
}

export function clock(ts: number, o: TimeOpts = {}): string {
  return new Date(ts).toLocaleTimeString([], { hour: o.clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !o.clock24 });
}

export function relative(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function timeLabel(ts: number, o: TimeOpts = {}): string {
  if (o.relative) return relative(ts);
  const d = new Date(ts);
  const now = new Date();
  const time = clock(ts, o);
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString()} ${time}`;
}

/** Heading for the divider between days in a conversation. */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function conversationTitle(c: Conversation): string {
  if (c.name) return c.name;
  if (c.others.length === 0) return 'Just you';
  return c.others.map((u) => u.displayName).join(', ');
}

export const presenceLabel: Record<User['presence'], string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  offline: 'Offline',
};

/** Convert a realtime payload into this viewer's Message. */
export function fromEvent(e: MessageEvent, myId: string): Message {
  const { reactors, ...msg } = e;
  return {
    ...msg,
    reactions: msg.reactions.map((r) => ({
      ...r,
      me: reactors.some((x) => x.emoji === r.emoji && x.user_id === myId),
    })),
  };
}
