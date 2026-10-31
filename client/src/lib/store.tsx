import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { disconnectSocket, getSocket } from './socket';
import { useAppearance } from './appearanceStore';
import { ping } from './sound';
import type { Community, CommunitySummary, Conversation, FriendLists, Me, MessageEvent, Notification, User } from './types';

interface NexusState {
  me: Me;
  friends: FriendLists;
  communities: CommunitySummary[];
  conversations: Conversation[];
  /** Channel ids with messages the user has not seen yet. */
  unread: Set<string>;
  connected: boolean;
  setMe: (me: Me) => void;
  setFriends: (f: FriendLists) => void;
  upsertCommunity: (c: CommunitySummary) => void;
  removeCommunity: (id: string) => void;
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: string) => void;
  /** The channel currently on screen, so incoming messages there are not marked unread. */
  setActiveChannel: (id: string | null) => void;
  markRead: (id: string) => void;
  /** Community details are loaded on demand and kept live by socket events. */
  communityDetails: Record<string, Community>;
  setCommunityDetail: (c: Community) => void;
  /** Unread notification count for the inbox badge. */
  notificationsUnread: number;
  setNotificationsUnread: (n: number) => void;
  /** Short-lived pop-ups for new notifications. */
  toasts: Notification[];
  dismissToast: (id: string) => void;
  logout: () => Promise<void>;
}

const NexusContext = createContext<NexusState | null>(null);

export function useNexus(): NexusState {
  const ctx = useContext(NexusContext);
  if (!ctx) throw new Error('useNexus must be used inside NexusProvider');
  return ctx;
}

const emptyFriends: FriendLists = { friends: [], incoming: [], outgoing: [], blocked: [] };

function replaceUser<T extends User>(list: T[], u: User): T[] {
  return list.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? { ...x, ...u } : x)) : list;
}

export function NexusProvider({ initialMe, onLogout, children }: { initialMe: Me; onLogout: () => void; children: ReactNode }) {
  const [me, setMe] = useState(initialMe);
  const [friends, setFriends] = useState<FriendLists>(emptyFriends);
  const [communities, setCommunities] = useState<CommunitySummary[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [communityDetails, setCommunityDetails] = useState<Record<string, Community>>({});
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const { plugin } = useAppearance();
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const upsertCommunity = useCallback((c: CommunitySummary) => {
    setCommunities((list) =>
      list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [...list, c],
    );
  }, []);
  const setCommunityDetail = useCallback(
    (c: Community) => {
      setCommunityDetails((m) => ({ ...m, [c.id]: c }));
      upsertCommunity(c);
    },
    [upsertCommunity],
  );
  const removeCommunity = useCallback((id: string) => {
    setCommunities((list) => list.filter((c) => c.id !== id));
    setCommunityDetails(({ [id]: _gone, ...rest }) => rest);
  }, []);
  const upsertConversation = useCallback((c: Conversation) => {
    setConversations((list) => [c, ...list.filter((x) => x.id !== c.id)]);
  }, []);
  const removeConversation = useCallback((id: string) => {
    setConversations((list) => list.filter((c) => c.id !== id));
  }, []);
  const markRead = useCallback((id: string) => {
    setUnread((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  // Initial data. Also re-run on every socket (re)connect, so presence and
  // messages that changed while we weren't subscribed are never stale.
  const loadAll = useCallback(() => {
    api.get<FriendLists>('/friends').then(setFriends).catch(() => {});
    api.get<{ communities: CommunitySummary[] }>('/communities').then((r) => setCommunities(r.communities)).catch(() => {});
    api.get<{ conversations: Conversation[] }>('/dms').then((r) => setConversations(r.conversations)).catch(() => {});
    api.get<{ unread: number }>('/notifications?limit=1').then((r) => setNotificationsUnread(r.unread)).catch(() => {});
  }, []);

  // Live notifications: bump the badge and pop a toast (unless on do not disturb).
  const meStatusRef = useRef(me.status);
  meStatusRef.current = me.status;
  useEffect(() => {
    const socket = getSocket();
    const onNew = ({ notification, unread }: { notification: Notification; unread: number }) => {
      setNotificationsUnread(unread);
      if (meStatusRef.current === 'dnd') return;
      setToasts((t) => [notification, ...t].slice(0, 3));
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== notification.id)), 6000);
      if (plugin('sounds')) ping();
    };
    const onRead = ({ unread }: { unread: number }) => setNotificationsUnread(unread);
    socket.on('notification:new', onNew);
    socket.on('notification:read', onRead);
    return () => {
      socket.off('notification:new', onNew);
      socket.off('notification:read', onRead);
    };
  }, [plugin]);

  // Realtime updates that affect app-wide state.
  useEffect(() => {
    const socket = getSocket();
    const onUser = (u: User) => {
      if (u.id === initialMe.id) setMe((m) => ({ ...m, presence: u.presence }));
      setFriends((f) => ({
        friends: replaceUser(f.friends, u),
        incoming: replaceUser(f.incoming, u),
        outgoing: replaceUser(f.outgoing, u),
        blocked: f.blocked,
      }));
      setConversations((list) =>
        list.map((c) => ({ ...c, members: replaceUser(c.members, u), others: replaceUser(c.others, u) })),
      );
      setCommunityDetails((m) => {
        const next: Record<string, Community> = {};
        for (const [id, c] of Object.entries(m)) next[id] = { ...c, members: replaceUser(c.members, u) };
        return next;
      });
    };
    const onCommunityRemoved = ({ id }: { id: string }) => removeCommunity(id);
    socket.on('connect', () => {
      setConnected(true);
      loadAll();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('user:update', onUser);
    socket.on('friends:update', setFriends);
    socket.on('community:update', setCommunityDetail);
    socket.on('community:removed', onCommunityRemoved);
    socket.on('dm:new', upsertConversation);
    if (socket.connected) loadAll();
    else socket.connect();
    return () => {
      socket.off('user:update', onUser);
      socket.off('friends:update', setFriends);
      socket.off('community:update', setCommunityDetail);
      socket.off('community:removed', onCommunityRemoved);
      socket.off('dm:new', upsertConversation);
      socket.off('connect');
      socket.off('disconnect');
    };
  }, [initialMe.id, loadAll, removeCommunity, setCommunityDetail, upsertConversation]);

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  // Unread tracking and conversation ordering.
  useEffect(() => {
    const socket = getSocket();
    const onMessage = (m: MessageEvent) => {
      setConversations((list) => {
        const c = list.find((x) => x.id === m.channelId);
        if (!c) return list;
        const text = m.content || (m.sticker ? 'Sent a sticker' : m.attachments?.length ? 'Sent an attachment' : '');
        return [{ ...c, lastActivity: m.createdAt, lastMessage: { authorId: m.author.id, text } }, ...list.filter((x) => x.id !== c.id)];
      });
      if (m.author.id === me.id) return;
      const away = m.channelId !== activeChannel || document.hidden;
      if (m.channelId !== activeChannel) setUnread((s) => new Set(s).add(m.channelId));
      const isDm = conversationsRef.current.some((c) => c.id === m.channelId);
      if (away && isDm && plugin("sounds") && me.status !== "dnd") ping();
    };
    socket.on('message:new', onMessage);
    return () => {
      socket.off('message:new', onMessage);
    };
  }, [activeChannel, me.id, me.username, me.status, plugin]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    disconnectSocket();
    onLogout();
  }, [onLogout]);

  // Lists fetched before our socket connected carry a stale "offline" for us,
  // so always show our own presence from `me`.
  const withMyPresence = useCallback(
    <T extends User>(list: T[]): T[] => list.map((u) => (u.id === me.id && u.presence !== me.presence ? { ...u, presence: me.presence } : u)),
    [me.id, me.presence],
  );
  const liveConversations = useMemo(
    () => conversations.map((c) => ({ ...c, members: withMyPresence(c.members) })),
    [conversations, withMyPresence],
  );
  const liveCommunityDetails = useMemo(() => {
    const out: Record<string, Community> = {};
    for (const [id, c] of Object.entries(communityDetails)) out[id] = { ...c, members: withMyPresence(c.members) };
    return out;
  }, [communityDetails, withMyPresence]);

  const value = useMemo<NexusState>(
    () => ({
      me,
      friends,
      communities,
      conversations: liveConversations,
      unread,
      connected,
      setMe,
      setFriends,
      upsertCommunity,
      removeCommunity,
      upsertConversation,
      removeConversation,
      setActiveChannel,
      markRead,
      communityDetails: liveCommunityDetails,
      setCommunityDetail,
      notificationsUnread,
      setNotificationsUnread,
      toasts,
      dismissToast,
      logout,
    }),
    [me, friends, communities, liveConversations, unread, connected, upsertCommunity, removeCommunity, upsertConversation, removeConversation, markRead, liveCommunityDetails, setCommunityDetail, notificationsUnread, toasts, dismissToast, logout],
  );

  return <NexusContext.Provider value={value}>{children}</NexusContext.Provider>;
}
