import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  hashPassword,
  me,
  requireAuth,
  sessionToken,
  verifyPassword,
} from '../auth.ts';
import { HttpError, badRequest, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { getUser, selfUser, type UserRow } from '../serialize.ts';

const USERNAME = /^[a-zA-Z0-9_.]{3,24}$/;
const ACCENTS = ['#7c5cff', '#22d3ee', '#f43f5e', '#f59e0b', '#10b981', '#ec4899', '#3b82f6'];

export function authRoutes(rt: Realtime, opts: { secureCookies: boolean }) {
  const { db } = rt.ctx;
  const router = Router();

  // Simple in-memory throttle on sign-in attempts per username.
  const failures = new Map<string, { count: number; until: number }>();

  function setSessionCookie(res: Response, userId: string) {
    const { token, expiresAt } = createSession(db, userId);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookies,
      expires: new Date(expiresAt),
      path: '/',
    });
  }

  router.post('/register', async (req, res) => {
    const username = str(req.body, 'username', { min: 3, max: 24 })!;
    if (!USERNAME.test(username)) {
      throw badRequest('Usernames may only use letters, numbers, underscores and dots');
    }
    const password = str(req.body, 'password', { min: 8, max: 200 })!;
    const displayName = str(req.body, 'displayName', { min: 1, max: 32, optional: true }) || username;
    const games = Array.isArray(req.body?.games)
      ? (req.body.games as unknown[]).filter((g): g is string => typeof g === 'string').map((g) => g.slice(0, 40)).slice(0, 12)
      : [];

    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, 'That username is taken');
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, accent, games, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      username,
      displayName,
      await hashPassword(password),
      ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
      JSON.stringify(games),
      Date.now(),
    );

    setSessionCookie(res, id);
    res.status(201).json({ user: selfUser(rt.ctx, getUser(db, id)!) });
  });

  router.post('/login', async (req, res) => {
    const username = str(req.body, 'username', { max: 24 })!;
    const password = str(req.body, 'password', { max: 200 })!;
    const key = username.toLowerCase();
    const fail = failures.get(key);
    if (fail && fail.until > Date.now()) {
      throw new HttpError(429, 'Too many attempts. Try again in a minute.');
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      const count = (fail?.count ?? 0) + 1;
      failures.set(key, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
      throw new HttpError(401, 'Wrong username or password');
    }
    failures.delete(key);
    setSessionCookie(res, user.id);
    res.json({ user: selfUser(rt.ctx, user) });
  });

  router.post('/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) destroySession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', requireAuth(db), (req, res) => {
    res.json({ user: selfUser(rt.ctx, getUser(db, me(req))!) });
  });

  return router;
}
