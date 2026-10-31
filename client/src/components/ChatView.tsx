import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Pin, Search, Users, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAppearance } from '../lib/appearanceStore';
import { dayLabel, fromEvent, timeLabel } from '../lib/format';
import { renderMessage } from '../lib/markdown';
import { getSocket } from '../lib/socket';
import { useNexus } from '../lib/store';
import type { Attachment, Channel, Message, MessageEvent, User } from '../lib/types';
import { Composer } from './Composer';
import { MessageItem, type MessageCtx } from './MessageItem';
import { ProfileModal } from './ProfileModal';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

interface Props {
  channel: Channel;
  title: string;
  icon: ReactNode;
  topic?: string;
  lockedReason?: string;
  canModerate: boolean;
  canPin: boolean;
  members: User[];
  /** Right-hand panel (member list); hidden when the user turns it off. */
  aside?: ReactNode;
  /** Shown above the first message. */
  intro?: ReactNode;
  kind: 'dm' | 'channel';
  /** Scroll to and flash this message once loaded (from search or notifications). */
  focusMessageId?: number;
  /** Extra buttons for the header, before the panel toggles. */
  headerExtra?: ReactNode;
  /** Shown under the header, e.g. an ongoing call. */
  banner?: ReactNode;
}

export function ChatView({ channel, title, icon, topic, lockedReason, canModerate, canPin, members, aside, intro, kind, focusMessageId, headerExtra, banner }: Props) {
  const { me, friends, setActiveChannel, markRead } = useNexus();
  const { appearance, update, plugin } = useAppearance();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [panel, setPanel] = useState<'members' | 'pins' | 'search' | null>(appearance.showMemberList && aside ? 'members' : null);
  const [pins, setPins] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [profile, setProfile] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const blockedIds = useMemo(() => new Set(friends.blocked.map((u) => u.id)), [friends.blocked]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setReplyTo(null);
    setEditing(null);
    setTyping({});
    setError('');
    stick.current = true;
    api
      .get<{ messages: Message[]; hasMore: boolean }>(`/channels/${channel.id}/messages`)
      .then((r) => {
        if (cancelled) return;
        setMessages(r.messages);
        setHasMore(r.hasMore);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    setActiveChannel(channel.id);
    markRead(channel.id);
    return () => {
      cancelled = true;
      setActiveChannel(null);
    };
  }, [channel.id, setActiveChannel, markRead]);

  useEffect(() => {
    const socket = getSocket();
    const onNew = (e: MessageEvent) => {
      if (e.channelId !== channel.id) return;
      const msg = fromEvent(e, me.id);
      setMessages((list) => (list.some((m) => m.id === msg.id) ? list : [...list, msg]));
      setTyping(({ [e.author.id]: _done, ...rest }) => rest);
    };
    const onUpdate = (e: MessageEvent) => {
      if (e.channelId !== channel.id) return;
      const msg = fromEvent(e, me.id);
      setMessages((list) => list.map((m) => (m.id === msg.id ? msg : m)));
      setPins((list) => (msg.pinned ? [msg, ...list.filter((m) => m.id !== msg.id)] : list.filter((m) => m.id !== msg.id)));
    };
    const onDelete = (e: { id: number; channelId: string }) => {
      if (e.channelId !== channel.id) return;
      setMessages((list) =>
        list.filter((m) => m.id !== e.id).map((m) => (m.replyTo?.id === e.id ? { ...m, replyTo: { ...m.replyTo, content: null } } : m)),
      );
      setPins((list) => list.filter((m) => m.id !== e.id));
    };
    const onTyping = (e: { channelId: string; userId: string; displayName: string }) => {
      if (e.channelId !== channel.id || e.userId === me.id || !plugin('typing')) return;
      setTyping((t) => ({ ...t, [e.userId]: { name: e.displayName, until: Date.now() + 4000 } }));
    };
    socket.on('message:new', onNew);
    socket.on('message:update', onUpdate);
    socket.on('message:delete', onDelete);
    socket.on('typing', onTyping);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:update', onUpdate);
      socket.off('message:delete', onDelete);
      socket.off('typing', onTyping);
    };
  }, [channel.id, me.id, plugin]);

  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setTyping((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v.until > now)));
    }, 1000);
    return () => clearInterval(t);
  }, [typing]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Images load after layout; keep pinned to the bottom while they do.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = bottom;
    setAtBottom(bottom);
    if (el.scrollTop < 60 && hasMore && !loading) loadOlder();
  };

  const loadingOlder = useRef(false);
  async function loadOlder() {
    const el = listRef.current;
    const oldest = messages[0];
    if (!oldest || !el || loadingOlder.current) return;
    loadingOlder.current = true;
    const prevHeight = el.scrollHeight;
    try {
      const r = await api.get<{ messages: Message[]; hasMore: boolean }>(`/channels/${channel.id}/messages?before=${oldest.id}`);
      stick.current = false;
      setMessages((list) => [...r.messages, ...list]);
      setHasMore(r.hasMore);
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - prevHeight;
      });
    } finally {
      loadingOlder.current = false;
    }
  }

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const updateLocal = useCallback((msg: Message) => setMessages((list) => list.map((m) => (m.id === msg.id ? msg : m))), []);

  const saveEdit = () =>
    run(async () => {
      if (!editing) return;
      const r = await api.patch<{ message: Message }>(`/messages/${editing.id}`, { content: editing.text });
      updateLocal(r.message);
      setEditing(null);
    });

  const ctx = useMemo<MessageCtx>(
    () => ({
      myId: me.id,
      myUsername: me.username,
      canModerate,
      canPin,
      canReply: !lockedReason,
      plugins: appearance.plugins,
      onReply: setReplyTo,
      onEdit: (m) => setEditing({ id: m.id, text: m.content }),
      onDelete: (m) =>
        run(async () => {
          if (!window.confirm('Delete this message?')) return;
          await api.del(`/messages/${m.id}`);
          setMessages((list) => list.filter((x) => x.id !== m.id));
        }),
      onPin: (m) =>
        run(async () => {
          const r = await api.post<{ message: Message }>(`/messages/${m.id}/pin`, { pinned: !m.pinned });
          updateLocal(r.message);
        }),
      onReact: (m, emoji) =>
        run(async () => {
          const r = await api.post<{ message: Message }>(`/messages/${m.id}/reactions`, { emoji });
          updateLocal(r.message);
        }),
      onProfile: setProfile,
      onOpenMedia: setLightbox,
      onJump: (id) => {
        const el = listRef.current?.querySelector(`[data-id="${id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 1400);
        }
      },
    }),
    [me.id, me.username, canModerate, canPin, lockedReason, appearance.plugins, run, updateLocal],
  );

  useEffect(() => {
    if (loading || !focusMessageId) return;
    const t = window.setTimeout(() => {
      const el = listRef.current?.querySelector(`[data-id="${focusMessageId}"]`);
      if (!el) return;
      stick.current = false;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      window.setTimeout(() => el.classList.remove('flash'), 1600);
    }, 60);
    return () => window.clearTimeout(t);
  }, [loading, focusMessageId]);

  async function togglePanel(p: 'members' | 'pins' | 'search') {
    const next = panel === p ? null : p;
    setPanel(next);
    if (p === 'members') update({ showMemberList: next === 'members' });
    if (next === 'pins') {
      const r = await api.get<{ messages: Message[] }>(`/channels/${channel.id}/pins`);
      setPins(r.messages);
    }
  }

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((m) => m.content.toLowerCase().includes(q) || m.author.displayName.toLowerCase().includes(q)).reverse();
  }, [query, messages]);

  const style = appearance.messageStyle === 'auto' ? (kind === 'dm' ? 'bubbles' : 'flat') : appearance.messageStyle;
  const typingNames = Object.values(typing).map((t) => t.name);
  const hideBlocked = plugin('hideBlocked');
  const renderOpts = { markdown: plugin('markdown'), spoilers: plugin('spoilers'), streamer: plugin('streamerMode'), myUsername: me.username };

  return (
    <section className="chat">
      <header className="chat-head">
        <span className="chat-head-icon">{icon}</span>
        <div className="chat-head-text">
          <h1>{title}</h1>
          {topic && <span className="chat-topic">{topic}</span>}
        </div>
        <div className="chat-head-actions">
          {headerExtra}
          <button className={`icon-btn ${panel === 'search' ? 'on' : ''}`} onClick={() => togglePanel('search')} aria-label="Search this conversation" data-tip="Search">
            <Search size={18} />
          </button>
          <button className={`icon-btn ${panel === 'pins' ? 'on' : ''}`} onClick={() => togglePanel('pins')} aria-label="Pinned messages" data-tip="Pins">
            <Pin size={18} />
          </button>
          {aside && (
            <button className={`icon-btn ${panel === 'members' ? 'on' : ''}`} onClick={() => togglePanel('members')} aria-label="Members" data-tip="Members">
              <Users size={18} />
            </button>
          )}
        </div>
      </header>
      {banner}

      <div className="chat-body">
        <div className="chat-main">
          <div className="messages" ref={listRef} onScroll={onScroll} data-style={style}>
            {!loading && !hasMore && <div className="chat-intro">{intro}</div>}
            {hasMore && <div className="loading-older">Loading earlier messages…</div>}
            {loading && <MessageSkeleton />}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              const grouped = !newDay && !!prev && prev.author.id === m.author.id && !m.replyTo && m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
              const blocked = blockedIds.has(m.author.id) && !revealed.has(m.id);
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="day-divider">
                      <span>{dayLabel(m.createdAt)}</span>
                    </div>
                  )}
                  {blocked ? (
                    hideBlocked ? null : (
                      <div className="msg-blocked">
                        Message from someone you blocked.
                        <button className="link-btn" onClick={() => setRevealed((s) => new Set(s).add(m.id))}>Show</button>
                      </div>
                    )
                  ) : (
                    <MessageItem
                      m={m}
                      grouped={grouped}
                      editing={editing?.id === m.id}
                      ctx={ctx}
                      editor={
                        editing?.id === m.id ? (
                          <div className="msg-edit">
                            <textarea
                              autoFocus
                              value={editing.text}
                              maxLength={2000}
                              onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  saveEdit();
                                }
                                if (e.key === 'Escape') setEditing(null);
                              }}
                            />
                            <span className="muted small">
                              Enter to <button className="link-btn" onClick={saveEdit}>save</button> · Esc to{' '}
                              <button className="link-btn" onClick={() => setEditing(null)}>cancel</button>
                            </span>
                          </div>
                        ) : undefined
                      }
                    />
                  )}
                </Fragment>
              );
            })}
          </div>

          {!atBottom && (
            <button className="jump-latest" onClick={scrollToBottom}>
              <ArrowDown size={15} /> Jump to latest
            </button>
          )}

          <div className="composer-dock">
            <div className="typing-row">
              {typingNames.length > 0 && (
                <span className="typing-line">
                  <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
                  {typingNames.length === 1
                    ? `${typingNames[0]} is typing…`
                    : typingNames.length === 2
                      ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                      : 'Several people are typing…'}
                </span>
              )}
            </div>
            {error && <p className="form-error">{error}</p>}
            <Composer
              channelId={channel.id}
              placeholder={kind === 'dm' ? `Message ${title}` : channel.kind === 'thread' ? 'Reply to this post' : `Message #${title}`}
              lockedReason={lockedReason}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              members={members}
              onSent={(msg) => {
                stick.current = true;
                setMessages((list) => (list.some((m) => m.id === msg.id) ? list : [...list, msg]));
              }}
            />
          </div>
        </div>

        {panel === 'members' && aside}
        {panel === 'pins' && (
          <aside className="side-panel">
            <div className="side-panel-head">
              <h3>Pinned</h3>
              <button className="icon-btn sm" onClick={() => setPanel(null)} aria-label="Close"><X size={16} /></button>
            </div>
            {pins.length === 0 && <p className="muted small pad">Nothing pinned yet. {canPin ? 'Use the ⋯ menu on a message to pin it.' : ''}</p>}
            {pins.map((p) => (
              <button key={p.id} className="mini-msg" onClick={() => ctx.onJump(p.id)}>
                <span className="mini-msg-meta">
                  <strong style={{ color: p.author.accent }}>{p.author.displayName}</strong>
                  <time>{timeLabel(p.createdAt)}</time>
                </span>
                <span className="mini-msg-text">{p.content ? renderMessage(p.content, renderOpts) : p.sticker ? 'Sticker' : 'Attachment'}</span>
              </button>
            ))}
          </aside>
        )}
        {panel === 'search' && (
          <aside className="side-panel">
            <div className="side-panel-head">
              <h3>Search</h3>
              <button className="icon-btn sm" onClick={() => setPanel(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="search-field">
              <Search size={15} />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search loaded messages" />
            </div>
            {query && <p className="muted small pad">{searchResults.length} result{searchResults.length === 1 ? '' : 's'}</p>}
            {searchResults.map((m) => (
              <button key={m.id} className="mini-msg" onClick={() => ctx.onJump(m.id)}>
                <span className="mini-msg-meta">
                  <strong style={{ color: m.author.accent }}>{m.author.displayName}</strong>
                  <time>{timeLabel(m.createdAt)}</time>
                </span>
                <span className="mini-msg-text">{m.content}</span>
              </button>
            ))}
          </aside>
        )}
      </div>
      {profile && <ProfileModal username={profile} onClose={() => setProfile(null)} />}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label={lightbox.name}>
          <img src={lightbox.url} alt={lightbox.name} />
          <a className="lightbox-open" href={lightbox.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Open original
          </a>
        </div>
      )}
    </section>
  );
}

function MessageSkeleton() {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {[70, 45, 85, 30, 60].map((w, i) => (
        <div key={i} className="skeleton-msg">
          <span className="sk-avatar" />
          <span className="sk-lines">
            <span className="sk-line short" />
            <span className="sk-line" style={{ width: `${w}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
