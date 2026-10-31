import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Clapperboard, Gamepad2, MessagesSquare, Palette, Sparkles, Swords, Trophy, Users, X } from 'lucide-react';
import { api } from '../lib/api';
import { PRESETS, applyPreset } from '../lib/appearance';
import { useAppearance } from '../lib/appearanceStore';
import { STICKERS, Sticker, stickerRef } from '../lib/stickers';
import type { Me } from '../lib/types';

const GAME_PICKS = ['Valorant', 'League of Legends', 'Counter-Strike 2', 'Minecraft', 'Fortnite', 'Apex Legends', 'Rocket League', 'Overwatch 2', 'Dota 2', 'EA Sports FC', 'Call of Duty', 'Genshin Impact', 'Roblox', 'Marvel Rivals'];
const WORDS = ['squad', 'clan', 'team', 'guild', 'crew', 'community'];

/** Landing page with sign-up and sign-in. */
export function AuthPage({ onAuthed }: { onAuthed: (me: Me) => void }) {
  const [panel, setPanel] = useState<'login' | 'register' | null>(null);
  const [word, setWord] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setWord((w) => (w + 1) % WORDS.length), 2200);
    return () => clearInterval(t);
  }, []);

  // Gentle parallax on the floating cards.
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      el.style.setProperty('--px', String(x));
      el.style.setProperty('--py', String(y));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Reveal sections as they scroll into view.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
      { threshold: 0.15 },
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing">
      <div className="land-bg" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <div className="land-floor" />
        <div className="land-stars" />
      </div>

      <header className="land-nav">
        <div className="land-brand">
          <span className="logo-mark" />
          <span>Nexus</span>
        </div>
        <nav>
          <a href="#features">Features</a>
          <a href="#customise">Customise</a>
          <a href="#stickers">Stickers</a>
        </nav>
        <div className="land-nav-cta">
          <button className="btn ghost" onClick={() => setPanel('login')}>Sign in</button>
          <button className="btn primary" onClick={() => setPanel('register')}>Get started</button>
        </div>
      </header>

      <section className="land-hero" ref={heroRef}>
        <div className="land-copy">
          <span className="pill-tag"><Sparkles size={14} /> The social home for gamers</span>
          <h1>
            One place for your
            <span className="word-swap" aria-live="polite">
              {WORDS.map((w, i) => (
                <span key={w} className={i === word ? 'on' : i === (word + WORDS.length - 1) % WORDS.length ? 'out' : ''}>
                  {w}
                </span>
              ))}
            </span>
          </h1>
          <p className="land-sub">
            Chat, clips, communities and competition, finally in one app. Make it look exactly how you want with themes, plugins and your own CSS.
          </p>
          <div className="land-ctas">
            <button className="btn primary xl glow" onClick={() => setPanel('register')}>
              Create your account <ArrowRight size={18} />
            </button>
            <button className="btn xl" onClick={() => setPanel('login')}>I already have one</button>
          </div>
          <div className="land-proof">
            <span><Check size={15} /> Free forever</span>
            <span><Check size={15} /> No ads in chat</span>
            <span><Check size={15} /> Your data, your rules</span>
          </div>
        </div>

        <div className="land-stage" aria-hidden="true">
          <div className="float-card chat-card">
            <div className="fc-head"><span className="fc-hash">#</span> scrims <span className="fc-live">LIVE</span></div>
            <div className="fc-msg"><span className="fc-av a1">K</span><div><b>kairo</b><p>who's free for a 5-stack tonight? 🎯</p></div></div>
            <div className="fc-msg"><span className="fc-av a2">N</span><div><b>nova</b><p>me! bringing my <span className="fc-mention">@duelist</span> main</p></div></div>
            <div className="fc-msg"><span className="fc-av a3">R</span><div><b>riven</b><div className="fc-sticker"><Sticker sticker={{ id: 'nexus:lets-go' }} size={64} /></div></div></div>
            <div className="fc-typing"><i /><i /><i /> ash is typing…</div>
          </div>
          <div className="float-card clip-card">
            <div className="clip-thumb"><span className="clip-play">▶</span><span className="clip-tag">1v4 CLUTCH</span></div>
            <div className="clip-meta"><b>Ace on Ascent</b><span>12.4k views · 🔥 2.1k</span></div>
          </div>
          <div className="float-card bracket-card">
            <div className="br-title"><Trophy size={14} /> Friday Cup · Semis</div>
            <div className="br-row win"><span>Midnight</span><b>13</b></div>
            <div className="br-row"><span>Neon Owls</span><b>9</b></div>
          </div>
          <div className="float-card theme-card">
            {PRESETS.slice(0, 5).map((p) => (
              <span key={p.id} style={{ background: `linear-gradient(135deg, ${p.colors.accent}, ${p.colors.accent2})` }} />
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="land-section">
        <h2 className="reveal">Everything your squad needs</h2>
        <div className="feature-grid">
          {[
            { icon: MessagesSquare, title: 'Chat that feels alive', text: 'Replies, reactions, GIFs, stickers, rich text and typing indicators, all in real time.' },
            { icon: Users, title: 'Communities your way', text: 'Announcement and chat channels, roles, invites and an accent colour that is all yours.' },
            { icon: Palette, title: 'Customise everything', text: 'Nine themes, fonts, layout, density, wallpapers, plugins and full custom CSS.' },
            { icon: Clapperboard, title: 'Clips and discovery', text: 'A gaming-first feed of clips, creators and news. Coming soon.' },
            { icon: Swords, title: 'Find teammates', text: 'Flag yourself as looking for a team and match by game, role and region.' },
            { icon: Trophy, title: 'Tournaments built in', text: 'Brackets, registration and match reporting inside your community. Coming soon.' },
          ].map((f, i) => (
            <article key={f.title} className="feature reveal" style={{ transitionDelay: `${i * 70}ms` }}>
              <span className="feature-icon"><f.icon size={22} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="customise" className="land-section split-section">
        <div className="reveal">
          <span className="pill-tag"><Palette size={14} /> Studio</span>
          <h2>Make it unmistakably yours</h2>
          <p className="land-sub">
            Pick a theme, or tune every colour, font, corner and panel yourself. Turn plugins on or off. Write your own CSS and share it in the theme gallery.
          </p>
          <ul className="tick-list">
            <li><Check size={16} /> Live preview while you tweak</li>
            <li><Check size={16} /> Syncs across all your devices</li>
            <li><Check size={16} /> Export, import and publish themes</li>
          </ul>
        </div>
        <ThemeCarousel />
      </section>

      <section id="stickers" className="land-section">
        <h2 className="reveal">Say it with a sticker</h2>
        <div className="marquee">
          <div className="marquee-track">
            {[...STICKERS, ...STICKERS].map((s, i) => (
              <span key={i} className="marquee-item"><Sticker sticker={stickerRef(s)} size={96} /></span>
            ))}
          </div>
        </div>
      </section>

      <section className="land-final reveal">
        <Gamepad2 size={40} />
        <h2>Your next session starts here</h2>
        <button className="btn primary xl glow" onClick={() => setPanel('register')}>
          Join Nexus <ArrowRight size={18} />
        </button>
      </section>

      <footer className="land-foot">
        <span>© {new Date().getFullYear()} Project Nexus</span>
        <span className="muted">Working name · built for gamers</span>
      </footer>

      {panel && <AuthPanel mode={panel} onMode={setPanel} onClose={() => setPanel(null)} onAuthed={onAuthed} />}
    </div>
  );
}

function ThemeCarousel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % PRESETS.length), 2600);
    return () => clearInterval(t);
  }, []);
  const p = PRESETS[i];
  const light = p.colors.mode === 'light';
  return (
    <div className="theme-demo reveal" style={{ ['--d-bg' as string]: p.colors.bg, ['--d-panel' as string]: p.colors.panel, ['--d-text' as string]: p.colors.text, ['--d-a' as string]: p.colors.accent, ['--d-b' as string]: p.colors.accent2 }}>
      <div className="td-wall" />
      <div className="td-dock">{[0, 1, 2, 3].map((n) => <span key={n} />)}</div>
      <div className="td-panel">
        <div className="td-line w60" />
        <div className="td-bubble them">gg that was insane</div>
        <div className="td-bubble me">one more? 🎮</div>
        <div className="td-bubble them">queue up 🔥</div>
        <div className="td-input" />
      </div>
      <div className={`td-label ${light ? 'light' : ''}`}>
        <b>{p.name}</b>
        <span>{p.tagline}</span>
      </div>
    </div>
  );
}

function AuthPanel({ mode, onMode, onClose, onAuthed }: { mode: 'login' | 'register'; onMode: (m: 'login' | 'register') => void; onClose: () => void; onAuthed: (me: Me) => void }) {
  const { appearance, update } = useAppearance();
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [games, setGames] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStep(0);
    setError('');
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'register' && step < 2) {
      if (step === 0 && password.length < 8) return setError('Use at least 8 characters for your password.');
      if (step === 0 && !/^[a-zA-Z0-9_.]{3,24}$/.test(username)) return setError('Usernames are 3–24 letters, numbers, dots or underscores.');
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const r =
        mode === 'login'
          ? await api.post<{ user: Me }>('/auth/login', { username, password })
          : await api.post<{ user: Me }>('/auth/register', { username, password, displayName: displayName || undefined, games });
      if (mode === 'register') await api.put('/users/me/prefs', { prefs: appearance }).catch(() => {});
      onAuthed(r.user);
    } catch (err) {
      setError((err as Error).message);
      if (mode === 'register') setStep(0);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (g: string) => setGames((l) => (l.includes(g) ? l.filter((x) => x !== g) : [...l, g]));

  return (
    <div className="auth-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="auth-panel glass" onSubmit={submit}>
        <button type="button" className="icon-btn auth-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {mode === 'register' && (
          <div className="steps" aria-label={`Step ${step + 1} of 3`}>
            {['Account', 'Games', 'Look'].map((s, i) => (
              <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
                <i>{i < step ? <Check size={12} /> : i + 1}</i> {s}
              </span>
            ))}
          </div>
        )}

        {(mode === 'login' || step === 0) && (
          <div className="auth-step" key="s0">
            <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p className="muted">{mode === 'login' ? 'Jump back into the action.' : 'Takes less than a minute.'}</p>
            <label className="field">
              <span>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={24} autoFocus />
            </label>
            {mode === 'register' && (
              <label className="field">
                <span>Display name (optional)</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} placeholder="How friends see you" />
              </label>
            )}
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
            </label>
            {mode === 'register' && <PasswordMeter value={password} />}
          </div>
        )}

        {mode === 'register' && step === 1 && (
          <div className="auth-step" key="s1">
            <h2>What do you play?</h2>
            <p className="muted">We'll use this to suggest communities and teammates.</p>
            <div className="game-cloud">
              {GAME_PICKS.map((g, i) => (
                <button type="button" key={g} className={`chip big ${games.includes(g) ? 'on' : ''}`} onClick={() => toggle(g)} aria-pressed={games.includes(g)} style={{ animationDelay: `${i * 35}ms` }}>
                  {games.includes(g) && <Check size={14} />} {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'register' && step === 2 && (
          <div className="auth-step" key="s2">
            <h2>Pick your vibe</h2>
            <p className="muted">You can change everything later in the Studio.</p>
            <div className="vibe-grid">
              {PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`vibe ${appearance.preset === p.id ? 'on' : ''}`}
                  onClick={() => update((a) => applyPreset(a, p))}
                  style={{ background: `linear-gradient(140deg, ${p.colors.bg} 30%, ${p.colors.accent} 140%)`, color: p.colors.text }}
                >
                  <span className="vibe-dots">
                    <i style={{ background: p.colors.accent }} />
                    <i style={{ background: p.colors.accent2 }} />
                  </span>
                  <b>{p.name}</b>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        <div className="auth-actions">
          {mode === 'register' && step > 0 && (
            <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>
          )}
          <button className="btn primary block glow" disabled={busy}>
            {busy ? 'One sec…' : mode === 'login' ? 'Sign in' : step < 2 ? 'Continue' : "Let's go"}
            {!busy && <ArrowRight size={17} />}
          </button>
        </div>
        <p className="muted small center">
          {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
          <button type="button" className="link-btn" onClick={() => onMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  );
}

function PasswordMeter({ value }: { value: string }) {
  const score = Math.min(4, [value.length >= 8, value.length >= 12, /[A-Z]/.test(value) && /[a-z]/.test(value), /\d|[^\w]/.test(value)].filter(Boolean).length);
  const labels = ['Too short', 'Weak', 'Okay', 'Strong', 'Excellent'];
  return (
    <div className="pw-meter" data-score={value.length < 8 ? 0 : score}>
      <span><i /><i /><i /><i /></span>
      <small>{value ? labels[value.length < 8 ? 0 : score] : 'At least 8 characters'}</small>
    </div>
  );
}
