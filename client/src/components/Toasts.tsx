import { useNavigate } from 'react-router-dom';
import { AtSign, CalendarDays, CornerUpLeft, Shield, Trophy, UserPlus, X } from 'lucide-react';
import { notificationLink, notificationVerb, showsSnippet } from '../lib/notifications';
import { useNexus } from '../lib/store';
import type { Notification } from '../lib/types';
import { Avatar } from './Avatar';

export const KIND_ICON = {
  mention: AtSign,
  reply: CornerUpLeft,
  friend_request: UserPlus,
  friend_accept: UserPlus,
  event: CalendarDays,
  team_invite: Shield,
  tournament: Trophy,
} as const;

export function NotificationIcon({ n }: { n: Notification }) {
  const Icon = KIND_ICON[n.kind];
  return (
    <span className="notif-avatar">
      {n.actor ? <Avatar user={n.actor} size={38} showPresence={false} /> : <span className="notif-blank" />}
      <span className={`notif-kind k-${n.kind}`}><Icon size={11} strokeWidth={2.6} /></span>
    </span>
  );
}

/** Pop-ups for live notifications, bottom-right. */
export function Toasts() {
  const { toasts, dismissToast } = useNexus();
  const navigate = useNavigate();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((n) => (
        <div key={n.id} className="toast glass">
          <button
            className="toast-body"
            onClick={() => {
              dismissToast(n.id);
              navigate(notificationLink(n));
            }}
          >
            <NotificationIcon n={n} />
            <span className="toast-text">
              <span><b>{n.actor?.displayName ?? 'Someone'}</b> {notificationVerb(n)}</span>
              {showsSnippet(n) && <span className="toast-snippet">{n.text}</span>}
            </span>
          </button>
          <button className="icon-btn sm" onClick={() => dismissToast(n.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
