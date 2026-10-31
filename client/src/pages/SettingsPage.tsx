import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useNexus } from '../lib/store';
import type { Me, Status } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { AccentPicker } from './CommunitiesPage';

const STATUSES: { value: Status; label: string; hint: string }[] = [
  { value: 'online', label: 'Online', hint: 'Friends see you are around' },
  { value: 'idle', label: 'Idle', hint: 'Away from keyboard' },
  { value: 'dnd', label: 'Do not disturb', hint: 'In a match, ping me later' },
  { value: 'invisible', label: 'Invisible', hint: 'Appear offline to everyone' },
];

export function SettingsPage() {
  const { me, setMe, logout } = useNexus();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [accent, setAccent] = useState(me.accent);
  const [nowPlaying, setNowPlaying] = useState(me.nowPlaying);
  const [lfg, setLfg] = useState(me.lfg);
  const [games, setGames] = useState(me.games.join(', '));
  const [status, setStatus] = useState<Status>(me.status);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const r = await api.patch<{ user: Me }>('/users/me', {
        displayName,
        bio,
        accent,
        nowPlaying,
        lfg,
        status,
        games: games.split(',').map((g) => g.trim()).filter(Boolean),
      });
      setMe(r.user);
      setMessage({ ok: true, text: 'Profile saved.' });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  }

  const preview = { ...me, displayName: displayName || me.username, accent, presence: status === 'invisible' ? 'offline' as const : status };

  return (
    <section className="panel settings">
      <div className="landing-inner">
        <header className="card-head">
          <h1>Profile and settings</h1>
          <button className="btn btn-ghost" onClick={logout}><Icon name="logout" size={16} /> Sign out</button>
        </header>

        <div className="settings-grid">
          <form className="card stack" onSubmit={save}>
            <label>
              Display name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={32} />
            </label>
            <label>
              Bio
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190} placeholder="IGL, smokes main, plays after 9pm" />
            </label>
            <label>
              Now playing
              <input value={nowPlaying} onChange={(e) => setNowPlaying(e.target.value)} maxLength={60} placeholder="Valorant" />
            </label>
            <label>
              Favourite games <span className="muted">(comma separated)</span>
              <input value={games} onChange={(e) => setGames(e.target.value)} placeholder="Valorant, Minecraft" />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={lfg} onChange={(e) => setLfg(e.target.checked)} />
              <span>Show that I'm looking for teammates</span>
            </label>
            <fieldset className="status-picker">
              <legend>Status</legend>
              {STATUSES.map((s) => (
                <label key={s.value} className={`status-option ${status === s.value ? 'on' : ''}`}>
                  <input type="radio" name="status" value={s.value} checked={status === s.value} onChange={() => setStatus(s.value)} />
                  <span className={`presence-dot presence-${s.value === 'invisible' ? 'offline' : s.value}`} />
                  <span>
                    <strong>{s.label}</strong>
                    <span className="muted small">{s.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <AccentPicker value={accent} onChange={setAccent} />
            {message && <p className={message.ok ? 'notice' : 'form-error'}>{message.text}</p>}
            <button className="btn btn-primary">Save profile</button>
          </form>

          <aside className="card profile-preview">
            <p className="eyebrow">Preview</p>
            <div className="profile-banner" style={{ ['--accent' as string]: accent }} />
            <div className="profile-head">
              <Avatar user={preview} size={72} />
              <div>
                <h3>{preview.displayName}</h3>
                <p className="muted">@{me.username}</p>
              </div>
            </div>
            {nowPlaying && <p className="now-playing"><Icon name="gamepad" size={16} /> Playing <strong>{nowPlaying}</strong></p>}
            {lfg && <span className="tag tag-lfg">Looking for teammates</span>}
            {bio && <p className="profile-bio">{bio}</p>}
          </aside>
        </div>
      </div>
    </section>
  );
}
