import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { me } from '../auth.ts';
import { assertCanPost, isBlockedEitherWay, readableChannel } from '../access.ts';
import { HttpError, badRequest, forbidden, notFound, str } from '../http.ts';
import type { Realtime } from '../realtime.ts';
import { getMessageRow, serializeMessages, usersById } from '../serialize.ts';
import type { UploadRow } from './media.ts';

interface ClipRow {
  id: string;
  author_id: string;
  title: string;
  game: string;
  source: 'upload' | 'youtube' | 'twitch';
  url: string;
  width: number | null;
  height: number | null;
  created_at: number;
}

/** Recognise YouTube and Twitch clip links. Only these providers may be embedded. */
export function parseVideoLink(raw: string): { source: 'youtube' | 'twitch'; id: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const yt = /^[\w-]{11}$/;
  if (host === 'youtu.be' && yt.test(u.pathname.slice(1))) return { source: 'youtube', id: u.pathname.slice(1) };
  if (host === 'youtube.com') {
    const v = u.searchParams.get('v');
    if (u.pathname === '/watch' && v && yt.test(v)) return { source: 'youtube', id: v };
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/);
    if (m) return { source: 'youtube', id: m[2] };
  }
  const slug = /^[\w-]{3,100}$/;
  if (host === 'clips.twitch.tv' && slug.test(u.pathname.slice(1))) return { source: 'twitch', id: u.pathname.slice(1) };
  if (host === 'twitch.tv') {
    const m = u.pathname.match(/^\/[\w]+\/clip\/([\w-]{3,100})/);
    if (m) return { source: 'twitch', id: m[1] };
  }
  return null;
}

const DAY = 86_400_000;

export function feedRoutes(rt: Realtime) {
  const { db } = rt.ctx;
  const router = Router();

  function serialize(c: ClipRow, viewerId: string) {
    const likes = (db.prepare('SELECT COUNT(*) AS n FROM clip_likes WHERE clip_id = ?').get(c.id) as { n: number }).n;
    const comments = (db.prepare('SELECT COUNT(*) AS n FROM clip_comments WHERE clip_id = ?').get(c.id) as { n: number }).n;
    const liked = !!db.prepare('SELECT 1 FROM clip_likes WHERE clip_id = ? AND user_id = ?').get(c.id, viewerId);
    const following = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(viewerId, c.author_id);
    const [author] = usersById(rt.ctx, [c.author_id]);
    return {
      id: c.id,
      title: c.title,
      game: c.game,
      source: c.source,
      url: c.url,
      thumb: c.source === 'youtube' ? `https://i.ytimg.com/vi/${c.url}/hqdefault.jpg` : null,
      width: c.width,
      height: c.height,
      createdAt: c.created_at,
      author: author ?? null,
      likes,
      comments,
      liked,
      following,
      mine: c.author_id === viewerId,
    };
  }

  const blockedFilter = `author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)`;

  /**
   * For you: recent clips ranked by engagement with time decay, boosted for
   * your games and the creators you follow. Following: newest from people you follow.
   */
  router.get('/clips', (req, res) => {
    const userId = me(req);
    const tab = req.query.tab === 'following' ? 'following' : req.query.tab === 'new' ? 'new' : 'foryou';
    const game = typeof req.query.game === 'string' ? req.query.game.slice(0, 40) : '';
    const author = typeof req.query.author === 'string' ? req.query.author.slice(0, 24) : '';
    const offset = Math.max(0, Math.min(Number(req.query.offset) || 0, 1000));
    const where = [blockedFilter];
    const args: (string | number)[] = [userId, userId];
    if (game) {
      where.push('game = ? COLLATE NOCASE');
      args.push(game);
    }
    if (author) {
      where.push('author_id = (SELECT id FROM users WHERE username = ?)');
      args.push(author);
    }
    if (tab === 'following') {
      where.push('author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)');
      args.push(userId);
    }
    const rows = db
      .prepare(`SELECT * FROM clips WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 300`)
      .all(...args) as unknown as ClipRow[];
    let list = rows.map((r) => serialize(r, userId));
    if (tab === 'foryou') {
      const myGames = new Set(
        (JSON.parse((db.prepare('SELECT games FROM users WHERE id = ?').get(userId) as { games: string }).games) as string[]).map((g) =>
          g.toLowerCase(),
        ),
      );
      const now = Date.now();
      const score = (c: (typeof list)[number]) => {
        const ageDays = (now - c.createdAt) / DAY;
        let s = (1 + c.likes * 3 + c.comments * 2) / Math.pow(ageDays + 1, 1.3);
        if (myGames.has(c.game.toLowerCase())) s *= 1.8;
        if (c.following) s *= 1.5;
        if (c.mine) s *= 0.6;
        return s;
      };
      list = list.sort((a, b) => score(b) - score(a));
    }
    const page = list.slice(offset, offset + 12);
    res.json({ clips: page, nextOffset: offset + 12 < list.length ? offset + 12 : null });
  });

  router.get('/clips/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM clips WHERE id = ?').get(req.params.id) as unknown as ClipRow | undefined;
    if (!c || isBlockedEitherWay(db, me(req), c.author_id)) throw notFound('Clip not found');
    res.json({ clip: serialize(c, me(req)) });
  });

  router.post('/clips', (req, res) => {
    const userId = me(req);
    const title = str(req.body, 'title', { min: 1, max: 100 })!;
    const game = str(req.body, 'game', { max: 40, optional: true }) ?? '';
    const recent = db.prepare('SELECT COUNT(*) AS n FROM clips WHERE author_id = ? AND created_at > ?').get(userId, Date.now() - 3_600_000) as {
      n: number;
    };
    if (recent.n >= 20) throw new HttpError(429, 'That is a lot of clips. Try again in a bit.');
    let source: ClipRow['source'];
    let url: string;
    let width: number | null = null;
    let height: number | null = null;
    if (typeof req.body?.uploadId === 'string') {
      const up = db.prepare('SELECT * FROM uploads WHERE id = ? AND owner_id = ?').get(req.body.uploadId, userId) as UploadRow | undefined;
      if (!up) throw badRequest('Upload not found');
      if (!up.mime.startsWith('video/') && up.mime !== 'image/gif') throw badRequest('Clips must be videos');
      source = 'upload';
      url = `/uploads/${up.file}`;
      width = up.width;
      height = up.height;
    } else if (typeof req.body?.link === 'string') {
      const parsed = parseVideoLink(req.body.link);
      if (!parsed) throw badRequest('Paste a YouTube or Twitch clip link');
      source = parsed.source;
      url = parsed.id;
    } else {
      throw badRequest('Upload a video or paste a link');
    }
    const id = randomUUID();
    db.prepare('INSERT INTO clips (id, author_id, title, game, source, url, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      userId,
      title,
      game,
      source,
      url,
      width,
      height,
      Date.now(),
    );
    res.status(201).json({ clip: serialize(db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as unknown as ClipRow, userId) });
  });

  router.delete('/clips/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM clips WHERE id = ?').get(req.params.id) as unknown as ClipRow | undefined;
    if (!c) throw notFound('Clip not found');
    if (c.author_id !== me(req)) throw forbidden('You can only delete your own clips');
    db.prepare('DELETE FROM clips WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  const visibleClip = (userId: string, id: string) => {
    const c = db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as unknown as ClipRow | undefined;
    if (!c || isBlockedEitherWay(db, userId, c.author_id)) throw notFound('Clip not found');
    return c;
  };

  router.post('/clips/:id/like', (req, res) => {
    const userId = me(req);
    const c = visibleClip(userId, req.params.id);
    const del = db.prepare('DELETE FROM clip_likes WHERE clip_id = ? AND user_id = ?').run(c.id, userId);
    if (!del.changes) db.prepare('INSERT INTO clip_likes (clip_id, user_id) VALUES (?, ?)').run(c.id, userId);
    res.json({ clip: serialize(c, userId) });
  });

  router.get('/clips/:id/comments', (req, res) => {
    const userId = me(req);
    const c = visibleClip(userId, req.params.id);
    const rows = db
      .prepare(`SELECT * FROM clip_comments WHERE clip_id = ? AND ${blockedFilter} ORDER BY created_at LIMIT 200`)
      .all(c.id, userId, userId) as { id: string; author_id: string; content: string; created_at: number }[];
    const users = new Map(usersById(rt.ctx, [...new Set(rows.map((r) => r.author_id))]).map((u) => [u.id, u]));
    res.json({
      comments: rows.map((r) => ({ id: r.id, author: users.get(r.author_id) ?? null, content: r.content, createdAt: r.created_at, mine: r.author_id === userId })),
    });
  });

  router.post('/clips/:id/comments', (req, res) => {
    const userId = me(req);
    const c = visibleClip(userId, req.params.id);
    const content = str(req.body, 'content', { min: 1, max: 500 })!;
    const id = randomUUID();
    db.prepare('INSERT INTO clip_comments (id, clip_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)').run(id, c.id, userId, content, Date.now());
    const [author] = usersById(rt.ctx, [userId]);
    res.status(201).json({ comment: { id, author, content, createdAt: Date.now(), mine: true } });
  });

  router.delete('/clip-comments/:id', (req, res) => {
    const row = db.prepare('SELECT c.author_id, k.author_id AS clip_author FROM clip_comments c JOIN clips k ON k.id = c.clip_id WHERE c.id = ?').get(
      req.params.id,
    ) as { author_id: string; clip_author: string } | undefined;
    if (!row) throw notFound('Comment not found');
    // Authors can remove their own comments; creators can tidy their clip's comments.
    if (row.author_id !== me(req) && row.clip_author !== me(req)) throw forbidden();
    db.prepare('DELETE FROM clip_comments WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Share a clip into a chat as a message with a link back to the feed.
  router.post('/clips/:id/share', (req, res) => {
    const userId = me(req);
    const c = visibleClip(userId, req.params.id);
    const channel = readableChannel(db, userId, String(req.body?.channelId ?? ''));
    assertCanPost(db, userId, channel);
    const note = str(req.body, 'note', { max: 300, optional: true }) ?? '';
    const content = `${note ? `${note}\n` : ''}🎬 ${c.title}${c.game ? ` · ${c.game}` : ''}\n/feed/${c.id}`;
    const r = db
      .prepare('INSERT INTO messages (channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?)')
      .run(channel.id, userId, content, Date.now());
    const row = getMessageRow(db, Number(r.lastInsertRowid))!;
    const [msg] = serializeMessages(rt.ctx, '', [row]);
    rt.toChannel(channel.id, 'message:new', { ...msg, reactors: [] });
    res.status(201).json({ ok: true });
  });

  // ---- Following creators ----

  router.post('/users/:id/follow', (req, res) => {
    const userId = me(req);
    const target = req.params.id;
    if (target === userId) throw badRequest("You can't follow yourself");
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(target) || isBlockedEitherWay(db, userId, target)) throw notFound('User not found');
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(userId, target, Date.now());
    res.json({ following: true });
  });

  router.delete('/users/:id/follow', (req, res) => {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(me(req), req.params.id);
    res.json({ following: false });
  });

  return router;
}
