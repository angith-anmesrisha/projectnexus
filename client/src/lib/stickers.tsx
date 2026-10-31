// The built-in "Nexus Essentials" sticker pack, drawn as SVG so it is crisp at any size.
import type { StickerRef } from './types';

type Shape = 'burst' | 'badge' | 'shield' | 'bubble' | 'ribbon' | 'hex';

interface StickerDef {
  id: string;
  label: string;
  text: string;
  sub?: string;
  shape: Shape;
  from: string;
  to: string;
  ink?: string;
  tilt?: number;
}

export const STICKERS: StickerDef[] = [
  { id: 'gg', label: 'GG', text: 'GG', shape: 'burst', from: '#a855f7', to: '#22d3ee', tilt: -6 },
  { id: 'gg-wp', label: 'GG WP', text: 'GG', sub: 'WELL PLAYED', shape: 'ribbon', from: '#10b981', to: '#22d3ee' },
  { id: 'clutch', label: 'Clutch', text: 'CLUTCH', shape: 'shield', from: '#f59e0b', to: '#ef4444', tilt: 4 },
  { id: 'ace', label: 'Ace', text: 'ACE', sub: '5 KILLS', shape: 'hex', from: '#fde047', to: '#f97316' },
  { id: '1v5', label: '1v5', text: '1v5', sub: 'IMPOSSIBLE', shape: 'burst', from: '#ef4444', to: '#7c3aed', tilt: 5 },
  { id: 'lets-go', label: "Let's go", text: "LET'S", sub: 'GOOO', shape: 'bubble', from: '#22c55e', to: '#a3e635', tilt: -4 },
  { id: 'hype', label: 'Hype', text: 'HYPE', shape: 'burst', from: '#ec4899', to: '#f59e0b', tilt: -8 },
  { id: 'carry', label: 'Carry', text: 'CARRY', sub: 'ON MY BACK', shape: 'badge', from: '#3b82f6', to: '#8b5cf6' },
  { id: 'w', label: 'W', text: 'W', shape: 'hex', from: '#22c55e', to: '#14b8a6' },
  { id: 'l', label: 'L', text: 'L', shape: 'hex', from: '#64748b', to: '#ef4444' },
  { id: 'tilt', label: 'Tilted', text: 'TILTED', shape: 'bubble', from: '#f97316', to: '#ef4444', tilt: 12 },
  { id: 'rage-quit', label: 'Rage quit', text: 'RAGE', sub: 'QUIT', shape: 'shield', from: '#dc2626', to: '#450a0a', tilt: -5 },
  { id: 'afk', label: 'AFK', text: 'AFK', sub: 'BRB SNACKS', shape: 'badge', from: '#94a3b8', to: '#475569' },
  { id: 'brb', label: 'BRB', text: 'BRB', shape: 'bubble', from: '#06b6d4', to: '#3b82f6', tilt: 3 },
  { id: 'one-more', label: 'One more game', text: 'ONE', sub: 'MORE GAME', shape: 'ribbon', from: '#8b5cf6', to: '#ec4899' },
  { id: 'need-heals', label: 'Need heals', text: 'HEALS', sub: 'PLEASE', shape: 'shield', from: '#f43f5e', to: '#fb7185', tilt: -3 },
];

function shapePath(shape: Shape): string {
  switch (shape) {
    case 'burst': {
      const pts: string[] = [];
      for (let i = 0; i < 24; i++) {
        const r = i % 2 ? 78 : 96;
        const a = (Math.PI * 2 * i) / 24;
        pts.push(`${100 + r * Math.cos(a)},${100 + r * Math.sin(a)}`);
      }
      return `M${pts.join('L')}Z`;
    }
    case 'badge':
      return 'M100 8a92 92 0 1 1 0 184a92 92 0 1 1 0-184z';
    case 'shield':
      return 'M100 8L180 36v58c0 50-34 82-80 98c-46-16-80-48-80-98V36z';
    case 'bubble':
      return 'M30 30h140a20 20 0 0 1 20 20v80a20 20 0 0 1-20 20H86l-36 34v-34H30a20 20 0 0 1-20-20V50a20 20 0 0 1 20-20z';
    case 'ribbon':
      return 'M10 60h180l-18 40l18 40H10l18-40z';
    case 'hex':
      return 'M100 6l82 47v94l-82 47l-82-47V53z';
  }
}

function BuiltinSticker({ def, size }: { def: StickerDef; size: number }) {
  const gid = `st-${def.id}`;
  const big = def.text.length <= 2 ? 84 : def.text.length <= 4 ? 52 : def.text.length <= 5 ? 40 : 32;
  const textY = def.sub ? 104 : 118;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={`${def.label} sticker`} style={{ transform: `rotate(${def.tilt ?? 0}deg)` }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={def.from} />
          <stop offset="1" stopColor={def.to} />
        </linearGradient>
      </defs>
      <path d={shapePath(def.shape)} fill="#fff" stroke="#fff" strokeWidth="14" strokeLinejoin="round" />
      <path d={shapePath(def.shape)} fill={`url(#${gid})`} />
      <path d={shapePath(def.shape)} fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="3" strokeLinejoin="round" />
      <text
        x="100"
        y={textY}
        textAnchor="middle"
        fontFamily="'Space Grotesk', 'Outfit', sans-serif"
        fontWeight="800"
        fontSize={big}
        fill={def.ink ?? '#fff'}
        stroke="rgba(0,0,0,.35)"
        strokeWidth="6"
        paintOrder="stroke"
        letterSpacing="1"
      >
        {def.text}
      </text>
      {def.sub && (
        <text x="100" y="138" textAnchor="middle" fontFamily="'Space Grotesk', sans-serif" fontWeight="700" fontSize="17" fill="#fff" stroke="rgba(0,0,0,.35)" strokeWidth="4" paintOrder="stroke" letterSpacing="2">
          {def.sub}
        </text>
      )}
    </svg>
  );
}

export function Sticker({ sticker, size = 160 }: { sticker: StickerRef; size?: number }) {
  if (sticker.id.startsWith('nexus:')) {
    const def = STICKERS.find((s) => `nexus:${s.id}` === sticker.id);
    if (def) return <BuiltinSticker def={def} size={size} />;
  }
  if (sticker.url) return <img src={sticker.url} alt={sticker.name ?? 'sticker'} width={size} height={size} className="sticker-img" />;
  return <span className="muted">Sticker unavailable</span>;
}

export const stickerRef = (def: StickerDef): StickerRef => ({ id: `nexus:${def.id}`, name: def.label });
