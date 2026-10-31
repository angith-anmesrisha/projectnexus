import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Headphones,
  HeadphoneOff,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  MonitorOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  X,
} from 'lucide-react';
import { streamsFor, useVoice, type VoiceParticipant } from '../lib/voice';
import { useNexus } from '../lib/store';
import type { User } from '../lib/types';
import { Avatar } from './Avatar';

function VideoEl({ stream, mirror, contain }: { stream: MediaStream; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={`${mirror ? 'mirror' : ''} ${contain ? 'contain' : ''}`} />;
}

interface Tile {
  key: string;
  user: User;
  p: VoiceParticipant;
  stream?: MediaStream;
  kind: 'person' | 'screen';
  self: boolean;
}

/** Everyone in a voice room as tiles, with screen shares spotlighted. */
export function VoiceStage({ channelId, members, compact }: { channelId: string; members: User[]; compact?: boolean }) {
  const voice = useVoice();
  const { me } = useNexus();
  const [focus, setFocus] = useState<string | null>(null);
  const participants = voice.rooms[channelId] ?? [];
  const byId = useMemo(() => new Map(members.map((u) => [u.id, u])), [members]);
  const joined = voice.channelId === channelId;

  const tiles: Tile[] = [];
  for (const p of participants) {
    const self = p.userId === me.id;
    const user = self ? me : byId.get(p.userId);
    if (!user) continue;
    const s = self ? { camera: voice.camera ?? undefined, screen: voice.screen ?? undefined } : streamsFor(p, voice.remote[p.userId]);
    if (p.screen && s.screen) tiles.push({ key: `${p.userId}-screen`, user, p, stream: s.screen, kind: 'screen', self });
    tiles.push({ key: p.userId, user, p, stream: p.video ? s.camera : undefined, kind: 'person', self });
  }
  const spotlight = tiles.find((t) => t.key === focus) ?? (focus === null ? tiles.find((t) => t.kind === 'screen') : undefined);
  const rest = spotlight ? tiles.filter((t) => t !== spotlight) : tiles;

  const tile = (t: Tile, big = false) => {
    const talking = t.kind === 'person' && voice.speaking.has(t.user.id) && !t.p.muted;
    const state = !t.self && joined ? voice.peerState[t.user.id] : undefined;
    return (
      <div
        key={t.key}
        className={`vtile ${t.kind} ${talking ? 'talking' : ''} ${big ? 'big' : ''} ${t.stream ? 'has-video' : ''}`}
        style={{ ['--av' as string]: t.user.accent }}
        onDoubleClick={() => setFocus(focus === t.key ? null : t.key)}
      >
        {t.stream ? (
          <VideoEl stream={t.stream} mirror={t.self && t.kind === 'person'} contain={t.kind === 'screen'} />
        ) : (
          <div className="vtile-avatar">
            <Avatar user={t.user} size={big ? 112 : compact ? 56 : 84} showPresence={false} />
          </div>
        )}
        <div className="vtile-label">
          {t.kind === 'screen' ? <MonitorUp size={13} /> : t.p.muted ? <MicOff size={13} className="red" /> : <Mic size={13} />}
          {t.p.deafened && <HeadphoneOff size={13} className="red" />}
          <span>{t.kind === 'screen' ? `${t.user.displayName}'s screen` : t.self ? `${t.user.displayName} (you)` : t.user.displayName}</span>
          {state && state !== 'connected' && <span className="vtile-state">{state === 'failed' ? 'reconnecting' : 'connecting'}…</span>}
        </div>
        {!compact && (
          <button className="vtile-focus icon-btn sm" onClick={() => setFocus(focus === t.key ? null : t.key)} aria-label="Focus" data-tip={focus === t.key ? 'Back to grid' : 'Focus'}>
            <Maximize2 size={14} />
          </button>
        )}
      </div>
    );
  };

  if (participants.length === 0) return null;
  return (
    <div className={`vstage ${spotlight ? 'spot' : ''} ${compact ? 'compact' : ''}`} data-count={rest.length}>
      {spotlight && <div className="vstage-spot">{tile(spotlight, true)}</div>}
      <div className="vgrid">{rest.map((t) => tile(t))}</div>
    </div>
  );
}

export function VoiceControls({ onLeave, extra }: { onLeave?: () => void; extra?: ReactNode }) {
  const v = useVoice();
  return (
    <div className="vcontrols">
      <button className={`vbtn ${v.muted ? 'off' : ''}`} onClick={v.toggleMute} aria-label={v.muted ? 'Unmute' : 'Mute'} data-tip={v.muted ? 'Unmute' : 'Mute'} aria-pressed={v.muted}>
        {v.muted ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
      <button className={`vbtn ${v.deafened ? 'off' : ''}`} onClick={v.toggleDeafen} aria-label={v.deafened ? 'Undeafen' : 'Deafen'} data-tip={v.deafened ? 'Undeafen' : 'Deafen'} aria-pressed={v.deafened}>
        {v.deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
      </button>
      <button className={`vbtn ${v.camera ? 'on' : ''}`} onClick={v.toggleCamera} aria-label={v.camera ? 'Turn camera off' : 'Turn camera on'} data-tip="Camera" aria-pressed={!!v.camera}>
        {v.camera ? <Video size={20} /> : <VideoOff size={20} />}
      </button>
      <button className={`vbtn ${v.screen ? 'on' : ''}`} onClick={v.toggleScreen} aria-label={v.screen ? 'Stop sharing' : 'Share your screen'} data-tip={v.screen ? 'Stop sharing' : 'Share screen'} aria-pressed={!!v.screen}>
        {v.screen ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
      </button>
      {extra}
      <button className="vbtn leave" onClick={onLeave ?? v.leave} aria-label="Leave voice" data-tip="Leave">
        <PhoneOff size={20} />
      </button>
    </div>
  );
}

/** A community voice lounge, shown in the main area. */
export function VoiceRoomView({ channelId, name, topic, members, communityName }: { channelId: string; name: string; topic: string; members: User[]; communityName: string }) {
  const v = useVoice();
  const joined = v.channelId === channelId;
  const participants = v.rooms[channelId] ?? [];
  const byId = new Map(members.map((u) => [u.id, u]));
  return (
    <div className="voice-room">
      <header className="chat-head">
        <span className="chat-head-icon"><Volume2 size={20} /></span>
        <div className="chat-head-text">
          <h1>{name}</h1>
          <span className="chat-topic">{topic || `Voice lounge in ${communityName}`}</span>
        </div>
        <div className="chat-head-actions">
          <span className="voice-count">{participants.length} in voice</span>
        </div>
      </header>
      {v.error && (
        <div className="voice-error">
          {v.error}
          <button className="icon-btn sm" onClick={v.clearError} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
      <div className="voice-body">
        {joined ? (
          <VoiceStage channelId={channelId} members={members} />
        ) : (
          <div className="voice-lobby">
            <div className="voice-lobby-ring">
              <Volume2 size={40} />
            </div>
            <h2>{name}</h2>
            <p className="muted">
              {participants.length === 0
                ? 'Nobody is here yet. Jump in and others will see you in the channel list.'
                : `${participants.length} ${participants.length === 1 ? 'person is' : 'people are'} hanging out.`}
            </p>
            {participants.length > 0 && (
              <div className="avatar-stack big">
                {participants.slice(0, 8).map((p) => {
                  const u = byId.get(p.userId);
                  return u ? <Avatar key={p.userId} user={u} size={44} showPresence={false} /> : null;
                })}
              </div>
            )}
            <div className="voice-lobby-actions">
              <button className="btn primary xl glow" disabled={v.connecting} onClick={() => v.join(channelId)}>
                <Phone size={18} /> {v.connecting ? 'Connecting…' : 'Join voice'}
              </button>
              <button className="btn xl" disabled={v.connecting} onClick={() => v.join(channelId, { video: true })}>
                <Video size={18} /> Join with camera
              </button>
            </div>
          </div>
        )}
      </div>
      {joined && <VoiceControls />}
    </div>
  );
}

/** Floating "you're in voice" bar shown while browsing elsewhere in the app. */
export function VoiceDock({ hereChannelId, label, href }: { hereChannelId: string | null; label: string; href: string }) {
  const v = useVoice();
  const navigate = useNavigate();
  if (!v.channelId || v.channelId === hereChannelId) return null;
  const talking = [...v.speaking].length > 0;
  return (
    <div className="voice-dock glass">
      <button className="voice-dock-info" onClick={() => navigate(href)}>
        <span className={`voice-dot ${talking ? 'live' : ''}`} />
        <span>
          <b>Voice connected</b>
          <small>{label}</small>
        </span>
      </button>
      <button className={`icon-btn sm ${v.muted ? 'danger' : ''}`} onClick={v.toggleMute} aria-label={v.muted ? 'Unmute' : 'Mute'}>
        {v.muted ? <MicOff size={16} /> : <Mic size={16} />}
      </button>
      <button className={`icon-btn sm ${v.deafened ? 'danger' : ''}`} onClick={v.toggleDeafen} aria-label={v.deafened ? 'Undeafen' : 'Deafen'}>
        {v.deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
      </button>
      <button className="icon-btn sm danger" onClick={v.leave} aria-label="Leave voice">
        <PhoneOff size={16} />
      </button>
    </div>
  );
}

/** Ringing card for an incoming DM or group call. */
export function IncomingCallCard() {
  const v = useVoice();
  const navigate = useNavigate();
  const call = v.incoming;
  useEffect(() => {
    if (!call) return;
    // A soft repeating ring, synthesised so there is no audio file.
    let ctx: AudioContext | null = null;
    const ring = () => {
      try {
        ctx ??= new AudioContext();
        const now = ctx.currentTime;
        [0, 0.22].forEach((d) => {
          const o = ctx!.createOscillator();
          const g = ctx!.createGain();
          o.frequency.value = 660;
          g.gain.setValueAtTime(0.0001, now + d);
          g.gain.exponentialRampToValueAtTime(0.07, now + d + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.18);
          o.connect(g).connect(ctx!.destination);
          o.start(now + d);
          o.stop(now + d + 0.2);
        });
      } catch {
        /* audio blocked until interaction */
      }
    };
    ring();
    const t = window.setInterval(ring, 2200);
    const stop = window.setTimeout(() => v.dismissIncoming(), 45_000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
      void ctx?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.channelId]);
  if (!call) return null;
  return (
    <div className="incoming-call glass" role="alertdialog" aria-label={`Incoming call from ${call.from.displayName}`}>
      <div className="incoming-avatar" style={{ ['--av' as string]: call.from.accent }}>
        <Avatar user={call.from} size={64} showPresence={false} />
      </div>
      <div className="incoming-text">
        <b>{call.from.displayName}</b>
        <span className="muted small">{call.kind === 'group' ? 'started a group call' : 'is calling you'}</span>
      </div>
      <div className="incoming-actions">
        <button className="vbtn leave" onClick={v.dismissIncoming} aria-label="Decline">
          <PhoneOff size={20} />
        </button>
        <button
          className="vbtn accept"
          onClick={() => {
            navigate(`/messages/${call.channelId}`);
            void v.join(call.channelId);
          }}
          aria-label="Accept"
        >
          <Phone size={20} />
        </button>
      </div>
    </div>
  );
}
