import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { Me } from '../lib/types';

const GAME_PICKS = ['Valorant', 'League of Legends', 'Counter-Strike 2', 'Minecraft', 'Fortnite', 'Apex Legends', 'Rocket League', 'Overwatch 2', 'Dota 2', 'EA Sports FC'];

export function AuthPage({ onAuthed }: { onAuthed: (me: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [games, setGames] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r =
        mode === 'login'
          ? await api.post<{ user: Me }>('/auth/login', { username, password })
          : await api.post<{ user: Me }>('/auth/register', { username, password, displayName: displayName || undefined, games });
      onAuthed(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggleGame = (g: string) => setGames((list) => (list.includes(g) ? list.filter((x) => x !== g) : [...list, g]));

  return (
    <div className="auth">
      <div className="auth-art" aria-hidden="true">
        <div className="auth-grid" />
        <div className="auth-pitch">
          <span className="logo-mark big" />
          <h1>
            Your gaming life,
            <br />
            <span className="gradient-text">all in one place.</span>
          </h1>
          <p>Chat with your squad, run your community, discover clips and find your next tournament. Built for gamers first.</p>
          <ul className="pillars">
            <li><b>Connect</b> Friends, DMs and communities</li>
            <li><b>Discover</b> Clips, creators and news</li>
            <li><b>Compete</b> Teams, LFG and tournaments</li>
          </ul>
        </div>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="muted">{mode === 'login' ? 'Sign in to jump back in.' : 'It takes less than a minute.'}</p>

        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={24} autoFocus />
        </label>
        {mode === 'register' && (
          <label>
            Display name <span className="muted">(optional)</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : 1}
          />
        </label>
        {mode === 'register' && (
          <fieldset className="game-picks">
            <legend>What do you play?</legend>
            <div className="chip-row">
              {GAME_PICKS.map((g) => (
                <button type="button" key={g} className={`chip ${games.includes(g) ? 'on' : ''}`} onClick={() => toggleGame(g)} aria-pressed={games.includes(g)}>
                  {g}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'One sec…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="muted small center">
          {mode === 'login' ? 'New to Nexus?' : 'Already have an account?'}{' '}
          <button type="button" className="link-btn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  );
}
