import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Clapperboard,
  Compass,
  House,
  LayoutGrid,
  LogOut,
  MessagesSquare,
  Newspaper,
  Palette,
  Plus,
  Search,
  Trophy,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAppearance } from '../lib/appearanceStore';
import { useNexus } from '../lib/store';
import type { Me, Status } from '../lib/types';
import { Avatar, CommunityBadge } from './Avatar';
import { CommandPalette } from './CommandPalette';
import { SearchModal } from './SearchModal';
import { Toasts } from './Toasts';
import { IncomingCallCard, VoiceDock } from './VoiceRoom';
import { VoiceAudio, useVoice } from '../lib/voice';
import { conversationTitle } from '../lib/format';

const NAV: { to: string; label: string; icon: LucideIcon; soon?: boolean }[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/messages', label: 'Messages', icon: MessagesSquare },
  { to: '/communities', label: 'Communities', icon: LayoutGrid },
  { to: '/feed', label: 'Feed', icon: Clapperboard, soon: true },
  { to: '/news', label: 'News', icon: Newspaper, soon: true },
  { to: '/tournaments', label: 'Tournaments', icon: Trophy, soon: true },
  { to: '/notifications', label: 'Inbox', icon: Bell },
];

const STATUS: { value: Status; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Idle' },
  { value: 'dnd', label: 'Do not disturb' },
  { value: 'invisible', label: 'Invisible' },
];

export function Shell() {
  const { me, setMe, unread, conversations, communities, communityDetails, friends, connected, logout, notificationsUnread } = useNexus();
  const { appearance, plugin, setPlugin } = useAppearance();
  const [palette, setPalette] = useState(false);
  const [search, setSearch] = useState(false);
  const voice = useVoice();
  const [meMenu, setMeMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setPalette(false);
        setSearch(true);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setPlugin('focusMode', !plugin('focusMode'));
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        navigate('/studio');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plugin, setPlugin, navigate]);

  useEffect(() => {
    if (!meMenu) return;
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMeMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [meMenu]);

  const dmUnread = conversations.filter((c) => unread.has(c.id)).length;
  const badges: Record<string, number> = { '/messages': friends.incoming.length + dmUnread, '/notifications': notificationsUnread };
  const communityUnread = (id: string) => communityDetails[id]?.channels.some((ch) => unread.has(ch.id));

  /** Label and link for the room we are connected to, and whether it is on screen. */
  function voiceDockTarget() {
    const id = voice.channelId;
    const here = location.pathname.split('/').pop() ?? '';
    if (!id) return { hereChannelId: null, label: '', href: '/' };
    const convo = conversations.find((c) => c.id === id);
    if (convo) return { hereChannelId: here === id ? id : null, label: conversationTitle(convo), href: `/messages/${id}` };
    for (const c of Object.values(communityDetails)) {
      const ch = c.channels.find((x) => x.id === id);
      if (ch) return { hereChannelId: here === id ? id : null, label: `${ch.name} · ${c.name}`, href: `/communities/${c.id}/${id}` };
    }
    return { hereChannelId: null, label: 'Voice', href: '/' };
  }

  async function setStatus(status: Status) {
    const r = await api.patch<{ user: Me }>('/users/me', { status });
    setMe({ ...r.user, presence: status === 'invisible' ? 'offline' : status });
    setMeMenu(false);
  }

  return (
    <div className={`app ${plugin('focusMode') ? 'focus' : ''} ${appearance.dockLabels ? 'labels' : ''}`}>
      <div className="wallpaper" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>

      <nav className="dock glass" aria-label="Main">
        <NavLink to="/" className="dock-logo" aria-label="Nexus home">
          <span className="logo-mark" />
        </NavLink>
        <button className="dock-item search-trigger" onClick={() => setSearch(true)} aria-label="Search messages (Ctrl+F)" data-tip="Search · Ctrl F">
          <span className="dock-glyph"><Search size={20} /></span>
          <span className="dock-label">Search</span>
        </button>
        <div className="dock-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="dock-item" data-tip={n.soon ? `${n.label} · soon` : n.label} aria-label={n.label}>
              <span className="dock-glyph">
                <n.icon size={20} />
                {badges[n.to] > 0 && <span className="count-badge">{badges[n.to]}</span>}
                {n.soon && <span className="soon-dot" />}
              </span>
              <span className="dock-label">{n.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="dock-sep" />
        <div className="dock-communities">
          {communities.map((c) => {
            const active = location.pathname.startsWith(`/communities/${c.id}`);
            return (
              <NavLink key={c.id} to={`/communities/${c.id}`} className={`orb ${active ? 'active' : ''}`} data-tip={c.name} aria-label={c.name}>
                <CommunityBadge name={c.name} accent={c.accent} size={42} />
                {communityUnread(c.id) && !active && <span className="orb-unread" />}
              </NavLink>
            );
          })}
          <NavLink to="/communities?new=1" className="orb orb-add" data-tip="Create or join a community" aria-label="Create or join a community">
            <Plus size={20} />
          </NavLink>
        </div>
        <div className="dock-foot">
          <NavLink to="/studio" className="dock-item" data-tip="Customise (Ctrl ,)" aria-label="Customise">
            <span className="dock-glyph"><Palette size={20} /></span>
            <span className="dock-label">Studio</span>
          </NavLink>
          <div className="me-wrap" ref={menuRef}>
            <button className="me-btn" onClick={() => setMeMenu((v) => !v)} aria-label="Your status and account" aria-expanded={meMenu}>
              <Avatar user={me} size={40} />
            </button>
            {meMenu && (
              <div className="me-menu glass">
                <div className="me-card" style={{ ['--av' as string]: me.accent }}>
                  {me.banner ? <img className="me-banner" src={me.banner} alt="" /> : <span className="me-banner" />}
                  <Avatar user={me} size={52} />
                  <strong>{me.displayName}</strong>
                  <span className="muted small">@{me.username}</span>
                </div>
                <div className="menu-group">
                  {STATUS.map((s) => (
                    <button key={s.value} className={me.status === s.value ? 'on' : ''} onClick={() => setStatus(s.value)}>
                      <span className={`dot presence-${s.value === 'invisible' ? 'offline' : s.value}`} /> {s.label}
                    </button>
                  ))}
                </div>
                <div className="menu-group">
                  <button onClick={() => { setMeMenu(false); navigate('/studio/profile'); }}>
                    <UserRound size={16} /> Edit profile
                  </button>
                  <button onClick={() => { setMeMenu(false); navigate('/studio'); }}>
                    <Palette size={16} /> Customise Nexus
                  </button>
                  <button className="danger" onClick={logout}>
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="stage">
        {!connected && <div className="reconnecting">Reconnecting…</div>}
        <Outlet />
      </main>

      {palette && <CommandPalette onClose={() => setPalette(false)} onSearch={() => { setPalette(false); setSearch(true); }} />}
      {search && <SearchModal onClose={() => setSearch(false)} />}
      <Toasts />
      <VoiceAudio />
      <IncomingCallCard />
      <VoiceDock {...voiceDockTarget()} />
    </div>
  );
}
