import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import {
  Brush,
  Code2,
  Download,
  LayoutPanelLeft,
  MessageSquareText,
  Palette,
  Puzzle,
  RotateCcw,
  Store,
  Trash2,
  Type,
  Upload,
  UserRound,
  Wand2,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  CSS_SNIPPETS,
  DEFAULT_APPEARANCE,
  FONTS,
  PLUGINS,
  PRESETS,
  applyPreset,
  normalize,
  type Appearance,
  type Wallpaper,
} from '../lib/appearance';
import { useAppearance } from '../lib/appearanceStore';
import { useNexus } from '../lib/store';
import type { Me, Status, User } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { imageSize } from '../components/MediaPicker';
import { Sticker } from '../lib/stickers';

const SECTIONS = [
  { id: 'themes', label: 'Themes', icon: Palette },
  { id: 'colors', label: 'Colours & wallpaper', icon: Brush },
  { id: 'layout', label: 'Layout', icon: LayoutPanelLeft },
  { id: 'type', label: 'Typography', icon: Type },
  { id: 'chat', label: 'Chat style', icon: MessageSquareText },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'css', label: 'Custom CSS', icon: Code2 },
  { id: 'gallery', label: 'Theme gallery', icon: Store },
  { id: 'backup', label: 'Import & export', icon: Download },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

export function StudioPage() {
  const { section = 'themes' } = useParams();
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div className="workspace has-chat">
      <aside className="context glass">
        <div className="context-head">
          <h2><Wand2 size={18} /> Studio</h2>
        </div>
        <p className="muted small pad">Everything here updates live and syncs to your account.</p>
        <div className="ctx-list">
          {SECTIONS.map((s) => (
            <NavLink key={s.id} to={`/studio/${s.id}`} className={`ctx-link ${s.id === current.id ? 'active' : ''}`}>
              <s.icon size={17} /> {s.label}
            </NavLink>
          ))}
        </div>
      </aside>
      <section className="main glass">
        <div className="page studio">
          <header className="page-head">
            <div>
              <h1>{current.label}</h1>
            </div>
          </header>
          {current.id === 'themes' && <ThemesSection />}
          {current.id === 'colors' && <ColorsSection />}
          {current.id === 'layout' && <LayoutSection />}
          {current.id === 'type' && <TypeSection />}
          {current.id === 'chat' && <ChatSection />}
          {current.id === 'plugins' && <PluginsSection />}
          {current.id === 'css' && <CssSection />}
          {current.id === 'gallery' && <GallerySection />}
          {current.id === 'backup' && <BackupSection />}
          {current.id === 'profile' && <ProfileSection />}
        </div>
      </section>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <strong>{label}</strong>
        {hint && <span className="muted small">{hint}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Slider({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <span className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format ? format(value) : value}</output>
    </span>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="seg inline">
      {options.map((o) => (
        <button type="button" key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

function ThemesSection() {
  const { appearance, update } = useAppearance();
  return (
    <>
      <p className="muted">Start from a theme, then make it your own in the other sections.</p>
      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button key={p.id} className={`preset ${appearance.preset === p.id ? 'on' : ''}`} onClick={() => update((a) => applyPreset(a, p))}>
            <span className="preset-art" style={{ background: p.colors.bg }}>
              <span className="pa-glow" style={{ background: `radial-gradient(circle at 30% 30%, ${p.colors.accent}, transparent 60%), radial-gradient(circle at 80% 80%, ${p.colors.accent2}, transparent 55%)` }} />
              <span className="pa-dock" style={{ background: p.colors.panel }} />
              <span className="pa-panel" style={{ background: p.colors.panel }}>
                <span className="pa-bubble" style={{ background: p.colors.accent }} />
                <span className="pa-bubble alt" style={{ background: p.colors.text, opacity: 0.18 }} />
                <span className="pa-bubble" style={{ background: p.colors.accent2, width: '40%' }} />
              </span>
            </span>
            <span className="preset-text">
              <strong>{p.name}</strong>
              <span className="muted small">{p.tagline}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

const WALLPAPERS: { value: Wallpaper; label: string }[] = [
  { value: 'aurora', label: 'Aurora' },
  { value: 'grid', label: 'Neon grid' },
  { value: 'mesh', label: 'Mesh' },
  { value: 'solid', label: 'Solid' },
  { value: 'image', label: 'Image' },
];

function ColorsSection() {
  const { appearance: a, update } = useAppearance();
  const setColor = (k: keyof Appearance['colors'], v: string) => update((x) => ({ ...x, preset: 'custom', colors: { ...x.colors, [k]: v } }));
  const colorRow = (k: 'bg' | 'panel' | 'text' | 'accent' | 'accent2', label: string, hint: string) => (
    <Row label={label} hint={hint}>
      <label className="color-pick">
        <input type="color" value={a.colors[k]} onChange={(e) => setColor(k, e.target.value)} />
        <code>{a.colors[k]}</code>
      </label>
    </Row>
  );
  return (
    <div className="set-card">
      <Row label="Mode" hint="Light or dark base">
        <Seg value={a.colors.mode} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} onChange={(v) => setColor('mode', v)} />
      </Row>
      {colorRow('accent', 'Accent', 'Buttons, highlights, your bubbles')}
      {colorRow('accent2', 'Second accent', 'Gradients and glows')}
      {colorRow('bg', 'Background', 'Behind everything')}
      {colorRow('panel', 'Panels', 'Sidebars and chat surface')}
      {colorRow('text', 'Text', 'Main text colour')}
      <Row label="Wallpaper" hint="What shows behind the glass">
        <Seg value={a.wallpaper} options={WALLPAPERS} onChange={(v) => update({ wallpaper: v })} />
      </Row>
      {a.wallpaper === 'image' && (
        <Row label="Image URL" hint="Any https image link">
          <input className="text-input" value={a.wallpaperImage} onChange={(e) => update({ wallpaperImage: e.target.value })} placeholder="https://…" />
        </Row>
      )}
      <Row label="Wallpaper dimming" hint="Darken the wallpaper for readability">
        <Slider value={a.wallpaperDim} min={0} max={0.9} step={0.05} onChange={(v) => update({ wallpaperDim: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Panel opacity" hint="Lower lets the wallpaper show through">
        <Slider value={a.panelOpacity} min={0.35} max={1} step={0.01} onChange={(v) => update({ panelOpacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Glass blur">
        <Slider value={a.blur} min={0} max={40} step={1} onChange={(v) => update({ blur: v })} format={(v) => `${v}px`} />
      </Row>
    </div>
  );
}

function LayoutSection() {
  const { appearance: a, update, plugin, setPlugin } = useAppearance();
  return (
    <div className="set-card">
      <Row label="Dock position" hint="Which side the main navigation sits on">
        <Seg value={a.dockSide} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={(v) => update({ dockSide: v })} />
      </Row>
      <Row label="Dock labels" hint="Show names under the dock icons">
        <Toggle on={a.dockLabels} onChange={(v) => update({ dockLabels: v })} label="Dock labels" />
      </Row>
      <Row label="Member list" hint="Show the member panel in chats by default">
        <Toggle on={a.showMemberList} onChange={(v) => update({ showMemberList: v })} label="Member list" />
      </Row>
      <Row label="Focus mode" hint="Hide everything but the conversation (Ctrl Shift F)">
        <Toggle on={plugin('focusMode')} onChange={(v) => setPlugin('focusMode', v)} label="Focus mode" />
      </Row>
      <Row label="Density" hint="How much space between things">
        <Seg value={a.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'cozy', label: 'Cozy' }, { value: 'roomy', label: 'Roomy' }]} onChange={(v) => update({ density: v })} />
      </Row>
      <Row label="Corner roundness">
        <Slider value={a.radius} min={0} max={28} step={1} onChange={(v) => update({ radius: v })} format={(v) => `${v}px`} />
      </Row>
      <Row label="Panel spacing" hint="Gap between the floating panels">
        <Slider value={a.gap} min={0} max={24} step={1} onChange={(v) => update({ gap: v })} format={(v) => `${v}px`} />
      </Row>
      <Row label="Motion" hint="Animations and transitions">
        <Seg value={a.motion} options={[{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }]} onChange={(v) => update({ motion: v })} />
      </Row>
    </div>
  );
}

function TypeSection() {
  const { appearance: a, update } = useAppearance();
  return (
    <>
      <div className="set-card">
        <Row label="Text size">
          <Slider value={a.fontScale} min={0.85} max={1.25} step={0.01} onChange={(v) => update({ fontScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
      </div>
      <h3 className="section-title">Body font</h3>
      <div className="font-grid">
        {FONTS.map((f) => (
          <button key={f.id} className={`font-card ${a.font === f.id ? 'on' : ''}`} onClick={() => update({ font: f.id })} style={{ fontFamily: f.family }}>
            <span className="font-sample">Aa</span>
            <span>{f.label}</span>
          </button>
        ))}
      </div>
      <h3 className="section-title">Heading font</h3>
      <div className="font-grid">
        {FONTS.map((f) => (
          <button key={f.id} className={`font-card ${a.displayFont === f.id ? 'on' : ''}`} onClick={() => update({ displayFont: f.id })} style={{ fontFamily: f.family }}>
            <span className="font-sample">GG</span>
            <span>{f.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ChatSection() {
  const { appearance: a, update } = useAppearance();
  const { me } = useNexus();
  const friend: User = { ...me, id: 'demo', username: 'kairo', displayName: 'kairo', accent: '#22d3ee', avatar: null, presence: 'online' };
  const style = a.messageStyle === 'auto' ? 'bubbles' : a.messageStyle;
  return (
    <>
      <div className="set-card">
        <Row label="Message style" hint="Auto uses bubbles in DMs and a flat feed in channels">
          <Seg
            value={a.messageStyle}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'bubbles', label: 'Bubbles' }, { value: 'flat', label: 'Flat' }, { value: 'cards', label: 'Cards' }]}
            onChange={(v) => update({ messageStyle: v })}
          />
        </Row>
      </div>
      <h3 className="section-title">Preview</h3>
      <div className="chat-preview messages" data-style={style}>
        {[
          { u: friend, t: 'anyone up for ranked? 🎯', own: false },
          { u: me, t: 'yes!! give me **5 mins**', own: true },
          { u: friend, t: '||I already queued us||', own: false },
        ].map((m, i) => (
          <div key={i} className={`msg ${m.own ? 'own' : ''}`}>
            <div className="msg-row">
              <div className="msg-gutter"><Avatar user={m.u} size={40} showPresence={false} /></div>
              <div className="msg-main">
                <div className="msg-meta"><span className="msg-author" style={{ color: m.u.accent }}>{m.u.displayName}</span><time>Today at 9:41 PM</time></div>
                <div className="msg-body"><div className="msg-text">{m.t.replace(/\*\*|\|\|/g, '')}</div></div>
              </div>
            </div>
          </div>
        ))}
        <div className="msg">
          <div className="msg-row">
            <div className="msg-gutter"><Avatar user={friend} size={40} showPresence={false} /></div>
            <div className="msg-main"><div className="msg-body"><div className="msg-sticker"><Sticker sticker={{ id: 'nexus:gg' }} size={110} /></div></div></div>
          </div>
        </div>
      </div>
    </>
  );
}

function PluginsSection() {
  const { plugin, setPlugin } = useAppearance();
  const cats = ['Chat', 'Interface', 'Privacy', 'Fun'] as const;
  return (
    <>
      <p className="muted">Built-in plugins change how Nexus behaves. Flip them on and off any time.</p>
      {cats.map((c) => (
        <div key={c}>
          <h3 className="section-title">{c}</h3>
          <div className="plugin-grid">
            {PLUGINS.filter((p) => p.category === c).map((p) => (
              <div key={p.id} className={`plugin ${plugin(p.id) ? 'on' : ''}`}>
                <div className="plugin-head">
                  <span className="plugin-icon"><Puzzle size={16} /></span>
                  <strong>{p.name}</strong>
                  <Toggle on={plugin(p.id)} onChange={(v) => setPlugin(p.id, v)} label={p.name} />
                </div>
                <p className="muted small">{p.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function CssSection() {
  const { appearance, update } = useAppearance();
  const [draft, setDraft] = useState(appearance.customCss);
  const [auto, setAuto] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => setDraft(appearance.customCss), [appearance.customCss]);

  function change(v: string) {
    setDraft(v);
    if (auto) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => update({ customCss: v }), 300);
    }
  }

  return (
    <>
      <p className="muted">
        Write CSS that is applied only on your screen. Use the variables below to stay in sync with your theme. If something breaks, clear the editor and it goes back to normal.
      </p>
      <div className="css-editor">
        <div className="css-toolbar">
          <label className="inline-toggle">
            <Toggle on={auto} onChange={setAuto} label="Live apply" /> Live apply
          </label>
          {!auto && <button className="btn sm primary" onClick={() => update({ customCss: draft })}>Apply</button>}
          <button className="btn sm ghost" onClick={() => { setDraft(''); update({ customCss: '' }); }}>
            <Trash2 size={14} /> Clear
          </button>
          <span className="muted small">{draft.length.toLocaleString()} / 60,000</span>
        </div>
        <textarea
          spellCheck={false}
          value={draft}
          maxLength={60000}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.currentTarget;
              const s = el.selectionStart;
              const v = draft.slice(0, s) + '  ' + draft.slice(el.selectionEnd);
              change(v);
              requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = s + 2));
            }
          }}
          placeholder={'/* Try it */\n.msg-author { text-transform: uppercase; letter-spacing: .05em; }'}
        />
      </div>
      <h3 className="section-title">Snippets</h3>
      <div className="snippet-grid">
        {CSS_SNIPPETS.map((s) => (
          <button key={s.name} className="snippet" onClick={() => change(`${draft}${draft && !draft.endsWith('\n') ? '\n' : ''}/* ${s.name} */\n${s.css}\n`)}>
            <strong>{s.name}</strong>
            <code>{s.css.split('\n')[0]}</code>
          </button>
        ))}
      </div>
      <h3 className="section-title">Variables and hooks</h3>
      <div className="docs-card">
        <p><code>--accent</code> <code>--accent-2</code> <code>--accent-rgb</code> <code>--bg</code> <code>--text</code> <code>--panel-rgb</code> <code>--radius</code> <code>--gap</code> <code>--font</code> <code>--display</code></p>
        <p className="muted small">Useful classes: <code>.dock</code> <code>.context</code> <code>.main</code> <code>.chat</code> <code>.msg</code> <code>.msg.own</code> <code>.msg-author</code> <code>.msg-text</code> <code>.composer</code> <code>.avatar</code> <code>.orb</code> <code>.chan-link</code> <code>.wallpaper</code></p>
      </div>
    </>
  );
}

interface GalleryTheme {
  id: string;
  name: string;
  description: string;
  data: Appearance;
  installs: number;
  author: User;
}

function GallerySection() {
  const { appearance, replace } = useAppearance();
  const { me } = useNexus();
  const [themes, setThemes] = useState<GalleryTheme[]>([]);
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [q, setQ] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = () => api.get<{ themes: GalleryTheme[] }>(`/themes?sort=${sort}&q=${encodeURIComponent(q)}`).then((r) => setThemes(r.themes));
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, q]);

  async function install(t: GalleryTheme) {
    if (normalize(t.data).customCss && !window.confirm(`"${t.name}" includes custom CSS written by ${t.author.displayName}. Only install themes from people you trust. Continue?`)) return;
    replace(normalize(t.data));
    await api.post(`/themes/${t.id}/install`);
    setNotice(`Installed ${t.name}.`);
    load();
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/themes', { name, description, data: appearance });
      setPublishing(false);
      setName('');
      setDescription('');
      setNotice('Published! Others can now install your theme.');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(t: GalleryTheme) {
    if (!window.confirm(`Delete ${t.name} from the gallery?`)) return;
    await api.del(`/themes/${t.id}`);
    load();
  }

  return (
    <>
      <div className="gallery-bar">
        <input className="text-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search themes" aria-label="Search themes" />
        <Seg value={sort} options={[{ value: 'top', label: 'Popular' }, { value: 'new', label: 'Newest' }]} onChange={setSort} />
        <button className="btn primary" onClick={() => setPublishing((v) => !v)}><Upload size={16} /> Publish my look</button>
      </div>
      {publishing && (
        <form className="set-card form" onSubmit={publish}>
          <p className="muted small">Shares your current colours, wallpaper, fonts, layout, plugins and custom CSS.</p>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} /></label>
          <label className="field"><span>Description</span><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions"><button className="btn primary">Publish</button></div>
        </form>
      )}
      {notice && <p className="notice">{notice}</p>}
      <div className="gallery-grid">
        {themes.length === 0 && <p className="muted">No themes yet. Be the first to publish one!</p>}
        {themes.map((t) => {
          const d = normalize(t.data);
          return (
            <article key={t.id} className="gtheme">
              <div className="gtheme-art" style={{ background: d.colors.bg }}>
                <span style={{ background: `radial-gradient(circle at 25% 30%, ${d.colors.accent}, transparent 60%), radial-gradient(circle at 80% 80%, ${d.colors.accent2}, transparent 55%)` }} />
                <i style={{ background: d.colors.panel }} />
                {d.customCss && <em>CSS</em>}
              </div>
              <div className="gtheme-body">
                <strong>{t.name}</strong>
                <span className="muted small">by {t.author.displayName} · {t.installs} install{t.installs === 1 ? '' : 's'}</span>
                {t.description && <p className="small">{t.description}</p>}
                <div className="gtheme-actions">
                  <button className="btn sm primary" onClick={() => install(t)}>Install</button>
                  {t.author.id === me.id && <button className="btn sm danger-ghost" onClick={() => remove(t)}>Delete</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function BackupSection() {
  const { appearance, replace } = useAppearance();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const json = JSON.stringify(appearance, null, 2);

  function download() {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nexus-theme.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importIt() {
    try {
      replace(normalize(JSON.parse(text)));
      setMsg({ ok: true, text: 'Imported.' });
    } catch {
      setMsg({ ok: false, text: "That doesn't look like a Nexus theme." });
    }
  }

  return (
    <>
      <div className="set-card">
        <Row label="Export" hint="Save your whole setup as a file">
          <span className="btn-row">
            <button className="btn" onClick={download}><Download size={16} /> Download</button>
            <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(json)}>Copy JSON</button>
          </span>
        </Row>
        <Row label="Reset" hint="Back to the default Nexus Night look">
          <button className="btn danger-ghost" onClick={() => window.confirm('Reset all appearance settings?') && replace(DEFAULT_APPEARANCE)}>
            <RotateCcw size={16} /> Reset everything
          </button>
        </Row>
      </div>
      <h3 className="section-title">Import</h3>
      <textarea className="json-box" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste theme JSON here" spellCheck={false} />
      <div className="btn-row">
        <button className="btn primary" disabled={!text.trim()} onClick={importIt}>Import</button>
        <label className="btn ghost">
          <Upload size={16} /> From file
          <input type="file" accept="application/json" hidden onChange={async (e) => e.target.files?.[0] && setText(await e.target.files[0].text())} />
        </label>
      </div>
      {msg && <p className={msg.ok ? 'notice' : 'form-error'}>{msg.text}</p>}
    </>
  );
}

const STATUSES: { value: Status; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Idle' },
  { value: 'dnd', label: 'Do not disturb' },
  { value: 'invisible', label: 'Invisible' },
];

function ProfileSection() {
  const { me, setMe, logout } = useNexus();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [accent, setAccent] = useState(me.accent);
  const [nowPlaying, setNowPlaying] = useState(me.nowPlaying);
  const [lfg, setLfg] = useState(me.lfg);
  const [games, setGames] = useState(me.games.join(', '));
  const [status, setStatus] = useState<Status>(me.status);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'avatar' | 'banner' | null>(null);

  async function save(e?: FormEvent, extra: Record<string, unknown> = {}) {
    e?.preventDefault();
    setMsg(null);
    try {
      const r = await api.patch<{ user: Me }>('/users/me', {
        displayName,
        bio,
        accent,
        nowPlaying,
        lfg,
        status,
        games: games.split(',').map((g) => g.trim()).filter(Boolean),
        ...extra,
      });
      setMe({ ...r.user, presence: status === 'invisible' ? 'offline' : status });
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  async function uploadImage(kind: 'avatar' | 'banner', file: File) {
    setBusy(kind);
    try {
      const up = await api.upload(file, await imageSize(file));
      if (up.attachment.kind !== 'image' && up.attachment.kind !== 'gif') throw new Error('Please choose an image');
      await save(undefined, { [kind === 'avatar' ? 'avatarUploadId' : 'bannerUploadId']: up.id });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const preview = { ...me, displayName: displayName || me.username, accent, presence: status === 'invisible' ? ('offline' as const) : status };

  return (
    <div className="profile-editor">
      <form className="set-card form" onSubmit={save}>
        <div className="form-2col">
          <label className="field"><span>Display name</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={32} /></label>
          <label className="field"><span>Now playing</span><input value={nowPlaying} onChange={(e) => setNowPlaying(e.target.value)} maxLength={60} placeholder="Valorant" /></label>
        </div>
        <label className="field"><span>Bio</span><textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190} placeholder="IGL, smokes main, plays after 9pm" /></label>
        <label className="field"><span>Favourite games (comma separated)</span><input value={games} onChange={(e) => setGames(e.target.value)} placeholder="Valorant, Minecraft" /></label>
        <div className="form-2col">
          <div className="field">
            <span>Avatar</span>
            <span className="btn-row">
              <label className="btn sm">{busy === 'avatar' ? 'Uploading…' : 'Upload'}<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadImage('avatar', e.target.files[0])} /></label>
              {me.avatar && <button type="button" className="btn sm ghost" onClick={() => save(undefined, { avatarUploadId: null })}>Remove</button>}
            </span>
          </div>
          <div className="field">
            <span>Banner</span>
            <span className="btn-row">
              <label className="btn sm">{busy === 'banner' ? 'Uploading…' : 'Upload'}<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadImage('banner', e.target.files[0])} /></label>
              {me.banner && <button type="button" className="btn sm ghost" onClick={() => save(undefined, { bannerUploadId: null })}>Remove</button>}
            </span>
          </div>
        </div>
        <div className="field">
          <span>Name colour</span>
          <label className="color-pick"><input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /><code>{accent}</code></label>
        </div>
        <Row label="Looking for teammates" hint="Show an LFG badge on your profile">
          <Toggle on={lfg} onChange={setLfg} label="Looking for teammates" />
        </Row>
        <div className="field">
          <span>Status</span>
          <span className="seg inline">
            {STATUSES.map((s) => (
              <button type="button" key={s.value} className={status === s.value ? 'on' : ''} onClick={() => setStatus(s.value)}>
                <span className={`dot presence-${s.value === 'invisible' ? 'offline' : s.value}`} /> {s.label}
              </button>
            ))}
          </span>
        </div>
        {msg && <p className={msg.ok ? 'notice' : 'form-error'}>{msg.text}</p>}
        <div className="btn-row">
          <button className="btn primary">Save profile</button>
          <button type="button" className="btn ghost" onClick={async () => { await logout(); navigate('/'); }}>Sign out</button>
        </div>
      </form>
      <aside className="profile-preview">
        <p className="eyebrow">Preview</p>
        <div className="pcard" style={{ ['--av' as string]: accent }}>
          <div className="pcard-banner">{me.banner && <img src={me.banner} alt="" />}</div>
          <div className="pcard-body">
            <Avatar user={preview} size={80} />
            <h3 style={{ color: accent }}>{preview.displayName}</h3>
            <p className="muted small">@{me.username}</p>
            {nowPlaying && <span className="chip">🎮 {nowPlaying}</span>}
            {lfg && <span className="chip lfg">Looking for teammates</span>}
            {bio && <p className="profile-bio">{bio}</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
