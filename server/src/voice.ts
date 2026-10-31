// Voice and video rooms. Media flows peer to peer over WebRTC; the server only
// tracks who is in which room and relays signalling between room members.
import type { Server, Socket } from 'socket.io';
import { channelMemberIds, getChannel, readableChannel, type ChannelRow } from './access.ts';
import type { DB } from './db.ts';
import { getUser, publicUser, type Ctx } from './serialize.ts';

export interface VoiceParticipant {
  userId: string;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
  /** MediaStream ids so peers can tell the camera from the screen share. */
  streams: { camera?: string; screen?: string };
  joinedAt: number;
}

const VOICE_KINDS = new Set(['voice', 'dm', 'group']);
const MAX_ROOM = 12; // a full mesh gets heavy beyond this

const voiceRoom = (id: string) => `voice:${id}`;
const channelRoom = (id: string) => `channel:${id}`;
const userRoom = (id: string) => `user:${id}`;

export function createVoice(ctx: Ctx) {
  const db: DB = ctx.db;
  const rooms = new Map<string, Map<string, VoiceParticipant & { socketId: string }>>();
  const where = new Map<string, string>(); // userId -> channelId

  const list = (channelId: string): VoiceParticipant[] =>
    [...(rooms.get(channelId)?.values() ?? [])].map(({ socketId: _s, ...p }) => p);

  function broadcast(io: Server, channelId: string) {
    io.to(channelRoom(channelId)).emit('voice:state', { channelId, participants: list(channelId) });
  }

  function leave(io: Server, userId: string) {
    const channelId = where.get(userId);
    if (!channelId) return;
    where.delete(userId);
    const room = rooms.get(channelId);
    const entry = room?.get(userId);
    room?.delete(userId);
    if (entry) io.sockets.sockets.get(entry.socketId)?.leave(voiceRoom(channelId));
    io.to(voiceRoom(channelId)).emit('voice:left', { channelId, userId });
    if (room && room.size === 0) {
      rooms.delete(channelId);
      const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as ChannelRow | undefined;
      if (ch && (ch.kind === 'dm' || ch.kind === 'group')) {
        for (const id of channelMemberIds(db, channelId)) io.to(userRoom(id)).emit('call:end', { channelId });
      }
    }
    broadcast(io, channelId);
  }

  function attach(io: Server, socket: Socket) {
    const userId: string = socket.data.userId;

    socket.on('voice:join', (payload: unknown, ack?: (r: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const channelId = (payload as { channelId?: unknown })?.channelId;
      if (typeof channelId !== 'string') return reply({ error: 'Bad request' });
      let channel: ChannelRow;
      try {
        channel = readableChannel(db, userId, channelId);
      } catch {
        return reply({ error: 'Channel not found' });
      }
      if (!VOICE_KINDS.has(channel.kind)) return reply({ error: 'This channel has no voice' });
      const room = rooms.get(channelId) ?? new Map();
      if (room.size >= MAX_ROOM && !room.has(userId)) return reply({ error: `This room is full (${MAX_ROOM} people)` });

      // One voice session per user: joining elsewhere moves you.
      const previous = where.get(userId);
      if (previous) {
        const old = rooms.get(previous)?.get(userId);
        if (old && old.socketId !== socket.id) io.to(old.socketId).emit('voice:moved', { channelId });
        leave(io, userId);
      }
      const wasEmpty = room.size === 0;
      room.set(userId, {
        userId,
        muted: false,
        deafened: false,
        video: false,
        screen: false,
        streams: {},
        joinedAt: Date.now(),
        socketId: socket.id,
      });
      rooms.set(channelId, room);
      where.set(userId, channelId);
      socket.join(voiceRoom(channelId));
      // Existing members are told someone joined; the newcomer starts the offers.
      socket.to(voiceRoom(channelId)).emit('voice:joined', { channelId, userId });
      reply({ ok: true, participants: list(channelId) });
      broadcast(io, channelId);

      if (wasEmpty && (channel.kind === 'dm' || channel.kind === 'group')) {
        const caller = getUser(db, userId);
        for (const id of channelMemberIds(db, channelId)) {
          if (id !== userId && caller) io.to(userRoom(id)).emit('call:ring', { channelId, from: publicUser(ctx, caller), kind: channel.kind });
        }
      }
    });

    socket.on('voice:leave', () => {
      if (rooms.get(where.get(userId) ?? '')?.get(userId)?.socketId === socket.id) leave(io, userId);
    });

    socket.on('voice:update', (payload: unknown) => {
      const channelId = where.get(userId);
      const me = channelId ? rooms.get(channelId)?.get(userId) : undefined;
      if (!channelId || !me || me.socketId !== socket.id) return;
      const p = (payload ?? {}) as Partial<VoiceParticipant>;
      for (const k of ['muted', 'deafened', 'video', 'screen'] as const) if (typeof p[k] === 'boolean') me[k] = p[k]!;
      if (p.streams && typeof p.streams === 'object') {
        const s = p.streams as Record<string, unknown>;
        me.streams = {
          camera: typeof s.camera === 'string' ? s.camera.slice(0, 64) : undefined,
          screen: typeof s.screen === 'string' ? s.screen.slice(0, 64) : undefined,
        };
      }
      broadcast(io, channelId);
    });

    // Relay SDP offers/answers and ICE candidates, only between members of the same room.
    socket.on('voice:signal', (payload: unknown) => {
      const { to, data } = (payload ?? {}) as { to?: unknown; data?: unknown };
      const channelId = where.get(userId);
      if (typeof to !== 'string' || !channelId) return;
      const target = rooms.get(channelId)?.get(to);
      const me = rooms.get(channelId)?.get(userId);
      if (!target || !me || me.socketId !== socket.id) return;
      if (JSON.stringify(data ?? null).length > 64_000) return;
      io.to(target.socketId).emit('voice:signal', { from: userId, data });
    });

    socket.on('disconnect', () => {
      if (rooms.get(where.get(userId) ?? '')?.get(userId)?.socketId === socket.id) leave(io, userId);
    });
  }

  /** Current voice rooms in channels this user can read (for first paint). */
  function statesFor(userId: string) {
    const out: Record<string, VoiceParticipant[]> = {};
    for (const channelId of rooms.keys()) {
      try {
        readableChannel(db, userId, channelId);
        out[channelId] = list(channelId);
      } catch {
        /* not visible to this user */
      }
    }
    return out;
  }

  /** Remove someone from voice when they lose access (kicked, left). */
  function evictIfUnreadable(io: Server, userId: string) {
    const channelId = where.get(userId);
    if (!channelId) return;
    try {
      readableChannel(db, userId, getChannel(db, channelId).id);
    } catch {
      leave(io, userId);
    }
  }

  return { attach, statesFor, evictIfUnreadable };
}
