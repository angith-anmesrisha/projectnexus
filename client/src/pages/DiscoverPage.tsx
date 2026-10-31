import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useNexus } from '../lib/store';
import type { Community, CommunitySummary } from '../lib/types';
import { CommunityBadge } from '../components/Avatar';
import { Icon } from '../components/Icon';

export function DiscoverPage() {
  const { me, setCommunityDetail } = useNexus();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CommunitySummary[]>([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .get<{ communities: CommunitySummary[] }>(`/communities/browse?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.communities))
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  async function join(c: CommunitySummary) {
    try {
      const r = await api.post<{ community: Community }>(`/communities/${c.id}/join`);
      setCommunityDetail(r.community);
      navigate(`/communities/${c.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const forYou = me.games.length && !q ? results.filter((c) => me.games.some((g) => c.game.toLowerCase() === g.toLowerCase())) : [];
  const rest = results.filter((c) => !forYou.includes(c));

  return (
    <section className="panel discover">
      <div className="landing-inner wide">
        <header className="discover-hero">
          <p className="eyebrow">Discover</p>
          <h1>Find communities for the games you love</h1>
          <div className="search">
            <Icon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or game" aria-label="Search communities" />
          </div>
        </header>
        {error && <p className="form-error">{error}</p>}

        {forYou.length > 0 && (
          <>
            <h2 className="section-title">For your games</h2>
            <CommunityGrid list={forYou} onJoin={join} />
          </>
        )}
        <h2 className="section-title">{q ? 'Results' : forYou.length ? 'More on Nexus' : 'Popular on Nexus'}</h2>
        {rest.length === 0 ? (
          <p className="muted">{forYou.length ? "That's everything for now." : 'No communities found.'} <Link to="/communities">Start one</Link>.</p>
        ) : (
          <CommunityGrid list={rest} onJoin={join} />
        )}

        <div className="feed-teaser">
          <Icon name="play" size={28} />
          <div>
            <h3>Clips, creators and news are coming to Discover</h3>
            <p className="muted">A gaming-first feed of clips, montages, guides and patch news, shaped by the games you pick.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CommunityGrid({ list, onJoin }: { list: CommunitySummary[]; onJoin: (c: CommunitySummary) => void }) {
  return (
    <div className="card-grid">
      {list.map((c) => (
        <article key={c.id} className="community-card" style={{ ['--accent' as string]: c.accent }}>
          <div className="community-card-banner" />
          <div className="community-card-body">
            <CommunityBadge name={c.name} accent={c.accent} size={52} />
            <h3>{c.name}</h3>
            {c.game && <span className="tag">{c.game}</span>}
            <p className="muted small">{c.description || 'No description yet.'}</p>
            <div className="community-card-foot">
              <span className="muted small">{c.memberCount} member{c.memberCount === 1 ? '' : 's'}</span>
              {c.role ? (
                <Link to={`/communities/${c.id}`} className="btn btn-ghost small">Open</Link>
              ) : (
                <button className="btn btn-primary small" onClick={() => onJoin(c)}>Join</button>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
