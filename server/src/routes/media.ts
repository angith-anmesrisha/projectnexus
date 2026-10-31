import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';
import { me } from '../auth.ts';
import { HttpError, badRequest, notFound, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import type { Attachment } from '../serialize.ts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Built-in sticker pack. The client draws these; the server only checks ids. */
export const BUILTIN_STICKERS = [
  'gg', 'gg-wp', 'clutch', 'ace', '1v5', 'lets-go', 'hype', 'carry',
  'w', 'l', 'tilt', 'rage-quit', 'afk', 'brb', 'one-more', 'need-heals',
];

// GIFs from search providers may be embedded directly; everything else must be uploaded.
const GIF_HOSTS = /^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\//;
const LOCAL_GIF = /^\/uploads\/[0-9a-f]{32}\.gif$/;
export const isAllowedGifUrl = (url: string) => (GIF_HOSTS.test(url) || LOCAL_GIF.test(url)) && url.length < 600;

interface Sniffed {
  mime: string;
  ext: string;
  kind: Attachment['kind'];
}

/** Identify media by its magic bytes instead of trusting the declared type. */
function sniff(buf: Buffer): Sniffed | null {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return { mime: 'image/gif', ext: 'gif', kind: 'gif' };
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (buf.subarray(4, 8).toString() === 'ftyp') return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
  if (hex.startsWith('1a45dfa3')) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
  return null;
}

const clampDim = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 10000) : null;
};

export interface UploadRow {
  id: string;
  owner_id: string;
  file: string;
  mime: string;
  name: string;
  size: number;
  width: number | null;
  height: number | null;
}

export function attachmentFromUpload(u: UploadRow): Attachment {
  const s = u.mime.startsWith('image/gif') ? 'gif' : u.mime.startsWith('image/') ? 'image' : u.mime.startsWith('video/') ? 'video' : 'file';
  return { kind: s, url: `/uploads/${u.file}`, name: u.name, mime: u.mime, size: u.size, width: u.width, height: u.height };
}

/** Public file serving. Upload names are unguessable, so the link is the capability. */
export function uploadsStatic(dir: string) {
  return express.static(dir, {
    immutable: true,
    maxAge: '365d',
    index: false,
    setHeaders(res, path) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
      if (path.endsWith('.bin')) res.setHeader('Content-Disposition', 'attachment');
    },
  });
}

export function mediaRoutes(rt: Realtime, uploadDir: string) {
  const { db } = rt.ctx;
  const router = Router();
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const recentUploads = new Map<string, number[]>();

  // Body is the raw file. Name and display size come in the query string.
  router.post('/uploads', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), (req, res) => {
    const userId = me(req);
    const now = Date.now();
    const recent = (recentUploads.get(userId) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= 40) throw new HttpError(429, 'Too many uploads. Try again in a few minutes.');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('The file is empty');
    recent.push(now);
    recentUploads.set(userId, recent);

    const rawName = typeof req.query.name === 'string' ? req.query.name : 'file';
    const name = rawName.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
    const sniffed = sniff(body);
    const id = randomUUID();
    const token = randomBytes(16).toString('hex');
    // Unknown types are stored as opaque downloads so the browser never renders them.
    const file = `${token}.${sniffed?.ext ?? 'bin'}`;
    const mime = sniffed?.mime ?? 'application/octet-stream';
    writeFileSync(join(uploadDir, file), body);

    const row: UploadRow = {
      id,
      owner_id: userId,
      file,
      mime,
      name,
      size: body.length,
      width: sniffed && sniffed.kind !== 'file' ? clampDim(req.query.w) : null,
      height: sniffed && sniffed.kind !== 'file' ? clampDim(req.query.h) : null,
    };
    db.prepare(
      'INSERT INTO uploads (id, owner_id, file, mime, name, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(row.id, row.owner_id, row.file, row.mime, row.name, row.size, row.width, row.height, now);
    res.status(201).json({ id, attachment: attachmentFromUpload(row) });
  });

  // ---- GIF search (needs GIPHY_API_KEY or TENOR_API_KEY) ----

  router.get('/gifs/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 50) : '';
    const giphy = process.env.GIPHY_API_KEY;
    const tenor = process.env.TENOR_API_KEY;
    if (!giphy && !tenor) {
      res.json({ enabled: false, results: [] });
      return;
    }
    try {
      let results: { url: string; preview: string; width: number; height: number }[] = [];
      if (giphy) {
        const endpoint = q
          ? `https://api.giphy.com/v1/gifs/search?api_key=${giphy}&q=${encodeURIComponent(q)}&limit=30&rating=pg-13`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${giphy}&limit=30&rating=pg-13`;
        const data = (await (await fetch(endpoint)).json()) as any;
        results = (data.data ?? []).map((g: any) => ({
          url: g.images?.downsized_medium?.url ?? g.images?.original?.url,
          preview: g.images?.fixed_width?.url ?? g.images?.original?.url,
          width: Number(g.images?.fixed_width?.width) || 200,
          height: Number(g.images?.fixed_width?.height) || 200,
        }));
      } else {
        const endpoint = q
          ? `https://tenor.googleapis.com/v2/search?key=${tenor}&q=${encodeURIComponent(q)}&limit=30&media_filter=gif,tinygif&contentfilter=medium`
          : `https://tenor.googleapis.com/v2/featured?key=${tenor}&limit=30&media_filter=gif,tinygif&contentfilter=medium`;
        const data = (await (await fetch(endpoint)).json()) as any;
        results = (data.results ?? []).map((g: any) => ({
          url: g.media_formats?.gif?.url,
          preview: g.media_formats?.tinygif?.url ?? g.media_formats?.gif?.url,
          width: g.media_formats?.tinygif?.dims?.[0] ?? 200,
          height: g.media_formats?.tinygif?.dims?.[1] ?? 200,
        }));
      }
      res.json({ enabled: true, results: results.filter((r) => r.url && isAllowedGifUrl(r.url)) });
    } catch {
      throw new HttpError(502, 'GIF search is unavailable right now');
    }
  });

  router.get('/gifs/favorites', (req, res) => {
    const rows = db
      .prepare('SELECT url, preview, width, height FROM gif_favorites WHERE user_id = ? ORDER BY created_at DESC')
      .all(me(req));
    res.json({ favorites: rows });
  });

  router.post('/gifs/favorites', (req, res) => {
    const url = str(req.body, 'url', { min: 1, max: 600 })!;
    const preview = str(req.body, 'preview', { max: 600, optional: true }) || url;
    if (!isAllowedGifUrl(url) || !isAllowedGifUrl(preview)) {
      throw badRequest('Only GIFs from search or uploads can be saved');
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM gif_favorites WHERE user_id = ?').get(me(req)) as { n: number };
    if (n >= 200) throw badRequest('You can save up to 200 GIFs');
    db.prepare(
      'INSERT OR REPLACE INTO gif_favorites (user_id, url, preview, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(me(req), url, preview, clampDim(req.body?.width), clampDim(req.body?.height), Date.now());
    res.status(201).json({ ok: true });
  });

  router.delete('/gifs/favorites', (req, res) => {
    const url = str(req.body, 'url', { min: 1, max: 600 })!;
    db.prepare('DELETE FROM gif_favorites WHERE user_id = ? AND url = ?').run(me(req), url);
    res.json({ ok: true });
  });

  // ---- Personal stickers made from uploaded images ----

  router.get('/stickers', (req, res) => {
    const rows = db
      .prepare('SELECT id, name, url FROM user_stickers WHERE user_id = ? ORDER BY created_at')
      .all(me(req));
    res.json({ stickers: rows });
  });

  router.post('/stickers', (req, res) => {
    const userId = me(req);
    const name = str(req.body, 'name', { min: 1, max: 32 })!;
    const uploadId = str(req.body, 'uploadId', { min: 1, max: 64 })!;
    const upload = db.prepare('SELECT * FROM uploads WHERE id = ? AND owner_id = ?').get(uploadId, userId) as
      | UploadRow
      | undefined;
    if (!upload || !upload.mime.startsWith('image/')) throw badRequest('Stickers must be an image you uploaded');
    if (upload.size > 2 * 1024 * 1024) throw badRequest('Sticker images must be under 2 MB');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM user_stickers WHERE user_id = ?').get(userId) as { n: number };
    if (n >= 60) throw badRequest('You can have up to 60 stickers');
    const id = randomUUID();
    const url = `/uploads/${upload.file}`;
    db.prepare('INSERT INTO user_stickers (id, user_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, name, url, Date.now());
    res.status(201).json({ sticker: { id, name, url } });
  });

  router.delete('/stickers/:id', (req, res) => {
    const result = db.prepare('DELETE FROM user_stickers WHERE id = ? AND user_id = ?').run(req.params.id, me(req));
    if (result.changes === 0) throw notFound('Sticker not found');
    res.json({ ok: true });
  });

  return router;
}
