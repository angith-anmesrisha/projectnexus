import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** The app-wide realtime connection. The session cookie authenticates it. */
export function getSocket(): Socket {
  if (!socket) socket = io({ transports: ['websocket'], autoConnect: false });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
