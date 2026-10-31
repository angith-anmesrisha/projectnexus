import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Compass, DoorOpen, Hash, Link2, Megaphone, MessagesSquare, Plus, Settings, Trophy, UserPlus, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { useNexus } from '../lib/store';
import { can, type Channel, type Community, type Member } from '../lib/types';
import { CommunityBadge } from '../components/Avatar';
import { ChatView } from '../components/ChatView';
import { EventsView } from '../components/EventsView';
import { ForumView } from '../components/ForumView';
import { Modal } from '../components/Modal';
import { RolesPanel, topRole } from '../components/RolesPanel';
import { MemberRow } from './MessagesPage';

const ACCENTS = ['#8b5cf6', '#22d3ee', '#f43f5e', '#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#a3ff12'];

type ModalKind = 'create' | 'join' | 'channel' | 'invite' | 'settings' | null;

export function CommunitiesPage() {
  const { communityId, channelId } = useParams();
  const [params, setParams] = useSearchParams();
  const { communities, communityDetails, setCommunityDetail } = useNexus();
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalKind>(params.get('new') ? 'create' : null);
  const navigate = useNavigate();

  const community = communityId ? communityDetails[communityId] : undefined;
  const inList = communities.some((c) => c.id === communityId);

  useEffect(() => {
    if (params.get('new')) {
      setModal('create');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    if (!communityId) return;
    setError('');
    api
      .get<{ community: Community }>(`/communities/${communityId}`)
      .then((r) => setCommunityDetail(r.community))
      .catch((e) => setError(e.message));
  }, [communityId, setCommunityDetail]);

  useEffect(() => {
    if (communityId && community && !inList) navigate('/communities', { replace: true });
  }, [communityId, community, inList, navigate]);

  if (communityId && community && !channelId && community.channels.length) {
    const first = community.channels.find((c) => c.kind === 'text') ?? community.channels[0];
    return <Navigate to={`/communities/${community.id}/${first.id}`} replace />;
  }
  const isEvents = channelId === 'events';
  const channel = community?.channels.find((c) => c.id === channelId);
  if (community && channelId && !channel && !isEvents) return <Navigate to={`/communities/${community.id}`} replace />;
  const canManageMessages = can(community, 'manageMessages');

  const modals = (
    <>
      {modal === 'create' && <CreateCommunityModal onClose={() => setModal(null)} onJoin={() => setModal('join')} />}
      {modal === 'join' && <JoinModal onClose={() => setModal(null)} />}
      {modal === 'channel' && community && <CreateChannelModal community={community} onClose={() => setModal(null)} />}
      {modal === 'invite' && community && <InviteModal community={community} onClose={() => setModal(null)} />}
      {modal === 'settings' && community && <CommunitySettingsModal community={community} onClose={() => setModal(null)} />}
    </>
  );

  if (!communityId) {
    return (
      <div className="workspace single">
        <section className="main glass">
          <CommunitiesLanding onCreate={() => setModal('create')} onJoin={() => setModal('join')} />
        </section>
        {modals}
      </div>
    );
  }

  return (
    <div className="workspace has-chat">
      <aside className="context glass">
        {community ? <CommunitySidebar community={community} onModal={setModal} /> : <p className="muted pad">{error || 'Loading…'}</p>}
      </aside>
      <section className="main glass">
        {community && isEvents ? (
          <EventsView community={community} />
        ) : community && channel?.kind === 'forum' ? (
          <ForumView key={channel.id} community={community} forum={channel} aside={<MemberList community={community} />} />
        ) : community && channel ? (
          <ChatView
            key={channel.id}
            kind="channel"
            channel={channel}
            title={channel.name}
            icon={channel.kind === 'announcement' ? <Megaphone size={20} /> : <Hash size={20} />}
            topic={channel.topic}
            lockedReason={channel.kind === 'announcement' && !can(community, 'postAnnouncements') ? 'Only admins can post announcements here.' : undefined}
            canModerate={canManageMessages}
            canPin={canManageMessages}
            members={community.members}
            focusMessageId={Number(params.get('m')) || undefined}
            intro={
              <div className="intro">
                <span className="intro-icon">{channel.kind === 'announcement' ? <Megaphone size={34} /> : <Hash size={34} />}</span>
                <h2>Welcome to #{channel.name}</h2>
                <p className="muted">{channel.topic || `This is the start of #${channel.name} in ${community.name}.`}</p>
              </div>
            }
            aside={<MemberList community={community} />}
          />
        ) : error ? (
          <div className="empty">
            <p className="muted">{error}</p>
            <Link to="/communities" className="btn">All communities</Link>
          </div>
        ) : (
          <div className="empty"><p className="muted">Loading…</p></div>
        )}
      </section>
      {modals}
    </div>
  );
}

function CommunitySidebar({ community, onModal }: { community: Community; onModal: (m: ModalKind) => void }) {
  const { unread, removeCommunity } = useNexus();
  const navigate = useNavigate();
  const online = community.members.filter((m) => m.presence !== 'offline').length;

  async function leave() {
    if (!window.confirm(`Leave ${community.name}?`)) return;
    await api.post(`/communities/${community.id}/leave`);
    removeCommunity(community.id);
    navigate('/communities');
  }

  const link = (c: Channel) => (
    <NavLink key={c.id} to={`/communities/${community.id}/${c.id}`} className={`chan-link ${unread.has(c.id) ? 'unread' : ''}`}>
      {c.kind === 'announcement' ? <Megaphone size={17} /> : c.kind === 'forum' ? <MessagesSquare size={17} /> : <Hash size={17} />}
      <span>{c.name}</span>
    </NavLink>
  );
  const canSettings = can(community, 'manageCommunity') || can(community, 'manageRoles') || can(community, 'kickMembers');

  return (
    <>
      <div className="community-banner" style={{ ['--cb' as string]: community.accent }}>
        <CommunityBadge name={community.name} accent={community.accent} size={52} />
        <div className="community-banner-text">
          <h2>{community.name}</h2>
          <span className="small">
            <span className="dot presence-online" /> {online} online · {community.memberCount} {community.memberCount === 1 ? "member" : "members"}
          </span>
        </div>
      </div>
      <div className="community-tools">
        {can(community, 'createInvites') && (
          <button className="btn sm primary" onClick={() => onModal('invite')}>
            <UserPlus size={15} /> Invite
          </button>
        )}
        {canSettings && (
          <button className="icon-btn" onClick={() => onModal('settings')} aria-label="Community settings" data-tip="Settings">
            <Settings size={18} />
          </button>
        )}
        {community.role !== 'owner' && (
          <button className="icon-btn danger" onClick={leave} aria-label="Leave community" data-tip="Leave">
            <DoorOpen size={18} />
          </button>
        )}
      </div>
      <div className="ctx-list">
        <div className="ctx-section">
          <span>Channels</span>
          {can(community, 'manageChannels') && (
            <button className="icon-btn sm" onClick={() => onModal('channel')} aria-label="Create channel" data-tip="New channel">
              <Plus size={15} />
            </button>
          )}
        </div>
        {community.channels.filter((c) => c.kind === 'announcement').map(link)}
        {community.channels.filter((c) => c.kind === 'text').map(link)}
        {community.channels.some((c) => c.kind === 'forum') && <div className="ctx-section"><span>Forums</span></div>}
        {community.channels.filter((c) => c.kind === 'forum').map(link)}
        <div className="ctx-section"><span>Happening</span></div>
        <NavLink to={`/communities/${community.id}/events`} className="chan-link">
          <CalendarDays size={17} />
          <span>Events</span>
        </NavLink>
        <div className="ctx-section"><span>Coming soon</span></div>
        <span className="chan-link later"><Volume2 size={17} /><span>Voice lounges</span></span>
        <span className="chan-link later"><Trophy size={17} /><span>Tournaments</span></span>
      </div>
    </>
  );
}

/** Online members grouped by their highest hoisted role, then everyone else. */
function MemberList({ community }: { community: Community }) {
  const order = { owner: 0, admin: 1, member: 2 };
  const sorted = [...community.members].sort((a, b) => order[a.role] - order[b.role] || a.displayName.localeCompare(b.displayName));
  const online = sorted.filter((m) => m.presence !== 'offline');
  const offline = sorted.filter((m) => m.presence === 'offline');
  const hoisted = [...community.roles].filter((r) => r.hoist).sort((a, b) => b.position - a.position);
  const groups: { label: string; color?: string; members: Member[] }[] = [];
  const placed = new Set<string>();
  for (const r of hoisted) {
    const ms = online.filter((m) => !placed.has(m.id) && m.roleIds.includes(r.id));
    ms.forEach((m) => placed.add(m.id));
    if (ms.length) groups.push({ label: r.name, color: r.color || undefined, members: ms });
  }
  const rest = online.filter((m) => !placed.has(m.id));
  if (rest.length) groups.push({ label: 'Online', members: rest });
  const row = (m: Member) => {
    const r = topRole(community, m);
    return <MemberRow key={m.id} user={m} role={m.role} color={r?.color || undefined} />;
  };
  return (
    <aside className="side-panel">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="side-panel-head"><h3 style={{ color: g.color }}>{g.label} · {g.members.length}</h3></div>
          {g.members.map(row)}
        </div>
      ))}
      {offline.length > 0 && <div className="side-panel-head"><h3>Offline · {offline.length}</h3></div>}
      {offline.map(row)}
    </aside>
  );
}

function CommunitiesLanding({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const { communities } = useNexus();
  return (
    <div className="page">
      <header className="hero-card">
        <p className="eyebrow">Communities</p>
        <h1>Your squads, clubs and fan spaces</h1>
        <p className="muted">Spin one up in seconds. Every community gets announcements, chat, LFG and clips channels, and you can theme it to match.</p>
        <div className="hero-actions">
          <button className="btn primary" onClick={onCreate}><Plus size={17} /> Create a community</button>
          <button className="btn" onClick={onJoin}><Link2 size={17} /> Join with invite</button>
          <Link className="btn ghost" to="/discover"><Compass size={17} /> Browse</Link>
        </div>
      </header>
      {communities.length > 0 && (
        <>
          <h3 className="section-title">Your communities</h3>
          <div className="tile-grid">
            {communities.map((c) => (
              <Link key={c.id} to={`/communities/${c.id}`} className="tile" style={{ ['--cb' as string]: c.accent }}>
                <span className="tile-glow" />
                <CommunityBadge name={c.name} accent={c.accent} size={52} />
                <strong>{c.name}</strong>
                <span className="muted small">{c.game || 'Community'} · {c.memberCount} members</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CreateCommunityModal({ onClose, onJoin }: { onClose: () => void; onJoin: () => void }) {
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
      <form onSubmit={submit} className="form">
        <div className="create-preview" style={{ ['--cb' as string]: accent }}>
          <CommunityBadge name={name || 'New Community'} accent={accent} size={56} />
          <div>
            <strong>{name || 'Your community'}</strong>
            <span className="muted small">{game || 'Any game'}</span>
          </div>
        </div>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={48} placeholder="Midnight Ranked" autoFocus />
        </label>
        <label className="field">
          <span>Main game</span>
          <input value={game} onChange={(e) => setGame(e.target.value)} maxLength={40} placeholder="Valorant" />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="What's this place about?" />
        </label>
        <ColorRow value={accent} onChange={setAccent} />
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onJoin}>I have an invite</button>
          <button className="btn primary">Create</button>
        </div>
      </form>
    </Modal>
  );
}

export function ColorRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <span>Accent</span>
      <div className="swatches">
        {ACCENTS.map((a) => (
          <button type="button" key={a} className={`swatch ${value === a ? 'on' : ''}`} style={{ background: a }} onClick={() => onChange(a)} aria-label={`Accent ${a}`} aria-pressed={value === a} />
        ))}
        <label className="swatch custom" aria-label="Custom colour" style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
    </div>
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
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Invite link or code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="https://…/invite/aB3dE9xY" autoFocus />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">Join</button>
        </div>
      </form>
    </Modal>
  );
}

function CreateChannelModal({ community, onClose }: { community: Community; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'text' | 'announcement' | 'forum'>('text');
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
      <form onSubmit={submit} className="form">
        <div className="choice-row">
          <button type="button" className={`choice ${kind === 'text' ? 'on' : ''}`} onClick={() => setKind('text')}>
            <Hash size={20} />
            <strong>Text</strong>
            <span className="muted small">Everyone can chat</span>
          </button>
          <button type="button" className={`choice ${kind === 'announcement' ? 'on' : ''}`} onClick={() => setKind('announcement')}>
            <Megaphone size={20} />
            <strong>Announcement</strong>
            <span className="muted small">Only admins post</span>
          </button>
          <button type="button" className={`choice ${kind === 'forum' ? 'on' : ''}`} onClick={() => setKind('forum')}>
            <MessagesSquare size={20} />
            <strong>Forum</strong>
            <span className="muted small">Posts with threads</span>
          </button>
        </div>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={32} placeholder="scrims" autoFocus />
        </label>
        <label className="field">
          <span>Topic</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} placeholder="Optional" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">Create channel</button>
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
    <Modal title={`Invite people to ${community.name}`} onClose={onClose}>
      <p className="muted">Anyone with this link can join.</p>
      <div className="input-row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
        <button className="btn primary" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
      </div>
      <button className="link-btn small" onClick={regenerate}>Reset link (the old one stops working)</button>
    </Modal>
  );
}

function CommunitySettingsModal({ community, onClose }: { community: Community; onClose: () => void }) {
  const { me, setCommunityDetail, removeCommunity } = useNexus();
  const navigate = useNavigate();
  const tabs = [
    can(community, 'manageCommunity') && { id: 'overview', label: 'Overview' },
    can(community, 'manageRoles') && { id: 'roles', label: 'Roles' },
    (can(community, 'manageRoles') || can(community, 'kickMembers')) && { id: 'members', label: 'Members' },
  ].filter(Boolean) as { id: 'overview' | 'roles' | 'members'; label: string }[];
  const [tab, setTab] = useState(tabs[0]?.id ?? 'members');
  const [name, setName] = useState(community.name);
  const [game, setGame] = useState(community.game);
  const [description, setDescription] = useState(community.description);
  const [accent, setAccent] = useState(community.accent);
  const [error, setError] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
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
    setError('');
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
  const toggleRole = (m: Member, roleId: string) =>
    run(() =>
      api.put(`/communities/${community.id}/members/${m.id}/roles`, {
        roleIds: m.roleIds.includes(roleId) ? m.roleIds.filter((r) => r !== roleId) : [...m.roleIds, roleId],
      }),
    );
  const needle = memberFilter.trim().toLowerCase();
  const members = community.members.filter((m) => !needle || m.displayName.toLowerCase().includes(needle) || m.username.toLowerCase().includes(needle));

  return (
    <Modal title="Community settings" onClose={onClose} wide>
      {tabs.length > 1 && (
        <div className="seg settings-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'overview' && (
        <>
          <form onSubmit={save} className="form">
            <div className="form-2col">
              <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={48} /></label>
              <label className="field"><span>Main game</span><input value={game} onChange={(e) => setGame(e.target.value)} maxLength={40} /></label>
            </div>
            <label className="field"><span>Description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></label>
            <ColorRow value={accent} onChange={setAccent} />
            <div className="modal-actions"><button className="btn primary">Save changes</button></div>
          </form>
          {isOwner && (
            <div className="danger-zone">
              <div>
                <strong>Delete community</strong>
                <p className="muted small">Removes every channel and message for everyone.</p>
              </div>
              <button className="btn danger" onClick={destroy}>Delete</button>
            </div>
          )}
        </>
      )}

      {tab === 'roles' && <RolesPanel community={community} />}

      {tab === 'members' && (
        <>
          <input className="member-filter" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} placeholder="Find a member" aria-label="Find a member" />
          <div className="role-list">
            {members.map((m) => (
              <div key={m.id} className="role-row">
                <span className="role-name" style={{ color: topRole(community, m)?.color || undefined }}>
                  {m.displayName} <span className="muted small">@{m.username}</span>
                </span>
                {m.role !== 'member' && <span className={`role-pill role-${m.role}`}>{m.role}</span>}
                {can(community, 'manageRoles') && community.roles.length > 0 && (
                  <span className="role-toggles">
                    {[...community.roles].sort((a, b) => b.position - a.position).map((r) => (
                      <button
                        key={r.id}
                        className={`role-chip ${m.roleIds.includes(r.id) ? 'on' : ''}`}
                        style={{ ['--rc' as string]: r.color || 'var(--text-3)' }}
                        onClick={() => toggleRole(m, r.id)}
                        aria-pressed={m.roleIds.includes(r.id)}
                      >
                        <i /> {r.name}
                      </button>
                    ))}
                  </span>
                )}
                {isOwner && m.role !== 'owner' && (
                  <button className="btn ghost sm" onClick={() => run(() => api.patch(`/communities/${community.id}/members/${m.id}`, { role: m.role === 'admin' ? 'member' : 'admin' }))}>
                    {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                  </button>
                )}
                {can(community, 'kickMembers') && m.id !== me.id && m.role !== 'owner' && (isOwner || m.role === 'member') && (
                  <button className="btn danger-ghost sm" onClick={() => run(() => api.del(`/communities/${community.id}/members/${m.id}`))}>Remove</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
