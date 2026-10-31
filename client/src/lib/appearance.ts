// Everything the user can customise about how Nexus looks and behaves.
// Settings are plain JSON so they can be synced, exported and shared as themes.

export type Wallpaper = 'aurora' | 'grid' | 'mesh' | 'solid' | 'image';
export type Density = 'compact' | 'cozy' | 'roomy';
export type MessageStyle = 'auto' | 'bubbles' | 'flat' | 'cards';

export interface Colors {
  mode: 'dark' | 'light';
  bg: string;
  panel: string;
  text: string;
  accent: string;
  accent2: string;
}

export interface Appearance {
  version: 1;
  preset: string;
  colors: Colors;
  wallpaper: Wallpaper;
  wallpaperImage: string;
  wallpaperDim: number; // 0..0.9
  panelOpacity: number; // 0.35..1
  blur: number; // px
  radius: number; // px
  gap: number; // px between panels
  font: string;
  displayFont: string;
  fontScale: number; // 0.85..1.25
  density: Density;
  messageStyle: MessageStyle;
  dockSide: 'left' | 'right';
  showMemberList: boolean;
  dockLabels: boolean;
  motion: 'full' | 'reduced';
  plugins: Record<string, boolean>;
  customCss: string;
}

export const FONTS: { id: string; label: string; family: string; google?: string }[] = [
  { id: 'inter', label: 'Inter', family: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;500;600;700' },
  { id: 'outfit', label: 'Outfit', family: "'Outfit', system-ui, sans-serif", google: 'Outfit:wght@400;500;600;700' },
  { id: 'sora', label: 'Sora', family: "'Sora', system-ui, sans-serif", google: 'Sora:wght@400;500;600;700' },
  { id: 'nunito', label: 'Nunito', family: "'Nunito', system-ui, sans-serif", google: 'Nunito:wght@400;600;700;800' },
  { id: 'space', label: 'Space Grotesk', family: "'Space Grotesk', system-ui, sans-serif", google: 'Space+Grotesk:wght@400;500;600;700' },
  { id: 'rajdhani', label: 'Rajdhani', family: "'Rajdhani', system-ui, sans-serif", google: 'Rajdhani:wght@500;600;700' },
  { id: 'orbitron', label: 'Orbitron', family: "'Orbitron', system-ui, sans-serif", google: 'Orbitron:wght@500;600;700;800' },
  { id: 'mono', label: 'JetBrains Mono', family: "'JetBrains Mono', ui-monospace, monospace", google: 'JetBrains+Mono:wght@400;500;600;700' },
  { id: 'system', label: 'System', family: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
];

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  default: boolean;
  category: 'Chat' | 'Privacy' | 'Interface' | 'Fun';
}

/** Built-in plugins. Each one is a behaviour switch the app checks at runtime. */
export const PLUGINS: PluginInfo[] = [
  { id: 'markdown', name: 'Rich text', description: 'Render **bold**, *italic*, ~~strike~~, `code`, code blocks and quotes.', default: true, category: 'Chat' },
  { id: 'spoilers', name: 'Spoiler tags', description: 'Hide text wrapped in ||double bars|| until someone clicks it.', default: true, category: 'Chat' },
  { id: 'bigEmoji', name: 'Jumbo emoji', description: 'Messages that are only emoji are shown large.', default: true, category: 'Chat' },
  { id: 'emojiAutocomplete', name: 'Emoji and mention autocomplete', description: 'Type :fire or @name for suggestions while you write.', default: true, category: 'Chat' },
  { id: 'sendOnCtrlEnter', name: 'Send with Ctrl+Enter', description: 'Enter adds a new line and Ctrl+Enter sends.', default: false, category: 'Chat' },
  { id: 'typing', name: 'Typing indicators', description: "See when others are typing, and let them see when you are.", default: true, category: 'Chat' },
  { id: 'clock24', name: '24-hour clock', description: 'Show times like 21:30 instead of 9:30 PM.', default: false, category: 'Interface' },
  { id: 'relativeTime', name: 'Relative timestamps', description: 'Show "5m ago" instead of the clock time.', default: false, category: 'Interface' },
  { id: 'focusMode', name: 'Focus mode', description: 'Hide side panels to keep only the conversation. Toggle with Ctrl+Shift+F.', default: false, category: 'Interface' },
  { id: 'hideBlocked', name: 'Hide blocked users completely', description: 'Remove their messages instead of collapsing them.', default: false, category: 'Privacy' },
  { id: 'streamerMode', name: 'Streamer mode', description: 'Blur invite links and @usernames so you can go live safely.', default: false, category: 'Privacy' },
  { id: 'sounds', name: 'Sound effects', description: 'A soft ping for new direct messages and mentions.', default: false, category: 'Fun' },
  { id: 'rainbowName', name: 'Prismatic name', description: 'Your own name shimmers in your messages (only you see it).', default: false, category: 'Fun' },
  { id: 'confetti', name: 'GG confetti', description: 'Sending "gg" bursts a little confetti on your screen.', default: true, category: 'Fun' },
];

export interface Preset {
  id: string;
  name: string;
  tagline: string;
  colors: Colors;
  wallpaper: Wallpaper;
  font?: string;
  radius?: number;
  panelOpacity?: number;
}

export const PRESETS: Preset[] = [
  { id: 'nexus', name: 'Nexus Night', tagline: 'Violet and cyan aurora', wallpaper: 'aurora', colors: { mode: 'dark', bg: '#07070f', panel: '#11121f', text: '#ecedf7', accent: '#8b5cf6', accent2: '#22d3ee' } },
  { id: 'synthwave', name: 'Synthwave', tagline: 'Sunset grid, hot pink', wallpaper: 'grid', font: 'outfit', colors: { mode: 'dark', bg: '#0f0420', panel: '#1a0b2e', text: '#fdf0ff', accent: '#ff3ea5', accent2: '#ffb627' } },
  { id: 'toxic', name: 'Toxic', tagline: 'Acid green on black', wallpaper: 'mesh', font: 'rajdhani', colors: { mode: 'dark', bg: '#030603', panel: '#0b120b', text: '#eaffea', accent: '#a3ff12', accent2: '#12ffd1' } },
  { id: 'ember', name: 'Ember', tagline: 'Warm forge glow', wallpaper: 'aurora', colors: { mode: 'dark', bg: '#0e0605', panel: '#1a0e0b', text: '#fff1ea', accent: '#ff6b2c', accent2: '#ffd23f' } },
  { id: 'abyss', name: 'Abyss', tagline: 'Deep sea teal', wallpaper: 'mesh', font: 'sora', colors: { mode: 'dark', bg: '#020c14', panel: '#071824', text: '#e6f7ff', accent: '#14b8a6', accent2: '#38bdf8' } },
  { id: 'void', name: 'Void', tagline: 'True black for OLED', wallpaper: 'solid', panelOpacity: 1, colors: { mode: 'dark', bg: '#000000', panel: '#0a0a0a', text: '#f5f5f5', accent: '#f5f5f5', accent2: '#7dd3fc' } },
  { id: 'terminal', name: 'Terminal', tagline: 'Green phosphor, sharp edges', wallpaper: 'solid', font: 'mono', radius: 3, colors: { mode: 'dark', bg: '#010802', panel: '#03120a', text: '#b9ffc4', accent: '#22c55e', accent2: '#a3e635' } },
  { id: 'arctic', name: 'Arctic', tagline: 'Crisp light mode', wallpaper: 'mesh', colors: { mode: 'light', bg: '#e8eef6', panel: '#ffffff', text: '#0f172a', accent: '#2563eb', accent2: '#06b6d4' } },
  { id: 'sakura', name: 'Sakura', tagline: 'Soft pink daylight', wallpaper: 'aurora', font: 'nunito', colors: { mode: 'light', bg: '#fdf2f6', panel: '#ffffff', text: '#3b0a24', accent: '#e11d74', accent2: '#8b5cf6' } },
];

export const DEFAULT_APPEARANCE: Appearance = {
  version: 1,
  preset: 'nexus',
  colors: PRESETS[0].colors,
  wallpaper: 'aurora',
  wallpaperImage: '',
  wallpaperDim: 0.35,
  panelOpacity: 0.78,
  blur: 18,
  radius: 18,
  gap: 10,
  font: 'inter',
  displayFont: 'space',
  fontScale: 1,
  density: 'cozy',
  messageStyle: 'auto',
  dockSide: 'left',
  showMemberList: true,
  dockLabels: false,
  motion: 'full',
  plugins: Object.fromEntries(PLUGINS.map((p) => [p.id, p.default])),
  customCss: '',
};

/** Fill in anything missing from older or hand-edited settings. */
export function normalize(raw: unknown): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Appearance>;
  return {
    ...DEFAULT_APPEARANCE,
    ...r,
    colors: { ...DEFAULT_APPEARANCE.colors, ...(r.colors ?? {}) },
    plugins: { ...DEFAULT_APPEARANCE.plugins, ...(r.plugins ?? {}) },
    version: 1,
  };
}

export function applyPreset(a: Appearance, p: Preset): Appearance {
  return {
    ...a,
    preset: p.id,
    colors: p.colors,
    wallpaper: p.wallpaper,
    font: p.font ?? 'inter',
    radius: p.radius ?? DEFAULT_APPEARANCE.radius,
    panelOpacity: p.panelOpacity ?? DEFAULT_APPEARANCE.panelOpacity,
  };
}

const loadedFonts = new Set<string>();
function ensureFont(id: string) {
  const font = FONTS.find((f) => f.id === id);
  if (!font?.google || loadedFonts.has(id)) return;
  loadedFonts.add(id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  document.head.appendChild(link);
}

const hexToRgb = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

/** Readable text colour for something filled with `hex`. */
function contrastOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex).split(' ').map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0b0b12' : '#ffffff';
}

/** Push settings into CSS variables and the custom stylesheet. */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  const c = a.colors;
  const font = FONTS.find((f) => f.id === a.font) ?? FONTS[0];
  const display = FONTS.find((f) => f.id === a.displayFont) ?? FONTS[0];
  ensureFont(font.id);
  ensureFont(display.id);
  const vars: Record<string, string> = {
    '--bg': c.bg,
    '--panel-rgb': hexToRgb(c.panel),
    '--text': c.text,
    '--accent': c.accent,
    '--accent-2': c.accent2,
    '--accent-rgb': hexToRgb(c.accent),
    '--accent-2-rgb': hexToRgb(c.accent2),
    '--on-accent': contrastOn(c.accent),
    '--panel-alpha': String(a.panelOpacity),
    '--blur': `${a.blur}px`,
    '--radius': `${a.radius}px`,
    '--gap': `${a.gap}px`,
    '--font': font.family,
    '--display': display.family,
    '--scale': String(a.fontScale),
    '--wall-dim': String(a.wallpaperDim),
    '--wall-image': a.wallpaperImage ? `url("${a.wallpaperImage.replace(/["\\\n]/g, '')}")` : 'none',
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.mode = c.mode;
  root.dataset.density = a.density;
  root.dataset.motion = a.motion;
  root.dataset.dock = a.dockSide;
  root.dataset.wallpaper = a.wallpaper;
  root.style.colorScheme = c.mode;

  let style = document.getElementById('nexus-custom-css') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'nexus-custom-css';
    document.head.appendChild(style);
  }
  style.textContent = a.customCss;
}

export const CSS_SNIPPETS: { name: string; css: string }[] = [
  { name: 'Neon glow on your messages', css: '.msg.own .msg-body { box-shadow: 0 0 24px rgb(var(--accent-rgb) / .45); }' },
  { name: 'Hide the wallpaper behind chat', css: '.chat { background: var(--bg); }' },
  { name: 'Square avatars', css: '.avatar { border-radius: 10px; }' },
  { name: 'Bigger message text', css: '.msg-text { font-size: 1.08em; }' },
  { name: 'Gradient channel names', css: '.chan-link.active { background: linear-gradient(90deg, rgb(var(--accent-rgb) / .35), transparent); }' },
  { name: 'Slow rainbow accent', css: '@keyframes hue { to { filter: hue-rotate(360deg); } }\n.dock-item.active .dock-glyph { animation: hue 8s linear infinite; }' },
];
