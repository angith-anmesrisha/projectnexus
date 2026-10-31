import { NavLink, Outlet } from 'react-router-dom';
import { useNexus } from '../lib/store';
import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';

const NAV: { to: string; label: string; icon: IconName; soon?: boolean }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/discover', label: 'Discover', icon: 'compass' },
  { to: '/feed', label: 'Feed', icon: 'play', soon: true },
  { to: '/news', label: 'News', icon: 'news', soon: true },
  { to: '/communities', label: 'Communities', icon: 'users' },
  { to: '/messages', label: 'Messages', icon: 'chat' },
  { to: '/tournaments', label: 'Tournaments', icon: 'trophy', soon: true },
  { to: '/notifications', label: 'Notifications', icon: 'bell', soon: true },
];

export function Shell() {
  const { me, unread, conversations, communityDetails, friends, connected } = useNexus();

  const dmUnread = conversations.some((c) => unread.has(c.id));
  const communityUnread = Object.values(communityDetails).some((c) => c.channels.some((ch) => unread.has(ch.id)));
  const badges: Record<string, number | boolean> = {
    '/messages': friends.incoming.length || dmUnread,
    '/communities': communityUnread,
  };

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <NavLink to="/" className="rail-logo" aria-label="Project Nexus home">
          <span className="logo-mark" />
        </NavLink>
        <div className="rail-items">
          {NAV.map((item) => {
            const badge = badges[item.to];
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className="rail-item" title={item.label}>
                <span className="rail-icon">
                  <Icon name={item.icon} size={22} />
                  {typeof badge === 'number' && badge > 0 && <span className="badge">{badge}</span>}
                  {badge === true && <span className="badge-dot" />}
                </span>
                <span className="rail-label">{item.label}</span>
                {item.soon && <span className="soon-pip" aria-label="coming soon" />}
              </NavLink>
            );
          })}
        </div>
        <NavLink to="/settings" className="rail-me" title="Profile and settings">
          <Avatar user={me} size={38} />
        </NavLink>
      </nav>
      <main className="stage">
        {!connected && <div className="offline-banner">Reconnecting to Nexus…</div>}
        <Outlet />
      </main>
    </div>
  );
}
