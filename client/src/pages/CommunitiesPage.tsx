import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useNexus } from '../lib/store';
import type { Channel, Community } from '../lib/types';
import { CommunityBadge } from '../components/Avatar';
import { ChatView } from '../components/ChatView';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { MemberRow } from './MessagesPage';

const ACCENTS = ['#22d3ee', '#7c5cff', '#f43f5e', '#f59e0b', '#10b981', '#ec4899', '#3b82f6'];

export function CommunitiesPage() {
  const { communityId, channelId } = useParams();
  const { communities, communityDetails, setCommunityDetail } = useNexus();
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'create' | 'join' | 'channel' | 'invite' | 'settings' | null>(null);
  const navigate = useNavigate();

  const community = communityId ? communityDetails[communityId] : undefined;
  const inList = communities.some((c) => c.id === communityId);

  useEffect(() => {
    if (!communityId) return;
    setError('');
    api
      .get<{ community: Community }>(`/communities/${communityId}`)
      .then((r) => setCommunityDetail(r.community))
      .catch((e) => setError(e.message));
  }, [communityId, setCommunityDetail]);

  // Removed from (or deleted) the community we are looking at.
  useEffect(() => {
    if (communityId && community && !inList) navigate('/communities', { replace: true });
  }, [communityId, community, inList, navigate]);

  if (communityId && community && !channelId && community.channels.length) {
    const first = community.channels.find((c) => c.kind === 'text') ?? community.channels[0];
    return <Navigate to={`/communities/${community.id}/${first.id}`} replace />;
  }

  const channel = community?.channels.find((c) => c.id === channelId);
  // The channel was deleted while we were looking at it.
  if (community && channelId && !channel) return <Navigate to={`/communities/${community.id}`} replace />;
  const isMod = community?.role === 'owner' || community?.role === 'admin';

  return (
    <div className="split">
      <aside className="sidebar">
        {community ? (
          <CommunitySidebar community={community} isMod={isMod} onModal={setModal} />
        ) : (
          <>
            <div className="sidebar-head">
              <h2>Communities</h2>
            </div>
            <div className="side-list">
              {communities.map((c) => (
                <NavLink key={c.id} to={`/communities/${c.id}`} className="side-link convo">
                  <CommunityBadge name={c.name} accent={c.accent} size={34} />
                  <span className="convo-text">
                    <span className="convo-name">{c.name}</span>
                    <span className="convo-sub">{c.game || `${c.memberCount} members`}</span>
                  </span>
                </NavLink>
              ))}
            </div>
            <div className="sidebar-foot">
              <button className="btn btn-primary btn-block" onClick={() => setModal('create')}>
                <Icon name="plus" size={16} /> Create community
              </button>
              <button className="btn btn-ghost btn-block" onClick={() => setModal('join')}>
                <Icon name="link" size={16} /> Join with invite
              </button>
            </div>
          </>
        )}
      </aside>

      {community && channel ? (
        <ChatView
          key={channel.id}
          channel={channel}
          title={channel.name}
          icon={<Icon name={channel.kind === 'announcement' ? 'megaphone' : 'hash'} />}
          topic={channel.topic}
          readOnlyReason={channel.kind === 'announcement' && !isMod ? 'Only admins can post in announcement channels.' : undefined}
          canModerate={isMod}
          canPin={isMod}
          aside={<MemberList community={community} />}
        />
      ) : communityId && error ? (
        <div className="empty-state">
          <p className="muted">{error}</p>
          <Link to="/communities" className="btn">All communities</Link>
        </div>
      ) : communityId ? (
        <div className="empty-state"><p className="muted">Loading…</p></div>
      ) : (
        <CommunitiesLanding onCreate={() => setModal('create')} onJoin={() => setModal('join')} />
      )}

      {modal === 'create' && <CreateCommunityModal onClose={() => setModal(null)} />}
      {modal === 'join' && <JoinModal onClose={() => setModal(null)} />}
      {modal === 'channel' && community && <CreateChannelModal community={community} onClose={() => setModal(null)} />}
      {modal === 'invite' && community && <InviteModal community={community} onClose={() => setModal(null)} />}
      {modal === 'settings' && community && <CommunitySettingsModal community={community} onClose={() => setModal(null)} />}
    </div>
  );
}

function CommunitySidebar({ community, isMod, onModal }: { community: Community; isMod: boolean; onModal: (m: 'channel' | 'invite' | 'settings') => void }) {
  const { unread, removeCommunity } = useNexus();
  const navigate = useNavigate();

  async function leave() {
    if (!window.confirm(`Leave ${community.name}?`)) return;
    await api.post(`/communities/${community.id}/leave`);
    removeCommunity(community.id);
    navigate('/communities');
  }

  const announcements = community.channels.filter((c) => c.kind === 'announcement');
  const text = community.channels.filter((c) => c.kind === 'text');

  const channelLink = (c: Channel) => (
    <NavLink key={c.id} to={`/communities/${community.id}/${c.id}`} className={`side-link channel-link ${unread.has(c.id) ? 'unread' : ''}`}>
      <Icon name={c.kind === 'announcement' ? 'megaphone' : 'hash'} size={18} />
      {c.name}
    </NavLink>
  );

  return (
    <>
      <Link to="/communities" className="back-link">← All communities</Link>
      <div className="community-hero" style={{ ['--accent' as string]: community.accent }}>
        <CommunityBadge name={community.name} accent={community.accent} size={48} />
        <div>
          <h2>{community.name}</h2>
          <p className="muted small">{community.game ? `${community.game} · ` : ''}{community.memberCount} members</p>
        </div>
      </div>
      <div className="community-actions">
        {isMod && (
          <button className="btn btn-ghost small" onClick={() => onModal('invite')}>
            <Icon name="userPlus" size={16} /> Invite
          </button>
        )}
        {isMod && (
          <button className="icon-btn" onClick={() => onModal('settings')} title="Community settings" aria-label="Community settings">
            <Icon name="settings" size={18} />
          </button>
        )}
        {community.role !== 'owner' && (
          <button className="icon-btn danger" onClick={leave} title="Leave community" aria-label="Leave community">
            <Icon name="door" size={18} />
          </button>
        )}
      </div>
      <div className="side-list">
        {announcements.length > 0 && <div className="side-section"><span>Announcements</span></div>}
        {announcements.map(channelLink)}
        <div className="side-section">
          <span>Text channels</span>
          {isMod && (
            <button className="icon-btn small" onClick={() => onModal('channel')} title="Create channel" aria-label="Create channel">
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>
        {text.map(channelLink)}
        <div className="side-section"><span>Coming soon</span></div>
        <span className="side-link disabled"><Icon name="chat" size={18} /> Forums</span>
        <span className="side-link disabled"><Icon name="users" size={18} /> Voice rooms</span>
        <span className="side-link disabled"><Icon name="trophy" size={18} /> Events and tournaments</span>
      </div>
    </>
  );
}

function MemberList({ community }: { community: Community }) {
  const order = { owner: 0, admin: 1, member: 2 };
  const sorted = [...community.members].sort(
    (a, b) => Number(a.presence === 'offline') - Number(b.presence === 'offline') || order[a.role] - order[b.role] || a.displayName.localeCompare(b.displayName),
  );
  const online = sorted.filter((m) => m.presence !== 'offline');
  const offline = sorted.filter((m) => m.presence === 'offline');
  return (
    <aside className="side-panel members">
      <h3 className="panel-title">Online — {online.length}</h3>
      {online.map((m) => <MemberRow key={m.id} user={m} role={m.role} />)}
      {offline.length > 0 && <h3 className="panel-title">Offline — {offline.length}</h3>}
      {offline.map((m) => <MemberRow key={m.id} user={m} role={m.role} />)}
    </aside>
  );
}

function CommunitiesLanding({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <section className="panel landing">
      <div className="landing-inner">
        <h1>Find your people</h1>
        <p className="muted">Communities bring your team, your friends or your whole game's fanbase into one space with channels for everything.</p>
        <div className="card-grid two">
          <button className="action-card" onClick={onCreate}>
            <Icon name="plus" size={28} />
            <h3>Create a community</h3>
            <p className="muted">Start with announcements, general, LFG and clips channels, then make it yours.</p>
          </button>
          <button className="action-card" onClick={onJoin}>
            <Icon name="link" size={28} />
            <h3>Join with an invite</h3>
            <p className="muted">Paste an invite link or code from a friend.</p>
          </button>
          <Link to="/discover" className="action-card">
            <Icon name="compass" size={28} />
            <h3>Browse communities</h3>
            <p className="muted">See what's active on Nexus and jump in.</p>
          </Link>
        </div>
      </div>
    </section>
  );
}

function CreateCommunityModal({ onClose }: { onClose: () => void }) {
  const { setCommunityDetail } = useNexus();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [game, setGame] = useState('');
  const [description, setDescription] = useState('');
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api.post<{ community: Community }>('/communities', { name, game, description, accent });
      setCommunityDetail(r.community);
      onClose();
      navigate(`/communities/${r.community.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Create a community" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={48} placeholder="Midnight Ranked" autoFocus />
        </label>
        <label>
          Main game <span className="muted">(optional)</span>
          <input value={game} onChange={(e) => setGame(e.target.value)} maxLength={40} placeholder="Valorant" />
        </label>
        <label>
          Description <span className="muted">(optional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </label>
        <AccentPicker value={accent} onChange={setAccent} />
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Create</button>
        </div>
      </form>
    </Modal>
  );
}

export function AccentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="accent-picker">
      <legend>Accent colour</legend>
      {ACCENTS.map((a) => (
        <button
          type="button"
          key={a}
          className={`swatch ${value === a ? 'on' : ''}`}
          style={{ background: a }}
          onClick={() => onChange(a)}
          aria-label={`Accent ${a}`}
          aria-pressed={value === a}
        />
      ))}
    </fieldset>
  );
}

function JoinModal({ onClose }: { onClose: () => void }) {
  const { setCommunityDetail } = useNexus();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api.post<{ community: Community }>('/communities/join', { inviteCode: code });
      setCommunityDetail(r.community);
      onClose();
      navigate(`/communities/${r.community.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Join a community" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>
          Invite link or code
          <input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="https://…/invite/aB3dE9xY" autoFocus />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Join</button>
        </div>
      </form>
    </Modal>
  );
}

function CreateChannelModal({ community, onClose }: { community: Community; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'text' | 'announcement'>('text');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api.post<{ channel: Channel }>(`/communities/${community.id}/channels`, { name, topic, kind });
      onClose();
      navigate(`/communities/${community.id}/${r.channel.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Create a channel" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="segmented">
          <button type="button" className={kind === 'text' ? 'on' : ''} onClick={() => setKind('text')}>
            <Icon name="hash" size={16} /> Text
          </button>
          <button type="button" className={kind === 'announcement' ? 'on' : ''} onClick={() => setKind('announcement')}>
            <Icon name="megaphone" size={16} /> Announcement
          </button>
        </div>
        <label>
          Channel name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={32} placeholder="scrims" autoFocus />
        </label>
        <label>
          Topic <span className="muted">(optional)</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Create channel</button>
        </div>
      </form>
    </Modal>
  );
}

function InviteModal({ community, onClose }: { community: Community; onClose: () => void }) {
  const [code, setCode] = useState(community.inviteCode ?? '');
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/invite/${code}`;

  async function copy() {
    await navigator.clipboard?.writeText(link);
    setCopied(true);
  }

  async function regenerate() {
    const r = await api.post<{ inviteCode: string }>(`/communities/${community.id}/invite`);
    setCode(r.inviteCode);
    setCopied(false);
  }

  return (
    <Modal title={`Invite friends to ${community.name}`} onClose={onClose}>
      <p className="muted">Anyone with this link can join.</p>
      <div className="input-row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <button className="link-btn small" onClick={regenerate}>Reset link (the old one stops working)</button>
    </Modal>
  );
}

function CommunitySettingsModal({ community, onClose }: { community: Community; onClose: () => void }) {
  const { me, setCommunityDetail, removeCommunity } = useNexus();
  const navigate = useNavigate();
  const [name, setName] = useState(community.name);
  const [game, setGame] = useState(community.game);
  const [description, setDescription] = useState(community.description);
  const [accent, setAccent] = useState(community.accent);
  const [error, setError] = useState('');
  const isOwner = community.role === 'owner';

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api.patch<{ community: Community }>(`/communities/${community.id}`, { name, game, description, accent });
      setCommunityDetail(r.community);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function run(fn: () => Promise<{ community: Community }>) {
    try {
      setCommunityDetail((await fn()).community);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function destroy() {
    if (!window.confirm(`Delete ${community.name} for everyone? This can't be undone.`)) return;
    await api.del(`/communities/${community.id}`);
    removeCommunity(community.id);
    onClose();
    navigate('/communities');
  }

  return (
    <Modal title="Community settings" onClose={onClose} wide>
      <form onSubmit={save} className="stack">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={48} />
        </label>
        <label>
          Main game
          <input value={game} onChange={(e) => setGame(e.target.value)} maxLength={40} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </label>
        <AccentPicker value={accent} onChange={setAccent} />
        <div className="modal-actions">
          <button className="btn btn-primary">Save changes</button>
        </div>
      </form>

      <h3 className="panel-title">Members and roles</h3>
      <div className="role-list">
        {community.members.map((m) => (
          <div key={m.id} className="role-row">
            <span>{m.displayName} <span className="muted small">@{m.username}</span></span>
            <span className={`role-tag role-${m.role}`}>{m.role}</span>
            {isOwner && m.role !== 'owner' && (
              <button className="btn btn-ghost small" onClick={() => run(() => api.patch(`/communities/${community.id}/members/${m.id}`, { role: m.role === 'admin' ? 'member' : 'admin' }))}>
                {m.role === 'admin' ? 'Make member' : 'Make admin'}
              </button>
            )}
            {m.id !== me.id && m.role !== 'owner' && (isOwner || m.role === 'member') && (
              <button className="btn btn-danger-ghost small" onClick={() => run(() => api.del(`/communities/${community.id}/members/${m.id}`))}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      {isOwner && (
        <div className="danger-zone">
          <button className="btn btn-danger" onClick={destroy}>Delete community</button>
        </div>
      )}
    </Modal>
  );
}
