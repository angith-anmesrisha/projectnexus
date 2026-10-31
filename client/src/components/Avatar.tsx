import type { User } from '../lib/types';
import { presenceLabel } from '../lib/format';

type AvatarUser = Pick<User, 'displayName' | 'accent' | 'presence'> & { avatar?: string | null };

export function Avatar({ user, size = 36, showPresence = true }: { user: AvatarUser; size?: number; showPresence?: boolean }) {
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, ['--av' as string]: user.accent }}>
      {user.avatar ? <img src={user.avatar} alt="" /> : initials}
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
    <span className="community-badge" style={{ width: size, height: size, fontSize: size * 0.34, ['--cb' as string]: accent }}>
      {initials}
    </span>
  );
}
