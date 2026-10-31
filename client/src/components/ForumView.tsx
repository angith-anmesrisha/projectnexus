import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, MessageCircle, MessagesSquare, PenSquare, Search, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { relative } from '../lib/format';
import { getSocket } from '../lib/socket';
import { useNexus } from '../lib/store';
import { can, type Channel, type Community, type Thread } from '../lib/types';
import { Avatar } from './Avatar';
import { ChatView } from './ChatView';
import { Modal } from './Modal';
import { imageSize } from './MediaPicker';

type Sort = 'active' | 'new';

/** A forum channel: a board of posts, each with its own reply thread. */
export function ForumView({ community, forum, aside }: { community: Community; forum: Channel; aside: ReactNode }) {
  const { me } = useNexus();
  const [params, setParams] = useSearchParams();
  const postId = params.get('post');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [sort, setSort] = useState<Sort>('active');
  const [filter, setFilter] = useState('');
  const [composing, setComposing] = useState(false);
  const [openThread, setOpenThread] = useState<Thread | null>(null);

  const load = useCallback(() => {
    api.get<{ threads: Thread[] }>(`/channels/${forum.id}/threads`).then((r) => setThreads(r.threads)).catch(() => setThreads([]));
  }, [forum.id]);

  useEffect(() => {
    setThreads(null);
    load();
    const socket = getSocket();
    const onUpdate = (p: { forumId: string }) => p.forumId === forum.id && load();
    socket.on('thread:update', onUpdate);
    return () => {
      socket.off('thread:update', onUpdate);
    };
  }, [forum.id, load]);

  // Resolve the open post from the list, or fetch it directly (deep links).
  useEffect(() => {
    if (!postId) return setOpenThread(null);
    const found = threads?.find((t) => t.id === postId);
    if (found) return setOpenThread(found);
    api.get<{ thread: Thread }>(`/threads/${postId}`).then((r) => setOpenThread(r.thread)).catch(() => setParams({}, { replace: true }));
  }, [postId, threads, setParams]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = (threads ?? []).filter((t) => !needle || t.title.toLowerCase().includes(needle) || t.preview.toLowerCase().includes(needle));
    return sort === 'new' ? [...list].sort((a, b) => b.createdAt - a.createdAt) : list;
  }, [threads, filter, sort]);

  const canModerate = can(community, 'manageMessages');

  if (postId && openThread) {
    const channel: Channel = { id: openThread.id, communityId: community.id, kind: 'thread', name: openThread.title, topic: '', position: 0, parentId: forum.id };
    const canDelete = openThread.author?.id === me.id || canModerate || can(community, 'manageChannels');
    return (
      <ChatView
        key={openThread.id}
        kind="channel"
        channel={channel}
        title={openThread.title}
        icon={
          <button className="icon-btn back-btn" onClick={() => setParams({})} aria-label="Back to forum" data-tip="Back">
            <ArrowLeft size={19} />
          </button>
        }
        topic={`Post in ${forum.name} · ${openThread.replies} ${openThread.replies === 1 ? 'reply' : 'replies'}`}
        canModerate={canModerate}
        canPin={canModerate}
        members={community.members}
        focusMessageId={Number(params.get('m')) || undefined}
        headerExtra={
          canDelete ? (
            <button
              className="icon-btn danger"
              aria-label="Delete post"
              data-tip="Delete post"
              onClick={async () => {
                if (!window.confirm('Delete this post and all its replies?')) return;
                await api.del(`/channels/${openThread.id}`);
                setParams({});
              }}
            >
              <Trash2 size={17} />
            </button>
          ) : null
        }
        intro={
          <div className="intro post-intro">
            <span className="eyebrow">{forum.name}</span>
            <h2>{openThread.title}</h2>
            <p className="muted">Started by {openThread.author?.displayName ?? 'someone'} · {relative(openThread.createdAt)}</p>
          </div>
        }
        aside={aside}
      />
    );
  }

  return (
    <div className="forum">
      <header className="chat-head">
        <span className="chat-head-icon"><MessagesSquare size={20} /></span>
        <div className="chat-head-text">
          <h1>{forum.name}</h1>
          {forum.topic && <span className="chat-topic">{forum.topic}</span>}
        </div>
        <div className="chat-head-actions">
          <button className="btn primary sm" onClick={() => setComposing(true)}>
            <PenSquare size={15} /> New post
          </button>
        </div>
      </header>
      <div className="forum-tools">
        <label className="forum-search">
          <Search size={15} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search posts" aria-label="Search posts" />
        </label>
        <div className="seg sm">
          <button className={sort === 'active' ? 'on' : ''} onClick={() => setSort('active')}>Latest activity</button>
          <button className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>Newest</button>
        </div>
      </div>
      <div className="forum-list">
        {threads === null && [0, 1, 2].map((i) => <div key={i} className="post-card skeleton" />)}
        {threads !== null && threads.length === 0 && (
          <div className="empty-state">
            <MessagesSquare size={36} />
            <h3>No posts yet</h3>
            <p className="muted">Start the first discussion: guides, LFG posts, patch hot takes, anything.</p>
            <button className="btn primary" onClick={() => setComposing(true)}><PenSquare size={16} /> Write a post</button>
          </div>
        )}
        {threads !== null && threads.length > 0 && shown.length === 0 && <p className="muted center pad">No posts match “{filter}”.</p>}
        {shown.map((t) => (
          <button key={t.id} className="post-card" onClick={() => setParams({ post: t.id })}>
            <div className="post-main">
              <h3>{t.title}</h3>
              {t.preview && <p className="post-preview">{t.preview}</p>}
              <div className="post-meta">
                {t.author && <Avatar user={t.author} size={20} showPresence={false} />}
                <span>{t.author?.displayName ?? 'Someone'}</span>
                <span className="muted">· {relative(t.lastActivity)}</span>
                <span className="post-replies"><MessageCircle size={14} /> {t.replies}</span>
                {t.reactions.slice(0, 3).map((r) => (
                  <span key={r.emoji} className="post-react">{r.emoji.startsWith(':') ? '⭐' : r.emoji} {r.count}</span>
                ))}
              </div>
            </div>
            {t.image && <img className="post-thumb" src={t.image} alt="" loading="lazy" />}
          </button>
        ))}
      </div>
      {composing && (
        <NewPostModal
          forum={forum}
          onClose={() => setComposing(false)}
          onCreated={(t) => {
            setComposing(false);
            setThreads((l) => (l ? [t, ...l.filter((x) => x.id !== t.id)] : [t]));
            setParams({ post: t.id });
          }}
        />
      )}
    </div>
  );
}

function NewPostModal({ forum, onClose, onCreated }: { forum: Channel; onClose: () => void; onCreated: (t: Thread) => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function attach(file: File) {
    setError('');
    try {
      const dims = await imageSize(file);
      const r = await api.upload(file, dims);
      if (r.attachment.kind !== "image" && r.attachment.kind !== "gif") throw new Error("Pick an image file");
      setImage({ id: r.id, url: r.attachment.url });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ thread: Thread }>(`/channels/${forum.id}/threads`, {
        title,
        content,
        attachments: image ? [{ uploadId: image.id }] : [],
      });
      onCreated(r.thread);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`New post in ${forum.name}`} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required autoFocus placeholder="Best crosshair settings for 2026?" />
        </label>
        <label className="field">
          <span>Post</span>
          <textarea className="tall" value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} placeholder="Share the details. Markdown works." />
        </label>
        {image ? (
          <div className="post-attach">
            <img src={image.url} alt="" />
            <button type="button" className="icon-btn sm" onClick={() => setImage(null)} aria-label="Remove image"><X size={14} /></button>
          </div>
        ) : (
          <button type="button" className="btn ghost sm fit" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={15} /> Add an image
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !title.trim() || (!content.trim() && !image)}>{busy ? 'Posting…' : 'Post'}</button>
        </div>
      </form>
    </Modal>
  );
}
