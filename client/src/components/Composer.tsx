import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { FileText, Lock, Paperclip, Reply, SendHorizontal, Smile, Sticker as StickerIcon, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAppearance } from '../lib/appearanceStore';
import { searchShortcodes } from '../lib/emoji';
import { getSocket } from '../lib/socket';
import type { Attachment, Message, StickerRef, User } from '../lib/types';
import { MediaPicker, imageSize, type GifResult, type PickerTab } from './MediaPicker';
import { Avatar } from './Avatar';
import { burstConfetti } from '../lib/confetti';

interface Pending {
  key: string;
  file: File;
  preview: string | null;
  status: 'uploading' | 'ready' | 'error';
  uploadId?: string;
  attachment?: Attachment;
  error?: string;
}

interface Props {
  channelId: string;
  placeholder: string;
  lockedReason?: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  members: User[];
  onSent: (m: Message) => void;
}

type Suggestion = { kind: 'emoji'; slug: string; emoji: string } | { kind: 'user'; user: User };

export function Composer({ channelId, placeholder, lockedReason, replyTo, onCancelReply, members, onSent }: Props) {
  const { plugin } = useAppearance();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [picker, setPicker] = useState<PickerTab | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sugIndex, setSugIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  // Keep a draft per channel while you hop around.
  useEffect(() => {
    const draft = sessionStorage.getItem(`draft:${channelId}`) ?? '';
    setText(draft);
    setPending([]);
    setPicker(null);
    inputRef.current?.focus();
  }, [channelId]);
  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`draft:${channelId}`, text);
      else sessionStorage.removeItem(`draft:${channelId}`);
    } catch {
      // ignore
    }
  }, [text, channelId]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const addFiles = useCallback((files: FileList | File[]) => {
    setError('');
    for (const file of Array.from(files).slice(0, 10)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const preview = file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null;
      setPending((p) => [...p, { key, file, preview, status: 'uploading' }]);
      imageSize(file)
        .then((dims) => api.upload(file, dims))
        .then((r) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: 'ready', uploadId: r.id, attachment: r.attachment } : x))))
        .catch((e) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: 'error', error: e.message } : x))));
    }
  }, []);

  async function post(body: Record<string, unknown>) {
    setError('');
    setSending(true);
    try {
      const r = await api.post<{ message: Message }>(`/channels/${channelId}/messages`, { ...body, replyToId: replyTo?.id ?? null });
      onSent(r.message);
      onCancelReply();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function send() {
    const content = text.trim();
    const ready = pending.filter((p) => p.status === 'ready');
    if (pending.some((p) => p.status === 'uploading')) {
      setError('Hang on, still uploading…');
      return;
    }
    if (!content && ready.length === 0) return;
    const ok = await post({ content, attachments: ready.map((p) => ({ uploadId: p.uploadId })) });
    if (ok) {
      if (plugin('confetti') && /\bgg\b/i.test(content)) burstConfetti();
      setText('');
      pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      setPending([]);
    }
  }

  const sendGif = async (g: GifResult) => {
    setPicker(null);
    await post({ attachments: [{ gifUrl: g.url, width: g.width, height: g.height }] });
  };
  const sendSticker = async (s: StickerRef) => {
    setPicker(null);
    await post({ sticker: { id: s.id } });
  };

  function insert(str: string) {
    const el = inputRef.current;
    if (!el) return setText((t) => t + str);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + str + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + str.length;
    });
  }

  // Autocomplete for :emoji and @mentions based on the word before the cursor.
  function updateSuggestions(value: string, cursor: number) {
    if (!plugin('emojiAutocomplete')) return setSuggestions([]);
    const before = value.slice(0, cursor);
    const emoji = /(?:^|\s):([a-z0-9_+-]{2,30})$/i.exec(before);
    const mention = /(?:^|\s)@([a-z0-9_.]{0,24})$/i.exec(before);
    if (emoji) {
      setSuggestions(searchShortcodes(emoji[1]).map((e) => ({ kind: 'emoji', ...e })));
    } else if (mention) {
      const q = mention[1].toLowerCase();
      setSuggestions(
        members
          .filter((u) => u.username.toLowerCase().startsWith(q) || u.displayName.toLowerCase().startsWith(q))
          .slice(0, 8)
          .map((user) => ({ kind: 'user', user })),
      );
    } else setSuggestions([]);
    setSugIndex(0);
  }

  function applySuggestion(s: Suggestion) {
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const replaced = s.kind === 'emoji' ? before.replace(/:([a-z0-9_+-]{2,30})$/i, s.emoji) : before.replace(/@([a-z0-9_.]{0,24})$/i, `@${s.user.username} `);
    const next = replaced + text.slice(cursor);
    setText(next);
    setSuggestions([]);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) el.selectionStart = el.selectionEnd = replaced.length;
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSugIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[sugIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setSuggestions([]);
        return;
      }
    }
    const ctrlMode = plugin('sendOnCtrlEnter');
    if (e.key === 'Enter' && (ctrlMode ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
      e.preventDefault();
      send();
    }
    if (e.key === 'Escape' && replyTo) onCancelReply();
  }

  function onChange(value: string, cursor: number) {
    setText(value);
    updateSuggestions(value, cursor);
    const now = Date.now();
    if (value && plugin('typing') && now - lastTyping.current > 2500) {
      lastTyping.current = now;
      getSocket().emit('typing', { channelId });
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  if (lockedReason) {
    return (
      <div className="composer composer-locked">
        <Lock size={16} /> {lockedReason}
      </div>
    );
  }

  return (
    <div
      className={`composer ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {picker && (
        <MediaPicker
          tab={picker}
          onTab={setPicker}
          onEmoji={(e) => insert(e)}
          onGif={sendGif}
          onSticker={sendSticker}
          onClose={() => setPicker(null)}
        />
      )}
      {suggestions.length > 0 && (
        <div className="suggest" role="listbox">
          {suggestions.map((s, i) => (
            <button
              key={s.kind === 'emoji' ? s.slug : s.user.id}
              role="option"
              aria-selected={i === sugIndex}
              className={i === sugIndex ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(s);
              }}
            >
              {s.kind === 'emoji' ? (
                <>
                  <span className="suggest-emoji">{s.emoji}</span> :{s.slug}:
                </>
              ) : (
                <>
                  <Avatar user={s.user} size={22} showPresence={false} /> {s.user.displayName} <span className="muted">@{s.user.username}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="composer-reply">
          <Reply size={14} /> Replying to <strong>{replyTo.author.displayName}</strong>
          <button className="icon-btn sm" onClick={onCancelReply} aria-label="Cancel reply">
            <X size={14} />
          </button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="tray">
          {pending.map((p) => (
            <div key={p.key} className={`tray-item ${p.status}`}>
              {p.preview && p.file.type.startsWith('image/') ? (
                <img src={p.preview} alt="" />
              ) : p.preview ? (
                <video src={p.preview} muted />
              ) : (
                <span className="tray-file"><FileText size={22} /><span>{p.file.name}</span></span>
              )}
              {p.status === 'uploading' && <span className="tray-status">Uploading…</span>}
              {p.status === 'error' && <span className="tray-status err">{p.error}</span>}
              <button
                className="tray-remove"
                onClick={() => setPending((list) => list.filter((x) => x.key !== p.key))}
                aria-label={`Remove ${p.file.name}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="composer-error">{error}</p>}
      <div className="composer-row">
        <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach files" data-tip="Attach">
          <Paperclip size={19} />
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={2000}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setTimeout(() => setSuggestions([]), 100)}
          aria-label={placeholder}
        />
        <div className="composer-tools">
          <button className={`icon-btn gif-btn ${picker === 'gif' ? 'on' : ''}`} onClick={() => setPicker(picker === 'gif' ? null : 'gif')} aria-label="GIFs" data-tip="GIFs">
            GIF
          </button>
          <button className={`icon-btn ${picker === 'sticker' ? 'on' : ''}`} onClick={() => setPicker(picker === 'sticker' ? null : 'sticker')} aria-label="Stickers" data-tip="Stickers">
            <StickerIcon size={19} />
          </button>
          <button className={`icon-btn ${picker === 'emoji' ? 'on' : ''}`} onClick={() => setPicker(picker === 'emoji' ? null : 'emoji')} aria-label="Emoji" data-tip="Emoji">
            <Smile size={19} />
          </button>
          <button
            className="send-btn"
            onClick={send}
            disabled={sending || (!text.trim() && !pending.some((p) => p.status === 'ready'))}
            aria-label="Send"
          >
            <SendHorizontal size={18} />
          </button>
        </div>
      </div>
      {dragging && <div className="drop-hint">Drop to attach</div>}
    </div>
  );
}
