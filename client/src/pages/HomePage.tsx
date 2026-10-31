import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Clapperboard, Compass, Gamepad2, MessagesSquare, Newspaper, Palette, Plus, Trophy, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { relative, conversationTitle } from '../lib/format';
import { useNexus } from '../lib/store';
import type { Conversation, NexusEvent, User } from '../lib/types';
import { EventCard } from '../components/EventsView';
import { Avatar, CommunityBadge } from '../components/Avatar';

export function HomePage() {
  const { me, friends, communities, conversations, unread, upsertConversation } = useNexus();
  const navigate = useNavigate();
  const [events, setEvents] = useState<NexusEvent[]>([]);
  useEffect(() => {
    api.get<{ events: NexusEvent[] }>('/events').then((r) => setEvents(r.events)).catch(() => {});
  }, []);
  const online = friends.friends.filter((f) => f.presence !== 'offline');
  const playing = online.filter((f) => f.nowPlaying);
  const lfg = friends.friends.filter((f) => f.lfg);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Late-night grind' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  async function message(u: User) {
    const r = await api.post<{ conversation: Conversation }>('/dms', { userIds: [u.id] });
    upsertConversation(r.conversation);
    navigate(`/messages/${r.conversation.id}`);
  }

  return (
    <div className="workspace single">
      <section className="main glass">
        <div className="page home">
          <header className="home-hero" style={{ ['--av' as string]: me.accent }}>
            <div className="home-hero-text">
              <p className="eyebrow">{greeting}</p>
              <h1>{me.displayName}</h1>
              <p className="muted">
                {online.length ? `${online.length} friend${online.length === 1 ? ' is' : 's are'} online` : 'Your friends are offline'}
                {conversations.some((c) => unread.has(c.id)) ? ' · you have unread messages' : ''}
              </p>
            </div>
            <div className="home-quick">
              <Link to="/messages" className="quick"><UserPlus size={18} /> Add friends</Link>
              <Link to="/communities?new=1" className="quick"><Plus size={18} /> New community</Link>
              <Link to="/studio" className="quick"><Palette size={18} /> Customise</Link>
            </div>
          </header>

          <div className="bento">
            <article className="card span-2">
              <div className="card-head">
                <h3><Gamepad2 size={18} /> Playing now</h3>
                <Link to="/messages" className="link-btn small">All friends</Link>
              </div>
              {playing.length === 0 && online.length === 0 && (
                <div className="empty-inline">
                  <p className="muted">No one's online yet. <Link to="/messages">Add friends by username</Link> to see what they're playing.</p>
                </div>
              )}
              <div className="activity-grid">
                {(playing.length ? playing : online).slice(0, 6).map((f) => (
                  <button key={f.id} className="activity" onClick={() => message(f)} style={{ ['--av' as string]: f.accent }}>
                    <Avatar user={f} size={44} />
                    <span className="activity-text">
                      <strong>{f.displayName}</strong>
                      <span>{f.nowPlaying ? <><Gamepad2 size={12} /> {f.nowPlaying}</> : 'Online'}</span>
                    </span>
                    <MessagesSquare size={16} className="activity-cta" />
                  </button>
                ))}
              </div>
            </article>

            <article className="card">
              <div className="card-head">
                <h3><MessagesSquare size={18} /> Recent chats</h3>
              </div>
              {conversations.length === 0 && <p className="muted small">Start a conversation from your friends list.</p>}
              <div className="recent-list">
                {conversations.slice(0, 5).map((c) => (
                  <Link key={c.id} to={`/messages/${c.id}`} className={`recent ${unread.has(c.id) ? 'unread' : ''}`}>
                    <Avatar user={c.others[0] ?? me} size={32} showPresence={false} />
                    <span className="recent-text">
                      <strong>{conversationTitle(c)}</strong>
                      <span>{c.lastMessage?.text ?? 'No messages yet'}</span>
                    </span>
                    <time>{c.lastMessage ? relative(c.lastActivity) : ''}</time>
                  </Link>
                ))}
              </div>
            </article>

            <article className="card span-2">
              <div className="card-head">
                <h3><Compass size={18} /> Your communities</h3>
                <Link to="/discover" className="link-btn small">Discover more</Link>
              </div>
              {communities.length === 0 && (
                <div className="empty-inline">
                  <p className="muted">You haven't joined any communities. <Link to="/discover">Browse</Link> or <Link to="/communities?new=1">create one</Link>.</p>
                </div>
              )}
              <div className="tile-grid compact">
                {communities.slice(0, 6).map((c) => (
                  <Link key={c.id} to={`/communities/${c.id}`} className="tile" style={{ ['--cb' as string]: c.accent }}>
                    <span className="tile-glow" />
                    <CommunityBadge name={c.name} accent={c.accent} size={44} />
                    <strong>{c.name}</strong>
                    <span className="muted small">{c.memberCount} members</span>
                  </Link>
                ))}
              </div>
            </article>

            <article className="card">
              <div className="card-head">
                <h3>Looking for a team</h3>
              </div>
              {lfg.length === 0 ? (
                <p className="muted small">Friends who switch on "Looking for teammates" in their profile show up here.</p>
              ) : (
                lfg.slice(0, 5).map((f) => (
                  <div key={f.id} className="lfg-row">
                    <Avatar user={f} size={30} />
                    <span>
                      <strong>{f.displayName}</strong>
                      <span className="muted small">{f.games.slice(0, 2).join(', ') || 'Any game'}</span>
                    </span>
                  </div>
                ))
              )}
            </article>

            {events.length > 0 && (
              <article className="card span-3">
                <div className="card-head">
                  <h3><CalendarDays size={17} /> Upcoming events</h3>
                </div>
                <div className="home-events">
                  {events.slice(0, 3).map((e) => (
                    <EventCard key={e.id} e={e} compact onChange={(next) => setEvents((l) => (next ? l.map((x) => (x.id === e.id ? next : x)) : l.filter((x) => x.id !== e.id)))} />
                  ))}
                </div>
              </article>
            )}

            <article className="card span-3 roadmap-card">
              <div className="card-head"><h3>Coming to Nexus</h3></div>
              <div className="roadmap">
                {[
                  { icon: Gamepad2, t: 'Teammate finder', d: 'LFG matched by game, role and rank' },
                  { icon: Clapperboard, t: 'Clip feed', d: 'Vertical clips and montages' },
                  { icon: Newspaper, t: 'News', d: 'Patch notes for your games' },
                  { icon: Trophy, t: 'Tournaments', d: 'Brackets inside communities' },
                ].map((r) => (
                  <div key={r.t} className="road">
                    <span className="road-icon"><r.icon size={18} /></span>
                    <span><strong>{r.t}</strong><span className="muted small">{r.d}</span></span>
                    <ArrowRight size={14} className="muted" />
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
