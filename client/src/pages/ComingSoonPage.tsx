import { Icon, type IconName } from '../components/Icon';

const SECTIONS: Record<string, { icon: IconName; title: string; pitch: string; points: string[] }> = {
  feed: {
    icon: 'play',
    title: 'Feed',
    pitch: 'An immersive, vertical feed of gaming clips, montages and highlights.',
    points: ['Upload native clips with game tags', 'Share permitted YouTube and Twitch embeds', 'Follow creators and save favourites', 'Share any clip straight into a DM or community'],
  },
  news: {
    icon: 'news',
    title: 'News',
    pitch: 'Patch notes, releases and esports results for the games you follow, with links to the original sources.',
    points: ['Grouped by game and topic', 'Short summaries that keep the source and date', 'A daily briefing for your games', 'Nexus News bot posting into communities'],
  },
  tournaments: {
    icon: 'trophy',
    title: 'Tournaments',
    pitch: 'Run and join competitions without leaving your community.',
    points: ['Registration and team applications', 'Automatic brackets and schedules', 'Match reporting and result verification', 'Standings, disputes and announcements'],
  },
  notifications: {
    icon: 'bell',
    title: 'Notifications',
    pitch: 'One place for mentions, friend activity, community events and match reminders.',
    points: ['Mentions and replies', 'Friend requests', 'Event and tournament reminders', 'Per-community notification controls'],
  },
};

export function ComingSoonPage({ section }: { section: keyof typeof SECTIONS }) {
  const s = SECTIONS[section];
  return (
    <section className="panel coming-soon">
      <div className="soon-card">
        <span className="soon-icon"><Icon name={s.icon} size={36} /></span>
        <p className="eyebrow">Coming soon</p>
        <h1>{s.title}</h1>
        <p className="muted">{s.pitch}</p>
        <ul>
          {s.points.map((p) => (
            <li key={p}><Icon name="check" size={16} /> {p}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
