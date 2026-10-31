import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Crown, Flag, Gamepad2, Play, Plus, Swords, Trash2, Trophy, UserMinus, Users } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useNexus } from '../lib/store';
import { can, type Team, type Tournament, type TournamentEntry, type TournamentMatch, type TournamentSummary } from '../lib/types';
import { Avatar, CommunityBadge } from './Avatar';
import { localInput } from './EventsView';
import { Modal } from './Modal';

const STATUS_LABEL = { registration: 'Registration open', live: 'Live', done: 'Finished' } as const;

export function formatLabel(t: Pick<TournamentSummary, 'teamSize' | 'bestOf'>) {
  return `${t.teamSize === 1 ? 'Solo' : `${t.teamSize}v${t.teamSize}`} · Bo${t.bestOf}`;
}

function when(ts: number) {
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function roundName(round: number, rounds: number) {
  const left = rounds - round;
  if (left === 1) return 'Final';
  if (left === 2) return 'Semifinals';
  if (left === 3) return 'Quarterfinals';
  return `Round of ${2 ** left}`;
}

/** Refetch whenever a tournament changes (optionally only one community's). */
function useTournamentUpdates(onUpdate: (p: { id?: string; removed?: string; communityId: string }) => void) {
  useEffect(() => {
    const socket = getSocket();
    socket.on('tournament:update', onUpdate);
    return () => {
      socket.off('tournament:update', onUpdate);
    };
  }, [onUpdate]);
}

export function TournamentList({ communityId }: { communityId?: string }) {
  const { communities } = useNexus();
  const [list, setList] = useState<TournamentSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    api
      .get<{ tournaments: TournamentSummary[] }>(communityId ? `/communities/${communityId}/tournaments` : '/tournaments')
      .then((r) => setList(r.tournaments));
  }, [communityId]);
  useEffect(() => {
    setList(null);
    load();
  }, [load]);
  useTournamentUpdates(
    useCallback(
      (p: { communityId: string }) => {
        if (!communityId || p.communityId === communityId) load();
      },
      [communityId, load],
    ),
  );

  const hosts = communities.filter((c) => (communityId ? c.id === communityId : true) && can(c, 'manageEvents'));
  const groups = [
    { label: 'Live now', items: (list ?? []).filter((t) => t.status === 'live') },
    { label: 'Open for registration', items: (list ?? []).filter((t) => t.status === 'registration') },
    { label: 'Finished', items: (list ?? []).filter((t) => t.status === 'done') },
  ].filter((g) => g.items.length);

  return (
    <div className="tourney-list">
      <div className="section-head">
        <h2>{communityId ? 'Tournaments' : 'Your tournaments'}</h2>
        {hosts.length > 0 && (
          <button className="btn primary sm" onClick={() => setCreating(true)}>
            <Plus size={15} /> New tournament
          </button>
        )}
      </div>
      {list === null ? (
        <div className="tourney-grid">{[0, 1, 2].map((i) => <div key={i} className="tourney-card skeleton" />)}</div>
      ) : list.length === 0 ? (
        <div className="empty-card">
          <Trophy size={36} />
          <h3>No tournaments yet</h3>
          <p>
            {hosts.length
              ? 'Set one up: pick solo or teams, a bracket size and a start time. Nexus builds the bracket for you.'
              : 'Tournaments from your communities show up here. Organisers with the events permission can create them.'}
          </p>
          {hosts.length > 0 && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> New tournament</button>}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="tourney-group">
            <p className="eyebrow">{g.label}</p>
            <div className="tourney-grid">{g.items.map((t) => <TournamentCard key={t.id} t={t} showCommunity={!communityId} />)}</div>
          </section>
        ))
      )}
      {creating && <CreateTournamentModal hosts={hosts} onClose={() => setCreating(false)} />}
    </div>
  );
}

function TournamentCard({ t, showCommunity }: { t: TournamentSummary; showCommunity: boolean }) {
  return (
    <Link to={`/tournaments/${t.id}`} className={`tourney-card s-${t.status}`} style={{ ['--c' as string]: t.communityAccent }}>
      <div className="tourney-card-top">
        <span className={`tourney-status s-${t.status}`}>{t.status === 'live' && <i className="live-dot" />}{STATUS_LABEL[t.status]}</span>
        {t.myEntryId && <span className="chip sm on">Registered</span>}
      </div>
      <h3>{t.name}</h3>
      <p className="muted small tourney-facts">
        {t.game && <span><Gamepad2 size={13} /> {t.game}</span>}
        <span><Users size={13} /> {formatLabel(t)}</span>
        <span><CalendarDays size={13} /> {when(t.startsAt)}</span>
      </p>
      <div className="tourney-fill">
        <span style={{ width: `${Math.min(100, (t.entrants / t.maxEntrants) * 100)}%` }} />
      </div>
      <div className="tourney-card-foot">
        {t.champion ? (
          <span className="tourney-champ"><Crown size={14} /> {t.champion.name}</span>
        ) : (
          <span className="muted small">{t.entrants}/{t.maxEntrants} {t.teamSize === 1 ? 'players' : 'teams'}</span>
        )}
        {showCommunity && (
          <span className="tourney-community">
            <CommunityBadge name={t.communityName} accent={t.communityAccent || '#22d3ee'} size={20} /> {t.communityName}
          </span>
        )}
      </div>
    </Link>
  );
}

function CreateTournamentModal({ hosts, onClose }: { hosts: { id: string; name: string; game?: string }[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [communityId, setCommunityId] = useState(hosts[0]?.id ?? '');
  const [name, setName] = useState('');
  const [game, setGame] = useState(hosts[0]?.game ?? '');
  const [teamSize, setTeamSize] = useState(1);
  const [maxEntrants, setMaxEntrants] = useState(8);
  const [bestOf, setBestOf] = useState(1);
  const [start, setStart] = useState(localInput(Date.now() + 24 * 3600e3));
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ tournament: Tournament }>(`/communities/${communityId}/tournaments`, {
        name,
        game,
        teamSize,
        maxEntrants,
        bestOf,
        description,
        startsAt: new Date(start).getTime(),
      });
      onClose();
      navigate(`/tournaments/${r.tournament.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New tournament" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {hosts.length > 1 && (
          <label className="field">
            <span>Community</span>
            <select value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
              {hosts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={60} placeholder="Friday Night Cup" autoFocus />
        </label>
        <div className="form-2col">
          <label className="field">
            <span>Game</span>
            <input value={game} onChange={(e) => setGame(e.target.value)} maxLength={40} placeholder="Valorant" />
          </label>
          <label className="field">
            <span>Starts</span>
            <input type="datetime-local" value={start} min={localInput(Date.now())} onChange={(e) => setStart(e.target.value)} required />
          </label>
        </div>
        <div className="form-2col three">
          <label className="field">
            <span>Format</span>
            <select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
              <option value={1}>Solo (1v1)</option>
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Teams of {n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Bracket size</span>
            <select value={maxEntrants} onChange={(e) => setMaxEntrants(Number(e.target.value))}>
              {[4, 8, 16, 32, 64].map((n) => <option key={n} value={n}>Up to {n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Matches</span>
            <select value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))}>
              {[1, 3, 5, 7].map((n) => <option key={n} value={n}>Best of {n}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Rules and details</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} placeholder="Map pool, check-in time, prizes…" />
        </label>
        <p className="muted small">Single elimination. Seeds are drawn at random when you start the bracket, and byes go to the top seeds.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !communityId}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function TournamentDetail({ id }: { id: string }) {
  const { me } = useNexus();
  const navigate = useNavigate();
  const [t, setT] = useState<Tournament | null>(null);
  const [error, setError] = useState('');
  const [reporting, setReporting] = useState<TournamentMatch | null>(null);
  const [registering, setRegistering] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ tournament: Tournament }>(`/tournaments/${id}`)
      .then((r) => setT(r.tournament))
      .catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => {
    setT(null);
    setError('');
    load();
  }, [load]);
  useTournamentUpdates(
    useCallback(
      (p: { id?: string; removed?: string }) => {
        if (p.removed === id) navigate('/tournaments', { replace: true });
        else if (p.id === id) load();
      },
      [id, load, navigate],
    ),
  );

  const entries = useMemo(() => new Map((t?.entries ?? []).map((e) => [e.id, e])), [t]);

  async function act(fn: () => Promise<{ tournament?: Tournament }>) {
    setError('');
    try {
      const r = await fn();
      if (r.tournament) setT(r.tournament);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!t) {
    return (
      <div className="page">
        {error ? <div className="empty-card"><Trophy size={32} /><h3>{error}</h3><Link to="/tournaments" className="btn">Back to tournaments</Link></div> : <div className="tourney-card skeleton" />}
      </div>
    );
  }

  const mine = t.myEntryId ? entries.get(t.myEntryId) : undefined;
  const full = t.entrants >= t.maxEntrants;
  const champion = t.champion ? entries.get(t.champion.id) : undefined;

  return (
    <div className="page tourney-page">
      <Link to="/tournaments" className="back-link"><ArrowLeft size={15} /> Tournaments</Link>
      <header className="tourney-hero" style={{ ['--c' as string]: t.communityAccent }}>
        <div className="tourney-hero-main">
          <span className={`tourney-status s-${t.status}`}>{t.status === 'live' && <i className="live-dot" />}{STATUS_LABEL[t.status]}</span>
          <h1>{t.name}</h1>
          <p className="tourney-facts">
            <Link to={`/communities/${t.communityId}`} className="tourney-community">
              <CommunityBadge name={t.communityName} accent={t.communityAccent || '#22d3ee'} size={20} /> {t.communityName}
            </Link>
            {t.game && <span><Gamepad2 size={14} /> {t.game}</span>}
            <span><Users size={14} /> {formatLabel(t)}</span>
            <span><CalendarDays size={14} /> {when(t.startsAt)}</span>
            <span><Swords size={14} /> {t.entrants}/{t.maxEntrants} {t.teamSize === 1 ? 'players' : 'teams'}</span>
          </p>
          {t.description && <p className="tourney-desc">{t.description}</p>}
        </div>
        <div className="btn-row tourney-actions">
          {t.status === 'registration' && !mine && (
            <button
              className="btn primary"
              disabled={full}
              onClick={() => (t.teamSize === 1 ? act(() => api.post(`/tournaments/${t.id}/register`)) : setRegistering(true))}
            >
              <Plus size={16} /> {full ? 'Bracket full' : t.teamSize === 1 ? 'Register' : 'Register a team'}
            </button>
          )}
          {t.status === 'registration' && mine && mine.ownerId === me.id && (
            <button className="btn" onClick={() => act(() => api.del(`/tournaments/${t.id}/entries/${mine.id}`))}>
              <UserMinus size={15} /> Withdraw
            </button>
          )}
          {t.canManage && t.status === 'registration' && (
            <button className="btn primary glow" disabled={t.entrants < 2} onClick={() => act(() => api.post(`/tournaments/${t.id}/start`))}>
              <Play size={15} /> Start bracket
            </button>
          )}
          {t.canManage && (
            <button
              className="icon-btn danger"
              aria-label="Delete tournament"
              onClick={() => window.confirm(`Delete ${t.name}? This can't be undone.`) && act(() => api.del(`/tournaments/${t.id}`))}
            >
              <Trash2 size={17} />
            </button>
          )}
        </div>
      </header>
      {error && <p className="form-error">{error}</p>}

      {champion && (
        <div className="champion-banner">
          <span className="champion-crown"><Crown size={30} /></span>
          <div>
            <p className="eyebrow">Champion</p>
            <h2>{champion.name}</h2>
          </div>
          <div className="champion-players">{champion.players.slice(0, 6).map((u) => <Avatar key={u.id} user={u} size={34} showPresence={false} />)}</div>
        </div>
      )}

      {t.status === 'registration' ? (
        <section className="card">
          <div className="card-head"><h3><Users size={17} /> Entrants</h3><span className="muted small">The bracket is drawn when an organiser starts it</span></div>
          {t.entries.length === 0 ? (
            <p className="muted">Nobody has registered yet.</p>
          ) : (
            <div className="entrant-grid">
              {t.entries.map((e) => (
                <div key={e.id} className={`entrant ${e.id === t.myEntryId ? 'mine' : ''}`}>
                  <div className="entrant-avatars">{e.players.slice(0, 4).map((u) => <Avatar key={u.id} user={u} size={28} showPresence={false} />)}</div>
                  <b>{e.name}</b>
                  {t.canManage && e.ownerId !== me.id && (
                    <button className="icon-btn sm" aria-label={`Remove ${e.name}`} onClick={() => act(() => api.del(`/tournaments/${t.id}/entries/${e.id}`))}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <Bracket t={t} entries={entries} onReport={setReporting} onDispute={(m) => act(() => api.post(`/tournaments/${t.id}/matches/${m.id}/dispute`))} />
      )}

      {reporting && (
        <ReportModal
          t={t}
          match={reporting}
          entries={entries}
          onClose={() => setReporting(null)}
          onDone={(next) => {
            setReporting(null);
            setT(next);
          }}
        />
      )}
      {registering && <RegisterTeamModal t={t} onClose={() => setRegistering(false)} onDone={(next) => { setRegistering(false); setT(next); }} />}
    </div>
  );
}

function Bracket({
  t,
  entries,
  onReport,
  onDispute,
}: {
  t: Tournament;
  entries: Map<string, TournamentEntry>;
  onReport: (m: TournamentMatch) => void;
  onDispute: (m: TournamentMatch) => void;
}) {
  const rounds = Array.from({ length: t.rounds }, (_, r) => t.matches.filter((m) => m.round === r));
  return (
    <section className="bracket-wrap">
      <div className="bracket" style={{ ['--rounds' as string]: t.rounds }}>
        {rounds.map((ms, r) => (
          <div key={r} className="bracket-round">
            <p className="eyebrow">{roundName(r, t.rounds)}</p>
            <div className="bracket-matches">
              {ms.map((m) => (
                <MatchCard key={m.id} m={m} t={t} entries={entries} final={r === t.rounds - 1} onReport={onReport} onDispute={onDispute} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MatchCard({
  m,
  t,
  entries,
  final,
  onReport,
  onDispute,
}: {
  m: TournamentMatch;
  t: Tournament;
  entries: Map<string, TournamentEntry>;
  final: boolean;
  onReport: (m: TournamentMatch) => void;
  onDispute: (m: TournamentMatch) => void;
}) {
  const bye = m.round === 0 && (!m.a || !m.b);
  const mineIn = t.myEntryId && (m.a === t.myEntryId || m.b === t.myEntryId);
  const side = (id: string | null, score: number | null) => {
    const e = id ? entries.get(id) : undefined;
    const won = !!id && m.winner === id;
    const lost = !!m.winner && !!id && m.winner !== id;
    return (
      <div className={`match-side ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${id && id === t.myEntryId ? 'me' : ''}`}>
        <span className="seed">{e?.seed ?? ''}</span>
        <span className="match-name">{e ? e.name : bye ? 'Bye' : 'TBD'}</span>
        <span className="match-score">{score ?? (won ? 'W' : '')}</span>
      </div>
    );
  };
  return (
    <div className={`match ${bye ? 'bye' : ''} ${mineIn && m.status === 'pending' ? 'ready' : ''} ${final ? 'final' : ''} ${m.disputed ? 'disputed' : ''}`}>
      {side(m.a, m.scoreA)}
      {side(m.b, m.scoreB)}
      {(m.canReport || m.canDispute || m.disputed) && !bye && (
        <div className="match-actions">
          {m.disputed && <span className="match-flag"><Flag size={12} /> Disputed</span>}
          {m.canReport && (
            <button className="btn sm" onClick={() => onReport(m)}>
              {m.status === 'done' ? 'Edit result' : 'Report'}
            </button>
          )}
          {m.canDispute && (
            <button className="btn ghost sm" onClick={() => onDispute(m)}>
              <Flag size={12} /> Dispute
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReportModal({
  t,
  match,
  entries,
  onClose,
  onDone,
}: {
  t: Tournament;
  match: TournamentMatch;
  entries: Map<string, TournamentEntry>;
  onClose: () => void;
  onDone: (t: Tournament) => void;
}) {
  const a = entries.get(match.a!)!;
  const b = entries.get(match.b!)!;
  const [winner, setWinner] = useState(match.winner ?? '');
  const [scoreA, setScoreA] = useState(match.scoreA?.toString() ?? '');
  const [scoreB, setScoreB] = useState(match.scoreB?.toString() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Typing a score picks the winner for you.
  useEffect(() => {
    if (scoreA !== '' && scoreB !== '' && Number(scoreA) !== Number(scoreB)) setWinner(Number(scoreA) > Number(scoreB) ? a.id : b.id);
  }, [scoreA, scoreB, a.id, b.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ tournament: Tournament }>(`/tournaments/${t.id}/matches/${match.id}/report`, {
        winner,
        scoreA: scoreA === '' ? null : Number(scoreA),
        scoreB: scoreB === '' ? null : Number(scoreB),
      });
      onDone(r.tournament);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Report ${roundName(match.round, t.rounds).toLowerCase()}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="report-grid">
          {[
            { e: a, score: scoreA, set: setScoreA },
            { e: b, score: scoreB, set: setScoreB },
          ].map(({ e, score, set }) => (
            <label key={e.id} className={`report-side ${winner === e.id ? 'on' : ''}`}>
              <input type="radio" name="winner" checked={winner === e.id} onChange={() => setWinner(e.id)} />
              <span className="report-name">{winner === e.id && <Crown size={14} />} {e.name}</span>
              <input
                className="report-score"
                type="number"
                min={0}
                max={999}
                value={score}
                onChange={(ev) => set(ev.target.value)}
                placeholder="–"
                aria-label={`${e.name} score`}
              />
            </label>
          ))}
        </div>
        <p className="muted small">Best of {t.bestOf}. Pick the winner, and add the score if you have it.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !winner}>{busy ? 'Saving…' : 'Submit result'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RegisterTeamModal({ t, onClose, onDone }: { t: Tournament; onClose: () => void; onDone: (t: Tournament) => void }) {
  const { me } = useNexus();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<{ teams: Team[] }>('/teams/mine').then((r) => setTeams(r.teams.filter((x) => x.captainId === me.id)));
  }, [me.id]);
  async function register(team: Team) {
    setError('');
    try {
      onDone((await api.post<{ tournament: Tournament }>(`/tournaments/${t.id}/register`, { teamId: team.id })).tournament);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title="Register a team" onClose={onClose}>
      <p className="muted small">Teams need at least {t.teamSize} players. Your whole roster is entered.</p>
      <div className="share-list">
        {teams?.length === 0 && (
          <p className="muted">
            You're not captain of a team yet. <Link to="/tournaments?tab=teams" onClick={onClose}>Create one</Link> and invite your squad.
          </p>
        )}
        {teams?.map((team) => (
          <div key={team.id} className="share-row">
            <span className="team-mini">
              <TeamMark team={team} size={30} />
              <span><b>{team.name}</b> <span className="muted small">{team.members.length} players</span></span>
            </span>
            <button className="btn primary sm" disabled={team.members.length < t.teamSize} onClick={() => register(team)}>
              {team.members.length < t.teamSize ? `Needs ${t.teamSize}` : 'Register'}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

export function TeamMark({ team, size = 44 }: { team: Pick<Team, 'tag' | 'accent'>; size?: number }) {
  return (
    <span className="team-mark" style={{ width: size, height: size, fontSize: size * 0.3, ['--c' as string]: team.accent }}>
      {team.tag}
    </span>
  );
}
