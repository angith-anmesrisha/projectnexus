// Community tournaments: registration (solo or teams), single-elimination
// brackets with byes, match reporting by the players, disputes, and
// organiser overrides.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import { PERMS, communityRole, hasPerm } from '../access.ts';
import { tx } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound, str } from '../http.ts';
import { notify } from '../notify.ts';
import type { Realtime } from '../realtime.ts';
import { usersById } from '../serialize.ts';
import { teamMemberIds, type TeamRow } from './teams.ts';

interface TournamentRow {
  id: string;
  community_id: string;
  name: string;
  game: string;
  description: string;
  team_size: number;
  max_entrants: number;
  best_of: number;
  starts_at: number;
  status: 'registration' | 'live' | 'done';
  champion_entry_id: string | null;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

interface EntryRow {
  id: string;
  tournament_id: string;
  owner_id: string;
  team_id: string | null;
  name: string;
  seed: number | null;
  created_at: number;
}

interface MatchRow {
  id: string;
  tournament_id: string;
  round: number;
  slot: number;
  a_entry: string | null;
  b_entry: string | null;
  winner_entry: string | null;
  score_a: number | null;
  score_b: number | null;
  status: 'pending' | 'done';
  disputed: number;
  reported_by: string | null;
  updated_at: number | null;
}

const SIZES = [4, 8, 16, 32, 64];
const BEST_OF = [1, 3, 5, 7];

/**
 * Bracket positions for seeds 1..size, so that the top seeds meet last and
 * byes (seeds past the entrant count) land next to the top seeds.
 * For 8: [1, 8, 4, 5, 2, 7, 3, 6].
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

export const bracketSize = (n: number) => 2 ** Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

export function tournamentRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  const entriesOf = (tid: string) =>
    db.prepare('SELECT * FROM tournament_entries WHERE tournament_id = ? ORDER BY COALESCE(seed, 1e9), created_at').all(tid) as unknown as EntryRow[];
  const matchesOf = (tid: string) =>
    db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round, slot').all(tid) as unknown as MatchRow[];
  const playersOf = (entryId: string) =>
    (db.prepare('SELECT user_id FROM entry_players WHERE entry_id = ?').all(entryId) as { user_id: string }[]).map((r) => r.user_id);
  const allPlayers = (tid: string) =>
    (db.prepare('SELECT user_id FROM entry_players WHERE tournament_id = ?').all(tid) as { user_id: string }[]).map((r) => r.user_id);
  const getEntry = (id: string | null) =>
    id ? (db.prepare('SELECT * FROM tournament_entries WHERE id = ?').get(id) as unknown as EntryRow | undefined) : undefined;

  const canManage = (t: TournamentRow, userId: string) => t.created_by === userId || hasPerm(db, userId, t.community_id, PERMS.manageEvents);

  function tournamentFor(viewerId: string, id: string) {
    const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as unknown as TournamentRow | undefined;
    if (!t || !communityRole(db, viewerId, t.community_id)) throw notFound('Tournament not found');
    return t;
  }

  function summary(t: TournamentRow, viewerId: string) {
    const community = db.prepare('SELECT name, accent FROM communities WHERE id = ?').get(t.community_id) as { name: string; accent: string };
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ?').get(t.id) as { n: number };
    const mine = db
      .prepare('SELECT entry_id FROM entry_players WHERE tournament_id = ? AND user_id = ?')
      .get(t.id, viewerId) as { entry_id: string } | undefined;
    const champion = getEntry(t.champion_entry_id);
    const [creator] = t.created_by ? usersById(rt.ctx, [t.created_by]) : [];
    return {
      id: t.id,
      communityId: t.community_id,
      communityName: community.name,
      communityAccent: community.accent,
      name: t.name,
      game: t.game,
      description: t.description,
      teamSize: t.team_size,
      maxEntrants: t.max_entrants,
      bestOf: t.best_of,
      startsAt: t.starts_at,
      status: t.status,
      entrants: n,
      champion: champion ? { id: champion.id, name: champion.name } : null,
      creator: creator ?? null,
      canManage: canManage(t, viewerId),
      myEntryId: mine?.entry_id ?? null,
      createdAt: t.created_at,
    };
  }

  function detail(t: TournamentRow, viewerId: string) {
    const entries = entriesOf(t.id);
    const manage = canManage(t, viewerId);
    const allMatches = matchesOf(t.id);
    const teamInfo = (id: string | null) =>
      id ? (db.prepare('SELECT id, name, tag, accent FROM teams WHERE id = ?').get(id) as Pick<TeamRow, 'id' | 'name' | 'tag' | 'accent'> | undefined) : undefined;
    return {
      ...summary(t, viewerId),
      entries: entries.map((e) => ({
        id: e.id,
        name: e.name,
        seed: e.seed,
        team: teamInfo(e.team_id) ?? null,
        ownerId: e.owner_id,
        players: usersById(rt.ctx, playersOf(e.id)),
      })),
      matches: allMatches.map((m) => {
        // A result can be corrected only until the next match has been played.
        const next = allMatches.find((x) => x.round === m.round + 1 && x.slot === Math.floor(m.slot / 2));
        const locked = m.status === 'done' && !!next && next.status === 'done';
        const a = getEntry(m.a_entry);
        const b = getEntry(m.b_entry);
        const isOwner = a?.owner_id === viewerId || b?.owner_id === viewerId;
        return {
          id: m.id,
          round: m.round,
          slot: m.slot,
          a: m.a_entry,
          b: m.b_entry,
          winner: m.winner_entry,
          scoreA: m.score_a,
          scoreB: m.score_b,
          status: m.status,
          disputed: !!m.disputed,
          // Players report a ready match; organisers can also correct one.
          canReport: t.status !== 'registration' && !!a && !!b && !locked && (manage || (isOwner && m.status === 'pending')),
          canDispute: t.status === 'live' && m.status === 'done' && !m.disputed && !!a && !!b && isOwner && m.reported_by !== viewerId && !manage,
        };
      }),
      rounds: t.status === 'registration' ? 0 : Math.log2(bracketSize(entries.length)),
    };
  }

  function memberIds(communityId: string) {
    return (db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(communityId) as { user_id: string }[]).map((r) => r.user_id);
  }

  function broadcast(t: TournamentRow, removed = false) {
    for (const uid of memberIds(t.community_id)) {
      rt.toUser(uid, 'tournament:update', removed ? { removed: t.id, communityId: t.community_id } : { id: t.id, communityId: t.community_id });
    }
  }

  const reload = (id: string) => db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as unknown as TournamentRow;

  /** Put a finished match's winner into the next round, or crown the champion. */
  function advance(t: TournamentRow, m: MatchRow, rounds: number) {
    if (m.round === rounds - 1) {
      db.prepare("UPDATE tournaments SET status = 'done', champion_entry_id = ?, finished_at = ? WHERE id = ?").run(m.winner_entry, Date.now(), t.id);
      return;
    }
    const col = m.slot % 2 === 0 ? 'a_entry' : 'b_entry';
    db.prepare(`UPDATE tournament_matches SET ${col} = ? WHERE tournament_id = ? AND round = ? AND slot = ?`).run(
      m.winner_entry,
      t.id,
      m.round + 1,
      Math.floor(m.slot / 2),
    );
  }

  // Tournaments across all of the viewer's communities.
  router.get('/tournaments', (req, res) => {
    const userId = me(req);
    const rows = db
      .prepare(
        `SELECT t.* FROM tournaments t JOIN community_members m ON m.community_id = t.community_id AND m.user_id = ?
         WHERE t.status != 'done' OR t.finished_at > ?
         ORDER BY CASE t.status WHEN 'live' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END, t.starts_at LIMIT 60`,
      )
      .all(userId, Date.now() - 30 * 24 * 3_600_000) as unknown as TournamentRow[];
    res.json({ tournaments: rows.map((t) => summary(t, userId)) });
  });

  router.get('/communities/:id/tournaments', (req, res) => {
    const userId = me(req);
    if (!communityRole(db, userId, req.params.id)) throw notFound('Community not found');
    const rows = db
      .prepare(
        `SELECT * FROM tournaments WHERE community_id = ?
         ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END, starts_at DESC LIMIT 100`,
      )
      .all(req.params.id) as unknown as TournamentRow[];
    res.json({ tournaments: rows.map((t) => summary(t, userId)) });
  });

  router.get('/tournaments/:id', (req, res) => {
    const userId = me(req);
    res.json({ tournament: detail(tournamentFor(userId, req.params.id), userId) });
  });

  router.post('/communities/:id/tournaments', (req, res) => {
    const userId = me(req);
    if (!communityRole(db, userId, req.params.id)) throw notFound('Community not found');
    if (!hasPerm(db, userId, req.params.id, PERMS.manageEvents)) throw forbidden("Your roles don't allow running tournaments");
    const name = str(req.body, 'name', { min: 3, max: 60 })!;
    const game = str(req.body, 'game', { max: 40, optional: true }) ?? '';
    const description = str(req.body, 'description', { max: 2000, optional: true }) ?? '';
    const teamSize = Number(req.body?.teamSize ?? 1);
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 10) throw badRequest('Team size is 1 (solo) to 10');
    const maxEntrants = Number(req.body?.maxEntrants ?? 16);
    if (!SIZES.includes(maxEntrants)) throw badRequest(`Bracket size is one of ${SIZES.join(', ')}`);
    const bestOf = Number(req.body?.bestOf ?? 1);
    if (!BEST_OF.includes(bestOf)) throw badRequest('Matches are best of 1, 3, 5 or 7');
    const startsAt = Number(req.body?.startsAt);
    if (!Number.isFinite(startsAt) || startsAt < Date.now() - 5 * 60_000) throw badRequest('Pick a start time in the future');
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM tournaments WHERE community_id = ? AND status != 'done'")
      .get(req.params.id) as { n: number };
    if (n >= 20) throw new HttpError(429, 'Finish some tournaments before starting more');
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tournaments (id, community_id, name, game, description, team_size, max_entrants, best_of, starts_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, req.params.id, name, game, description, teamSize, maxEntrants, bestOf, startsAt, userId, Date.now());
    const t = reload(id);
    broadcast(t);
    res.status(201).json({ tournament: detail(t, userId) });
  });

  router.delete('/tournaments/:id', (req, res) => {
    const userId = me(req);
    const t = tournamentFor(userId, req.params.id);
    if (!canManage(t, userId)) throw forbidden();
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(t.id);
    broadcast(t, true);
    res.json({ ok: true });
  });

  router.post('/tournaments/:id/register', (req, res) => {
    const userId = me(req);
    const t = tournamentFor(userId, req.params.id);
    if (t.status !== 'registration') throw new HttpError(409, 'Registration is closed');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ?').get(t.id) as { n: number };
    if (n >= t.max_entrants) throw new HttpError(409, 'The bracket is full');

    let name: string;
    let teamId: string | null = null;
    let players: string[];
    if (t.team_size === 1) {
      const u = usersById(rt.ctx, [userId])[0];
      name = u.displayName;
      players = [userId];
    } else {
      teamId = str(req.body, 'teamId', { min: 1, max: 64 })!;
      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as unknown as TeamRow | undefined;
      if (!team) throw notFound('Team not found');
      if (team.captain_id !== userId) throw forbidden('Only the team captain can register');
      players = teamMemberIds(db, team.id);
      if (players.length < t.team_size) throw badRequest(`This tournament needs at least ${t.team_size} players per team`);
      name = `${team.name} [${team.tag}]`;
    }
    const taken = db
      .prepare(`SELECT user_id FROM entry_players WHERE tournament_id = ? AND user_id IN (${players.map(() => '?').join(',')})`)
      .all(t.id, ...players) as { user_id: string }[];
    if (taken.length) {
      const who = usersById(rt.ctx, taken.map((r) => r.user_id)).map((u) => u.displayName);
      throw new HttpError(409, `${who.join(', ')} ${who.length === 1 ? 'is' : 'are'} already registered`);
    }
    const id = randomUUID();
    tx(db, () => {
      db.prepare('INSERT INTO tournament_entries (id, tournament_id, owner_id, team_id, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        t.id,
        userId,
        teamId,
        name,
        Date.now(),
      );
      const add = db.prepare('INSERT INTO entry_players (entry_id, tournament_id, user_id) VALUES (?, ?, ?)');
      for (const p of players) add.run(id, t.id, p);
    });
    broadcast(t);
    res.status(201).json({ tournament: detail(t, userId) });
  });

  router.delete('/tournaments/:id/entries/:entryId', (req, res) => {
    const userId = me(req);
    const t = tournamentFor(userId, req.params.id);
    const e = getEntry(req.params.entryId);
    if (!e || e.tournament_id !== t.id) throw notFound('Entry not found');
    if (e.owner_id !== userId && !canManage(t, userId)) throw forbidden();
    if (t.status !== 'registration') throw new HttpError(409, 'The bracket has already started');
    db.prepare('DELETE FROM tournament_entries WHERE id = ?').run(e.id);
    broadcast(t);
    res.json({ tournament: detail(t, userId) });
  });

  router.post('/tournaments/:id/start', (req, res) => {
    const userId = me(req);
    const t = tournamentFor(userId, req.params.id);
    if (!canManage(t, userId)) throw forbidden();
    if (t.status !== 'registration') throw new HttpError(409, 'Already started');
    const entries = entriesOf(t.id);
    if (entries.length < 2) throw badRequest('You need at least 2 entrants');

    // Random seeding, then standard bracket placement with byes for the top seeds.
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    const size = bracketSize(shuffled.length);
    const rounds = Math.log2(size);
    const order = seedOrder(size);
    const bySeed = (seed: number) => (seed <= shuffled.length ? shuffled[seed - 1].id : null);
    tx(db, () => {
      shuffled.forEach((e, i) => db.prepare('UPDATE tournament_entries SET seed = ? WHERE id = ?').run(i + 1, e.id));
      const insert = db.prepare(
        'INSERT INTO tournament_matches (id, tournament_id, round, slot, a_entry, b_entry) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (let r = 0; r < rounds; r++) {
        const count = size / 2 ** (r + 1);
        for (let s = 0; s < count; s++) {
          insert.run(randomUUID(), t.id, r, s, r === 0 ? bySeed(order[s * 2]) : null, r === 0 ? bySeed(order[s * 2 + 1]) : null);
        }
      }
      db.prepare("UPDATE tournaments SET status = 'live', started_at = ? WHERE id = ?").run(Date.now(), t.id);
      // Byes go straight through.
      const live = reload(t.id);
      for (const m of matchesOf(t.id).filter((m) => m.round === 0 && (!m.a_entry || !m.b_entry))) {
        const winner = m.a_entry ?? m.b_entry;
        db.prepare("UPDATE tournament_matches SET winner_entry = ?, status = 'done', updated_at = ? WHERE id = ?").run(winner, Date.now(), m.id);
        advance(live, { ...m, winner_entry: winner }, rounds);
      }
    });
    const started = reload(t.id);
    notify(rt, allPlayers(t.id), { kind: 'tournament', actorId: userId, communityId: t.community_id, eventId: t.id, text: `started ${t.name}` });
    broadcast(started);
    res.json({ tournament: detail(started, userId) });
  });

  router.post('/tournaments/:id/matches/:matchId/report', (req, res) => {
    const userId = me(req);
    const t = tournamentFor(userId, req.params.id);
    if (t.status === 'registration') throw new HttpError(409, 'The bracket has not started');
    const m = db.prepare('SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?').get(req.params.matchId, t.id) as unknown as
      | MatchRow
      | undefined;
    if (!m) throw notFound('Match not found');
    if (!m.a_entry || !m.b_entry) throw new HttpError(409, 'This match is waiting on earlier results');
    const manage = canManage(t, userId);
    const a = getEntry(m.a_entry)!;
    const b = getEntry(m.b_entry)!;
    const isOwner = a.owner_id === userId || b.owner_id === userId;
    if (!manage) {
      if (!isOwner) throw forbidden('Only the players in this match or an organiser can report it');
      if (m.status === 'done') throw new HttpError(409, 'Already reported. Ask an organiser to change it');
    }
    const winner = str(req.body, 'winner', { min: 1, max: 64 })!;
    if (winner !== m.a_entry && winner !== m.b_entry) throw badRequest('The winner has to be in this match');
    const scoreA = req.body?.scoreA === undefined || req.body?.scoreA === null ? null : Number(req.body.scoreA);
    const scoreB = req.body?.scoreB === undefined || req.body?.scoreB === null ? null : Number(req.body.scoreB);
    for (const s of [scoreA, scoreB]) if (s !== null && (!Number.isInteger(s) || s < 0 || s > 999)) throw badRequest('Scores are whole numbers');
    if (scoreA !== null && scoreB !== null && scoreA !== scoreB && (scoreA > scoreB) !== (winner === m.a_entry)) {
      throw badRequest("The score doesn't match the winner");
    }
    const rounds = Math.log2(bracketSize(entriesOf(t.id).length));
    // Changing a result is only possible while the next match hasn't been played.
    if (m.status === 'done' && m.winner_entry !== winner && m.round < rounds - 1) {
      const next = db
        .prepare('SELECT status FROM tournament_matches WHERE tournament_id = ? AND round = ? AND slot = ?')
        .get(t.id, m.round + 1, Math.floor(m.slot / 2)) as { status: string };
      if (next.status === 'done') throw new HttpError(409, 'The next match has already been played. Correct that one first');
    }
    tx(db, () => {
      db.prepare(
        "UPDATE tournament_matches SET winner_entry = ?, score_a = ?, score_b = ?, status = 'done', disputed = 0, reported_by = ?, updated_at = ? WHERE id = ?",
      ).run(winner, scoreA, scoreB, userId, Date.now(), m.id);
      advance(t, { ...m, winner_entry: winner }, rounds);
    });
    const after = reload(t.id);
    const loser = winner === m.a_entry ? m.b_entry : m.a_entry;
    if (after.status === 'done' && t.status !== 'done') {
      const champ = getEntry(winner)!;
      notify(rt, [...allPlayers(t.id), ...memberIds(t.community_id)], {
        kind: 'tournament',
        actorId: userId,
        communityId: t.community_id,
        eventId: t.id,
        text: `reported the final: ${champ.name} won ${t.name}`,
      });
    } else {
      notify(rt, [...playersOf(winner), ...playersOf(loser!)], {
        kind: 'tournament',
        actorId: userId,
        communityId: t.community_id,
        eventId: t.id,
        text: `reported a result: ${getEntry(winner)!.name} beat ${getEntry(loser)!.name}`,
      });
    }
    broadcast(after);
    res.json({ tournament: detail(after, userId) });
  });

  router.post('/tournaments/:id/matches/:matchId/dispute', (req, res) => {
    const userId = me(req);
    const t = tournamentFor(userId, req.params.id);
    const m = db.prepare('SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?').get(req.params.matchId, t.id) as unknown as
      | MatchRow
      | undefined;
    if (!m || m.status !== 'done' || !m.a_entry || !m.b_entry) throw notFound('Match not found');
    const owners = [getEntry(m.a_entry)?.owner_id, getEntry(m.b_entry)?.owner_id];
    if (!owners.includes(userId)) throw forbidden();
    if (m.reported_by === userId) throw badRequest('You reported this result');
    db.prepare('UPDATE tournament_matches SET disputed = 1 WHERE id = ?').run(m.id);
    const organisers = memberIds(t.community_id).filter((uid) => canManage(t, uid));
    notify(rt, organisers, { kind: 'tournament', actorId: userId, communityId: t.community_id, eventId: t.id, text: `disputed a result in ${t.name}` });
    broadcast(t);
    res.json({ tournament: detail(t, userId) });
  });

  return router;
}
