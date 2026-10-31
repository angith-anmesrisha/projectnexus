import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AtSign, FileText, Film, Hash, Image, Link2, Loader2, MessageCircle, Search, Sticker, X } from 'lucide-react';
import { api } from '../lib/api';
import { timeLabel } from '../lib/format';
import { useNexus } from '../lib/store';
import type { Message, SearchPlace } from '../lib/types';
import { Avatar, CommunityBadge } from './Avatar';

type Has = '' | 'link' | 'image' | 'video' | 'gif' | 'file' | 'sticker';
const HAS: { id: Has; label: string; icon: ReactNode }[] = [
  { id: 'link', label: 'Links', icon: <Link2 size={14} /> },
  { id: 'image', label: 'Images', icon: <Image size={14} /> },
  { id: 'gif', label: 'GIFs', icon: <Film size={14} /> },
  { id: 'file', label: 'Files', icon: <FileText size={14} /> },
  { id: 'sticker', label: 'Stickers', icon: <Sticker size={14} /> },
];

interface Result {
  messages: Message[];
  places: Record<string, SearchPlace>;
  hasMore: boolean;
}

export function placeLink(p: SearchPlace, messageId?: number) {
  if (p.kind === 'dm' || p.kind === 'group') return `/messages/${p.channelId}`;
  if (p.kind === 'thread' && p.parentId) return `/communities/${p.communityId}/${p.parentId}?post=${p.channelId}`;
  return `/communities/${p.communityId}/${p.channelId}${messageId ? `?m=${messageId}` : ''}`;
}

/** Wrap each query word in <mark>. */
function highlight(text: string, words: string[]): ReactNode {
  if (!words.length || !text) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/** Search every message you can read, with filters. Opened with Ctrl+F or from the dock. */
export function SearchModal({ onClose }: { onClose: () => void }) {
  const { communities } = useNexus();
  const navigate = useNavigate();
  const location = useLocation();
  const here = location.pathname.match(/^\/communities\/([^/?]+)/)?.[1];
  const hereCommunity = communities.find((c) => c.id === here);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [has, setHas] = useState<Has>('');
  const [scope, setScope] = useState<'all' | 'here'>(hereCommunity ? 'here' : 'all');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (from.trim()) p.set('from', from.trim());
    if (has) p.set('has', has);
    if (scope === 'here' && hereCommunity) p.set('communityId', hereCommunity.id);
    return p;
  }, [q, from, has, scope, hereCommunity]);

  // Debounced live search.
  useEffect(() => {
    if (!params.get('q') && !params.get('from') && !params.get('has')) {
      setResult(null);
      setError('');
      return;
    }
    setLoading(true);
    const t = window.setTimeout(() => {
      api
        .get<Result>(`/search?${params}`)
        .then((r) => {
          setResult(r);
          setError('');
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(t);
  }, [params]);

  async function more() {
    if (!result) return;
    const p = new URLSearchParams(params);
    p.set('before', String(result.messages[result.messages.length - 1].id));
    const r = await api.get<Result>(`/search?${p}`);
    setResult({ messages: [...result.messages, ...r.messages], places: { ...result.places, ...r.places }, hasMore: r.hasMore });
  }

  const words = q.trim().split(/\s+/).filter(Boolean);
  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-modal glass" role="dialog" aria-modal="true" aria-label="Search messages">
        <div className="search-bar">
          <Search size={19} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" aria-label="Search messages" />
          {loading && <Loader2 size={17} className="spin" />}
          <button className="icon-btn sm" onClick={onClose} aria-label="Close search"><X size={16} /></button>
        </div>
        <div className="search-filters">
          {hereCommunity && (
            <div className="seg sm">
              <button className={scope === 'here' ? 'on' : ''} onClick={() => setScope('here')}>{hereCommunity.name}</button>
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Everywhere</button>
            </div>
          )}
          <label className="from-filter">
            <AtSign size={14} />
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="from user" aria-label="From user" maxLength={24} />
          </label>
          {HAS.map((h) => (
            <button key={h.id} className={`chip ${has === h.id ? 'on' : ''}`} onClick={() => setHas(has === h.id ? '' : h.id)} aria-pressed={has === h.id}>
              {h.icon} {h.label}
            </button>
          ))}
        </div>
        <div className="search-results">
          {error && <p className="form-error pad">{error}</p>}
          {!result && !error && (
            <div className="search-hint">
              <Search size={30} />
              <p>Search across every chat and community you're in.</p>
              <p className="muted small">Combine words with filters, like <b>from</b> a friend or messages that <b>have links</b>.</p>
            </div>
          )}
          {result && result.messages.length === 0 && <p className="muted pad center">No messages match that search.</p>}
          {result?.messages.map((m) => {
            const p = result.places[m.channelId];
            return (
              <button key={m.id} className="search-hit" onClick={() => go(placeLink(p, m.id))}>
                <Avatar user={m.author} size={34} showPresence={false} />
                <span className="hit-body">
                  <span className="hit-meta">
                    <b style={{ color: m.author.accent }}>{m.author.displayName}</b>
                    <span className="hit-place">
                      {p.communityId ? (
                        <>
                          <CommunityBadge name={p.communityName ?? ''} accent={p.communityAccent ?? '#22d3ee'} size={16} />
                          {p.communityName} <Hash size={11} />
                          {p.title}
                        </>
                      ) : (
                        <>
                          <MessageCircle size={12} /> {p.title}
                        </>
                      )}
                    </span>
                    <span className="muted small">{timeLabel(m.createdAt, {})}</span>
                  </span>
                  <span className="hit-text">
                    {m.content ? highlight(m.content, words) : m.sticker ? 'Sticker' : m.attachments.map((a) => a.name).join(', ')}
                  </span>
                </span>
              </button>
            );
          })}
          {result?.hasMore && (
            <button className="btn ghost block" onClick={more}>Load more results</button>
          )}
        </div>
      </div>
    </div>
  );
}
