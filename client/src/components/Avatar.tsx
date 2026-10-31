import type { User } from '../lib/types';
import { presenceLabel } from '../lib/format';

export function Avatar({ user, size = 36, showPresence = true }: { user: Pick<User, 'displayName' | 'accent' | 'presence'>; size?: number; showPresence?: boolean }) {
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, ['--accent' as string]: user.accent }}>
      {initials}
      {showPresence && (
        <span className={`presence presence-${user.presence}`} title={presenceLabel[user.presence]} aria-label={presenceLabel[user.presence]} />
      )}
    </span>
  );
}

export function CommunityBadge({ name, accent, size = 40 }: { name: string; accent: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 3);
  return (
    <span className="community-badge" style={{ width: size, height: size, fontSize: size * 0.34, ['--accent' as string]: accent }}>
      {initials}
    </span>
  );
}
