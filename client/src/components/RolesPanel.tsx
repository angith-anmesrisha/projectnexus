import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Shield, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { PERMS, type Community, type CommunityRole, type Member, type PermKey } from '../lib/types';

const PERM_INFO: { key: PermKey; label: string; hint: string }[] = [
  { key: 'manageCommunity', label: 'Edit community', hint: 'Change the name, game, description and colour' },
  { key: 'manageChannels', label: 'Manage channels', hint: 'Create, rename and delete channels and forums' },
  { key: 'manageRoles', label: 'Manage roles', hint: 'Create roles and hand them out (only with permissions they have)' },
  { key: 'manageMessages', label: 'Moderate messages', hint: 'Delete and pin anyone’s messages and posts' },
  { key: 'kickMembers', label: 'Remove members', hint: 'Kick members out of the community' },
  { key: 'createInvites', label: 'Invite people', hint: 'See and reset the invite link' },
  { key: 'manageEvents', label: 'Schedule events', hint: 'Create and cancel community events' },
  { key: 'mentionEveryone', label: 'Mention @everyone', hint: 'Notify every member at once' },
  { key: 'postAnnouncements', label: 'Post announcements', hint: 'Write in announcement channels' },
];

const SWATCHES = ['#f43f5e', '#f59e0b', '#a3e635', '#10b981', '#22d3ee', '#3b82f6', '#8b5cf6', '#ec4899'];

/** The highest positioned role with a colour, used for name colours. */
export function topRole(community: Community, m: Member): CommunityRole | undefined {
  return community.roles
    .filter((r) => m.roleIds.includes(r.id) && r.color)
    .sort((a, b) => b.position - a.position)[0];
}

export function RolesPanel({ community }: { community: Community }) {
  const roles = [...community.roles].sort((a, b) => b.position - a.position);
  const [selected, setSelected] = useState<string | null>(roles[0]?.id ?? null);
  const [error, setError] = useState('');
  const role = roles.find((r) => r.id === selected) ?? null;

  useEffect(() => {
    if (!selected && roles[0]) setSelected(roles[0].id);
  }, [roles, selected]);

  async function run<T>(fn: () => Promise<T>) {
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function create() {
    const r = await run(() => api.post<{ role: CommunityRole }>(`/communities/${community.id}/roles`, { name: 'New role', color: SWATCHES[roles.length % SWATCHES.length] }));
    if (r) setSelected(r.role.id);
  }
  const patch = (body: Partial<CommunityRole>) => role && run(() => api.patch(`/roles/${role.id}`, body));
  async function remove() {
    if (!role || !window.confirm(`Delete the ${role.name} role? Members keep everything else.`)) return;
    await run(() => api.del(`/roles/${role.id}`));
    setSelected(null);
  }
  async function move(dir: 1 | -1) {
    if (!role) return;
    const i = roles.findIndex((r) => r.id === role.id);
    const other = roles[i - dir];
    if (!other) return;
    // Swap positions with the neighbour.
    await run(async () => {
      await api.patch(`/roles/${role.id}`, { position: other.position });
      await api.patch(`/roles/${other.id}`, { position: role.position });
    });
  }
  const holders = role ? community.members.filter((m) => m.roleIds.includes(role.id)).length : 0;

  return (
    <div className="roles-panel">
      <div className="roles-list">
        {roles.map((r) => (
          <button key={r.id} className={`roles-item ${r.id === selected ? 'on' : ''}`} onClick={() => setSelected(r.id)}>
            <i style={{ background: r.color || 'var(--text-3)' }} />
            <span>{r.name}</span>
          </button>
        ))}
        <button className="roles-item add" onClick={create}>
          <Plus size={15} /> New role
        </button>
        <p className="muted small roles-note">Owners and admins can always do everything. Higher roles colour names first.</p>
      </div>
      <div className="roles-editor">
        {!role ? (
          <div className="empty-state">
            <Shield size={30} />
            <h3>Create your first role</h3>
            <p className="muted">Roles give members colours, their own group in the member list, and extra powers like moderating or scheduling events.</p>
            <button className="btn primary" onClick={create}><Plus size={16} /> New role</button>
          </div>
        ) : (
          <RoleEditor key={role.id} role={role} holders={holders} onPatch={patch} onRemove={remove} onMove={move} canUp={roles[0]?.id !== role.id} canDown={roles[roles.length - 1]?.id !== role.id} />
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}

function RoleEditor({
  role,
  holders,
  onPatch,
  onRemove,
  onMove,
  canUp,
  canDown,
}: {
  role: CommunityRole;
  holders: number;
  onPatch: (b: Partial<CommunityRole>) => void;
  onRemove: () => void;
  onMove: (dir: 1 | -1) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const [name, setName] = useState(role.name);
  const has = (k: PermKey) => (role.permissions & PERMS[k]) === PERMS[k];
  return (
    <>
      <div className="role-head">
        <input
          className="role-title"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== role.name && onPatch({ name: name.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Role name"
        />
        <button className="icon-btn sm" disabled={!canUp} onClick={() => onMove(1)} aria-label="Move up" data-tip="Move up"><ChevronUp size={16} /></button>
        <button className="icon-btn sm" disabled={!canDown} onClick={() => onMove(-1)} aria-label="Move down" data-tip="Move down"><ChevronDown size={16} /></button>
        <button className="icon-btn sm danger" onClick={onRemove} aria-label="Delete role" data-tip="Delete role"><Trash2 size={16} /></button>
      </div>
      <p className="muted small">{holders} {holders === 1 ? 'member has' : 'members have'} this role</p>
      <div className="field">
        <span>Colour</span>
        <div className="swatches">
          <button className={`swatch none ${!role.color ? 'on' : ''}`} onClick={() => onPatch({ color: '' })} aria-label="No colour" />
          {SWATCHES.map((c) => (
            <button key={c} className={`swatch ${role.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onPatch({ color: c })} aria-label={`Colour ${c}`} />
          ))}
          <label className="swatch custom" style={{ background: role.color || undefined }} aria-label="Custom colour">
            <input type="color" value={role.color || '#ffffff'} onChange={(e) => onPatch({ color: e.target.value })} />
          </label>
        </div>
      </div>
      <label className="perm-row">
        <span>
          <b>Show separately</b>
          <small>Group online members with this role in the member list</small>
        </span>
        <input type="checkbox" className="switch-input" checked={role.hoist} onChange={(e) => onPatch({ hoist: e.target.checked })} />
      </label>
      <h4 className="side-label">Permissions</h4>
      {PERM_INFO.map((p) => (
        <label key={p.key} className="perm-row">
          <span>
            <b>{p.label}</b>
            <small>{p.hint}</small>
          </span>
          <input
            type="checkbox"
            className="switch-input"
            checked={has(p.key)}
            onChange={(e) => onPatch({ permissions: e.target.checked ? role.permissions | PERMS[p.key] : role.permissions & ~PERMS[p.key] })}
          />
        </label>
      ))}
    </>
  );
}
