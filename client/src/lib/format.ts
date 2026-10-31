import type { Conversation, Message, MessageEvent, User } from './types';

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString()} ${time}`;
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
