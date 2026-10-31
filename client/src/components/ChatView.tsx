import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { fromEvent, timeLabel } from '../lib/format';
import { getSocket } from '../lib/socket';
import { useNexus } from '../lib/store';
import type { Channel, Message, MessageEvent } from '../lib/types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ProfileModal } from './ProfileModal';

const QUICK_REACTIONS = ['👍', '🔥', '😂', '💀', '🎯', 'GG'];
const REACTION_EMOJI: Record<string, string> = { GG: ':gg:' };
const GROUP_WINDOW_MS = 5 * 60 * 1000;

interface Props {
  channel: Channel;
  title: string;
  icon: ReactNode;
  topic?: string;
  /** Why posting is disabled, if it is. */
  readOnlyReason?: string;
  canModerate: boolean;
  canPin: boolean;
  aside?: ReactNode;
}

/** Render message text with @mentions and links highlighted. */
function renderContent(text: string, myUsername: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<]+|@[a-zA-Z0-9_.]{3,24})/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow">
          {part}
        </a>
      );
    }
    if (part.startsWith('@') && part.length > 3) {
      const self = part.slice(1).toLowerCase() === myUsername.toLowerCase();
      return (
        <span key={i} className={`mention ${self ? 'mention-me' : ''}`}>
          {part}
        </span>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const reactionLabel = (emoji: string) => (emoji === ':gg:' ? 'GG' : emoji);

export function ChatView({ channel, title, icon, topic, readOnlyReason, canModerate, canPin, aside }: Props) {
  const { me, friends, setActiveChannel, markRead } = useNexus();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [showPins, setShowPins] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [profile, setProfile] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastTypingSent = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const blockedIds = useMemo(() => new Set(friends.blocked.map((u) => u.id)), [friends.blocked]);

  // Load history whenever the channel changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setReplyTo(null);
    setEditing(null);
    setTyping({});
    setShowPins(false);
    setError('');
    stickToBottom.current = true;
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
    inputRef.current?.focus();
    return () => {
      cancelled = true;
      setActiveChannel(null);
    };
  }, [channel.id, setActiveChannel, markRead]);

  // Live updates for this channel.
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
        list
          .filter((m) => m.id !== e.id)
          .map((m) => (m.replyTo?.id === e.id ? { ...m, replyTo: { ...m.replyTo, content: null } } : m)),
      );
      setPins((list) => list.filter((m) => m.id !== e.id));
    };
    const onTyping = (e: { channelId: string; userId: string; displayName: string }) => {
      if (e.channelId !== channel.id || e.userId === me.id) return;
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
  }, [channel.id, me.id]);

  // Expire typing indicators.
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.until > now)));
    }, 1000);
    return () => clearInterval(timer);
  }, [typing]);

  // Keep the view pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function loadOlder() {
    const el = listRef.current;
    const oldest = messages[0];
    if (!oldest || !el) return;
    const prevHeight = el.scrollHeight;
    const r = await api.get<{ messages: Message[]; hasMore: boolean }>(`/channels/${channel.id}/messages?before=${oldest.id}`);
    stickToBottom.current = false;
    setMessages((list) => [...r.messages, ...list]);
    setHasMore(r.hasMore);
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - prevHeight;
    });
  }

  async function send() {
    const content = draft.trim();
    if (!content) return;
    setError('');
    try {
      const r = await api.post<{ message: Message }>(`/channels/${channel.id}/messages`, {
        content,
        replyToId: replyTo?.id ?? null,
      });
      stickToBottom.current = true;
      setMessages((list) => (list.some((m) => m.id === r.message.id) ? list : [...list, r.message]));
      setDraft('');
      setReplyTo(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    const now = Date.now();
    if (value && now - lastTypingSent.current > 2500) {
      lastTypingSent.current = now;
      getSocket().emit('typing', { channelId: channel.id });
    }
  }

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const updateLocal = (msg: Message) => setMessages((list) => list.map((m) => (m.id === msg.id ? msg : m)));

  const react = (m: Message, emoji: string) =>
    run(async () => {
      setPickerFor(null);
      const r = await api.post<{ message: Message }>(`/messages/${m.id}/reactions`, { emoji });
      updateLocal(r.message);
    });

  const saveEdit = () =>
    run(async () => {
      if (!editing || !editing.text.trim()) return;
      const r = await api.patch<{ message: Message }>(`/messages/${editing.id}`, { content: editing.text });
      updateLocal(r.message);
      setEditing(null);
    });

  const remove = (m: Message) =>
    run(async () => {
      if (!window.confirm('Delete this message?')) return;
      await api.del(`/messages/${m.id}`);
      setMessages((list) => list.filter((x) => x.id !== m.id));
    });

  const togglePin = (m: Message) =>
    run(async () => {
      const r = await api.post<{ message: Message }>(`/messages/${m.id}/pin`, { pinned: !m.pinned });
      updateLocal(r.message);
    });

  async function openPins() {
    setShowPins((v) => !v);
    const r = await api.get<{ messages: Message[] }>(`/channels/${channel.id}/pins`);
    setPins(r.messages);
  }

  const typingNames = Object.values(typing).map((t) => t.name);
  const mentionsMe = (m: Message) => new RegExp(`@${me.username.replace(/\./g, '\\.')}\\b`, 'i').test(m.content);

  return (
    <section className="chat">
      <header className="chat-head">
        <span className="chat-head-icon">{icon}</span>
        <h1>{title}</h1>
        {topic && <span className="chat-topic">{topic}</span>}
        <div className="chat-head-actions">
          <button className={`icon-btn ${showPins ? 'active' : ''}`} onClick={openPins} title="Pinned messages" aria-label="Pinned messages">
            <Icon name="pin" />
          </button>
        </div>
      </header>

      <div className="chat-body">
        <div className="chat-main">
          <div className="message-list" ref={listRef} onScroll={onScroll}>
            {hasMore && (
              <button className="btn btn-ghost load-older" onClick={loadOlder}>
                Load older messages
              </button>
            )}
            {!loading && !hasMore && (
              <div className="channel-start">
                <span className="channel-start-icon">{icon}</span>
                <h2>Welcome to {title}</h2>
                <p className="muted">This is the very beginning of the conversation.</p>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const grouped =
                !!prev && prev.author.id === m.author.id && !m.replyTo && m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
              const own = m.author.id === me.id;
              const hidden = blockedIds.has(m.author.id) && !revealed.has(m.id);
              if (hidden) {
                return (
                  <div key={m.id} className="message message-blocked">
                    <span className="muted">Message from a blocked user.</span>
                    <button className="link-btn" onClick={() => setRevealed((s) => new Set(s).add(m.id))}>Show</button>
                  </div>
                );
              }
              return (
                <div key={m.id} className={`message ${grouped ? 'grouped' : ''} ${mentionsMe(m) ? 'message-mention' : ''}`}>
                  {m.replyTo && (
                    <div className="reply-ref">
                      <Icon name="reply" size={14} />
                      <strong>{m.replyTo.author.displayName}</strong>
                      <span>{m.replyTo.content ?? <em>Original message was deleted</em>}</span>
                    </div>
                  )}
                  <div className="message-row">
                    <div className="message-gutter">
                      {grouped ? (
                        <time className="hover-time">{new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                      ) : (
                        <button className="avatar-btn" onClick={() => setProfile(m.author.username)}>
                          <Avatar user={m.author} size={40} showPresence={false} />
                        </button>
                      )}
                    </div>
                    <div className="message-content">
                      {!grouped && (
                        <div className="message-meta">
                          <button className="author" style={{ color: m.author.accent }} onClick={() => setProfile(m.author.username)}>
                            {m.author.displayName}
                          </button>
                          <time>{timeLabel(m.createdAt)}</time>
                          {m.pinned && <span className="pinned-flag"><Icon name="pin" size={12} /> pinned</span>}
                        </div>
                      )}
                      {editing?.id === m.id ? (
                        <div className="edit-box">
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
                          <span className="muted small">Enter to save · Esc to cancel</span>
                        </div>
                      ) : (
                        <p className="message-text">
                          {renderContent(m.content, me.username)}
                          {m.editedAt && <span className="edited"> (edited)</span>}
                        </p>
                      )}
                      {m.reactions.length > 0 && (
                        <div className="reactions">
                          {m.reactions.map((r) => (
                            <button key={r.emoji} className={`reaction ${r.me ? 'mine' : ''}`} onClick={() => react(m, r.emoji)}>
                              <span>{reactionLabel(r.emoji)}</span> {r.count}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="message-tools">
                      <button className="icon-btn" title="React" aria-label="React" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}>
                        <Icon name="smile" size={18} />
                      </button>
                      {!readOnlyReason && (
                        <button className="icon-btn" title="Reply" aria-label="Reply" onClick={() => { setReplyTo(m); inputRef.current?.focus(); }}>
                          <Icon name="reply" size={18} />
                        </button>
                      )}
                      {canPin && (
                        <button className="icon-btn" title={m.pinned ? 'Unpin' : 'Pin'} aria-label={m.pinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(m)}>
                          <Icon name="pin" size={18} />
                        </button>
                      )}
                      {own && (
                        <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setEditing({ id: m.id, text: m.content })}>
                          <Icon name="edit" size={18} />
                        </button>
                      )}
                      {(own || canModerate) && (
                        <button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => remove(m)}>
                          <Icon name="trash" size={18} />
                        </button>
                      )}
                      {pickerFor === m.id && (
                        <div className="reaction-picker">
                          {QUICK_REACTIONS.map((e) => (
                            <button key={e} onClick={() => react(m, REACTION_EMOJI[e] ?? e)}>
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="composer-wrap">
            <div className="typing">{typingNames.length > 0 && <TypingLine names={typingNames} />}</div>
            {error && <p className="form-error composer-error">{error}</p>}
            {readOnlyReason ? (
              <div className="composer composer-locked">
                <Icon name="shield" size={18} /> {readOnlyReason}
              </div>
            ) : (
              <div className="composer">
                {replyTo && (
                  <div className="replying">
                    Replying to <strong>{replyTo.author.displayName}</strong>
                    <button className="icon-btn" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                )}
                <div className="composer-row">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={draft}
                    maxLength={2000}
                    placeholder={`Message ${title}`}
                    onChange={(e) => onDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                      if (e.key === 'Escape') setReplyTo(null);
                    }}
                  />
                  <button className="icon-btn send" onClick={send} disabled={!draft.trim()} aria-label="Send">
                    <Icon name="send" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {showPins ? (
          <aside className="side-panel">
            <h3 className="panel-title">Pinned messages</h3>
            {pins.length === 0 && <p className="muted small">Nothing pinned yet.</p>}
            {pins.map((p) => (
              <div key={p.id} className="pin-card">
                <div className="message-meta">
                  <strong style={{ color: p.author.accent }}>{p.author.displayName}</strong>
                  <time>{timeLabel(p.createdAt)}</time>
                </div>
                <p>{renderContent(p.content, me.username)}</p>
              </div>
            ))}
          </aside>
        ) : (
          aside
        )}
      </div>
      {profile && <ProfileModal username={profile} onClose={() => setProfile(null)} />}
    </section>
  );
}

function TypingLine({ names }: { names: string[] }) {
  const text =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : 'Several people are typing';
  return (
    <span className="typing-line">
      <span className="dots" aria-hidden="true"><i /><i /><i /></span>
      {text}…
    </span>
  );
}
