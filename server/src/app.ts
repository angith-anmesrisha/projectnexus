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
import { userRoutes } from './routes/users.ts';

export interface AppOptions {
  dbPath: string;
  /** Built client to serve, if present. */
  staticDir?: string;
  secureCookies?: boolean;
}

export function createNexus(opts: AppOptions) {
  const db = openDb(opts.dbPath);
  const rt = createRealtime(db);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
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
  app.use('/api', authed);
  app.use('/api', (_req, _res, next) => next(notFound('No such API route')));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir));
    // Client-side routing: anything that is not an API call gets the app shell.
    app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => res.sendFile(join(dir, 'index.html')));
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
