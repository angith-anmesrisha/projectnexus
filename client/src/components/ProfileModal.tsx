import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { presenceLabel } from '../lib/format';
import { useNexus } from '../lib/store';
import type { Conversation, FriendLists, User } from '../lib/types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Modal } from './Modal';

type Relationship = 'self' | 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none';

export function ProfileModal({ username, onClose }: { username: string; onClose: () => void }) {
  const { setFriends, upsertConversation } = useNexus();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [rel, setRel] = useState<Relationship>('none');
  const [error, setError] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');

  const load = () =>
    api
      .get<{ user: User; relationship: Relationship }>(`/users/${encodeURIComponent(username)}`)
      .then((r) => {
        setUser(r.user);
        setRel(r.relationship);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, [username]);

  async function act(fn: () => Promise<FriendLists | void>) {
    setError('');
    try {
      const result = await fn();
      if (result) setFriends(result);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function message() {
    if (!user) return;
    const r = await api.post<{ conversation: Conversation }>('/dms', { userIds: [user.id] });
    upsertConversation(r.conversation);
    onClose();
    navigate(`/messages/${r.conversation.id}`);
  }

  async function report() {
    if (!user) return;
    try {
      await api.post('/reports', { targetType: 'user', targetId: user.id, reason });
      setReporting(false);
      setReason('');
      setNotice('Thanks. Our moderators will take a look.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title={user ? user.displayName : 'Profile'} onClose={onClose}>
      {!user && !error && <p className="muted">Loading…</p>}
      {user && (
        <div className="profile">
          <div className="profile-banner" style={{ ['--accent' as string]: user.accent }} />
          <div className="profile-head">
            <Avatar user={user} size={72} />
            <div>
              <h3>{user.displayName}</h3>
              <p className="muted">@{user.username} · {presenceLabel[user.presence]}</p>
            </div>
          </div>
          {user.nowPlaying && (
            <p className="now-playing">
              <Icon name="gamepad" size={16} /> Playing <strong>{user.nowPlaying}</strong>
            </p>
          )}
          {user.lfg && <span className="tag tag-lfg">Looking for teammates</span>}
          {user.bio && <p className="profile-bio">{user.bio}</p>}
          {user.games.length > 0 && (
            <div className="tag-row">
              {user.games.map((g) => (
                <span key={g} className="tag">{g}</span>
              ))}
            </div>
          )}

          {rel !== 'self' && (
            <div className="profile-actions">
              {rel === 'friend' && (
                <button className="btn btn-primary" onClick={message}>
                  <Icon name="chat" size={16} /> Message
                </button>
              )}
              {rel === 'none' && (
                <button className="btn btn-primary" onClick={() => act(() => api.post('/friends/requests', { username: user.username }))}>
                  <Icon name="userPlus" size={16} /> Add friend
                </button>
              )}
              {rel === 'incoming' && (
                <button className="btn btn-primary" onClick={() => act(() => api.post(`/friends/requests/${user.id}/accept`))}>
                  Accept request
                </button>
              )}
              {rel === 'outgoing' && <button className="btn" disabled>Request sent</button>}
              {rel === 'friend' && (
                <button className="btn btn-ghost" onClick={() => act(() => api.del(`/friends/${user.id}`))}>Remove friend</button>
              )}
              {rel === 'blocked' ? (
                <button className="btn btn-ghost" onClick={() => act(() => api.del(`/blocks/${user.id}`))}>Unblock</button>
              ) : (
                <button className="btn btn-danger-ghost" onClick={() => act(() => api.post(`/blocks/${user.id}`))}>Block</button>
              )}
              <button className="btn btn-danger-ghost" onClick={() => setReporting((v) => !v)}>Report</button>
            </div>
          )}
          {reporting && (
            <div className="report-box">
              <textarea
                placeholder="What's going on? Reports go to the Nexus safety team."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
              <button className="btn btn-danger" disabled={reason.trim().length < 3} onClick={report}>Send report</button>
            </div>
          )}
          {notice && <p className="notice">{notice}</p>}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
