// Game news from official sources. Steam's public news feed covers most PC
// games; games without one link to their official news page instead.
// Results are cached per game, and a failed fetch falls back to the last
// good copy so the page never breaks when a source is down.

export interface NewsItem {
  id: string;
  game: string;
  title: string;
  summary: string;
  url: string;
  image: string | null;
  source: string;
  author: string;
  category: 'patch' | 'esports' | 'news';
  publishedAt: number;
}

export interface NewsSource {
  game: string;
  /** Steam app id, when the game has a Steam news feed. */
  appid: number | null;
  officialUrl: string;
  ok: boolean;
}

interface Catalog {
  appid: number | null;
  officialUrl: string;
}

/** Games we know how to fetch news for, matched case-insensitively. */
export const NEWS_CATALOG: Record<string, Catalog> = {
  'Counter-Strike 2': { appid: 730, officialUrl: 'https://www.counter-strike.net/news' },
  'Dota 2': { appid: 570, officialUrl: 'https://www.dota2.com/news' },
  'Apex Legends': { appid: 1172470, officialUrl: 'https://www.ea.com/games/apex-legends/news' },
  'Rocket League': { appid: 252950, officialUrl: 'https://www.rocketleague.com/news' },
  'Overwatch 2': { appid: 2357570, officialUrl: 'https://overwatch.blizzard.com/news/' },
  'Marvel Rivals': { appid: 2767030, officialUrl: 'https://www.marvelrivals.com/news/' },
  'Call of Duty': { appid: 1938090, officialUrl: 'https://www.callofduty.com/blog' },
  'EA Sports FC': { appid: 2669320, officialUrl: 'https://www.ea.com/games/ea-sports-fc/news' },
  'Team Fortress 2': { appid: 440, officialUrl: 'https://www.teamfortress.com/' },
  'Rainbow Six Siege': { appid: 359550, officialUrl: 'https://www.ubisoft.com/en-us/game/rainbow-six/siege/news-updates' },
  'Destiny 2': { appid: 1085660, officialUrl: 'https://www.bungie.net/7/en/News' },
  PUBG: { appid: 578080, officialUrl: 'https://pubg.com/en/news' },
  Rust: { appid: 252490, officialUrl: 'https://rust.facepunch.com/news' },
  Deadlock: { appid: 1422450, officialUrl: 'https://store.steampowered.com/app/1422450' },
  'Helldivers 2': { appid: 553850, officialUrl: 'https://store.steampowered.com/news/app/553850' },
  'Path of Exile 2': { appid: 2694490, officialUrl: 'https://www.pathofexile.com/forum/view-forum/news' },
  Warframe: { appid: 230410, officialUrl: 'https://www.warframe.com/news' },
  'Dead by Daylight': { appid: 381210, officialUrl: 'https://deadbydaylight.com/news/' },
  'Elden Ring': { appid: 1245620, officialUrl: 'https://en.bandainamcoent.eu/elden-ring/news' },
  "Baldur's Gate 3": { appid: 1086940, officialUrl: 'https://baldursgate3.game/news' },
  Valorant: { appid: null, officialUrl: 'https://playvalorant.com/en-us/news/' },
  'League of Legends': { appid: null, officialUrl: 'https://www.leagueoflegends.com/en-us/news/' },
  Fortnite: { appid: null, officialUrl: 'https://www.fortnite.com/news' },
  Minecraft: { appid: null, officialUrl: 'https://www.minecraft.net/en-us/articles' },
  'Genshin Impact': { appid: null, officialUrl: 'https://genshin.hoyoverse.com/en/news' },
  Roblox: { appid: null, officialUrl: 'https://corp.roblox.com/newsroom' },
};

/** Popular games shown to people who haven't picked any we cover. */
export const DEFAULT_NEWS_GAMES = ['Counter-Strike 2', 'Apex Legends', 'Rocket League', 'Marvel Rivals', 'Dota 2'];

export function catalogName(game: string): string | null {
  const g = game.trim().toLowerCase();
  return Object.keys(NEWS_CATALOG).find((k) => k.toLowerCase() === g) ?? null;
}

const STEAM_CLAN_IMAGES = 'https://clan.akamai.steamstatic.com/images/';

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** The first image in a Steam post, as an https URL. */
export function firstImage(contents: string): string | null {
  const m =
    contents.match(/\{STEAM_CLAN_IMAGE\}\/([^\s"'\[\]<>]+)/) ??
    contents.match(/\[img(?:=[^\]]*)?\]\s*([^\[\s]+)\s*\[\/img\]/i) ??
    contents.match(/\[img\s+src="([^"]+)"/i) ??
    contents.match(/<img[^>]+src="([^"]+)"/i);
  if (!m) return null;
  const raw = m[0].startsWith('{STEAM_CLAN_IMAGE}') ? STEAM_CLAN_IMAGES + m[1] : m[1].replace('{STEAM_CLAN_IMAGE}', STEAM_CLAN_IMAGES.slice(0, -1));
  return /^https:\/\//.test(raw) ? raw : null;
}

/** Plain text from Steam's mix of BBCode and HTML, cut to a short summary. */
export function summarize(contents: string, max = 260): string {
  const text = decodeEntities(
    contents
      .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, ' ')
      .replace(/\[(previewyoutube|video)[^\]]*\][\s\S]*?\[\/\1\]/gi, ' ')
      .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, ' ')
      .replace(/\[\/?[a-z0-9*]+(?:[= ][^\]]*)?\]/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).trim()}…`;
}

export function categorize(title: string, contents = ''): NewsItem['category'] {
  if (/\b(patch|hotfix|update|release notes|changelog|bug ?fix(es)?)\b/i.test(title)) return 'patch';
  if (/\b(major|championship|tournament|esports|finals?|qualifier|invitational|grand final|pro league|worlds)\b/i.test(`${title} ${contents.slice(0, 200)}`)) {
    return 'esports';
  }
  return 'news';
}

interface SteamItem {
  gid: string;
  title: string;
  url: string;
  author?: string;
  contents?: string;
  feedlabel?: string;
  date: number;
}

export interface NewsService {
  forGames(games: string[]): Promise<{ items: NewsItem[]; sources: NewsSource[] }>;
}

export function createNews(opts: { fetch?: typeof fetch; ttlMs?: number; perGame?: number; timeoutMs?: number } = {}): NewsService {
  const doFetch = opts.fetch ?? fetch;
  const ttl = opts.ttlMs ?? 15 * 60_000;
  const perGame = opts.perGame ?? 8;
  const timeout = opts.timeoutMs ?? 6000;
  const cache = new Map<number, { at: number; items: NewsItem[] }>();
  const inflight = new Map<number, Promise<NewsItem[]>>();

  async function load(game: string, appid: number): Promise<NewsItem[]> {
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${appid}&count=${perGame}&maxlength=0&format=json`;
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Steam answered ${res.status}`);
    const body = (await res.json()) as { appnews?: { newsitems?: SteamItem[] } };
    const items = body.appnews?.newsitems ?? [];
    return items
      .filter((n) => n && typeof n.title === 'string' && typeof n.url === 'string' && /^https:\/\//.test(n.url))
      .map((n) => ({
        id: `steam-${n.gid}`,
        game,
        title: decodeEntities(n.title).slice(0, 200),
        summary: summarize(n.contents ?? ''),
        url: n.url,
        image: firstImage(n.contents ?? ''),
        source: n.feedlabel || 'Steam',
        author: (n.author ?? '').slice(0, 60),
        category: categorize(n.title, n.contents),
        publishedAt: n.date * 1000,
      }));
  }

  async function cached(game: string, appid: number): Promise<{ items: NewsItem[]; ok: boolean }> {
    const hit = cache.get(appid);
    if (hit && Date.now() - hit.at < ttl) return { items: hit.items, ok: true };
    let p = inflight.get(appid);
    if (!p) {
      p = load(game, appid).finally(() => inflight.delete(appid));
      inflight.set(appid, p);
    }
    try {
      const items = await p;
      cache.set(appid, { at: Date.now(), items });
      return { items, ok: true };
    } catch {
      // Serve the last good copy if there is one.
      return { items: hit?.items ?? [], ok: false };
    }
  }

  return {
    async forGames(games) {
      const names = [...new Set(games.map(catalogName).filter((g): g is string => !!g))].slice(0, 12);
      const results = await Promise.all(
        names.map(async (game) => {
          const { appid, officialUrl } = NEWS_CATALOG[game];
          if (appid === null) return { items: [] as NewsItem[], source: { game, appid, officialUrl, ok: true } };
          const r = await cached(game, appid);
          return { items: r.items, source: { game, appid, officialUrl, ok: r.ok } };
        }),
      );
      const items = results.flatMap((r) => r.items).sort((a, b) => b.publishedAt - a.publishedAt);
      return { items, sources: results.map((r) => r.source) };
    },
  };
}
