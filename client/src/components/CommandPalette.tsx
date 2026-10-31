import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Megaphone, MessageCircle, Palette, Search, Sparkles, User } from 'lucide-react';
import { api } from '../lib/api';
import { PRESETS, applyPreset } from '../lib/appearance';
import { useAppearance } from '../lib/appearanceStore';
import { conversationTitle } from '../lib/format';
import { useNexus } from '../lib/store';
import type { Conversation } from '../lib/types';
import { Avatar, CommunityBadge } from './Avatar';

interface Item {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  run: () => void;
}

/** Ctrl+K quick switcher for conversations, channels, pages and actions. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { conversations, communities, communityDetails, friends, upsertConversation } = useNexus();
  const { update, plugin, setPlugin } = useAppearance();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);

  const go = (path: string) => () => {
    navigate(path);
    onClose();
  };

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    for (const c of conversations) {
      list.push({
        id: `dm-${c.id}`,
        label: conversationTitle(c),
        hint: c.kind === 'group' ? 'Group chat' : 'Direct message',
        icon: c.others[0] ? <Avatar user={c.others[0]} size={22} showPresence={false} /> : <MessageCircle size={18} />,
        run: go(`/messages/${c.id}`),
      });
    }
    for (const f of friends.friends) {
      if (conversations.some((c) => c.kind === 'dm' && c.others[0]?.id === f.id)) continue;
      list.push({
        id: `friend-${f.id}`,
        label: f.displayName,
        hint: `Message @${f.username}`,
        icon: <Avatar user={f} size={22} showPresence={false} />,
        run: async () => {
          const r = await api.post<{ conversation: Conversation }>('/dms', { userIds: [f.id] });
          upsertConversation(r.conversation);
          navigate(`/messages/${r.conversation.id}`);
          onClose();
        },
      });
    }
    for (const c of communities) {
      list.push({ id: `c-${c.id}`, label: c.name, hint: 'Community', icon: <CommunityBadge name={c.name} accent={c.accent} size={22} />, run: go(`/communities/${c.id}`) });
      for (const ch of communityDetails[c.id]?.channels ?? []) {
        list.push({
          id: `ch-${ch.id}`,
          label: ch.name,
          hint: c.name,
          icon: ch.kind === 'announcement' ? <Megaphone size={18} /> : <Hash size={18} />,
          run: go(`/communities/${c.id}/${ch.id}`),
        });
      }
    }
    list.push(
      { id: 'p-home', label: 'Home', hint: 'Page', icon: <Sparkles size={18} />, run: go('/') },
      { id: 'p-discover', label: 'Discover communities', hint: 'Page', icon: <Search size={18} />, run: go('/discover') },
      { id: 'p-friends', label: 'Friends', hint: 'Page', icon: <User size={18} />, run: go('/messages') },
      { id: 'p-studio', label: 'Customisation studio', hint: 'Themes, layout, plugins, CSS', icon: <Palette size={18} />, run: go('/studio') },
      { id: 'p-gallery', label: 'Theme gallery', hint: 'Browse themes from the community', icon: <Palette size={18} />, run: go('/studio/gallery') },
      {
        id: 'a-focus',
        label: plugin('focusMode') ? 'Leave focus mode' : 'Enter focus mode',
        hint: 'Ctrl Shift F',
        icon: <Sparkles size={18} />,
        run: () => {
          setPlugin('focusMode', !plugin('focusMode'));
          onClose();
        },
      },
    );
    for (const p of PRESETS) {
      list.push({
        id: `t-${p.id}`,
        label: `Theme: ${p.name}`,
        hint: p.tagline,
        icon: <span className="swatch-dot" style={{ background: `linear-gradient(135deg, ${p.colors.accent}, ${p.colors.accent2})` }} />,
        run: () => {
          update((a) => applyPreset(a, p));
          onClose();
        },
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, friends.friends, communities, communityDetails, plugin]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items.slice(0, 40);
    return items
      .map((it) => {
        const label = it.label.toLowerCase();
        const score = label.startsWith(needle) ? 0 : label.includes(needle) ? 1 : it.hint.toLowerCase().includes(needle) ? 2 : -1;
        return { it, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((x) => x.it);
  }, [q, items]);

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette glass" role="dialog" aria-label="Quick switcher">
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            placeholder="Jump to a conversation, channel, page or theme…"
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === 'Enter') filtered[index]?.run();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" role="listbox">
          {filtered.map((it, i) => (
            <button key={it.id} role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onMouseEnter={() => setIndex(i)} onClick={it.run}>
              <span className="palette-icon">{it.icon}</span>
              <span className="palette-label">{it.label}</span>
              <span className="palette-hint">{it.hint}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="muted pad">Nothing matches “{q}”.</p>}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
