import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, CalendarPlus, Clock, MapPin, Star, Check, Trash2, Radio } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { can, type Community, type NexusEvent } from '../lib/types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

const DURATIONS = [
  { label: '30 min', ms: 30 * 60_000 },
  { label: '1 hour', ms: 60 * 60_000 },
  { label: '2 hours', ms: 2 * 60 * 60_000 },
  { label: '3 hours', ms: 3 * 60 * 60_000 },
  { label: 'All day', ms: 12 * 60 * 60_000 },
];

export function eventWhen(e: NexusEvent) {
  const start = new Date(e.startsAt);
  const end = new Date(e.endsAt);
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${t(start)} – ${t(end)}`;
}

export function countdown(ts: number) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'now';
  const m = Math.round(diff / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

export function EventCard({ e, onChange, compact }: { e: NexusEvent; onChange: (e: NexusEvent | null) => void; compact?: boolean }) {
  const live = e.startsAt <= Date.now() && e.endsAt > Date.now();
  const past = e.endsAt <= Date.now();
  const start = new Date(e.startsAt);

  async function rsvp(status: 'going' | 'interested') {
    const next = e.myRsvp === status ? null : status;
    const r = await api.post<{ event: NexusEvent }>(`/events/${e.id}/rsvp`, { status: next });
    onChange(r.event);
  }
  async function remove() {
    if (!window.confirm(`Cancel “${e.title}”?`)) return;
    await api.del(`/events/${e.id}`);
    onChange(null);
  }

  return (
    <article className={`event-card ${live ? 'live' : ''} ${past ? 'past' : ''} ${compact ? 'compact' : ''}`} style={{ ['--cb' as string]: e.communityAccent }}>
      <div className="event-date">
        <span>{start.toLocaleDateString(undefined, { month: 'short' })}</span>
        <b>{start.getDate()}</b>
      </div>
      <div className="event-body">
        <div className="event-top">
          {live ? (
            <span className="event-badge live"><Radio size={12} /> Live now</span>
          ) : past ? (
            <span className="event-badge">Ended</span>
          ) : (
            <span className="event-badge soon">{countdown(e.startsAt)}</span>
          )}
          {compact && <Link className="event-community" to={`/communities/${e.communityId}/events`}>{e.communityName}</Link>}
        </div>
        <h3>{e.title}</h3>
        <p className="event-line"><Clock size={14} /> {eventWhen(e)}</p>
        {e.location && <p className="event-line"><MapPin size={14} /> {e.location}</p>}
        {!compact && e.description && <p className="event-desc">{e.description}</p>}
        <div className="event-foot">
          <div className="avatar-stack">
            {e.attendees.slice(0, 5).map((u) => <Avatar key={u.id} user={u} size={24} showPresence={false} />)}
          </div>
          <span className="muted small">
            {e.going} going{e.interested ? ` · ${e.interested} interested` : ''}
          </span>
          {!past && (
            <div className="event-actions">
              <button className={`btn sm ${e.myRsvp === 'going' ? 'primary' : ''}`} onClick={() => rsvp('going')} aria-pressed={e.myRsvp === 'going'}>
                <Check size={14} /> Going
              </button>
              <button className={`btn sm ${e.myRsvp === 'interested' ? 'on' : 'ghost'}`} onClick={() => rsvp('interested')} aria-pressed={e.myRsvp === 'interested'}>
                <Star size={14} /> Interested
              </button>
              {e.canManage && !compact && (
                <button className="icon-btn sm danger" onClick={remove} aria-label="Cancel event" data-tip="Cancel event">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** A community's events page: live, upcoming and recently ended. */
export function EventsView({ community }: { community: Community }) {
  const [events, setEvents] = useState<NexusEvent[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setEvents(null);
    api.get<{ events: NexusEvent[] }>(`/communities/${community.id}/events`).then((r) => setEvents(r.events));
    const socket = getSocket();
    const onUpdate = (p: { event?: NexusEvent; removed?: string; communityId?: string }) => {
      if (p.removed) setEvents((l) => l?.filter((e) => e.id !== p.removed) ?? l);
      else if (p.event && p.event.communityId === community.id) {
        const ev = p.event;
        setEvents((l) => {
          if (!l) return l;
          const next = l.some((e) => e.id === ev.id) ? l.map((e) => (e.id === ev.id ? ev : e)) : [...l, ev];
          return next.sort((a, b) => a.startsAt - b.startsAt);
        });
      }
    };
    socket.on('event:update', onUpdate);
    return () => {
      socket.off('event:update', onUpdate);
    };
  }, [community.id]);

  const now = Date.now();
  const groups = useMemo(() => {
    const list = events ?? [];
    return [
      { label: 'Happening now', items: list.filter((e) => e.startsAt <= now && e.endsAt > now) },
      { label: 'Upcoming', items: list.filter((e) => e.startsAt > now) },
      { label: 'Recently ended', items: list.filter((e) => e.endsAt <= now).reverse() },
    ].filter((g) => g.items.length);
  }, [events, now]);

  const change = (id: string) => (e: NexusEvent | null) =>
    setEvents((l) => (e ? l?.map((x) => (x.id === id ? e : x)) : l?.filter((x) => x.id !== id)) ?? l);

  return (
    <div className="events-view">
      <header className="chat-head">
        <span className="chat-head-icon"><CalendarDays size={20} /></span>
        <div className="chat-head-text">
          <h1>Events</h1>
          <span className="chat-topic">Scrims, watch parties, tournaments and game nights in {community.name}</span>
        </div>
        <div className="chat-head-actions">
          {can(community, 'manageEvents') && (
            <button className="btn primary sm" onClick={() => setCreating(true)}>
              <CalendarPlus size={15} /> Schedule
            </button>
          )}
        </div>
      </header>
      <div className="events-scroll">
        {events === null && [0, 1].map((i) => <div key={i} className="event-card skeleton" />)}
        {events !== null && events.length === 0 && (
          <div className="empty-state">
            <CalendarDays size={36} />
            <h3>Nothing scheduled</h3>
            <p className="muted">
              {can(community, 'manageEvents') ? 'Plan a scrim, a watch party or a game night and everyone gets notified.' : 'When the team schedules something, it shows up here.'}
            </p>
            {can(community, 'manageEvents') && (
              <button className="btn primary" onClick={() => setCreating(true)}><CalendarPlus size={16} /> Schedule an event</button>
            )}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label} className="event-group">
            <h4 className="eyebrow">{g.label}</h4>
            {g.items.map((e) => <EventCard key={e.id} e={e} onChange={change(e.id)} />)}
          </section>
        ))}
      </div>
      {creating && (
        <CreateEventModal
          community={community}
          onClose={() => setCreating(false)}
          onCreated={(e) => {
            setCreating(false);
            setEvents((l) => [...(l ?? []).filter((x) => x.id !== e.id), e].sort((a, b) => a.startsAt - b.startsAt));
          }}
        />
      )}
    </div>
  );
}

/** "2026-11-01T20:00" for a datetime-local input, in local time. */
function localInput(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateEventModal({ community, onClose, onCreated }: { community: Community; onClose: () => void; onCreated: (e: NexusEvent) => void }) {
  const tomorrow8pm = new Date();
  tomorrow8pm.setDate(tomorrow8pm.getDate() + 1);
  tomorrow8pm.setHours(20, 0, 0, 0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState(localInput(tomorrow8pm.getTime()));
  const [duration, setDuration] = useState(DURATIONS[2].ms);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      const startsAt = new Date(start).getTime();
      const r = await api.post<{ event: NexusEvent }>(`/communities/${community.id}/events`, {
        title,
        description,
        location,
        startsAt,
        endsAt: startsAt + duration,
      });
      onCreated(r.event);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Schedule an event" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={80} placeholder="Friday night scrims" autoFocus />
        </label>
        <div className="form-2col">
          <label className="field">
            <span>Starts</span>
            <input type="datetime-local" value={start} min={localInput(Date.now())} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="field">
            <span>Length</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d.ms} value={d.ms}>{d.label}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Where</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={100} placeholder="#scrims, a lobby code, or a stream link" />
        </label>
        <label className="field">
          <span>Details</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="Format, rules, who should come…" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Scheduling…' : 'Schedule'}</button>
        </div>
      </form>
    </Modal>
  );
}
