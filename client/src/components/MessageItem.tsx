import { memo, useState } from 'react';
import { Copy, Download, Flag, Heart, MoreHorizontal, Pencil, Pin, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { clock, fileSize, timeLabel } from '../lib/format';
import { isEmojiOnly, renderMessage } from '../lib/markdown';
import { recentEmoji } from '../lib/emoji';
import { Sticker } from '../lib/stickers';
import type { Attachment, Message } from '../lib/types';
import { Avatar } from './Avatar';
import { MediaPicker } from './MediaPicker';

export interface MessageCtx {
  myId: string;
  myUsername: string;
  canModerate: boolean;
  canPin: boolean;
  canReply: boolean;
  plugins: Record<string, boolean>;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onPin: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onProfile: (username: string) => void;
  onOpenMedia: (a: Attachment) => void;
  onJump: (id: number) => void;
}

interface Props {
  m: Message;
  grouped: boolean;
  editing: boolean;
  ctx: MessageCtx;
  editor?: React.ReactNode;
}

const reactionLabel = (emoji: string) => (emoji === ':gg:' ? 'GG' : emoji);

function MessageItemInner({ m, grouped, editing, ctx, editor }: Props) {
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [savedGif, setSavedGif] = useState<Set<string>>(new Set());
  const own = m.author.id === ctx.myId;
  const p = ctx.plugins;
  const timeOpts = { clock24: p.clock24, relative: p.relativeTime };
  const mentionsMe = new RegExp(`@${ctx.myUsername.replace(/\./g, '\\.')}\\b`, 'i').test(m.content);
  const jumbo = p.bigEmoji && m.attachments.length === 0 && isEmojiOnly(m.content);
  const quick = [...new Set([...recentEmoji(), '🔥', '😂', '💀', '👍'])].slice(0, 3);

  async function saveGif(a: Attachment) {
    await api.post('/gifs/favorites', { url: a.url, preview: a.url, width: a.width, height: a.height });
    setSavedGif((s) => new Set(s).add(a.url));
  }

  async function report() {
    const reason = window.prompt('Why are you reporting this message?');
    if (reason && reason.trim().length >= 3) await api.post('/reports', { targetType: 'message', targetId: String(m.id), reason });
  }

  return (
    <div className={`msg ${own ? 'own' : ''} ${grouped ? 'grouped' : ''} ${mentionsMe ? 'mentioned' : ''}`} data-id={m.id}>
      {m.replyTo && (
        <button className="msg-replyref" onClick={() => ctx.onJump(m.replyTo!.id)}>
          <Reply size={13} />
          <Avatar user={m.replyTo.author} size={16} showPresence={false} />
          <strong>{m.replyTo.author.displayName}</strong>
          <span>{m.replyTo.content ?? <em>Original message was deleted</em>}</span>
        </button>
      )}
      <div className="msg-row">
        <div className="msg-gutter">
          {grouped ? (
            <time className="msg-hover-time">{clock(m.createdAt, timeOpts)}</time>
          ) : (
            <button className="msg-avatar" onClick={() => ctx.onProfile(m.author.username)} aria-label={`${m.author.displayName}'s profile`}>
              <Avatar user={m.author} size={40} showPresence={false} />
            </button>
          )}
        </div>
        <div className="msg-main">
          {!grouped && (
            <div className="msg-meta">
              <button
                className={`msg-author ${own && p.rainbowName ? 'prismatic' : ''}`}
                style={{ color: m.author.accent }}
                onClick={() => ctx.onProfile(m.author.username)}
              >
                {m.author.displayName}
              </button>
              <time title={new Date(m.createdAt).toLocaleString()}>{timeLabel(m.createdAt, timeOpts)}</time>
              {m.pinned && (
                <span className="msg-pinned">
                  <Pin size={11} /> pinned
                </span>
              )}
            </div>
          )}
          {editing ? (
            editor
          ) : (
            <div className="msg-body">
              {m.content && (
                <div className={`msg-text ${jumbo ? 'jumbo' : ''}`}>
                  {renderMessage(m.content, { markdown: p.markdown, spoilers: p.spoilers, streamer: p.streamerMode, myUsername: ctx.myUsername })}
                  {m.editedAt && <span className="msg-edited"> (edited)</span>}
                </div>
              )}
              {m.sticker && (
                <div className="msg-sticker">
                  <Sticker sticker={m.sticker} size={150} />
                </div>
              )}
              {m.attachments.length > 0 && (
                <div className={`msg-media count-${Math.min(m.attachments.length, 4)}`}>
                  {m.attachments.map((a, i) => (
                    <AttachmentView key={i} a={a} onOpen={() => ctx.onOpenMedia(a)} onSave={a.kind === 'gif' ? () => saveGif(a) : undefined} saved={savedGif.has(a.url)} />
                  ))}
                </div>
              )}
            </div>
          )}
          {m.reactions.length > 0 && (
            <div className="msg-reactions">
              {m.reactions.map((r) => (
                <button key={r.emoji} className={`reaction ${r.me ? 'mine' : ''}`} onClick={() => ctx.onReact(m, r.emoji)}>
                  <span className="reaction-glyph">{reactionLabel(r.emoji)}</span>
                  <span className="reaction-count">{r.count}</span>
                </button>
              ))}
              <button className="reaction add" onClick={() => setPicker(true)} aria-label="Add reaction">
                <SmilePlus size={14} />
              </button>
            </div>
          )}
        </div>
        <div className={`msg-tools ${picker || menu ? 'open' : ''}`}>
          {quick.map((e) => (
            <button key={e} className="tool quick" onClick={() => ctx.onReact(m, e)} aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
          <button className="tool" onClick={() => setPicker((v) => !v)} aria-label="Add reaction" data-tip="React">
            <SmilePlus size={17} />
          </button>
          {ctx.canReply && (
            <button className="tool" onClick={() => ctx.onReply(m)} aria-label="Reply" data-tip="Reply">
              <Reply size={17} />
            </button>
          )}
          {own && (
            <button className="tool" onClick={() => ctx.onEdit(m)} aria-label="Edit" data-tip="Edit">
              <Pencil size={16} />
            </button>
          )}
          <button className="tool" onClick={() => setMenu((v) => !v)} aria-label="More" data-tip="More">
            <MoreHorizontal size={17} />
          </button>
          {picker && (
            <div className="msg-picker">
              <MediaPicker
                emojiOnly
                tab="emoji"
                onTab={() => {}}
                onEmoji={(e) => {
                  ctx.onReact(m, e);
                  setPicker(false);
                }}
                onClose={() => setPicker(false)}
              />
            </div>
          )}
          {menu && (
            <div className="msg-menu glass" onMouseLeave={() => setMenu(false)}>
              {m.content && (
                <button onClick={() => { navigator.clipboard?.writeText(m.content); setMenu(false); }}>
                  <Copy size={15} /> Copy text
                </button>
              )}
              {ctx.canPin && (
                <button onClick={() => { ctx.onPin(m); setMenu(false); }}>
                  <Pin size={15} /> {m.pinned ? 'Unpin' : 'Pin message'}
                </button>
              )}
              {!own && (
                <button onClick={() => { setMenu(false); report(); }}>
                  <Flag size={15} /> Report
                </button>
              )}
              {(own || ctx.canModerate) && (
                <button className="danger" onClick={() => { ctx.onDelete(m); setMenu(false); }}>
                  <Trash2 size={15} /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemInner);

function AttachmentView({ a, onOpen, onSave, saved }: { a: Attachment; onOpen: () => void; onSave?: () => void; saved: boolean }) {
  const ratio = a.width && a.height ? `${a.width} / ${a.height}` : undefined;
  if (a.kind === 'image' || a.kind === 'gif') {
    return (
      <figure className={`media media-${a.kind}`} style={{ aspectRatio: ratio }}>
        <button className="media-open" onClick={onOpen} aria-label={`Open ${a.name}`}>
          <img src={a.url} alt={a.name} loading="lazy" />
        </button>
        {a.kind === 'gif' && <span className="media-badge">GIF</span>}
        {onSave && (
          <button className={`media-save ${saved ? 'on' : ''}`} onClick={onSave} aria-label="Save GIF" disabled={saved}>
            <Heart size={14} />
          </button>
        )}
      </figure>
    );
  }
  if (a.kind === 'video') {
    return (
      <figure className="media media-video" style={{ aspectRatio: ratio ?? '16 / 9' }}>
        <video src={a.url} controls preload="metadata" />
      </figure>
    );
  }
  return (
    <a className="file-card" href={a.url} download={a.name}>
      <span className="file-icon">{a.name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'}</span>
      <span className="file-meta">
        <strong>{a.name}</strong>
        <span>{fileSize(a.size)}</span>
      </span>
      <Download size={18} />
    </a>
  );
}
