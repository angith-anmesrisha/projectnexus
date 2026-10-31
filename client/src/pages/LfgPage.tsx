import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, LogOut, Mic, MicOff, MessagesSquare, Plus, Swords, UserPlus, X } from 'lucide-react';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { getSocket } from '../lib/socket';
import { useNexus } from '../lib/store';
import type { Conversation, LfgPost } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';

export const REGIONS = ['NA', 'EU', 'LATAM', 'BR', 'ASIA', 'OCE', 'ME', 'AF'];

function timeLeft(ts: number): string {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
}

export function LfgPage() {
  const { me } = useNexus();
  const navigate = useNavigate();
  const [game, setGame] = useState('');
  const [region, setRegion] = useState('');
  const [posts, setPosts] = useState<LfgPost[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (game) q.set('game', game);
    if (region) q.set('region', region);
    const r = await api.get<{ posts: LfgPost[] }>(`/lfg?${q}`);
    setPosts(r.posts);
  }, [game, region]);

  useEffect(() => {
    load();
    // Any change anywhere refreshes the board. Bursts are folded together.
    let t: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => {
      clearTimeout(t);
      t = setTimeout(load, 250);
    };
    const socket = getSocket();
    socket.on('lfg:update', onUpdate);
    const tick = setInterval(load, 60_000);
    return () => {
      socket.off('lfg:update', onUpdate);
      clearTimeout(t);
      clearInterval(tick);
    };
  }, [load]);

  async function act(p: LfgPost, action: 'join' | 'leave' | 'close') {
    setError('');
    try {
      await api.post(`/lfg/${p.id}/${action}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function group(p: LfgPost) {
    if (p.groupId) return navigate(`/messages/${p.groupId}`);
    setError('');
    try {
      const r = await api.post<{ conversation: Conversation }>(`/lfg/${p.id}/group`);
      navigate(`/messages/${r.conversation.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="workspace single">
      <section className="main glass page lfg-page">
        <header className="lfg-hero">
          <div>
            <p className="eyebrow">Teammate finder</p>
            <h1>Find your squad</h1>
            <p className="muted">Post what you're playing and who you need. Posts expire on their own, so the board is always live.</p>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Post a request</button>
        </header>

        <div className="lfg-filters">
          <div className="chip-row">
            <button className={`chip ${game === '' ? 'on' : ''}`} onClick={() => setGame('')}>All games</button>
            {me.games.map((g) => (
              <button key={g} className={`chip ${game === g ? 'on' : ''}`} onClick={() => setGame(game === g ? '' : g)}>{g}</button>
            ))}
          </div>
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            <option value="">Any region</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {error && <p className="form-error">{error}</p>}

        {posts === null ? (
          <div className="lfg-grid">{[0, 1, 2].map((i) => <div key={i} className="lfg-card skeleton" />)}</div>
        ) : posts.length === 0 ? (
          <div className="empty-card">
            <Swords size={36} />
            <h3>No open requests{game ? ` for ${game}` : ''}</h3>
            <p>Be the first to post. People who match will see it right away.</p>
            <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Post a request</button>
          </div>
        ) : (
          <div className="lfg-grid">
            {posts.map((p) => {
              const full = p.filled >= p.slots;
              return (
                <article key={p.id} className={`lfg-card ${p.mine || p.joined ? 'mine' : ''} ${full ? 'full' : ''}`}>
                  <header>
                    <span className="lfg-game">{p.game}</span>
                    {p.region && <span className="chip sm">{p.region}</span>}
                    <span className="lfg-mic" title={p.mic ? 'Mic required' : 'Mic optional'}>{p.mic ? <Mic size={14} /> : <MicOff size={14} />}</span>
                  </header>
                  <h3>{[p.mode, p.rank].filter(Boolean).join(' · ') || 'Any mode'}</h3>
                  {p.note && <p className="lfg-note">{p.note}</p>}
                  <div className="lfg-roster">
                    {p.host && (
                      <span className="lfg-seat host" title={`${p.host.displayName} (host)`}>
                        <Avatar user={p.host} size={32} />
                      </span>
                    )}
                    {p.players.map((u) => (
                      <span key={u.id} className="lfg-seat" title={u.displayName}><Avatar user={u} size={32} /></span>
                    ))}
                    {Array.from({ length: Math.max(0, p.slots - p.filled) }, (_, i) => (
                      <span key={i} className="lfg-seat open" aria-hidden><Plus size={14} /></span>
                    ))}
                  </div>
                  <p className="lfg-meta muted small">
                    <span>{p.host?.displayName} · {relative(p.createdAt)}</span>
                    <span><Clock size={12} /> {timeLeft(p.expiresAt)}</span>
                  </p>
                  <div className="btn-row">
                    {p.mine ? (
                      <>
                        <button className="btn primary sm" onClick={() => group(p)} disabled={!p.groupId && p.filled === 0}>
                          <MessagesSquare size={14} /> {p.groupId ? 'Open group chat' : 'Start group chat'}
                        </button>
                        <button className="btn ghost sm" onClick={() => act(p, 'close')}><X size={14} /> Close</button>
                      </>
                    ) : p.joined ? (
                      <>
                        {p.groupId && <button className="btn primary sm" onClick={() => group(p)}><MessagesSquare size={14} /> Open group chat</button>}
                        <button className="btn ghost sm" onClick={() => act(p, 'leave')}><LogOut size={14} /> Leave</button>
                      </>
                    ) : (
                      <button className="btn primary sm" disabled={full} onClick={() => act(p, 'join')}>
                        <UserPlus size={14} /> {full ? 'Full' : 'Join'}
                      </button>
                    )}
                    <span className="lfg-count">{p.filled}/{p.slots}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {creating && (
        <CreateLfgModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateLfgModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { me } = useNexus();
  const [game, setGame] = useState(me.games[0] ?? '');
  const [mode, setMode] = useState('');
  const [rank, setRank] = useState('');
  const [region, setRegion] = useState('');
  const [slots, setSlots] = useState(2);
  const [mic, setMic] = useState(true);
  const [hours, setHours] = useState(2);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/lfg', { game, mode, rank, region, slots, mic, hours, note });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Find teammates" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Game</span>
          <input value={game} onChange={(e) => setGame(e.target.value)} required maxLength={40} placeholder="Valorant" list="lfg-games" autoFocus />
          <datalist id="lfg-games">{me.games.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <div className="form-2col">
          <label className="field">
            <span>Mode</span>
            <input value={mode} onChange={(e) => setMode(e.target.value)} maxLength={40} placeholder="Ranked, Unrated, Raid…" />
          </label>
          <label className="field">
            <span>Rank</span>
            <input value={rank} onChange={(e) => setRank(e.target.value)} maxLength={40} placeholder="Gold to Plat" />
          </label>
        </div>
        <div className="form-2col three">
          <label className="field">
            <span>Players needed</span>
            <select value={slots} onChange={(e) => setSlots(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Region</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Any</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Open for</span>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[0.5, 1, 2, 4, 8, 24].map((h) => <option key={h} value={h}>{h < 1 ? '30 minutes' : h === 1 ? '1 hour' : `${h} hours`}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} placeholder="Chill vibes, need a smokes main" />
        </label>
        <label className="switch-row">
          <input type="checkbox" className="switch-input" checked={mic} onChange={(e) => setMic(e.target.checked)} />
          <span>Mic required</span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !game.trim()}>{busy ? 'Posting…' : 'Post'}</button>
        </div>
      </form>
    </Modal>
  );
}
