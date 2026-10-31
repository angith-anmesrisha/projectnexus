import { Router } from 'express';
import { me } from '../auth.ts';
import { DEFAULT_NEWS_GAMES, NEWS_CATALOG, catalogName, type NewsService } from '../news.ts';
import type { Realtime } from '../realtime.ts';
import { getUser } from '../serialize.ts';

export function newsRoutes(rt: Realtime, news: NewsService) {
  const router = Router();

  // News for one game, or for the games on your profile (popular picks if none are covered).
  router.get('/news', async (req, res) => {
    const user = getUser(rt.ctx.db, me(req))!;
    let mine: string[] = [];
    try {
      mine = (JSON.parse(user.games || '[]') as string[]).map(catalogName).filter((g): g is string => !!g);
    } catch {
      mine = [];
    }
    const asked = typeof req.query.game === 'string' ? catalogName(req.query.game) : null;
    const games = asked ? [asked] : mine.length ? mine : DEFAULT_NEWS_GAMES;
    const { items, sources } = await news.forGames(games);
    res.json({ items: items.slice(0, 60), sources, games, mine, catalog: Object.keys(NEWS_CATALOG) });
  });

  return router;
}
