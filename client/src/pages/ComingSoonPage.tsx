import { Bell, Check, Clapperboard, Newspaper, Trophy, type LucideIcon } from 'lucide-react';

const SECTIONS: Record<string, { icon: LucideIcon; title: string; pitch: string; points: string[] }> = {
  feed: {
    icon: Clapperboard,
    title: 'Feed',
    pitch: 'An immersive, vertical feed of gaming clips, montages and highlights.',
    points: ['Upload native clips with game tags', 'Share permitted YouTube and Twitch embeds', 'Follow creators and save favourites', 'Share any clip straight into a chat'],
  },
  news: {
    icon: Newspaper,
    title: 'News',
    pitch: 'Patch notes, releases and esports results for the games you follow, always linked to the source.',
    points: ['Grouped by game and topic', 'Short summaries that keep the source and date', 'A daily briefing for your games', 'Nexus News bot posting into communities'],
  },
  tournaments: {
    icon: Trophy,
    title: 'Tournaments',
    pitch: 'Run and join competitions without leaving your community.',
    points: ['Registration and team applications', 'Automatic brackets and schedules', 'Match reporting and verification', 'Standings, disputes and announcements'],
  },
  notifications: {
    icon: Bell,
    title: 'Inbox',
    pitch: 'One place for mentions, friend activity, events and match reminders.',
    points: ['Mentions and replies', 'Friend requests', 'Event and tournament reminders', 'Per-community notification controls'],
  },
};

export function ComingSoonPage({ section }: { section: keyof typeof SECTIONS }) {
  const s = SECTIONS[section];
  return (
    <div className="workspace single">
      <section className="main glass soon-wrap">
        <div className="soon">
          <span className="soon-icon"><s.icon size={38} /></span>
          <p className="eyebrow">Coming soon</p>
          <h1>{s.title}</h1>
          <p className="muted">{s.pitch}</p>
          <ul>
            {s.points.map((p) => (
              <li key={p}><Check size={16} /> {p}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
