import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Sparkles, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useNexus } from '../lib/store';
import type { Community, CommunitySummary } from '../lib/types';
import { CommunityBadge } from '../components/Avatar';

export function DiscoverPage() {
  const { me, setCommunityDetail } = useNexus();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CommunitySummary[] | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get<{ communities: CommunitySummary[] }>(`/communities/browse?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.communities))
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
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

  const list = results ?? [];
  const forYou = me.games.length && !q ? list.filter((c) => me.games.some((g) => c.game.toLowerCase() === g.toLowerCase())) : [];
  const rest = list.filter((c) => !forYou.includes(c));

  return (
    <div className="workspace single">
      <section className="main glass">
        <div className="page">
          <header className="discover-hero">
            <div className="discover-glow" />
            <p className="eyebrow">Discover</p>
            <h1>Find your people</h1>
            <p className="muted">Communities for every game, team and play style.</p>
            <div className="big-search">
              <Search size={20} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search communities or games" aria-label="Search communities" />
            </div>
            {me.games.length > 0 && (
              <div className="chip-row center">
                {me.games.map((g) => (
                  <button key={g} className="chip" onClick={() => setQ(g)}>{g}</button>
                ))}
              </div>
            )}
          </header>
          {error && <p className="form-error">{error}</p>}
          {forYou.length > 0 && (
            <>
              <h3 className="section-title"><Sparkles size={17} /> For your games</h3>
              <Grid list={forYou} onJoin={join} />
            </>
          )}
          <h3 className="section-title">{q ? `Results for “${q}”` : forYou.length ? 'More on Nexus' : 'Popular on Nexus'}</h3>
          {results && rest.length === 0 ? (
            <div className="empty-card">
              <Users size={30} />
              <p className="muted">{forYou.length ? "That's everything for now." : 'No communities found.'} <Link to="/communities?new=1">Start one</Link>.</p>
            </div>
          ) : (
            <Grid list={rest} onJoin={join} />
          )}
        </div>
      </section>
    </div>
  );
}

function Grid({ list, onJoin }: { list: CommunitySummary[]; onJoin: (c: CommunitySummary) => void }) {
  return (
    <div className="discover-grid">
      {list.map((c) => (
        <article key={c.id} className="dcard" style={{ ['--cb' as string]: c.accent }}>
          <div className="dcard-banner" />
          <div className="dcard-body">
            <CommunityBadge name={c.name} accent={c.accent} size={56} />
            <h3>{c.name}</h3>
            {c.game && <span className="chip sm">{c.game}</span>}
            <p className="muted small">{c.description || 'No description yet.'}</p>
            <div className="dcard-foot">
              <span className="small"><span className="dot presence-online" /> {c.memberCount} member{c.memberCount === 1 ? '' : 's'}</span>
              {c.role ? <Link to={`/communities/${c.id}`} className="btn sm">Open</Link> : <button className="btn primary sm" onClick={() => onJoin(c)}>Join</button>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
