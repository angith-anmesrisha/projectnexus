import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import { PERMS, communityRole, hasPerm } from '../access.ts';
import { badRequest, forbidden, notFound, str } from '../http.ts';
import { notify } from '../notify.ts';
import type { Realtime } from '../realtime.ts';
import { usersById } from '../serialize.ts';

interface EventRow {
  id: string;
  community_id: string;
  title: string;
  description: string;
  location: string;
  starts_at: number;
  ends_at: number;
  created_by: string;
  created_at: number;
}

const HOUR = 3_600_000;
const MAX_LENGTH = 7 * 24 * HOUR;

export function eventRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  function serialize(e: EventRow, viewerId: string) {
    const rsvps = db.prepare('SELECT user_id, status FROM event_rsvps WHERE event_id = ?').all(e.id) as {
      user_id: string;
      status: 'going' | 'interested';
    }[];
    const going = rsvps.filter((r) => r.status === 'going').map((r) => r.user_id);
    const community = db.prepare('SELECT name, accent FROM communities WHERE id = ?').get(e.community_id) as {
      name: string;
      accent: string;
    };
    const [creator] = usersById(rt.ctx, [e.created_by]);
    return {
      id: e.id,
      communityId: e.community_id,
      communityName: community.name,
      communityAccent: community.accent,
      title: e.title,
      description: e.description,
      location: e.location,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      creator: creator ?? null,
      going: going.length,
      interested: rsvps.length - going.length,
      attendees: usersById(rt.ctx, going.slice(0, 8)),
      myRsvp: rsvps.find((r) => r.user_id === viewerId)?.status ?? null,
      canManage: e.created_by === viewerId || hasPerm(db, viewerId, e.community_id, PERMS.manageEvents),
    };
  }

  function memberIds(communityId: string) {
    return (db.prepare('SELECT user_id FROM community_members WHERE community_id = ?').all(communityId) as { user_id: string }[]).map(
      (r) => r.user_id,
    );
  }

  /** Tell every member to refresh; each viewer gets their own RSVP flag. */
  function broadcast(e: EventRow, removed = false) {
    for (const uid of memberIds(e.community_id)) {
      rt.toUser(uid, 'event:update', removed ? { removed: e.id, communityId: e.community_id } : { event: serialize(e, uid) });
    }
  }

  function parseTimes(body: unknown, existing?: EventRow) {
    const startsAt = Number((body as any)?.startsAt ?? existing?.starts_at);
    const endsAt = Number((body as any)?.endsAt ?? existing?.ends_at ?? startsAt + HOUR);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) throw badRequest('Pick a start time');
    if (!existing && startsAt < Date.now() - 5 * 60_000) throw badRequest('Events have to start in the future');
    if (endsAt <= startsAt) throw badRequest('The event has to end after it starts');
    if (endsAt - startsAt > MAX_LENGTH) throw badRequest('Events can last up to a week');
    return { startsAt, endsAt };
  }

  function eventFor(viewerId: string, id: string) {
    const e = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as unknown as EventRow | undefined;
    if (!e || !communityRole(db, viewerId, e.community_id)) throw notFound('Event not found');
    return e;
  }

  // Upcoming events across all of the viewer's communities (for Home).
  router.get('/events', (req, res) => {
    const userId = me(req);
    const rows = db
      .prepare(
        `SELECT e.* FROM events e JOIN community_members m ON m.community_id = e.community_id AND m.user_id = ?
         WHERE e.ends_at > ? ORDER BY e.starts_at LIMIT 20`,
      )
      .all(userId, Date.now()) as unknown as EventRow[];
    res.json({ events: rows.map((e) => serialize(e, userId)) });
  });

  router.get('/communities/:id/events', (req, res) => {
    const userId = me(req);
    if (!communityRole(db, userId, req.params.id)) throw notFound('Community not found');
    // Upcoming and live events, plus anything that ended in the last week.
    const rows = db
      .prepare('SELECT * FROM events WHERE community_id = ? AND ends_at > ? ORDER BY starts_at LIMIT 100')
      .all(req.params.id, Date.now() - 7 * 24 * HOUR) as unknown as EventRow[];
    res.json({ events: rows.map((e) => serialize(e, userId)) });
  });

  router.post('/communities/:id/events', (req, res) => {
    const userId = me(req);
    if (!communityRole(db, userId, req.params.id)) throw notFound('Community not found');
    if (!hasPerm(db, userId, req.params.id, PERMS.manageEvents)) throw forbidden("Your roles don't allow creating events");
    const title = str(req.body, 'title', { min: 2, max: 80 })!;
    const description = str(req.body, 'description', { max: 1000, optional: true }) ?? '';
    const location = str(req.body, 'location', { max: 100, optional: true }) ?? '';
    const { startsAt, endsAt } = parseTimes(req.body);
    const { n } = db
      .prepare('SELECT COUNT(*) AS n FROM events WHERE community_id = ? AND ends_at > ?')
      .get(req.params.id, Date.now()) as { n: number };
    if (n >= 50) throw badRequest('A community can have up to 50 upcoming events');
    const id = randomUUID();
    db.prepare(
      `INSERT INTO events (id, community_id, title, description, location, starts_at, ends_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, req.params.id, title, description, location, startsAt, endsAt, userId, Date.now());
    // The creator is going by default.
    db.prepare(`INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')`).run(id, userId);
    const e = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as unknown as EventRow;
    broadcast(e);
    notify(rt, memberIds(e.community_id), { kind: 'event', actorId: userId, communityId: e.community_id, eventId: id, text: title });
    res.status(201).json({ event: serialize(e, userId) });
  });

  router.patch('/events/:id', (req, res) => {
    const userId = me(req);
    const e = eventFor(userId, req.params.id);
    if (!serialize(e, userId).canManage) throw forbidden();
    const title = str(req.body, 'title', { min: 2, max: 80, optional: true }) ?? e.title;
    const description = str(req.body, 'description', { max: 1000, optional: true }) ?? e.description;
    const location = str(req.body, 'location', { max: 100, optional: true }) ?? e.location;
    const { startsAt, endsAt } = parseTimes(req.body, e);
    db.prepare('UPDATE events SET title = ?, description = ?, location = ?, starts_at = ?, ends_at = ? WHERE id = ?').run(
      title,
      description,
      location,
      startsAt,
      endsAt,
      e.id,
    );
    const updated = eventFor(userId, e.id);
    broadcast(updated);
    res.json({ event: serialize(updated, userId) });
  });

  router.delete('/events/:id', (req, res) => {
    const userId = me(req);
    const e = eventFor(userId, req.params.id);
    if (!serialize(e, userId).canManage) throw forbidden();
    db.prepare('DELETE FROM events WHERE id = ?').run(e.id);
    db.prepare('DELETE FROM notifications WHERE event_id = ?').run(e.id);
    broadcast(e, true);
    res.json({ ok: true });
  });

  router.post('/events/:id/rsvp', (req, res) => {
    const userId = me(req);
    const e = eventFor(userId, req.params.id);
    const status = req.body?.status ?? null;
    if (status !== null && status !== 'going' && status !== 'interested') throw badRequest('status must be going, interested or null');
    if (status === null) db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(e.id, userId);
    else
      db.prepare(
        'INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status',
      ).run(e.id, userId, status);
    broadcast(e);
    res.json({ event: serialize(e, userId) });
  });

  return router;
}
