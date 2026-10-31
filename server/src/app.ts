import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { requireAuth } from './auth.ts';
import { openDb } from './db.ts';
import { errorHandler, notFound } from './http.ts';
import { createRealtime } from './realtime.ts';
import { authRoutes } from './routes/auth.ts';
import { communityRoutes } from './routes/communities.ts';
import { messageRoutes } from './routes/messages.ts';
import { appearanceRoutes } from './routes/appearance.ts';
import { inboxRoutes } from './routes/inbox.ts';
import { eventRoutes } from './routes/events.ts';
import { feedRoutes } from './routes/feed.ts';
import { lfgRoutes } from './routes/lfg.ts';
import { teamRoutes } from './routes/teams.ts';
import { tournamentRoutes } from './routes/tournaments.ts';
import { newsRoutes } from './routes/news.ts';
import { createNews, type NewsService } from './news.ts';
import { mediaRoutes, uploadsStatic } from './routes/media.ts';
import { userRoutes } from './routes/users.ts';

export interface AppOptions {
  dbPath: string;
  uploadDir: string;
  /** Built client to serve, if present. */
  staticDir?: string;
  secureCookies?: boolean;
  /** Game news source; tests pass one with a fake fetch. */
  news?: NewsService;
}

export function createNexus(opts: AppOptions) {
  const db = openDb(opts.dbPath);
  const rt = createRealtime(db);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes(rt, { secureCookies: !!opts.secureCookies }));
  const authed = express.Router();
  authed.use(requireAuth(db));
  authed.use(userRoutes(rt));
  authed.use(communityRoutes(rt));
  authed.use(messageRoutes(rt));
  authed.use(mediaRoutes(rt, opts.uploadDir));
  authed.use(appearanceRoutes(rt));
  authed.use(inboxRoutes(rt));
  authed.use(eventRoutes(rt));
  authed.use(feedRoutes(rt));
  authed.use(lfgRoutes(rt));
  authed.use(teamRoutes(rt));
  authed.use(tournamentRoutes(rt));
  authed.use(newsRoutes(rt, opts.news ?? createNews()));
  app.use('/api', authed);
  app.use('/uploads', uploadsStatic(opts.uploadDir));
  app.use('/api', (_req, _res, next) => next(notFound('No such API route')));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir));
    // Client-side routing: anything that is not an API call gets the app shell.
    app.get(/^(?!\/api\/|\/socket\.io\/|\/uploads\/).*/, (_req, res) => res.sendFile(join(dir, 'index.html')));
  }

  app.use(errorHandler);

  const server = createServer(app);
  rt.attach(server);

  return {
    app,
    server,
    db,
    async close() {
      await rt.close();
      db.close();
    },
  };
}
