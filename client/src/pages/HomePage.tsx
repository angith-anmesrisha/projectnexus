import { Link } from 'react-router-dom';
import { useNexus } from '../lib/store';
import { Avatar, CommunityBadge } from '../components/Avatar';
import { Icon } from '../components/Icon';

export function HomePage() {
  const { me, friends, communities } = useNexus();
  const online = friends.friends.filter((f) => f.presence !== 'offline');
  const lfg = friends.friends.filter((f) => f.lfg);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Late night session' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <section className="panel home">
      <div className="home-inner">
        <header className="home-hero">
          <div>
            <p className="eyebrow">{greeting}</p>
            <h1>{me.displayName}</h1>
            <p className="muted">
              {me.nowPlaying ? <>You're playing <strong>{me.nowPlaying}</strong>.</> : 'Set what you are playing in your profile so friends can join in.'}
            </p>
          </div>
          <Link to="/settings" className="btn btn-ghost"><Icon name="edit" size={16} /> Edit profile</Link>
        </header>

        {friends.incoming.length > 0 && (
          <Link to="/messages" className="alert-card">
            <Icon name="userPlus" />
            You have {friends.incoming.length} pending friend request{friends.incoming.length > 1 ? 's' : ''}.
          </Link>
        )}

        <div className="home-grid">
          <div className="card">
            <div className="card-head">
              <h2>Friends online</h2>
              <Link to="/messages" className="link-btn small">All friends</Link>
            </div>
            {online.length === 0 && <p className="muted small">Nobody is online yet. <Link to="/messages">Add friends</Link> by username.</p>}
            <div className="friend-chips">
              {online.slice(0, 12).map((f) => (
                <div key={f.id} className="friend-chip">
                  <Avatar user={f} size={36} />
                  <span>
                    <strong>{f.displayName}</strong>
                    <span className="muted small">{f.nowPlaying ? `Playing ${f.nowPlaying}` : 'Online'}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Your communities</h2>
              <Link to="/communities" className="link-btn small">Manage</Link>
            </div>
            {communities.length === 0 && (
              <p className="muted small">
                You haven't joined any yet. <Link to="/discover">Browse communities</Link> or <Link to="/communities">create one</Link>.
              </p>
            )}
            <div className="community-tiles">
              {communities.slice(0, 8).map((c) => (
                <Link key={c.id} to={`/communities/${c.id}`} className="community-tile" style={{ ['--accent' as string]: c.accent }}>
                  <CommunityBadge name={c.name} accent={c.accent} size={40} />
                  <span>
                    <strong>{c.name}</strong>
                    <span className="muted small">{c.memberCount} members</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Looking for teammates</h2>
            </div>
            {lfg.length === 0 ? (
              <p className="muted small">Friends who switch on "Looking for teammates" show up here. Full teammate search arrives with Compete.</p>
            ) : (
              lfg.map((f) => (
                <div key={f.id} className="friend-chip">
                  <Avatar user={f} size={32} />
                  <span>
                    <strong>{f.displayName}</strong>
                    <span className="muted small">{f.games.slice(0, 3).join(', ') || 'Any game'}</span>
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="card card-upcoming">
            <div className="card-head">
              <h2>On the way</h2>
            </div>
            <ul className="roadmap">
              <li><Icon name="play" size={18} /> <span><strong>Clip feed</strong> Vertical gaming clips and montages</span></li>
              <li><Icon name="news" size={18} /> <span><strong>News</strong> Patch notes and esports results for your games</span></li>
              <li><Icon name="trophy" size={18} /> <span><strong>Tournaments</strong> Brackets, registration and match reporting</span></li>
              <li><Icon name="users" size={18} /> <span><strong>Voice rooms</strong> Low-latency squad voice and screen share</span></li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
