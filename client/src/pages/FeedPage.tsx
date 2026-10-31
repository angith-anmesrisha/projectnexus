import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Clapperboard, Film, Heart, Link2, MessageCircle, Plus, Send, Share2, Trash2, Upload, UserCheck, UserPlus, X } from 'lucide-react';
import { api } from '../lib/api';
import { conversationTitle, relative } from '../lib/format';
import { useNexus } from '../lib/store';
import type { Clip, ClipComment } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { ClipPlayer } from '../components/ClipPlayer';
import { imageSize } from '../components/MediaPicker';
import { Modal } from '../components/Modal';

type Tab = 'foryou' | 'following' | 'new';
const TABS: { id: Tab; label: string }[] = [
  { id: 'foryou', label: 'For you' },
  { id: 'following', label: 'Following' },
  { id: 'new', label: 'New' },
];

export function FeedPage() {
  const { clipId } = useParams();
  const { me } = useNexus();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('foryou');
  const [game, setGame] = useState('');
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [posting, setPosting] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Clip | null>(null);
  const [sharing, setSharing] = useState<Clip | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (offset = 0) => {
      const q = new URLSearchParams({ tab, offset: String(offset) });
      if (game) q.set('game', game);
      const r = await api.get<{ clips: Clip[]; nextOffset: number | null }>(`/clips?${q}`);
      setNext(r.nextOffset);
      return r.clips;
    },
    [tab, game],
  );

  useEffect(() => {
    let cancelled = false;
    setClips(null);
    setActive(0);
    (async () => {
      let list = await load(0);
      // A shared link opens that clip first.
      if (clipId) {
        const pinned = await api.get<{ clip: Clip }>(`/clips/${clipId}`).then((r) => r.clip).catch(() => null);
        if (pinned) list = [pinned, ...list.filter((c) => c.id !== pinned.id)];
      }
      if (!cancelled) setClips(list);
      scroller.current?.scrollTo({ top: 0 });
    })();
    return () => {
      cancelled = true;
    };
  }, [load, clipId]);

  // Track which clip is on screen.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !clips?.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll('.clip-slide').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [clips]);

  // Load more near the end.
  useEffect(() => {
    if (clips && next !== null && active >= clips.length - 3) {
      const at = next;
      setNext(null);
      load(at).then((more) => setClips((l) => [...(l ?? []), ...more.filter((c) => !(l ?? []).some((x) => x.id === c.id))]));
    }
  }, [active, clips, next, load]);

  // Arrow keys / J K move between clips.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const dir = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0;
      if (!dir || !scroller.current) return;
      e.preventDefault();
      scroller.current.querySelector(`[data-index="${active + dir}"]`)?.scrollIntoView({ behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const games = useMemo(() => [...new Set([...me.games, ...(clips ?? []).map((c) => c.game).filter(Boolean)])].slice(0, 10), [me.games, clips]);
  const replace = (c: Clip) => setClips((l) => l?.map((x) => (x.id === c.id ? c : x)) ?? l);

  async function like(c: Clip) {
    replace({ ...c, liked: !c.liked, likes: c.likes + (c.liked ? -1 : 1) });
    replace((await api.post<{ clip: Clip }>(`/clips/${c.id}/like`)).clip);
  }
  async function follow(c: Clip) {
    if (!c.author) return;
    const r = c.following ? await api.del<{ following: boolean }>(`/users/${c.author.id}/follow`) : await api.post<{ following: boolean }>(`/users/${c.author.id}/follow`);
    setClips((l) => l?.map((x) => (x.author?.id === c.author!.id ? { ...x, following: r.following } : x)) ?? l);
  }
  async function remove(c: Clip) {
    if (!window.confirm('Delete this clip?')) return;
    await api.del(`/clips/${c.id}`);
    setClips((l) => l?.filter((x) => x.id !== c.id) ?? l);
  }

  return (
    <div className="workspace single">
      <section className={`main glass feed-main ${commentsFor ? "with-drawer" : ""}`}>
        <header className="feed-head">
          <div className="seg">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); if (clipId) navigate('/feed'); }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="feed-games">
            <button className={`chip ${game === '' ? 'on' : ''}`} onClick={() => setGame('')}>All games</button>
            {games.map((g) => (
              <button key={g} className={`chip ${game === g ? 'on' : ''}`} onClick={() => setGame(game === g ? '' : g)}>{g}</button>
            ))}
          </div>
          <button className="btn primary sm" onClick={() => setPosting(true)}>
            <Plus size={16} /> Post a clip
          </button>
        </header>

        <div className="feed-scroll" ref={scroller}>
          {clips === null && <div className="clip-slide"><div className="clip-frame skeleton" /></div>}
          {clips?.length === 0 && (
            <div className="empty-state feed-empty">
              <Clapperboard size={40} />
              <h3>{tab === 'following' ? 'Nothing from people you follow yet' : 'No clips yet'}</h3>
              <p className="muted">{tab === 'following' ? 'Follow creators from For you and their clips land here.' : 'Be the first: upload a play or paste a YouTube or Twitch clip.'}</p>
              <button className="btn primary" onClick={() => setPosting(true)}><Plus size={16} /> Post a clip</button>
            </div>
          )}
          {clips?.map((c, i) => (
            <div key={c.id} className="clip-slide" data-index={i}>
              <div className={`clip-frame ${c.height && c.width && c.height > c.width ? 'tall' : ''}`}>
                <ClipPlayer clip={c} active={i === active} muted={muted} onToggleMute={() => setMuted((m) => !m)} />
                <div className="clip-info">
                  <div className="clip-author">
                    {c.author && <Avatar user={c.author} size={34} showPresence={false} />}
                    <b>{c.author?.displayName}</b>
                    {!c.mine && c.author && (
                      <button className={`btn sm ${c.following ? 'ghost' : 'primary'}`} onClick={() => follow(c)}>
                        {c.following ? <><UserCheck size={14} /> Following</> : <><UserPlus size={14} /> Follow</>}
                      </button>
                    )}
                  </div>
                  <h2>{c.title}</h2>
                  <p className="muted small">{c.game && <span className="chip sm">{c.game}</span>} {relative(c.createdAt)}</p>
                </div>
              </div>
              <div className="clip-rail">
                <button className={`rail-btn ${c.liked ? 'liked' : ''}`} onClick={() => like(c)} aria-label={c.liked ? 'Unlike' : 'Like'} aria-pressed={c.liked}>
                  <Heart size={24} fill={c.liked ? 'currentColor' : 'none'} />
                  <span>{c.likes}</span>
                </button>
                <button className="rail-btn" onClick={() => setCommentsFor(c)} aria-label="Comments">
                  <MessageCircle size={24} />
                  <span>{c.comments}</span>
                </button>
                <button className="rail-btn" onClick={() => setSharing(c)} aria-label="Share to a chat">
                  <Share2 size={24} />
                  <span>Share</span>
                </button>
                {c.mine && (
                  <button className="rail-btn" onClick={() => remove(c)} aria-label="Delete clip">
                    <Trash2 size={22} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {commentsFor && (
          <CommentsDrawer
            clip={commentsFor}
            onClose={() => setCommentsFor(null)}
            onCount={(n) => {
              const c = clips?.find((x) => x.id === commentsFor.id);
              if (c) replace({ ...c, comments: n });
            }}
          />
        )}
      </section>
      {posting && (
        <PostClipModal
          onClose={() => setPosting(false)}
          onPosted={(c) => {
            setPosting(false);
            setTab('new');
            setClips((l) => [c, ...(l ?? [])]);
          }}
        />
      )}
      {sharing && <ShareModal clip={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

function CommentsDrawer({ clip, onClose, onCount }: { clip: Clip; onClose: () => void; onCount: (n: number) => void }) {
  const [comments, setComments] = useState<ClipComment[] | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    api.get<{ comments: ClipComment[] }>(`/clips/${clip.id}/comments`).then((r) => setComments(r.comments));
  }, [clip.id]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const r = await api.post<{ comment: ClipComment }>(`/clips/${clip.id}/comments`, { content: text });
    setText('');
    setComments((l) => {
      const next = [...(l ?? []), r.comment];
      onCount(next.length);
      return next;
    });
  }
  async function remove(id: string) {
    await api.del(`/clip-comments/${id}`);
    setComments((l) => {
      const next = (l ?? []).filter((c) => c.id !== id);
      onCount(next.length);
      return next;
    });
  }
  return (
    <aside className="comments-drawer glass">
      <header>
        <h3>Comments</h3>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close comments"><X size={16} /></button>
      </header>
      <div className="comments-list">
        {comments?.length === 0 && <p className="muted center pad">No comments yet. Say something nice.</p>}
        {comments?.map((c) => (
          <div key={c.id} className="comment">
            {c.author && <Avatar user={c.author} size={30} showPresence={false} />}
            <div>
              <b>{c.author?.displayName}</b> <span className="muted small">{relative(c.createdAt)}</span>
              <p>{c.content}</p>
            </div>
            {(c.mine || clip.mine) && (
              <button className="icon-btn sm" onClick={() => remove(c.id)} aria-label="Delete comment"><Trash2 size={13} /></button>
            )}
          </div>
        ))}
      </div>
      <form className="comment-form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" maxLength={500} aria-label="Add a comment" />
        <button className="icon-btn" disabled={!text.trim()} aria-label="Send"><Send size={16} /></button>
      </form>
    </aside>
  );
}

function PostClipModal({ onClose, onPosted }: { onClose: () => void; onPosted: (c: Clip) => void }) {
  const { me } = useNexus();
  const [mode, setMode] = useState<'upload' | 'link'>('upload');
  const [title, setTitle] = useState('');
  const [game, setGame] = useState(me.games[0] ?? '');
  const [link, setLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(f: File) {
    if (!f.type.startsWith('video/')) return setError('Pick a video file (MP4 or WebM)');
    if (f.size > 50 * 1024 * 1024) return setError('Clips can be up to 50 MB');
    setError('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 100));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      let body: Record<string, unknown> = { title, game };
      if (mode === 'upload') {
        if (!file) throw new Error('Choose a video first');
        const dims = await videoSize(file).catch(() => imageSize(file));
        const up = await api.upload(file, dims);
        body = { ...body, uploadId: up.id };
      } else {
        body = { ...body, link };
      }
      const r = await api.post<{ clip: Clip }>('/clips', body);
      onPosted(r.clip);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Post a clip" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="seg">
          <button type="button" className={mode === 'upload' ? 'on' : ''} onClick={() => setMode('upload')}><Upload size={14} /> Upload</button>
          <button type="button" className={mode === 'link' ? 'on' : ''} onClick={() => setMode('link')}><Link2 size={14} /> YouTube or Twitch</button>
        </div>
        {mode === 'upload' ? (
          <button type="button" className={`clip-drop ${preview ? 'has' : ''}`} onClick={() => fileRef.current?.click()}>
            {preview ? <video src={preview} muted autoPlay loop playsInline /> : <><Film size={30} /><span>Choose a video</span><small className="muted">MP4 or WebM, up to 50 MB</small></>}
          </button>
        ) : (
          <label className="field">
            <span>Link</span>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/… or https://clips.twitch.tv/…" autoFocus />
          </label>
        )}
        <input ref={fileRef} type="file" accept="video/mp4,video/webm" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100} placeholder="1v4 clutch on Ascent" />
        </label>
        <label className="field">
          <span>Game</span>
          <input value={game} onChange={(e) => setGame(e.target.value)} maxLength={40} placeholder="Valorant" list="clip-games" />
          <datalist id="clip-games">{me.games.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Posting…' : 'Post'}</button>
        </div>
      </form>
    </Modal>
  );
}

function videoSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve({ w: v.videoWidth, h: v.videoHeight });
      URL.revokeObjectURL(v.src);
    };
    v.onerror = reject;
    v.src = URL.createObjectURL(file);
  });
}

function ShareModal({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const { conversations, communities, communityDetails } = useNexus();
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState('');
  const targets = [
    ...conversations.map((c) => ({ id: c.id, label: conversationTitle(c), hint: c.kind === 'group' ? 'Group' : 'DM' })),
    ...communities.flatMap((c) =>
      (communityDetails[c.id]?.channels ?? []).filter((ch) => ch.kind === 'text').map((ch) => ({ id: ch.id, label: `#${ch.name}`, hint: c.name })),
    ),
  ];
  async function share(id: string) {
    setError('');
    try {
      await api.post(`/clips/${clip.id}/share`, { channelId: id, note });
      setSent((s) => [...s, id]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title={`Share “${clip.title}”`} onClose={onClose}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a message (optional)" maxLength={300} />
      <div className="share-list">
        {targets.length === 0 && <p className="muted">Start a chat or join a community to share clips.</p>}
        {targets.map((t) => (
          <div key={t.id} className="share-row">
            <span><b>{t.label}</b> <span className="muted small">{t.hint}</span></span>
            <button className={`btn sm ${sent.includes(t.id) ? 'ghost' : 'primary'}`} disabled={sent.includes(t.id)} onClick={() => share(t.id)}>
              {sent.includes(t.id) ? 'Sent' : 'Send'}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
