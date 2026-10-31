import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import { areFriends, isBlockedEitherWay } from '../access.ts';
import { tx } from '../db.ts';
import { HttpError, badRequest, notFound, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { getUser, publicUser, selfUser, usersById, type UserRow } from '../serialize.ts';

const STATUSES = ['online', 'idle', 'dnd', 'invisible'];
const HEX = /^#[0-9a-fA-F]{6}$/;

export function userRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  // ---- Profile ----

  router.patch('/users/me', (req, res) => {
    const id = me(req);
    const body = req.body ?? {};
    const updates: Record<string, string | number> = {};

    const displayName = str(body, 'displayName', { min: 1, max: 32, optional: true });
    if (displayName !== undefined) updates.display_name = displayName;
    const bio = str(body, 'bio', { max: 190, optional: true });
    if (bio !== undefined) updates.bio = bio;
    const nowPlaying = str(body, 'nowPlaying', { max: 60, optional: true });
    if (nowPlaying !== undefined) updates.now_playing = nowPlaying;
    if (body.accent !== undefined) {
      if (typeof body.accent !== 'string' || !HEX.test(body.accent)) throw badRequest('accent must be a hex colour');
      updates.accent = body.accent;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) throw badRequest('Unknown status');
      updates.status = body.status;
    }
    if (body.lfg !== undefined) updates.lfg = body.lfg ? 1 : 0;
    if (body.games !== undefined) {
      if (!Array.isArray(body.games) || body.games.some((g: unknown) => typeof g !== 'string')) {
        throw badRequest('games must be a list of names');
      }
      const games = [...new Set((body.games as string[]).map((g) => g.trim().slice(0, 40)).filter(Boolean))];
      updates.games = JSON.stringify(games.slice(0, 12));
    }

    const keys = Object.keys(updates);
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
        ...keys.map((k) => updates[k]),
        id,
      );
      rt.broadcastPresence(id);
    }
    res.json({ user: selfUser(rt.ctx, getUser(db, id)!) });
  });

  router.get('/users/:username', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username) as
      | UserRow
      | undefined;
    // Someone who blocked you cannot be looked up.
    if (!user || db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(user.id, me(req))) {
      throw notFound('User not found');
    }
    res.json({ user: publicUser(rt.ctx, user), relationship: relationship(me(req), user.id) });
  });

  function relationship(viewer: string, other: string) {
    if (viewer === other) return 'self';
    if (db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(viewer, other)) return 'blocked';
    const f = db
      .prepare(
        `SELECT requester_id, status FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      )
      .get(viewer, other, other, viewer) as { requester_id: string; status: string } | undefined;
    if (!f) return 'none';
    if (f.status === 'accepted') return 'friend';
    return f.requester_id === viewer ? 'outgoing' : 'incoming';
  }

  // ---- Friends ----

  function friendsPayload(userId: string) {
    const rows = db
      .prepare(
        `SELECT requester_id, addressee_id, status FROM friendships
         WHERE requester_id = ? OR addressee_id = ?`,
      )
      .all(userId, userId) as { requester_id: string; addressee_id: string; status: string }[];
    const friends: string[] = [];
    const incoming: string[] = [];
    const outgoing: string[] = [];
    for (const r of rows) {
      const other = r.requester_id === userId ? r.addressee_id : r.requester_id;
      if (r.status === 'accepted') friends.push(other);
      else if (r.requester_id === userId) outgoing.push(other);
      else incoming.push(other);
    }
    const blocked = (
      db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?').all(userId) as { blocked_id: string }[]
    ).map((r) => r.blocked_id);
    return {
      friends: usersById(rt.ctx, friends),
      incoming: usersById(rt.ctx, incoming),
      outgoing: usersById(rt.ctx, outgoing),
      blocked: usersById(rt.ctx, blocked),
    };
  }

  /** Tell both people their friend lists changed. */
  function notifyFriends(...ids: string[]) {
    for (const id of ids) rt.toUser(id, 'friends:update', friendsPayload(id));
  }

  router.get('/friends', (req, res) => {
    res.json(friendsPayload(me(req)));
  });

  router.post('/friends/requests', (req, res) => {
    const id = me(req);
    const username = str(req.body, 'username', { min: 1, max: 24 })!;
    const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    // Blocked users get the same answer as unknown users.
    if (!target || isBlockedEitherWay(db, id, target.id)) throw notFound('No user with that username');
    if (target.id === id) throw badRequest("You can't add yourself");
    if (areFriends(db, id, target.id)) throw new HttpError(409, 'You are already friends');

    const reverse = db
      .prepare(`SELECT 1 FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`)
      .get(target.id, id);
    if (reverse) {
      // They already asked us, so sending a request back accepts it.
      db.prepare(`UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?`).run(target.id, id);
    } else {
      db.prepare(
        `INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)`,
      ).run(id, target.id, Date.now());
    }
    notifyFriends(id, target.id);
    res.status(201).json(friendsPayload(id));
  });

  router.post('/friends/requests/:userId/accept', (req, res) => {
    const id = me(req);
    const result = db
      .prepare(
        `UPDATE friendships SET status = 'accepted'
         WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
      )
      .run(req.params.userId, id);
    if (result.changes === 0) throw notFound('No pending request from that user');
    notifyFriends(id, req.params.userId);
    res.json(friendsPayload(id));
  });

  // Removes a friend, declines an incoming request or cancels an outgoing one.
  router.delete('/friends/:userId', (req, res) => {
    const id = me(req);
    const other = req.params.userId;
    db.prepare(
      `DELETE FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    ).run(id, other, other, id);
    notifyFriends(id, other);
    res.json(friendsPayload(id));
  });

  // ---- Blocking and reporting ----

  router.post('/blocks/:userId', (req, res) => {
    const id = me(req);
    const other = req.params.userId;
    if (other === id) throw badRequest("You can't block yourself");
    if (!getUser(db, other)) throw notFound('User not found');
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(id, other, Date.now());
      db.prepare(
        `DELETE FROM friendships
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      ).run(id, other, other, id);
    });
    notifyFriends(id, other);
    res.json(friendsPayload(id));
  });

  router.delete('/blocks/:userId', (req, res) => {
    const id = me(req);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(id, req.params.userId);
    notifyFriends(id);
    res.json(friendsPayload(id));
  });

  router.post('/reports', (req, res) => {
    const targetType = req.body?.targetType;
    if (targetType !== 'user' && targetType !== 'message') throw badRequest('targetType must be user or message');
    const targetId = str(req.body, 'targetId', { min: 1, max: 64 })!;
    const reason = str(req.body, 'reason', { min: 3, max: 500 })!;
    db.prepare(
      'INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), me(req), targetType, targetId, reason, Date.now());
    res.status(201).json({ ok: true });
  });

  return router;
}
