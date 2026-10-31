import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, ImagePlus, Search, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { emojiGroups, loadEmoji, onEmojiLoaded, recentEmoji, rememberEmoji, withSkin, type EmojiGroup } from '../lib/emoji';
import { STICKERS, Sticker, stickerRef } from '../lib/stickers';
import type { StickerRef } from '../lib/types';

export type PickerTab = 'emoji' | 'gif' | 'sticker';

export interface GifResult {
  url: string;
  preview: string;
  width: number | null;
  height: number | null;
}

interface Props {
  tab: PickerTab;
  onTab: (t: PickerTab) => void;
  onEmoji: (e: string) => void;
  onGif?: (g: GifResult) => void;
  onSticker?: (s: StickerRef) => void;
  onClose: () => void;
  /** Emoji-only mode for reactions. */
  emojiOnly?: boolean;
}

export function MediaPicker({ tab, onTab, onEmoji, onGif, onSticker, onClose, emojiOnly }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Defer so the click that opened the picker does not close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown));
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const active = emojiOnly ? 'emoji' : tab;
  return (
    <div className="picker" ref={ref} role="dialog" aria-label="Emoji, GIFs and stickers">
      {!emojiOnly && (
        <div className="picker-tabs" role="tablist">
          {(['emoji', 'gif', 'sticker'] as PickerTab[]).map((t) => (
            <button key={t} role="tab" aria-selected={active === t} className={active === t ? 'on' : ''} onClick={() => onTab(t)}>
              {t === 'emoji' ? 'Emoji' : t === 'gif' ? 'GIFs' : 'Stickers'}
            </button>
          ))}
        </div>
      )}
      {active === 'emoji' && <EmojiPanel onPick={onEmoji} />}
      {active === 'gif' && onGif && <GifPanel onPick={onGif} />}
      {active === 'sticker' && onSticker && <StickerPanel onPick={onSticker} />}
    </div>
  );
}

const GROUP_ICONS: Record<string, string> = {
  smileys_emotion: '😀', people_body: '👋', animals_nature: '🐺', food_drink: '🍕', travel_places: '🚀',
  activities: '🎮', objects: '💡', symbols: '💯', flags: '🏁',
};

function EmojiPanel({ onPick }: { onPick: (e: string) => void }) {
  const [groups, setGroups] = useState<EmojiGroup[] | null>(emojiGroups());
  const [q, setQ] = useState('');
  const [tone, setTone] = useState(() => Number(localStorage.getItem('nexus.skinTone') ?? 0) || 0);
  const [hover, setHover] = useState<{ emoji: string; name: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const recents = useMemo(recentEmoji, []);

  useEffect(() => {
    loadEmoji().then(setGroups);
    return onEmojiLoaded(() => setGroups(emojiGroups()));
  }, []);

  const pick = (e: string) => {
    rememberEmoji(e);
    onPick(e);
  };

  const results = useMemo(() => {
    if (!q.trim() || !groups) return null;
    const needle = q.toLowerCase().trim();
    return groups.flatMap((g) => g.emojis).filter((e) => e.name.includes(needle) || e.slug.includes(needle)).slice(0, 120);
  }, [q, groups]);

  const setSkin = (t: number) => {
    setTone(t);
    try {
      localStorage.setItem('nexus.skinTone', String(t));
    } catch {
      // ignore
    }
  };

  return (
    <div className="emoji-panel">
      <div className="picker-search">
        <Search size={16} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji" aria-label="Search emoji" />
        <div className="skin-tones" aria-label="Skin tone">
          {['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'].map((s, i) => (
            <button key={i} className={tone === i ? 'on' : ''} onClick={() => setSkin(i)} aria-label={`Skin tone ${i}`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      {!q && groups && (
        <div className="emoji-cats">
          {recents.length > 0 && (
            <button onClick={() => bodyRef.current?.querySelector('#eg-recent')?.scrollIntoView()} title="Recent">🕘</button>
          )}
          {groups.map((g) => (
            <button key={g.slug} title={g.name} onClick={() => bodyRef.current?.querySelector(`#eg-${g.slug}`)?.scrollIntoView()}>
              {GROUP_ICONS[g.slug] ?? g.emojis[0]?.emoji}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-body" ref={bodyRef}>
        {!groups && <p className="muted pad">Loading emoji…</p>}
        {results && (
          <div className="emoji-grid">
            {results.map((e) => {
              const glyph = withSkin(e, tone);
              return (
                <button key={e.slug} onClick={() => pick(glyph)} onMouseEnter={() => setHover({ emoji: glyph, name: e.slug })} aria-label={e.name}>
                  {glyph}
                </button>
              );
            })}
            {results.length === 0 && <p className="muted pad">No emoji match “{q}”.</p>}
          </div>
        )}
        {!results && recents.length > 0 && (
          <section id="eg-recent">
            <h4>Recently used</h4>
            <div className="emoji-grid">
              {recents.map((e) => (
                <button key={e} onClick={() => pick(e)}>{e}</button>
              ))}
            </div>
          </section>
        )}
        {!results &&
          groups?.map((g) => (
            <section key={g.slug} id={`eg-${g.slug}`}>
              <h4>{g.name}</h4>
              <div className="emoji-grid">
                {g.emojis.map((e) => {
                  const glyph = withSkin(e, tone);
                  return (
                    <button key={e.slug} onClick={() => pick(glyph)} onMouseEnter={() => setHover({ emoji: glyph, name: e.slug })} aria-label={e.name}>
                      {glyph}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
      </div>
      <div className="picker-foot">
        {hover ? (
          <>
            <span className="picker-foot-glyph">{hover.emoji}</span>
            <code>:{hover.name}:</code>
          </>
        ) : (
          <span className="muted small">Tip: type :name: in a message</span>
        )}
      </div>
    </div>
  );
}

function GifPanel({ onPick }: { onPick: (g: GifResult) => void }) {
  const [q, setQ] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [results, setResults] = useState<GifResult[]>([]);
  const [favorites, setFavorites] = useState<GifResult[]>([]);
  const [view, setView] = useState<'search' | 'favorites'>('search');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ favorites: GifResult[] }>('/gifs/favorites').then((r) => setFavorites(r.favorites));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get<{ enabled: boolean; results: GifResult[] }>(`/gifs/search?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setEnabled(r.enabled);
          setResults(r.results);
          if (!r.enabled) setView('favorites');
        })
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const isFav = (g: GifResult) => favorites.some((f) => f.url === g.url);
  async function toggleFav(g: GifResult) {
    if (isFav(g)) {
      await api.del('/gifs/favorites', { url: g.url });
      setFavorites((f) => f.filter((x) => x.url !== g.url));
    } else {
      await api.post('/gifs/favorites', g);
      setFavorites((f) => [g, ...f]);
    }
  }

  async function upload(file: File) {
    setError('');
    setBusy(true);
    try {
      const dims = await imageSize(file);
      const r = await api.upload(file, dims);
      if (r.attachment.kind !== 'gif') throw new Error('That file is not a GIF');
      const g = { url: r.attachment.url, preview: r.attachment.url, width: dims?.w ?? null, height: dims?.h ?? null };
      await api.post('/gifs/favorites', g);
      setFavorites((f) => [g, ...f]);
      setView('favorites');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const list = view === 'favorites' ? favorites : results;
  return (
    <div className="gif-panel">
      <div className="picker-search">
        <Search size={16} />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setView('search');
          }}
          placeholder={enabled === false ? 'GIF search needs an API key' : 'Search GIFs'}
          disabled={enabled === false}
          aria-label="Search GIFs"
        />
      </div>
      <div className="gif-toolbar">
        <button className={view === 'search' ? 'on' : ''} disabled={enabled === false} onClick={() => setView('search')}>
          {q ? 'Results' : 'Trending'}
        </button>
        <button className={view === 'favorites' ? 'on' : ''} onClick={() => setView('favorites')}>
          <Heart size={14} /> Saved ({favorites.length})
        </button>
        <button className="gif-upload" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={14} /> {busy ? 'Uploading…' : 'Upload GIF'}
        </button>
        <input ref={fileRef} type="file" accept="image/gif" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="gif-grid">
        {list.map((g) => (
          <div key={g.url} className="gif-cell">
            <button className="gif-pick" onClick={() => onPick(g)} aria-label="Send GIF">
              <img src={g.preview} alt="" loading="lazy" />
            </button>
            <button className={`gif-fav ${isFav(g) ? 'on' : ''}`} onClick={() => toggleFav(g)} aria-label={isFav(g) ? 'Remove from saved' : 'Save GIF'}>
              <Heart size={14} />
            </button>
          </div>
        ))}
      </div>
      {list.length === 0 && (
        <div className="picker-empty">
          <ImagePlus size={28} />
          {view === 'favorites' ? (
            <p>
              No saved GIFs yet. Upload one, or tap the heart on any GIF in chat to save it here.
              {enabled === false && ' Live GIF search turns on when the server has a GIPHY or Tenor API key.'}
            </p>
          ) : (
            <p>No GIFs found.</p>
          )}
        </div>
      )}
      {enabled && <p className="picker-attrib">Powered by {view === 'search' ? 'GIF search' : 'your library'}</p>}
    </div>
  );
}

function StickerPanel({ onPick }: { onPick: (s: StickerRef) => void }) {
  const [mine, setMine] = useState<{ id: string; name: string; url: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ stickers: { id: string; name: string; url: string }[] }>('/stickers').then((r) => setMine(r.stickers));
  }, []);

  async function create(file: File) {
    setError('');
    setBusy(true);
    try {
      const up = await api.upload(file, await imageSize(file));
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Sticker';
      const r = await api.post<{ sticker: { id: string; name: string; url: string } }>('/stickers', { name, uploadId: up.id });
      setMine((m) => [...m, r.sticker]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.del(`/stickers/${id}`);
    setMine((m) => m.filter((s) => s.id !== id));
  }

  return (
    <div className="sticker-panel">
      <div className="sticker-scroll">
        <h4>Your stickers</h4>
        <div className="sticker-grid">
          {mine.map((s) => (
            <div key={s.id} className="sticker-cell">
              <button onClick={() => onPick({ id: `custom:${s.id}`, name: s.name, url: s.url })} title={s.name}>
                <img src={s.url} alt={s.name} />
              </button>
              <button className="sticker-del" onClick={() => remove(s.id)} aria-label={`Delete ${s.name}`}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button className="sticker-add" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImagePlus size={22} />
            <span>{busy ? 'Adding…' : 'Make a sticker'}</span>
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && create(e.target.files[0])} />
        </div>
        {error && <p className="form-error">{error}</p>}
        <h4>Nexus Essentials</h4>
        <div className="sticker-grid">
          {STICKERS.map((s) => (
            <button key={s.id} onClick={() => onPick(stickerRef(s))} title={s.label} className="sticker-btn">
              <Sticker sticker={stickerRef(s)} size={76} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Read an image's natural size so the chat can reserve space before it loads. */
export function imageSize(file: File): Promise<{ w: number; h: number } | undefined> {
  if (!file.type.startsWith('image/')) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(undefined);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
