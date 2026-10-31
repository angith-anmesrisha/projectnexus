import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import { badRequest, forbidden, notFound, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { getUser, publicUser, type UserRow } from '../serialize.ts';

const MAX_PREFS_BYTES = 64 * 1024;

/**
 * Appearance settings are an opaque JSON document owned by the client. The
 * server only checks size and shape, and syncs them across the user's devices.
 */
function parseSettings(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Settings must be an object');
  const json = JSON.stringify(value);
  if (json.length > MAX_PREFS_BYTES) throw badRequest('Settings are too large (64 KB max, including custom CSS)');
  return json;
}

interface ThemeRow {
  id: string;
  author_id: string;
  name: string;
  description: string;
  data: string;
  installs: number;
  created_at: number;
}

export function appearanceRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  router.get('/users/me/prefs', (req, res) => {
    const row = db.prepare('SELECT prefs FROM users WHERE id = ?').get(me(req)) as { prefs: string };
    res.json({ prefs: JSON.parse(row.prefs) });
  });

  router.put('/users/me/prefs', (req, res) => {
    const json = parseSettings(req.body?.prefs);
    db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(json, me(req));
    // Other open tabs and devices pick up the change live.
    rt.toUser(me(req), 'prefs:update', JSON.parse(json));
    res.json({ ok: true });
  });

  // ---- Theme gallery ----

  function serializeTheme(t: ThemeRow) {
    const author = getUser(db, t.author_id) as UserRow;
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      data: JSON.parse(t.data),
      installs: t.installs,
      createdAt: t.created_at,
      author: publicUser(rt.ctx, author),
    };
  }

  router.get('/themes', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 50) : '';
    const sort = req.query.sort === 'new' ? 'created_at DESC' : 'installs DESC, created_at DESC';
    const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const rows = db
      .prepare(`SELECT * FROM themes WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' ORDER BY ${sort} LIMIT 60`)
      .all(like, like) as unknown as ThemeRow[];
    res.json({ themes: rows.map(serializeTheme) });
  });

  router.post('/themes', (req, res) => {
    const userId = me(req);
    const name = str(req.body, 'name', { min: 2, max: 40 })!;
    const description = str(req.body, 'description', { max: 200, optional: true }) ?? '';
    const data = parseSettings(req.body?.data);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM themes WHERE author_id = ?').get(userId) as { n: number };
    if (n >= 20) throw badRequest('You can publish up to 20 themes');
    const id = randomUUID();
    db.prepare('INSERT INTO themes (id, author_id, name, description, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      userId,
      name,
      description,
      data,
      Date.now(),
    );
    res.status(201).json({ theme: serializeTheme(db.prepare('SELECT * FROM themes WHERE id = ?').get(id) as unknown as ThemeRow) });
  });

  router.post('/themes/:id/install', (req, res) => {
    const result = db.prepare('UPDATE themes SET installs = installs + 1 WHERE id = ?').run(req.params.id);
    if (result.changes === 0) throw notFound('Theme not found');
    res.json({ theme: serializeTheme(db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id) as unknown as ThemeRow) });
  });

  router.delete('/themes/:id', (req, res) => {
    const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id) as ThemeRow | undefined;
    if (!theme) throw notFound('Theme not found');
    if (theme.author_id !== me(req)) throw forbidden('You can only delete your own themes');
    db.prepare('DELETE FROM themes WHERE id = ?').run(theme.id);
    res.json({ ok: true });
  });

  return router;
}
