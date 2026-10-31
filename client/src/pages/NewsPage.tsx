import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Newspaper, RefreshCw, Settings2, Trophy, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import type { NewsItem, NewsSource } from '../lib/types';

type Category = 'all' | NewsItem['category'];
const CATEGORIES: { id: Category; label: string; icon?: typeof Wrench }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'patch', label: 'Patch notes', icon: Wrench },
  { id: 'esports', label: 'Esports', icon: Trophy },
  { id: 'news', label: 'News', icon: Newspaper },
];
const CATEGORY_LABEL = { patch: 'Patch notes', esports: 'Esports', news: 'News' } as const;

interface NewsResponse {
  items: NewsItem[];
  sources: NewsSource[];
  games: string[];
  mine: string[];
}

export function NewsPage() {
  const [game, setGame] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [data, setData] = useState<NewsResponse | null>(null);
  const [allGames, setAllGames] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    api
      .get<NewsResponse>(`/news${game ? `?game=${encodeURIComponent(game)}` : ''}`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        if (!game) setAllGames(r.games);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [game, reload]);

  const items = useMemo(() => (data?.items ?? []).filter((i) => category === 'all' || i.category === category), [data, category]);
  const [lead, ...rest] = items;
  const offline = data?.sources.filter((s) => s.appid !== null && !s.ok) ?? [];
  const official = data?.sources.filter((s) => s.appid === null) ?? [];

  return (
    <div className="workspace single">
      <section className="main glass">
        <div className="page news-page">
          <header className="news-hero">
            <div>
              <p className="eyebrow">News</p>
              <h1>{game || (data && data.mine.length ? 'News for your games' : 'Gaming news')}</h1>
              <p className="muted">
                Patch notes, updates and esports straight from official sources. Every story links back to where it was published.
              </p>
            </div>
            <div className="btn-row">
              <button className="btn ghost sm" onClick={() => setReload((n) => n + 1)} aria-label="Refresh"><RefreshCw size={14} /> Refresh</button>
              <Link to="/studio/profile" className="btn sm"><Settings2 size={14} /> Your games</Link>
            </div>
          </header>

          <div className="news-filters">
            <div className="chip-row">
              <button className={`chip ${game === '' ? 'on' : ''}`} onClick={() => setGame('')}>All my games</button>
              {allGames.map((g) => (
                <button key={g} className={`chip ${game === g ? 'on' : ''}`} onClick={() => setGame(game === g ? '' : g)}>{g}</button>
              ))}
            </div>
            <div className="seg">
              {CATEGORIES.map((c) => (
                <button key={c.id} className={category === c.id ? 'on' : ''} onClick={() => setCategory(c.id)}>
                  {c.icon && <c.icon size={13} />} {c.label}
                </button>
              ))}
            </div>
          </div>

          {data && !data.mine.length && !game && (
            <p className="news-note muted small">
              You haven't added any games we have news for, so here are popular ones. <Link to="/studio/profile">Add your games</Link> to tailor this page.
            </p>
          )}
          {offline.length > 0 && (
            <p className="news-note warn small">
              <AlertTriangle size={14} /> Couldn't reach the news feed for {offline.map((s) => s.game).join(', ')} right now
              {data && data.items.some((i) => offline.some((s) => s.game === i.game)) ? ', so you are seeing the last copy we fetched.' : '. Try again in a bit.'}
            </p>
          )}
          {error && <p className="form-error">{error}</p>}

          {data === null && !error ? (
            <div className="news-grid">
              <div className="news-card lead skeleton" />
              {[0, 1, 2, 3].map((i) => <div key={i} className="news-card skeleton" />)}
            </div>
          ) : items.length === 0 ? (
            official.length === 0 && (
              <div className="empty-card">
                <Newspaper size={36} />
                <h3>{category === 'all' ? 'No stories right now' : `No ${CATEGORY_LABEL[category as NewsItem['category']].toLowerCase()} right now`}</h3>
                <p>Check back soon, or try another game.</p>
              </div>
            )
          ) : (
            <div className="news-grid">
              {lead && <NewsCard item={lead} lead />}
              {rest.map((i) => <NewsCard key={i.id} item={i} />)}
            </div>
          )}

          {official.length > 0 && (
            <section className="news-official">
              <p className="eyebrow">Straight from the studios</p>
              <div className="official-grid">
                {official.map((s) => (
                  <a key={s.game} href={s.officialUrl} target="_blank" rel="noopener noreferrer" className="official-card">
                    <span className="official-icon"><Newspaper size={18} /></span>
                    <span>
                      <b>{s.game}</b>
                      <span className="muted small">Official news and patch notes</span>
                    </span>
                    <ExternalLink size={14} className="muted" />
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function NewsCard({ item, lead }: { item: NewsItem; lead?: boolean }) {
  const [imgOk, setImgOk] = useState(!!item.image);
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={`news-card ${lead ? 'lead' : ''} ${imgOk ? 'has-img' : ''}`}>
      <span className="news-img">
        {imgOk ? <img src={item.image!} alt="" loading="lazy" onError={() => setImgOk(false)} /> : <Newspaper size={lead ? 42 : 28} />}
        <span className={`news-cat c-${item.category}`}>{CATEGORY_LABEL[item.category]}</span>
      </span>
      <span className="news-body">
        <span className="news-meta small">
          <b>{item.game}</b> · {relative(item.publishedAt)}
        </span>
        <span className="news-title">{item.title}</span>
        {item.summary && <span className="news-summary">{item.summary}</span>}
        <span className="news-source muted small">
          {item.source}{item.author ? ` · ${item.author}` : ''} <ExternalLink size={12} />
        </span>
      </span>
    </a>
  );
}
