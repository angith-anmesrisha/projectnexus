import type { Notification } from './types';

/** Where clicking a notification should take you. */
export function notificationLink(n: Notification): string {
  switch (n.kind) {
    case 'mention':
    case 'reply':
      if (!n.communityId || !n.channelId) return '/notifications';
      if (n.channelKind === 'thread' && n.parentId) return `/communities/${n.communityId}/${n.parentId}?post=${n.channelId}`;
      return `/communities/${n.communityId}/${n.channelId}${n.messageId ? `?m=${n.messageId}` : ''}`;
    case 'event':
      return n.communityId ? `/communities/${n.communityId}/events` : '/notifications';
    case 'friend_request':
    case 'friend_accept':
      return '/messages';
  }
}

/** One-line description, without the actor's name (shown separately in bold). */
export function notificationVerb(n: Notification): string {
  const where = n.channelKind === 'thread' ? `in “${n.channelName}”` : n.channelName ? `in #${n.channelName}` : '';
  switch (n.kind) {
    case 'mention':
      return `mentioned you ${where}`;
    case 'reply':
      return `replied to you ${where}`;
    case 'friend_request':
      return 'sent you a friend request';
    case 'friend_accept':
      return 'accepted your friend request';
    case 'event':
      return `scheduled ${n.text ? `“${n.text}”` : 'an event'}${n.communityName ? ` in ${n.communityName}` : ''}`;
  }
}

export const showsSnippet = (n: Notification) => (n.kind === 'mention' || n.kind === 'reply') && !!n.text;
