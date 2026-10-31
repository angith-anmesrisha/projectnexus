import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Crown, LogOut, Pencil, Plus, Shield, Trash2, UserPlus, X } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useNexus } from '../lib/store';
import type { Team } from '../lib/types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { TeamMark } from './Tournaments';

const ACCENTS = ['#8b5cf6', '#22d3ee', '#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#e2e8f0'];

export function TeamsPanel() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [inviting, setInviting] = useState<Team | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<{ teams: Team[] }>('/teams/mine').then((r) => setTeams(r.teams));
  }, []);
  useEffect(() => {
    load();
    const socket = getSocket();
    socket.on('team:update', load);
    return () => {
      socket.off('team:update', load);
    };
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const invites = (teams ?? []).filter((t) => t.myRole === 'invited');
  const mine = (teams ?? []).filter((t) => t.myRole !== 'invited');

  return (
    <div className="teams-panel">
      <div className="section-head">
        <h2>Your teams</h2>
        <button className="btn primary sm" onClick={() => setEditing('new')}><Plus size={15} /> New team</button>
      </div>
      {error && <p className="form-error">{error}</p>}

      {invites.length > 0 && (
        <section className="team-invites">
          <p className="eyebrow">Invites</p>
          {invites.map((t) => (
            <div key={t.id} className="team-invite">
              <TeamMark team={t} size={40} />
              <span>
                <b>{t.name}</b>
                <span className="muted small">{t.members.length} players{t.game ? ` · ${t.game}` : ''}</span>
              </span>
              <button className="btn primary sm" onClick={() => act(() => api.post(`/teams/${t.id}/accept`))}><Check size={14} /> Join</button>
              <button className="btn ghost sm" onClick={() => act(() => api.post(`/teams/${t.id}/decline`))}><X size={14} /> Decline</button>
            </div>
          ))}
        </section>
      )}

      {teams === null ? (
        <div className="team-grid">{[0, 1].map((i) => <div key={i} className="team-card skeleton" />)}</div>
      ) : mine.length === 0 ? (
        <div className="empty-card">
          <Shield size={36} />
          <h3>No team yet</h3>
          <p>Make a team, give it a tag, and invite your squad. Captains can register the whole roster for team tournaments.</p>
          <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> New team</button>
        </div>
      ) : (
        <div className="team-grid">
          {mine.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              onEdit={() => setEditing(t)}
              onInvite={() => setInviting(t)}
              act={act}
            />
          ))}
        </div>
      )}
      {editing && <TeamModal team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {inviting && <InviteModal team={teams?.find((t) => t.id === inviting.id) ?? inviting} onClose={() => setInviting(null)} onChange={load} />}
    </div>
  );
}

function TeamCard({ team, onEdit, onInvite, act }: { team: Team; onEdit: () => void; onInvite: () => void; act: (fn: () => Promise<unknown>) => void }) {
  const { me } = useNexus();
  const captain = team.myRole === 'captain';
  return (
    <article className="team-card" style={{ ['--c' as string]: team.accent }}>
      <header>
        <TeamMark team={team} size={52} />
        <div>
          <h3>{team.name}</h3>
          <p className="muted small">{team.game || 'Any game'} · {team.members.length} {team.members.length === 1 ? 'player' : 'players'}</p>
        </div>
        {captain && <button className="icon-btn sm" onClick={onEdit} aria-label="Edit team"><Pencil size={14} /></button>}
      </header>
      {team.bio && <p className="team-bio">{team.bio}</p>}
      <div className="team-roster">
        {team.members.map((u) => (
          <div key={u.id} className="team-player">
            <Avatar user={u} size={30} />
            <span>{u.displayName}</span>
            {u.id === team.captainId && <span className="chip sm on"><Crown size={11} /> Captain</span>}
            {captain && u.id !== me.id && (
              <span className="team-player-actions">
                <button className="icon-btn sm" title="Make captain" aria-label={`Make ${u.displayName} captain`} onClick={() => act(() => api.post(`/teams/${team.id}/captain`, { userId: u.id }))}>
                  <Crown size={13} />
                </button>
                <button className="icon-btn sm danger" title="Remove" aria-label={`Remove ${u.displayName}`} onClick={() => act(() => api.del(`/teams/${team.id}/members/${u.id}`))}>
                  <X size={13} />
                </button>
              </span>
            )}
          </div>
        ))}
        {team.invites.map((u) => (
          <div key={u.id} className="team-player pending">
            <Avatar user={u} size={30} showPresence={false} />
            <span>{u.displayName}</span>
            <span className="muted small">Invited</span>
            {captain && (
              <span className="team-player-actions">
                <button className="icon-btn sm" aria-label={`Cancel invite for ${u.displayName}`} onClick={() => act(() => api.del(`/teams/${team.id}/invites/${u.id}`))}>
                  <X size={13} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="btn-row">
        {captain && <button className="btn sm" onClick={onInvite}><UserPlus size={14} /> Invite</button>}
        {captain ? (
          <button
            className="btn danger-ghost sm"
            onClick={() => window.confirm(`Disband ${team.name}?`) && act(() => api.del(`/teams/${team.id}`))}
          >
            <Trash2 size={14} /> Disband
          </button>
        ) : (
          <button className="btn ghost sm" onClick={() => act(() => api.post(`/teams/${team.id}/leave`))}><LogOut size={14} /> Leave</button>
        )}
      </div>
    </article>
  );
}

function TeamModal({ team, onClose, onSaved }: { team: Team | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useNexus();
  const [name, setName] = useState(team?.name ?? '');
  const [tag, setTag] = useState(team?.tag ?? '');
  const [game, setGame] = useState(team?.game ?? me.games[0] ?? '');
  const [bio, setBio] = useState(team?.bio ?? '');
  const [accent, setAccent] = useState(team?.accent ?? ACCENTS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { name, tag, game, bio, accent };
      if (team) await api.patch(`/teams/${team.id}`, body);
      else await api.post('/teams', body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={team ? 'Edit team' : 'New team'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="team-preview">
          <TeamMark team={{ tag: tag.toUpperCase() || 'TAG', accent }} size={64} />
          <div>
            <b>{name || 'Team name'}</b>
            <span className="muted small">{game || 'Any game'}</span>
          </div>
        </div>
        <div className="form-2col">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={32} placeholder="Night Owls" autoFocus />
          </label>
          <label className="field">
            <span>Tag</span>
            <input value={tag} onChange={(e) => setTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} required minLength={2} maxLength={5} placeholder="OWL" />
          </label>
        </div>
        <label className="field">
          <span>Game</span>
          <input value={game} onChange={(e) => setGame(e.target.value)} maxLength={40} placeholder="Valorant" />
        </label>
        <label className="field">
          <span>About</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={2} placeholder="EU evenings, Plat to Diamond" />
        </label>
        <div className="field">
          <span>Colour</span>
          <div className="swatches">
            {ACCENTS.map((c) => (
              <button type="button" key={c} className={`swatch ${accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setAccent(c)} aria-label={`Colour ${c}`} />
            ))}
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : team ? 'Save' : 'Create team'}</button>
        </div>
      </form>
    </Modal>
  );
}

function InviteModal({ team, onClose, onChange }: { team: Team; onClose: () => void; onChange: () => void }) {
  const { friends } = useNexus();
  const [error, setError] = useState('');
  const taken = new Set([...team.members, ...team.invites].map((u) => u.id));
  async function invite(userId: string) {
    setError('');
    try {
      await api.post(`/teams/${team.id}/invites`, { userId });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title={`Invite to ${team.name}`} onClose={onClose}>
      <div className="share-list">
        {friends.friends.length === 0 && <p className="muted">Add some friends first, then invite them here.</p>}
        {friends.friends.map((f) => (
          <div key={f.id} className="share-row">
            <span className="team-mini"><Avatar user={f} size={30} /> <b>{f.displayName}</b></span>
            <button className="btn primary sm" disabled={taken.has(f.id)} onClick={() => invite(f.id)}>
              {team.members.some((m) => m.id === f.id) ? 'On team' : team.invites.some((m) => m.id === f.id) ? 'Invited' : 'Invite'}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
