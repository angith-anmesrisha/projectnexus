// Voice and video over WebRTC. Every participant connects directly to every
// other one (a mesh); the server relays signalling through socket.io and uses
// the "perfect negotiation" pattern so either side can renegotiate at any time,
// for example when someone turns on their camera or shares their screen.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { getSocket } from './socket';
import { useNexus } from './store';
import type { User } from './types';

export interface VoiceParticipant {
  userId: string;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
  streams: { camera?: string; screen?: string };
  joinedAt: number;
}

export interface IncomingCall {
  channelId: string;
  from: User;
  kind: 'dm' | 'group';
}

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: Map<string, RTCRtpSender>; // track id -> sender
}

interface VoiceState {
  /** The room we are connected to, if any. */
  channelId: string | null;
  connecting: boolean;
  /** Everyone in every voice room we can see, keyed by channel id. */
  rooms: Record<string, VoiceParticipant[]>;
  muted: boolean;
  deafened: boolean;
  camera: MediaStream | null;
  screen: MediaStream | null;
  mic: MediaStream | null;
  /** Remote media streams by user id. */
  remote: Record<string, MediaStream[]>;
  /** User ids currently talking (including ourselves). */
  speaking: Set<string>;
  /** Peer connection state by user id, for "connecting…" hints. */
  peerState: Record<string, RTCPeerConnectionState>;
  error: string;
  incoming: IncomingCall | null;
  join: (channelId: string, opts?: { video?: boolean }) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  dismissIncoming: () => void;
  clearError: () => void;
}

const VoiceContext = createContext<VoiceState | null>(null);

export function useVoice(): VoiceState {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used inside VoiceProvider');
  return ctx;
}

const SPEAKING_LEVEL = 0.035;

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { me } = useNexus();
  const [channelId, setChannelId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [rooms, setRooms] = useState<Record<string, VoiceParticipant[]>>({});
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<Record<string, MediaStream[]>>({});
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [peerState, setPeerState] = useState<Record<string, RTCPeerConnectionState>>({});
  const [error, setError] = useState('');
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  // Mutable WebRTC state lives in refs so socket handlers always see the latest.
  const peers = useRef(new Map<string, Peer>());
  const local = useRef<{ mic: MediaStream | null; camera: MediaStream | null; screen: MediaStream | null }>({ mic: null, camera: null, screen: null });
  const roomRef = useRef<string | null>(null);
  const iceServers = useRef<RTCIceServer[] | null>(null);
  const flags = useRef({ muted: false, deafened: false });
  const audioCtx = useRef<AudioContext | null>(null);
  const analysers = useRef(new Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; streamId: string }>());

  const socket = getSocket();

  const sendState = useCallback(() => {
    const l = local.current;
    socket.emit('voice:update', {
      muted: flags.current.muted,
      deafened: flags.current.deafened,
      video: !!l.camera,
      screen: !!l.screen,
      streams: { camera: l.camera?.id, screen: l.screen?.id },
    });
  }, [socket]);

  // ---- Speaking detection ----

  const watchLevel = useCallback((key: string, stream: MediaStream) => {
    if (!stream.getAudioTracks().length) return;
    const existing = analysers.current.get(key);
    if (existing?.streamId === stream.id) return;
    existing?.source.disconnect();
    try {
      audioCtx.current ??= new AudioContext();
      const source = audioCtx.current.createMediaStreamSource(stream);
      const analyser = audioCtx.current.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analysers.current.set(key, { analyser, source, streamId: stream.id });
    } catch {
      // Older browsers may refuse remote streams in an AudioContext; skip the indicator.
    }
  }, []);

  useEffect(() => {
    if (!channelId) return;
    const buf = new Float32Array(512);
    const t = window.setInterval(() => {
      const next = new Set<string>();
      for (const [key, { analyser }] of analysers.current) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        if (rms > SPEAKING_LEVEL && !(key === me.id && flags.current.muted)) next.add(key);
      }
      setSpeaking((prev) => (prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next));
    }, 140);
    return () => window.clearInterval(t);
  }, [channelId, me.id]);

  // ---- Peers ----

  const closePeer = useCallback((userId: string) => {
    peers.current.get(userId)?.pc.close();
    peers.current.delete(userId);
    analysers.current.get(userId)?.source.disconnect();
    analysers.current.delete(userId);
    setRemote(({ [userId]: _gone, ...rest }) => rest);
    setPeerState(({ [userId]: _gone, ...rest }) => rest);
  }, []);

  const addLocalTracks = useCallback((peer: Peer) => {
    const l = local.current;
    for (const stream of [l.mic, l.camera, l.screen]) {
      if (!stream) continue;
      for (const track of stream.getTracks()) {
        if (!peer.senders.has(track.id)) peer.senders.set(track.id, peer.pc.addTrack(track, stream));
      }
    }
  }, []);

  const getPeer = useCallback(
    (userId: string): Peer => {
      const existing = peers.current.get(userId);
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers: iceServers.current ?? [] });
      const peer: Peer = { pc, polite: me.id > userId, makingOffer: false, ignoreOffer: false, senders: new Map() };
      peers.current.set(userId, peer);

      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          socket.emit('voice:signal', { to: userId, data: { description: pc.localDescription } });
        } catch (e) {
          console.warn('negotiation failed', e);
        } finally {
          peer.makingOffer = false;
        }
      };
      pc.onicecandidate = ({ candidate }) => candidate && socket.emit('voice:signal', { to: userId, data: { candidate } });
      pc.ontrack = ({ track, streams }) => {
        const stream = streams[0] ?? new MediaStream([track]);
        setRemote((r) => {
          const list = r[userId] ?? [];
          return { ...r, [userId]: list.some((s) => s.id === stream.id) ? [...list] : [...list, stream] };
        });
        if (track.kind === 'audio') watchLevel(userId, stream);
        track.onended = () => setRemote((r) => ({ ...r }));
        stream.onremovetrack = () =>
          setRemote((r) => ({ ...r, [userId]: (r[userId] ?? []).filter((s) => s.getTracks().length > 0) }));
      };
      pc.onconnectionstatechange = () => {
        setPeerState((s) => ({ ...s, [userId]: pc.connectionState }));
        if (pc.connectionState === 'failed') pc.restartIce();
      };
      addLocalTracks(peer);
      // Make sure we can always receive audio even when we have no microphone.
      if (!local.current.mic) pc.addTransceiver('audio', { direction: 'recvonly' });
      return peer;
    },
    [me.id, socket, addLocalTracks, watchLevel],
  );

  const onSignal = useCallback(
    async ({ from, data }: { from: string; data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
      if (!roomRef.current) return;
      const peer = getPeer(from);
      const { pc } = peer;
      try {
        if (data.description) {
          const collision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
          peer.ignoreOffer = !peer.polite && collision;
          if (peer.ignoreOffer) return;
          await pc.setRemoteDescription(data.description);
          if (data.description.type === 'offer') {
            await pc.setLocalDescription();
            socket.emit('voice:signal', { to: from, data: { description: pc.localDescription } });
          }
        } else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (e) {
            if (!peer.ignoreOffer) throw e;
          }
        }
      } catch (e) {
        console.warn('signal failed', e);
      }
    },
    [getPeer, socket],
  );

  // ---- Local media ----

  const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

  const teardown = useCallback(() => {
    for (const id of [...peers.current.keys()]) closePeer(id);
    const l = local.current;
    stopStream(l.mic);
    stopStream(l.camera);
    stopStream(l.screen);
    local.current = { mic: null, camera: null, screen: null };
    analysers.current.forEach((a) => a.source.disconnect());
    analysers.current.clear();
    roomRef.current = null;
    setMic(null);
    setCamera(null);
    setScreen(null);
    setRemote({});
    setSpeaking(new Set());
    setPeerState({});
    setChannelId(null);
  }, [closePeer]);

  const leave = useCallback(() => {
    if (roomRef.current) socket.emit('voice:leave');
    teardown();
  }, [socket, teardown]);

  const join = useCallback(
    async (target: string, opts: { video?: boolean } = {}) => {
      if (roomRef.current === target) return;
      if (roomRef.current) leave();
      setError('');
      setConnecting(true);
      try {
        if (!iceServers.current) iceServers.current = (await api.get<{ iceServers: RTCIceServer[] }>('/rtc-config')).iceServers;
        let micStream: MediaStream | null = null;
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch {
          setError('Microphone blocked. You can still listen; allow mic access in your browser to talk.');
        }
        local.current.mic = micStream;
        if (micStream) {
          micStream.getAudioTracks().forEach((t) => (t.enabled = !flags.current.muted && !flags.current.deafened));
          watchLevel(me.id, micStream);
        }
        setMic(micStream);
        const res = await new Promise<{ ok?: boolean; error?: string; participants?: VoiceParticipant[] }>((resolve) =>
          socket.emit('voice:join', { channelId: target }, resolve),
        );
        if (!res.ok) {
          stopStream(micStream);
          local.current.mic = null;
          setMic(null);
          setError(res.error ?? 'Could not join voice');
          return;
        }
        roomRef.current = target;
        setChannelId(target);
        setIncoming((c) => (c?.channelId === target ? null : c));
        setRooms((r) => ({ ...r, [target]: res.participants ?? [] }));
        // The newcomer opens a connection to everyone already in the room.
        for (const p of res.participants ?? []) if (p.userId !== me.id) getPeer(p.userId);
        if (!micStream) flags.current.muted = true;
        setMuted(flags.current.muted);
        sendState();
        if (opts.video) await toggleCameraRef.current?.();
      } finally {
        setConnecting(false);
      }
    },
    [leave, socket, me.id, getPeer, sendState, watchLevel],
  );

  const toggleMute = useCallback(() => {
    if (!local.current.mic && roomRef.current) {
      setError('No microphone. Allow mic access in your browser, then rejoin.');
      return;
    }
    const next = !flags.current.muted;
    flags.current.muted = next;
    if (!next && flags.current.deafened) {
      flags.current.deafened = false;
      setDeafened(false);
    }
    local.current.mic?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
    sendState();
  }, [sendState]);

  const toggleDeafen = useCallback(() => {
    const next = !flags.current.deafened;
    flags.current.deafened = next;
    // Deafening also mutes you, like a headset switch.
    if (next) flags.current.muted = true;
    else if (local.current.mic) flags.current.muted = false;
    local.current.mic?.getAudioTracks().forEach((t) => (t.enabled = !flags.current.muted));
    setDeafened(next);
    setMuted(flags.current.muted);
    sendState();
  }, [sendState]);

  const publish = useCallback((stream: MediaStream) => {
    for (const peer of peers.current.values()) {
      for (const track of stream.getTracks()) peer.senders.set(track.id, peer.pc.addTrack(track, stream));
    }
  }, []);
  const unpublish = useCallback((stream: MediaStream) => {
    for (const peer of peers.current.values()) {
      for (const track of stream.getTracks()) {
        const sender = peer.senders.get(track.id);
        if (sender) {
          try {
            peer.pc.removeTrack(sender);
          } catch {
            /* connection already closed */
          }
          peer.senders.delete(track.id);
        }
      }
    }
    stopStream(stream);
  }, []);

  const toggleCamera = useCallback(async () => {
    if (!roomRef.current) return;
    const l = local.current;
    if (l.camera) {
      unpublish(l.camera);
      l.camera = null;
      setCamera(null);
    } else {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
        l.camera = cam;
        setCamera(cam);
        publish(cam);
      } catch {
        setError('Camera blocked or not found.');
        return;
      }
    }
    sendState();
  }, [publish, unpublish, sendState]);
  const toggleCameraRef = useRef<() => Promise<void>>(undefined);
  toggleCameraRef.current = toggleCamera;

  const toggleScreen = useCallback(async () => {
    if (!roomRef.current) return;
    const l = local.current;
    if (l.screen) {
      unpublish(l.screen);
      l.screen = null;
      setScreen(null);
    } else {
      try {
        const scr = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
        l.screen = scr;
        setScreen(scr);
        publish(scr);
        // The browser's own "Stop sharing" button ends the track.
        scr.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (local.current.screen === scr) {
            unpublish(scr);
            local.current.screen = null;
            setScreen(null);
            sendState();
          }
        });
      } catch {
        return; // user cancelled the picker
      }
    }
    sendState();
  }, [publish, unpublish, sendState]);

  // ---- Socket wiring ----

  useEffect(() => {
    const loadRooms = () => api.get<{ rooms: Record<string, VoiceParticipant[]> }>('/voice').then((r) => setRooms(r.rooms)).catch(() => {});
    loadRooms();
    const onState = ({ channelId: id, participants }: { channelId: string; participants: VoiceParticipant[] }) =>
      setRooms((r) => {
        if (participants.length === 0) {
          const { [id]: _gone, ...rest } = r;
          return rest;
        }
        return { ...r, [id]: participants };
      });
    const onLeft = ({ userId }: { userId: string }) => closePeer(userId);
    const onMoved = () => {
      teardown();
      setError('You joined voice somewhere else, so this window disconnected.');
    };
    const onRing = (call: IncomingCall) => {
      if (roomRef.current !== call.channelId) setIncoming(call);
    };
    const onEnd = ({ channelId: id }: { channelId: string }) => setIncoming((c) => (c?.channelId === id ? null : c));
    // A reconnect drops us from the room server-side, so rejoin.
    const onConnect = () => {
      loadRooms();
      const room = roomRef.current;
      if (room) {
        teardown();
        void join(room);
      }
    };
    socket.on('voice:state', onState);
    socket.on('voice:signal', onSignal);
    socket.on('voice:left', onLeft);
    socket.on('voice:moved', onMoved);
    socket.on('call:ring', onRing);
    socket.on('call:end', onEnd);
    socket.on('connect', onConnect);
    return () => {
      socket.off('voice:state', onState);
      socket.off('voice:signal', onSignal);
      socket.off('voice:left', onLeft);
      socket.off('voice:moved', onMoved);
      socket.off('call:ring', onRing);
      socket.off('call:end', onEnd);
      socket.off('connect', onConnect);
    };
  }, [socket, onSignal, closePeer, teardown, join]);

  // Stop the mic and camera if the provider goes away (signing out).
  const teardownRef = useRef(teardown);
  teardownRef.current = teardown;
  useEffect(() => () => teardownRef.current(), []);

  // Leave cleanly when the tab closes.
  useEffect(() => {
    const bye = () => roomRef.current && socket.emit('voice:leave');
    window.addEventListener('beforeunload', bye);
    return () => window.removeEventListener('beforeunload', bye);
  }, [socket]);

  const value = useMemo<VoiceState>(
    () => ({
      channelId,
      connecting,
      rooms,
      muted,
      deafened,
      camera,
      screen,
      mic,
      remote,
      speaking,
      peerState,
      error,
      incoming,
      join,
      leave,
      toggleMute,
      toggleDeafen,
      toggleCamera,
      toggleScreen,
      dismissIncoming: () => setIncoming(null),
      clearError: () => setError(''),
    }),
    [channelId, connecting, rooms, muted, deafened, camera, screen, mic, remote, speaking, peerState, error, incoming, join, leave, toggleMute, toggleDeafen, toggleCamera, toggleScreen],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

/** Plays everyone's audio. Rendered once, near the root, so calls survive navigation. */
export function VoiceAudio() {
  const { remote, deafened } = useVoice();
  return (
    <div hidden>
      {Object.entries(remote).flatMap(([userId, streams]) =>
        streams.filter((s) => s.getAudioTracks().length).map((s) => <RemoteAudio key={`${userId}-${s.id}`} stream={s} muted={deafened} />),
      )}
    </div>
  );
}

function RemoteAudio({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay muted={muted} />;
}

/** Find a participant's camera and screen streams by the ids they announced. */
export function streamsFor(p: VoiceParticipant, remote: MediaStream[] | undefined) {
  const live = (s?: MediaStream) => (s && s.getVideoTracks().some((t) => t.readyState === 'live') ? s : undefined);
  return {
    camera: p.video ? live(remote?.find((s) => s.id === p.streams.camera)) : undefined,
    screen: p.screen ? live(remote?.find((s) => s.id === p.streams.screen)) : undefined,
  };
}
