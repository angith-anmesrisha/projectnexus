import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { DB } from './db.ts';
import { SESSION_COOKIE, parseCookies, userIdForToken } from './auth.ts';
import { readableChannel } from './access.ts';
import { getUser, publicUser, type Ctx } from './serialize.ts';
import { createVoice, type VoiceParticipant } from './voice.ts';

const userRoom = (id: string) => `user:${id}`;
const channelRoom = (id: string) => `channel:${id}`;

/** Every channel id the user can currently read. */
function readableChannelIds(db: DB, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT c.id FROM channels c
         JOIN community_members m ON m.community_id = c.community_id AND m.user_id = ?
       UNION
       SELECT channel_id FROM channel_members WHERE user_id = ?`,
    )
    .all(userId, userId) as { id: string }[];
  return rows.map((r) => r.id);
}

/** Users who may see this user's presence: friends and fellow community members. */
function presenceAudience(db: DB, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
         FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
       UNION
       SELECT b.user_id FROM community_members a
         JOIN community_members b ON a.community_id = b.community_id
         WHERE a.user_id = ? AND b.user_id != ?`,
    )
    .all(userId, userId, userId, userId, userId) as { id: string }[];
  return rows.map((r) => r.id);
}

export interface Realtime {
  ctx: Ctx;
  attach(server: HttpServer): Server;
  toChannel(channelId: string, event: string, payload: unknown): void;
  toUser(userId: string, event: string, payload: unknown): void;
  /** Subscribe a user's open sockets to a channel they just gained access to. */
  joinChannel(userId: string, channelId: string): void;
  leaveChannel(userId: string, channelId: string): void;
  /** Re-send a user's public profile to everyone allowed to see it. */
  broadcastPresence(userId: string): void;
  /** Who is in each voice room this user can see. */
  voiceStates(userId: string): Record<string, VoiceParticipant[]>;
  close(): Promise<void>;
}

export function createRealtime(db: DB): Realtime {
  const connections = new Map<string, number>();
  const ctx: Ctx = { db, isOnline: (id) => (connections.get(id) ?? 0) > 0 };
  let io: Server | null = null;
  const voice = createVoice(ctx);

  const rt: Realtime = {
    ctx,
    attach(server) {
      io = new Server(server, { serveClient: false });

      io.use((socket, next) => {
        const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
        const userId = userIdForToken(db, token);
        if (!userId) return next(new Error('unauthorized'));
        socket.data.userId = userId;
        next();
      });

      io.on('connection', (socket) => {
        const userId: string = socket.data.userId;
        socket.join(userRoom(userId));
        voice.attach(io!, socket);
        for (const id of readableChannelIds(db, userId)) socket.join(channelRoom(id));

        const count = (connections.get(userId) ?? 0) + 1;
        connections.set(userId, count);
        if (count === 1) rt.broadcastPresence(userId);

        socket.on('typing', (payload: unknown) => {
          const channelId = (payload as { channelId?: unknown })?.channelId;
          if (typeof channelId !== 'string') return;
          try {
            readableChannel(db, userId, channelId);
          } catch {
            return;
          }
          const user = getUser(db, userId);
          if (!user) return;
          socket.to(channelRoom(channelId)).emit('typing', {
            channelId,
            userId,
            displayName: user.display_name,
          });
        });

        socket.on('disconnect', () => {
          const left = (connections.get(userId) ?? 1) - 1;
          if (left <= 0) {
            connections.delete(userId);
            rt.broadcastPresence(userId);
          } else {
            connections.set(userId, left);
          }
        });
      });
      return io;
    },
    toChannel(channelId, event, payload) {
      io?.to(channelRoom(channelId)).emit(event, payload);
    },
    toUser(userId, event, payload) {
      io?.to(userRoom(userId)).emit(event, payload);
    },
    joinChannel(userId, channelId) {
      io?.in(userRoom(userId)).socketsJoin(channelRoom(channelId));
    },
    leaveChannel(userId, channelId) {
      io?.in(userRoom(userId)).socketsLeave(channelRoom(channelId));
      if (io) voice.evictIfUnreadable(io, userId);
    },
    broadcastPresence(userId) {
      if (!io) return;
      const user = getUser(db, userId);
      if (!user) return;
      const view = publicUser(ctx, user);
      // Include the user's own room so their other tabs and their own member lists stay current.
      io.to([userId, ...presenceAudience(db, userId)].map(userRoom)).emit('user:update', view);
    },
    voiceStates(userId) {
      return voice.statesFor(userId);
    },
    async close() {
      if (io) await new Promise<void>((resolve) => io!.close(() => resolve()));
    },
  };
  return rt;
}
