// Teams: a named roster with a captain, used to enter team tournaments.
// Players join by accepting an invite from the captain.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import { isBlockedEitherWay } from '../access.ts';
import { tx } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound, str } from '../http.ts';
import { notify } from '../notify.ts';
import type { Realtime } from '../realtime.ts';
import { getUser, usersById } from '../serialize.ts';

export interface TeamRow {
  id: string;
  name: string;
  tag: string;
  game: string;
  bio: string;
  accent: string;
  captain_id: string;
  created_at: number;
}

export const MAX_TEAM_SIZE = 10;
const MAX_TEAMS_PER_USER = 10;
const TAG = /^[A-Z0-9]{2,5}$/;
const HEX = /^#[0-9a-f]{6}$/i;

export const teamMemberIds = (db: Realtime['ctx']['db'], teamId: string) =>
  (db.prepare('SELECT user_id FROM team_members WHERE team_id = ? ORDER BY joined_at').all(teamId) as { user_id: string }[]).map((r) => r.user_id);

export function teamRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  const inviteIds = (teamId: string) =>
    (db.prepare('SELECT user_id FROM team_invites WHERE team_id = ? ORDER BY created_at').all(teamId) as { user_id: string }[]).map((r) => r.user_id);

  function getTeam(id: string) {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as unknown as TeamRow | undefined;
    if (!t) throw notFound('Team not found');
    return t;
  }

  function serialize(t: TeamRow, viewerId: string) {
    const ids = teamMemberIds(db, t.id);
    // Captain first, then everyone else in the order they joined.
    const ordered = [t.captain_id, ...ids.filter((id) => id !== t.captain_id)];
    const invites = inviteIds(t.id);
    const isMember = ids.includes(viewerId);
    return {
      id: t.id,
      name: t.name,
      tag: t.tag,
      game: t.game,
      bio: t.bio,
      accent: t.accent,
      captainId: t.captain_id,
      members: usersById(rt.ctx, ordered),
      invites: isMember ? usersById(rt.ctx, invites) : [],
      myRole: t.captain_id === viewerId ? 'captain' : isMember ? 'member' : invites.includes(viewerId) ? 'invited' : null,
      createdAt: t.created_at,
    };
  }

  /** Members and invitees refresh their copy. */
  function announce(teamId: string, extra: string[] = []) {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as unknown as TeamRow | undefined;
    if (!t) {
      for (const uid of extra) rt.toUser(uid, 'team:update', { removed: teamId });
      return;
    }
    for (const uid of new Set([...teamMemberIds(db, teamId), ...inviteIds(teamId), ...extra])) {
      rt.toUser(uid, 'team:update', { team: serialize(t, uid) });
    }
  }

  function requireCaptain(t: TeamRow, userId: string) {
    if (t.captain_id !== userId) throw forbidden('Only the captain can do that');
  }

  function fields(body: unknown, existing?: TeamRow) {
    const name = str(body, 'name', { min: 2, max: 32, optional: !!existing }) ?? existing!.name;
    const tag = (str(body, 'tag', { min: 2, max: 5, optional: !!existing }) ?? existing!.tag).toUpperCase();
    if (!TAG.test(tag)) throw badRequest('Tags are 2 to 5 letters or numbers');
    const game = str(body, 'game', { max: 40, optional: true }) ?? existing?.game ?? '';
    const bio = str(body, 'bio', { max: 300, optional: true }) ?? existing?.bio ?? '';
    const accent = str(body, 'accent', { max: 7, optional: true }) ?? existing?.accent ?? '#8b5cf6';
    if (!HEX.test(accent)) throw badRequest('Pick a colour like #8b5cf6');
    return { name, tag, game, bio, accent };
  }

  // Teams you're on, plus invites waiting for you.
  router.get('/teams/mine', (req, res) => {
    const userId = me(req);
    const rows = db
      .prepare(
        `SELECT t.* FROM teams t WHERE t.id IN (SELECT team_id FROM team_members WHERE user_id = ?)
            OR t.id IN (SELECT team_id FROM team_invites WHERE user_id = ?)
         ORDER BY t.created_at`,
      )
      .all(userId, userId) as unknown as TeamRow[];
    res.json({ teams: rows.map((t) => serialize(t, userId)) });
  });

  router.get('/teams/:id', (req, res) => {
    res.json({ team: serialize(getTeam(req.params.id), me(req)) });
  });

  router.post('/teams', (req, res) => {
    const userId = me(req);
    const f = fields(req.body);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?').get(userId) as { n: number };
    if (n >= MAX_TEAMS_PER_USER) throw new HttpError(429, `You can be on up to ${MAX_TEAMS_PER_USER} teams`);
    const id = randomUUID();
    const now = Date.now();
    tx(db, () => {
      db.prepare('INSERT INTO teams (id, name, tag, game, bio, accent, captain_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id,
        f.name,
        f.tag,
        f.game,
        f.bio,
        f.accent,
        userId,
        now,
      );
      db.prepare('INSERT INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, userId, now);
    });
    res.status(201).json({ team: serialize(getTeam(id), userId) });
  });

  router.patch('/teams/:id', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    requireCaptain(t, userId);
    const f = fields(req.body, t);
    db.prepare('UPDATE teams SET name = ?, tag = ?, game = ?, bio = ?, accent = ? WHERE id = ?').run(f.name, f.tag, f.game, f.bio, f.accent, t.id);
    announce(t.id);
    res.json({ team: serialize(getTeam(t.id), userId) });
  });

  router.delete('/teams/:id', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    requireCaptain(t, userId);
    const everyone = [...teamMemberIds(db, t.id), ...inviteIds(t.id)];
    db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
    announce(t.id, everyone);
    res.json({ ok: true });
  });

  router.post('/teams/:id/invites', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    requireCaptain(t, userId);
    const targetId = str(req.body, 'userId', { min: 1, max: 64 })!;
    const target = getUser(db, targetId);
    if (!target || isBlockedEitherWay(db, userId, targetId)) throw notFound('User not found');
    const ids = teamMemberIds(db, t.id);
    if (ids.includes(targetId)) throw new HttpError(409, 'Already on the team');
    if (ids.length + inviteIds(t.id).length >= MAX_TEAM_SIZE) throw new HttpError(409, `Teams can have up to ${MAX_TEAM_SIZE} players`);
    const result = db
      .prepare('INSERT OR IGNORE INTO team_invites (team_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?)')
      .run(t.id, targetId, userId, Date.now());
    if (result.changes) notify(rt, [targetId], { kind: 'team_invite', actorId: userId, eventId: t.id, text: `${t.name} [${t.tag}]` });
    announce(t.id);
    res.status(201).json({ team: serialize(getTeam(t.id), userId) });
  });

  router.delete('/teams/:id/invites/:userId', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    requireCaptain(t, userId);
    db.prepare('DELETE FROM team_invites WHERE team_id = ? AND user_id = ?').run(t.id, req.params.userId);
    announce(t.id, [req.params.userId]);
    res.json({ team: serialize(getTeam(t.id), userId) });
  });

  router.post('/teams/:id/accept', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    if (!db.prepare('SELECT 1 FROM team_invites WHERE team_id = ? AND user_id = ?').get(t.id, userId)) throw notFound('Invite not found');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?').get(userId) as { n: number };
    if (n >= MAX_TEAMS_PER_USER) throw new HttpError(429, `You can be on up to ${MAX_TEAMS_PER_USER} teams`);
    tx(db, () => {
      db.prepare('DELETE FROM team_invites WHERE team_id = ? AND user_id = ?').run(t.id, userId);
      db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)').run(t.id, userId, Date.now());
    });
    announce(t.id);
    res.json({ team: serialize(getTeam(t.id), userId) });
  });

  router.post('/teams/:id/decline', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    db.prepare('DELETE FROM team_invites WHERE team_id = ? AND user_id = ?').run(t.id, userId);
    announce(t.id, [userId]);
    res.json({ ok: true });
  });

  router.post('/teams/:id/leave', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    const ids = teamMemberIds(db, t.id);
    if (!ids.includes(userId)) throw notFound('Team not found');
    if (t.captain_id === userId) {
      if (ids.length > 1) throw badRequest('Hand the captaincy to someone else first, or disband the team');
      const invited = inviteIds(t.id);
      db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
      announce(t.id, [userId, ...invited]);
      return void res.json({ ok: true });
    }
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(t.id, userId);
    announce(t.id, [userId]);
    res.json({ ok: true });
  });

  router.delete('/teams/:id/members/:userId', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    requireCaptain(t, userId);
    if (req.params.userId === userId) throw badRequest("You can't remove yourself");
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(t.id, req.params.userId);
    announce(t.id, [req.params.userId]);
    res.json({ team: serialize(getTeam(t.id), userId) });
  });

  router.post('/teams/:id/captain', (req, res) => {
    const userId = me(req);
    const t = getTeam(req.params.id);
    requireCaptain(t, userId);
    const next = str(req.body, 'userId', { min: 1, max: 64 })!;
    if (!teamMemberIds(db, t.id).includes(next)) throw badRequest('Pick someone on the team');
    db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(next, t.id);
    announce(t.id);
    res.json({ team: serialize(getTeam(t.id), userId) });
  });

  return router;
}
