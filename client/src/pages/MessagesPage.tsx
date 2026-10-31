import { useMemo, useState, type FormEvent } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { Check, Gamepad2, MessageCirclePlus, MessagesSquare, Search, UserPlus, Users, X } from 'lucide-react';
import { api } from '../lib/api';
import { conversationTitle, presenceLabel, relative } from '../lib/format';
import { useNexus } from '../lib/store';
import type { Conversation, FriendLists, User } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { ChatView } from '../components/ChatView';
import { Modal } from '../components/Modal';
import { ProfileModal } from '../components/ProfileModal';

export function MessagesPage() {
  const { channelId } = useParams();
  const { conversations, unread, me, removeConversation, friends } = useNexus();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();
  const active = conversations.find((c) => c.id === channelId);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? conversations.filter((c) => conversationTitle(c).toLowerCase().includes(q)) : conversations;
  }, [filter, conversations]);

  async function leaveGroup(c: Conversation) {
    if (!window.confirm('Leave this group chat?')) return;
    await api.post(`/dms/${c.id}/leave`);
    removeConversation(c.id);
    navigate('/messages');
  }

  return (
    <div className={`workspace ${channelId ? 'has-chat' : ''}`}>
      <aside className="context glass">
        <div className="context-head">
          <h2>Messages</h2>
          <button className="icon-btn" onClick={() => setCreating(true)} aria-label="New conversation" data-tip="New chat">
            <MessageCirclePlus size={19} />
          </button>
        </div>
        <div className="search-field">
          <Search size={15} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a conversation" aria-label="Find a conversation" />
        </div>
        <NavLink to="/messages" end className="ctx-link">
          <Users size={18} /> Friends
          {friends.incoming.length > 0 && <span className="count-badge inline">{friends.incoming.length}</span>}
        </NavLink>
        <div className="ctx-section">Direct messages</div>
        <div className="ctx-list">
          {shown.length === 0 && <p className="muted small pad">{filter ? 'No matches.' : 'Your conversations will show up here.'}</p>}
          {shown.map((c) => {
            const lead = c.others[0] ?? me;
            const preview = c.lastMessage ? `${c.lastMessage.authorId === me.id ? 'You: ' : ''}${c.lastMessage.text}` : c.kind === 'group' ? `${c.members.length} members` : 'Say hi 👋';
            return (
              <NavLink key={c.id} to={`/messages/${c.id}`} className={`convo ${unread.has(c.id) ? 'unread' : ''}`}>
                {c.kind === 'group' ? (
                  <span className="group-stack">
                    {c.others.slice(0, 2).map((u) => (
                      <Avatar key={u.id} user={u} size={26} showPresence={false} />
                    ))}
                  </span>
                ) : (
                  <Avatar user={lead} size={40} />
                )}
                <span className="convo-text">
                  <span className="convo-top">
                    <span className="convo-name">{conversationTitle(c)}</span>
                    <time>{c.lastMessage ? relative(c.lastActivity).replace(' ago', '') : ''}</time>
                  </span>
                  <span className="convo-preview">{preview}</span>
                </span>
              </NavLink>
            );
          })}
        </div>
      </aside>

      <section className="main glass">
        {channelId && active ? (
          <ChatView
            key={active.id}
            kind="dm"
            channel={active}
            title={conversationTitle(active)}
            icon={active.kind === 'group' ? <Users size={20} /> : <Avatar user={active.others[0] ?? me} size={30} />}
            topic={active.kind === 'dm' && active.others[0] ? (active.others[0].nowPlaying ? `Playing ${active.others[0].nowPlaying}` : presenceLabel[active.others[0].presence]) : `${active.members.length} members`}
            canModerate={false}
            canPin
            members={active.members}
            intro={
              <div className="intro">
                {active.kind === 'dm' && active.others[0] ? <Avatar user={active.others[0]} size={80} /> : <span className="intro-icon"><Users size={34} /></span>}
                <h2>{conversationTitle(active)}</h2>
                <p className="muted">
                  {active.kind === 'dm' ? `This is the start of your conversation with ${conversationTitle(active)}.` : 'Welcome to your new group. Say something nice.'}
                </p>
              </div>
            }
            aside={
              active.kind === 'dm' && active.others[0] ? (
                <aside className="side-panel"><ProfileSide user={active.others[0]} /></aside>
              ) : (
                <aside className="side-panel">
                  <div className="side-panel-head"><h3>Members · {active.members.length}</h3></div>
                  {active.members.map((u) => (
                    <MemberRow key={u.id} user={u} />
                  ))}
                  <button className="btn ghost block" onClick={() => leaveGroup(active)}>Leave group</button>
                </aside>
              )
            }
          />
        ) : channelId ? (
          <div className="empty">
            <p className="muted">That conversation isn't available.</p>
            <Link to="/messages" className="btn">Back to friends</Link>
          </div>
        ) : (
          <FriendsPanel />
        )}
      </section>

      {creating && <NewChatModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProfileSide({ user }: { user: User }) {
  return (
    <div className="profile-side">
      <div className="profile-side-banner" style={{ ['--av' as string]: user.accent }}>
        {user.banner && <img src={user.banner} alt="" />}
      </div>
      <div className="profile-side-body">
        <Avatar user={user} size={72} />
        <h3>{user.displayName}</h3>
        <p className="muted small">@{user.username}</p>
        {user.nowPlaying && (
          <div className="now-playing-card">
            <Gamepad2 size={18} />
            <span>
              <span className="muted small">Playing</span>
              <strong>{user.nowPlaying}</strong>
            </span>
          </div>
        )}
        {user.lfg && <span className="chip lfg">Looking for teammates</span>}
        {user.bio && <p className="profile-bio">{user.bio}</p>}
        {user.games.length > 0 && (
          <>
            <h4 className="side-label">Plays</h4>
            <div className="chip-row">{user.games.map((g) => <span key={g} className="chip">{g}</span>)}</div>
          </>
        )}
        <h4 className="side-label">Member since</h4>
        <p className="small">{new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}</p>
      </div>
    </div>
  );
}

export function MemberRow({ user, role, color }: { user: User; role?: string; color?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`member ${user.presence === 'offline' ? 'off' : ''}`} onClick={() => setOpen(true)}>
        <Avatar user={user} size={34} />
        <span className="member-text">
          <span className="member-name" style={{ color: color ?? (role === 'owner' ? '#fcd34d' : undefined) }}>
            {user.displayName}
            {role && role !== 'member' && <span className={`role-pill role-${role}`}>{role}</span>}
          </span>
          {user.nowPlaying ? <span className="member-sub"><Gamepad2 size={11} /> {user.nowPlaying}</span> : user.lfg ? <span className="member-sub lfg">LFG</span> : null}
        </span>
      </button>
      {open && <ProfileModal username={user.username} onClose={() => setOpen(false)} />}
    </>
  );
}

type Tab = 'online' | 'all' | 'pending' | 'blocked';

function FriendsPanel() {
  const { friends, setFriends, upsertConversation } = useNexus();
  const [tab, setTab] = useState<Tab>('online');
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const navigate = useNavigate();

  const online = friends.friends.filter((f) => f.presence !== 'offline');
  const list = tab === 'online' ? online : friends.friends;

  async function act(fn: () => Promise<FriendLists>) {
    try {
      setFriends(await fn());
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    try {
      setFriends(await api.post<FriendLists>('/friends/requests', { username: username.trim() }));
      setResult({ ok: true, text: `Request sent to ${username.trim()}.` });
      setUsername('');
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    }
  }

  async function message(u: User) {
    const r = await api.post<{ conversation: Conversation }>('/dms', { userIds: [u.id] });
    upsertConversation(r.conversation);
    navigate(`/messages/${r.conversation.id}`);
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Friends</h1>
          <p className="muted">{online.length} online · {friends.friends.length} total</p>
        </div>
        <form className="add-friend" onSubmit={add}>
          <UserPlus size={17} />
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Add by username" maxLength={24} aria-label="Add a friend by username" />
          <button className="btn primary sm" disabled={!username.trim()}>Send</button>
        </form>
      </header>
      {result && <p className={result.ok ? 'notice' : 'form-error'}>{result.text}</p>}
      <div className="seg" role="tablist">
        {(['online', 'all', 'pending', 'blocked'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'pending' && friends.incoming.length > 0 && <span className="count-badge inline">{friends.incoming.length}</span>}
          </button>
        ))}
      </div>

      {(tab === 'online' || tab === 'all') && (
        <>
          {list.length === 0 && (
            <div className="empty-card">
              <MessagesSquare size={34} />
              <h3>{tab === 'online' ? 'Nobody online right now' : 'No friends yet'}</h3>
              <p className="muted">Add someone by their username above, or find people in a community.</p>
            </div>
          )}
          <div className="friend-grid">
            {list.map((u) => (
              <article key={u.id} className="friend-card" style={{ ['--av' as string]: u.accent }}>
                <button className="friend-card-main" onClick={() => setProfile(u.username)}>
                  <Avatar user={u} size={48} />
                  <span className="friend-card-text">
                    <strong>{u.displayName}</strong>
                    <span className="muted small">@{u.username}</span>
                    <span className="friend-status">
                      {u.nowPlaying ? <><Gamepad2 size={13} /> {u.nowPlaying}</> : presenceLabel[u.presence]}
                    </span>
                  </span>
                </button>
                <div className="friend-card-foot">
                  {u.lfg && <span className="chip lfg sm">LFG</span>}
                  <button className="btn sm" onClick={() => message(u)}>
                    <MessagesSquare size={15} /> Message
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === 'pending' && (
        <div className="stack-list">
          <h4 className="side-label">Incoming · {friends.incoming.length}</h4>
          {friends.incoming.map((u) => (
            <div key={u.id} className="row-card">
              <button className="row-main" onClick={() => setProfile(u.username)}>
                <Avatar user={u} size={40} />
                <span><strong>{u.displayName}</strong> <span className="muted small">@{u.username}</span></span>
              </button>
              <button className="icon-btn ok" onClick={() => act(() => api.post(`/friends/requests/${u.id}/accept`))} aria-label="Accept" data-tip="Accept"><Check size={18} /></button>
              <button className="icon-btn danger" onClick={() => act(() => api.del(`/friends/${u.id}`))} aria-label="Decline" data-tip="Decline"><X size={18} /></button>
            </div>
          ))}
          <h4 className="side-label">Sent · {friends.outgoing.length}</h4>
          {friends.outgoing.map((u) => (
            <div key={u.id} className="row-card">
              <span className="row-main">
                <Avatar user={u} size={40} />
                <span><strong>{u.displayName}</strong> <span className="muted small">@{u.username}</span></span>
              </span>
              <button className="btn ghost sm" onClick={() => act(() => api.del(`/friends/${u.id}`))}>Cancel</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'blocked' && (
        <div className="stack-list">
          {friends.blocked.length === 0 && <p className="muted">You haven't blocked anyone.</p>}
          {friends.blocked.map((u) => (
            <div key={u.id} className="row-card">
              <span className="row-main">
                <Avatar user={u} size={40} showPresence={false} />
                <span><strong>{u.displayName}</strong> <span className="muted small">@{u.username}</span></span>
              </span>
              <button className="btn ghost sm" onClick={() => act(() => api.del(`/blocks/${u.id}`))}>Unblock</button>
            </div>
          ))}
        </div>
      )}
      {profile && <ProfileModal username={profile} onClose={() => setProfile(null)} />}
    </div>
  );
}

function NewChatModal({ onClose }: { onClose: () => void }) {
  const { friends, upsertConversation } = useNexus();
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function create() {
    try {
      const r = await api.post<{ conversation: Conversation }>('/dms', { userIds: picked, name: name || undefined });
      upsertConversation(r.conversation);
      onClose();
      navigate(`/messages/${r.conversation.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="New conversation" onClose={onClose}>
      <p className="muted">Pick one friend for a DM, or up to nine for a group.</p>
      {picked.length > 1 && (
        <label className="field">
          <span>Group name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder="Ranked squad" />
        </label>
      )}
      <div className="pick-list">
        {friends.friends.length === 0 && <p className="muted small">Add some friends first.</p>}
        {friends.friends.map((u) => (
          <label key={u.id} className={`pick-row ${picked.includes(u.id) ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={picked.includes(u.id)}
              onChange={() => setPicked((p) => (p.includes(u.id) ? p.filter((x) => x !== u.id) : p.length < 9 ? [...p, u.id] : p))}
            />
            <Avatar user={u} size={30} />
            <span>{u.displayName} <span className="muted small">@{u.username}</span></span>
          </label>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={picked.length === 0} onClick={create}>
          {picked.length > 1 ? 'Create group' : 'Start chat'}
        </button>
      </div>
    </Modal>
  );
}
