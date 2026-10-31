// Emoji data is large, so it loads in the background after start-up.
// A handful of common shortcodes work immediately.

export interface EmojiEntry {
  emoji: string;
  name: string;
  slug: string;
  skin: boolean;
}

export interface EmojiGroup {
  name: string;
  slug: string;
  emojis: EmojiEntry[];
}

const COMMON: Record<string, string> = {
  fire: '🔥', joy: '😂', skull: '💀', heart: '❤️', thumbsup: '👍', '+1': '👍', thumbsdown: '👎', eyes: '👀',
  sob: '😭', clap: '👏', pray: '🙏', rocket: '🚀', trophy: '🏆', crown: '👑', gg: '🎮', video_game: '🎮',
  smile: '😄', grin: '😁', wink: '😉', cry: '😢', rage: '😡', thinking: '🤔', sunglasses: '😎', party: '🥳',
  tada: '🎉', hundred: '💯', '100': '💯', zap: '⚡', star: '⭐', sparkles: '✨', check: '✅', x: '❌', wave: '👋',
  muscle: '💪', target: '🎯', dart: '🎯', boom: '💥', ghost: '👻', clown: '🤡', salute: '🫡', goat: '🐐',
};

let groups: EmojiGroup[] | null = null;
const bySlug = new Map<string, string>(Object.entries(COMMON));
const listeners = new Set<() => void>();

const loading = import('unicode-emoji-json/data-by-group.json').then((mod) => {
  const data = (mod.default ?? mod) as unknown as { name: string; slug: string; emojis: { emoji: string; name: string; slug: string; skin_tone_support: boolean }[] }[];
  groups = data
    .filter((g) => g.slug !== 'component')
    .map((g) => ({
      name: g.name,
      slug: g.slug,
      emojis: g.emojis.map((e) => ({ emoji: e.emoji, name: e.name, slug: e.slug, skin: e.skin_tone_support })),
    }));
  for (const g of groups) for (const e of g.emojis) if (!bySlug.has(e.slug)) bySlug.set(e.slug, e.emoji);
  listeners.forEach((l) => l());
  return groups;
});

export const loadEmoji = () => loading;
export const emojiGroups = () => groups;
export const onEmojiLoaded = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function shortcodeToEmoji(code: string): string | undefined {
  return bySlug.get(code.toLowerCase());
}

/** Prefix search over shortcodes for the :autocomplete. */
export function searchShortcodes(q: string, limit = 8): { slug: string; emoji: string }[] {
  const needle = q.toLowerCase();
  const starts: { slug: string; emoji: string }[] = [];
  const contains: { slug: string; emoji: string }[] = [];
  for (const [slug, emoji] of bySlug) {
    if (slug.startsWith(needle)) starts.push({ slug, emoji });
    else if (slug.includes(needle)) contains.push({ slug, emoji });
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

const SKIN_TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];

/** Apply a skin tone (0 = default) to an emoji that supports it. */
export function withSkin(e: EmojiEntry, tone: number): string {
  if (!tone || !e.skin) return e.emoji;
  const chars = [...e.emoji.replace(/️/g, '')];
  return chars[0] + SKIN_TONES[tone] + chars.slice(1).join('');
}

const RECENT_KEY = 'nexus.recentEmoji';
export function recentEmoji(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function rememberEmoji(e: string) {
  try {
    const list = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 32);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Recents are a convenience; ignore storage failures.
  }
}
