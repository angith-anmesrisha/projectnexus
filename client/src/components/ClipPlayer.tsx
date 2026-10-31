import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clapperboard, Play, Volume2, VolumeX } from 'lucide-react';
import { api } from '../lib/api';
import type { Clip } from '../lib/types';

/** Plays a clip. Embeds only load while active so the feed stays light. */
export function ClipPlayer({ clip, active, muted, onToggleMute }: { clip: Clip; active: boolean; muted: boolean; onToggleMute: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) v.play().catch(() => {});
    else v.pause();
  }, [active]);

  if (clip.source === 'upload') {
    return (
      <div className="clip-media">
        <video ref={ref} src={clip.url} loop playsInline muted={muted} preload={active ? 'auto' : 'metadata'} onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())} />
        <button className="clip-mute" onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>
    );
  }
  if (!active) {
    return (
      <div className="clip-media poster">
        {clip.thumb ? <img src={clip.thumb} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Clapperboard size={42} />}
        <span className="clip-play"><Play size={28} /></span>
      </div>
    );
  }
  const src =
    clip.source === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${clip.url}?autoplay=1&mute=${muted ? 1 : 0}&loop=1&playlist=${clip.url}&playsinline=1&rel=0`
      : `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip.url)}&parent=${window.location.hostname}&autoplay=true&muted=${muted}`;
  return (
    <div className="clip-media">
      <iframe src={src} title={clip.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
    </div>
  );
}

/** A clip shared into chat, shown as a card linking to the feed. */
export function ClipEmbed({ id }: { id: string }) {
  const [clip, setClip] = useState<Clip | null | undefined>(undefined);
  useEffect(() => {
    api.get<{ clip: Clip }>(`/clips/${id}`).then((r) => setClip(r.clip)).catch(() => setClip(null));
  }, [id]);
  if (clip === undefined) return <div className="clip-embed skeleton" />;
  if (clip === null) return <div className="clip-embed gone">This clip was removed.</div>;
  return (
    <Link to={`/feed/${clip.id}`} className="clip-embed">
      <span className="clip-embed-thumb">
        {clip.source === 'upload' ? <video src={`${clip.url}#t=0.5`} muted preload="metadata" /> : clip.thumb ? <img src={clip.thumb} alt="" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Clapperboard size={28} />}
        <span className="clip-play sm"><Play size={18} /></span>
      </span>
      <span className="clip-embed-text">
        <b>{clip.title}</b>
        <span className="muted small">{clip.author?.displayName}{clip.game ? ` · ${clip.game}` : ''} · {clip.likes} likes</span>
      </span>
    </Link>
  );
}

/** A shared clip: an optional "🎬 title" line, then the /feed/<id> link, at the end of a message. */
export const CLIP_LINK = /(?:^|\n)(?:🎬 [^\n]*\n)?\/feed\/([0-9a-f-]{36})\s*$/u;
