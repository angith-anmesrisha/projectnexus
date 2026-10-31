import { useState, type FormEvent } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { conversationTitle, presenceLabel } from '../lib/format';
import { useNexus } from '../lib/store';
import type { Conversation, FriendLists, User } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { ChatView } from '../components/ChatView';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { ProfileModal } from '../components/ProfileModal';

export function MessagesPage() {
  const { channelId } = useParams();
  const { conversations, unread, me, removeConversation } = useNexus();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const active = conversations.find((c) => c.id === channelId);
  const navigate = useNavigate();

  async function leaveGroup(c: Conversation) {
    if (!window.confirm('Leave this group chat?')) return;
    await api.post(`/dms/${c.id}/leave`);
    removeConversation(c.id);
    navigate('/messages');
  }

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>Messages</h2>
        </div>
        <NavLink to="/messages" end className="side-link">
          <Icon name="users" size={18} /> Friends
        </NavLink>
        <div className="side-section">
          <span>Direct messages</span>
          <button className="icon-btn small" onClick={() => setCreatingGroup(true)} title="New group chat" aria-label="New group chat">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <div className="side-list">
          {conversations.length === 0 && <p className="muted small pad">Start a chat from your friends list.</p>}
          {conversations.map((c) => {
            const lead = c.others[0] ?? me;
            return (
              <NavLink key={c.id} to={`/messages/${c.id}`} className={`side-link convo ${unread.has(c.id) ? 'unread' : ''}`}>
                {c.kind === 'group' ? (
                  <span className="group-icon"><Icon name="users" size={16} /></span>
                ) : (
                  <Avatar user={lead} size={32} />
                )}
                <span className="convo-text">
                  <span className="convo-name">{conversationTitle(c)}</span>
                  <span className="convo-sub">
                    {c.kind === 'group' ? `${c.members.length} members` : lead.nowPlaying ? `Playing ${lead.nowPlaying}` : presenceLabel[lead.presence]}
                  </span>
                </span>
              </NavLink>
            );
          })}
        </div>
      </aside>

      {channelId && active ? (
        <ChatView
          key={active.id}
          channel={active}
          title={conversationTitle(active)}
          icon={active.kind === 'group' ? <Icon name="users" /> : <Avatar user={active.others[0] ?? me} size={28} />}
          canModerate={false}
          canPin
          aside={
            <aside className="side-panel members">
              <h3 className="panel-title">Members — {active.members.length}</h3>
              {active.members.map((u) => (
                <MemberRow key={u.id} user={u} />
              ))}
              {active.kind === 'group' && (
                <button className="btn btn-ghost btn-block" onClick={() => leaveGroup(active)}>Leave group</button>
              )}
            </aside>
          }
        />
      ) : channelId ? (
        <div className="empty-state">
          <p className="muted">That conversation isn't available.</p>
          <Link to="/messages" className="btn">Back to friends</Link>
        </div>
      ) : (
        <FriendsPanel />
      )}

      {creatingGroup && <NewGroupModal onClose={() => setCreatingGroup(false)} />}
    </div>
  );
}

export function MemberRow({ user, role }: { user: User; role?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`member-row ${user.presence === 'offline' ? 'dim' : ''}`} onClick={() => setOpen(true)}>
        <Avatar user={user} size={32} />
        <span className="convo-text">
          <span className="convo-name">
            {user.displayName}
            {role && role !== 'member' && <span className={`role-tag role-${role}`}>{role}</span>}
          </span>
          {user.nowPlaying && <span className="convo-sub">Playing {user.nowPlaying}</span>}
        </span>
      </button>
      {open && <ProfileModal username={user.username} onClose={() => setOpen(false)} />}
    </>
  );
}

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

function FriendsPanel() {
  const { friends, setFriends, upsertConversation } = useNexus();
  const [tab, setTab] = useState<Tab>('online');
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const navigate = useNavigate();

  const online = friends.friends.filter((f) => f.presence !== 'offline');
  const pendingCount = friends.incoming.length;

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
      setResult({ ok: true, text: `Friend request sent to ${username.trim()}.` });
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

  const list = tab === 'online' ? online : tab === 'all' ? friends.friends : [];

  return (
    <section className="panel">
      <header className="chat-head">
        <span className="chat-head-icon"><Icon name="users" /></span>
        <h1>Friends</h1>
        <div className="tabs" role="tablist">
          {(['online', 'all', 'pending', 'blocked'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
              {t === 'pending' && pendingCount > 0 && <span className="badge inline">{pendingCount}</span>}
            </button>
          ))}
          <button className={`tab tab-cta ${tab === 'add' ? 'on' : ''}`} onClick={() => setTab('add')}>Add friend</button>
        </div>
      </header>

      <div className="panel-body">
        {tab === 'add' && (
          <form className="add-friend" onSubmit={add}>
            <h2>Add a friend</h2>
            <p className="muted">Enter their Nexus username.</p>
            <div className="input-row">
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" maxLength={24} autoFocus />
              <button className="btn btn-primary" disabled={!username.trim()}>Send request</button>
            </div>
            {result && <p className={result.ok ? 'notice' : 'form-error'}>{result.text}</p>}
          </form>
        )}

        {(tab === 'online' || tab === 'all') && (
          <>
            <p className="list-caption">{tab === 'online' ? 'Online' : 'All friends'} — {list.length}</p>
            {list.length === 0 && (
              <div className="empty-inline">
                <p className="muted">{tab === 'online' ? 'No friends online right now.' : 'No friends yet. Add someone by username.'}</p>
              </div>
            )}
            {list.map((u) => (
              <div key={u.id} className="friend-row">
                <button className="friend-main" onClick={() => setProfile(u.username)}>
                  <Avatar user={u} size={40} />
                  <span className="convo-text">
                    <span className="convo-name">{u.displayName} <span className="muted small">@{u.username}</span></span>
                    <span className="convo-sub">
                      {u.nowPlaying ? `Playing ${u.nowPlaying}` : presenceLabel[u.presence]}
                      {u.lfg && <span className="tag tag-lfg small">LFG</span>}
                    </span>
                  </span>
                </button>
                <button className="icon-btn" onClick={() => message(u)} title="Message" aria-label={`Message ${u.displayName}`}>
                  <Icon name="chat" />
                </button>
              </div>
            ))}
          </>
        )}

        {tab === 'pending' && (
          <>
            <p className="list-caption">Incoming — {friends.incoming.length}</p>
            {friends.incoming.map((u) => (
              <div key={u.id} className="friend-row">
                <button className="friend-main" onClick={() => setProfile(u.username)}>
                  <Avatar user={u} size={40} />
                  <span className="convo-name">{u.displayName} <span className="muted small">@{u.username}</span></span>
                </button>
                <button className="icon-btn ok" onClick={() => act(() => api.post(`/friends/requests/${u.id}/accept`))} title="Accept" aria-label="Accept">
                  <Icon name="check" />
                </button>
                <button className="icon-btn danger" onClick={() => act(() => api.del(`/friends/${u.id}`))} title="Decline" aria-label="Decline">
                  <Icon name="x" />
                </button>
              </div>
            ))}
            <p className="list-caption">Outgoing — {friends.outgoing.length}</p>
            {friends.outgoing.map((u) => (
              <div key={u.id} className="friend-row">
                <span className="friend-main">
                  <Avatar user={u} size={40} />
                  <span className="convo-name">{u.displayName} <span className="muted small">@{u.username}</span></span>
                </span>
                <button className="btn btn-ghost small" onClick={() => act(() => api.del(`/friends/${u.id}`))}>Cancel</button>
              </div>
            ))}
          </>
        )}

        {tab === 'blocked' && (
          <>
            <p className="list-caption">Blocked — {friends.blocked.length}</p>
            {friends.blocked.map((u) => (
              <div key={u.id} className="friend-row">
                <span className="friend-main">
                  <Avatar user={u} size={40} showPresence={false} />
                  <span className="convo-name">{u.displayName} <span className="muted small">@{u.username}</span></span>
                </span>
                <button className="btn btn-ghost small" onClick={() => act(() => api.del(`/blocks/${u.id}`))}>Unblock</button>
              </div>
            ))}
          </>
        )}
      </div>
      {profile && <ProfileModal username={profile} onClose={() => setProfile(null)} />}
    </section>
  );
}

function NewGroupModal({ onClose }: { onClose: () => void }) {
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
      <p className="muted">Pick one friend for a DM, or several for a group chat (up to 9).</p>
      {picked.length > 1 && (
        <label>
          Group name <span className="muted">(optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder="Ranked squad" />
        </label>
      )}
      <div className="pick-list">
        {friends.friends.length === 0 && <p className="muted small">Add some friends first.</p>}
        {friends.friends.map((u) => (
          <label key={u.id} className="pick-row">
            <input
              type="checkbox"
              checked={picked.includes(u.id)}
              onChange={() => setPicked((p) => (p.includes(u.id) ? p.filter((x) => x !== u.id) : p.length < 9 ? [...p, u.id] : p))}
            />
            <Avatar user={u} size={28} />
            {u.displayName}
          </label>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={picked.length === 0} onClick={create}>
          {picked.length > 1 ? 'Create group' : 'Start chat'}
        </button>
      </div>
    </Modal>
  );
}
