import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, CheckCheck, Trash2 } from 'lucide-react';
import { NotificationIcon } from '../components/Toasts';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { notificationLink, notificationVerb, showsSnippet } from '../lib/notifications';
import { getSocket } from '../lib/socket';
import { useNexus } from '../lib/store';
import type { Notification } from '../lib/types';

type Filter = 'all' | 'mentions' | 'social' | 'events';
const FILTERS: { id: Filter; label: string; match: (n: Notification) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'mentions', label: 'Mentions', match: (n) => n.kind === 'mention' || n.kind === 'reply' },
  { id: 'social', label: 'Friends', match: (n) => n.kind === 'friend_request' || n.kind === 'friend_accept' },
  { id: 'events', label: 'Events', match: (n) => n.kind === 'event' },
];

function dayBucket(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return 'Earlier';
}

export function NotificationsPage() {
  const { setNotificationsUnread, notificationsUnread } = useNexus();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    api.get<{ notifications: Notification[]; unread: number }>('/notifications').then((r) => {
      setItems(r.notifications);
      setNotificationsUnread(r.unread);
    });
    const socket = getSocket();
    const onNew = ({ notification }: { notification: Notification }) => setItems((l) => (l ? [notification, ...l] : l));
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [setNotificationsUnread]);

  async function open(n: Notification) {
    if (!n.read) {
      setItems((l) => l?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? l);
      api.post<{ unread: number }>('/notifications/read', { ids: [n.id] }).then((r) => setNotificationsUnread(r.unread));
    }
    navigate(notificationLink(n));
  }

  async function markAll() {
    setItems((l) => l?.map((x) => ({ ...x, read: true })) ?? l);
    const r = await api.post<{ unread: number }>('/notifications/read', {});
    setNotificationsUnread(r.unread);
  }

  async function remove(n: Notification) {
    setItems((l) => l?.filter((x) => x.id !== n.id) ?? l);
    const r = await api.del<{ unread: number }>(`/notifications/${n.id}`);
    setNotificationsUnread(r.unread);
  }

  const match = FILTERS.find((f) => f.id === filter)!.match;
  const shown = (items ?? []).filter(match);
  const groups: [string, Notification[]][] = [];
  for (const n of shown) {
    const b = dayBucket(n.createdAt);
    const g = groups.find(([k]) => k === b);
    if (g) g[1].push(n);
    else groups.push([b, [n]]);
  }

  return (
    <div className="page inbox-page">
      <header className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted">{notificationsUnread > 0 ? `${notificationsUnread} unread` : 'You are all caught up'}</p>
        </div>
        <button className="btn ghost" onClick={markAll} disabled={notificationsUnread === 0}>
          <CheckCheck size={16} /> Mark all read
        </button>
      </header>
      <div className="seg" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
            {f.label}
            {f.id !== 'all' && (items ?? []).some((n) => !n.read && f.match(n)) && <span className="seg-dot" />}
          </button>
        ))}
      </div>

      {items === null && (
        <div className="notif-list">
          {[0, 1, 2, 3].map((i) => <div key={i} className="notif skeleton" />)}
        </div>
      )}
      {items !== null && shown.length === 0 && (
        <div className="empty-state">
          <BellOff size={34} />
          <h3>Nothing here yet</h3>
          <p className="muted">Mentions, replies, friend requests and events show up here.</p>
        </div>
      )}
      {groups.map(([label, list]) => (
        <section key={label} className="notif-group">
          <h4 className="eyebrow">{label}</h4>
          <div className="notif-list">
            {list.map((n) => (
              <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
                <button className="notif-main" onClick={() => open(n)}>
                  <NotificationIcon n={n} />
                  <span className="notif-text">
                    <span>
                      <b>{n.actor?.displayName ?? 'Someone'}</b> {notificationVerb(n)}
                    </span>
                    {showsSnippet(n) && <span className="notif-snippet">{n.text}</span>}
                    <span className="muted small">
                      {n.communityName && n.kind !== 'event' ? `${n.communityName} · ` : ''}
                      {relative(n.createdAt)}
                    </span>
                  </span>
                  {!n.read && <span className="unread-dot" aria-label="Unread" />}
                </button>
                <button className="icon-btn sm notif-del" onClick={() => remove(n)} aria-label="Remove" data-tip="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
