import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { NexusProvider } from './lib/store';
import type { Me } from './lib/types';
import { Shell } from './components/Shell';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { MessagesPage } from './pages/MessagesPage';
import { CommunitiesPage } from './pages/CommunitiesPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { SettingsPage } from './pages/SettingsPage';
import { InvitePage } from './pages/InvitePage';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<{ user: Me }>('/auth/me')
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }, []);

  const onLogout = useCallback(() => setMe(null), []);

  if (me === undefined) {
    return (
      <div className="splash">
        <span className="logo-mark big" />
      </div>
    );
  }
  if (me === null) return <AuthPage onAuthed={setMe} />;

  return (
    <NexusProvider initialMe={me} onLogout={onLogout}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="discover" element={<DiscoverPage />} />
          <Route path="feed" element={<ComingSoonPage section="feed" />} />
          <Route path="news" element={<ComingSoonPage section="news" />} />
          <Route path="communities" element={<CommunitiesPage />} />
          <Route path="communities/:communityId" element={<CommunitiesPage />} />
          <Route path="communities/:communityId/:channelId" element={<CommunitiesPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="messages/:channelId" element={<MessagesPage />} />
          <Route path="tournaments" element={<ComingSoonPage section="tournaments" />} />
          <Route path="notifications" element={<ComingSoonPage section="notifications" />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="invite/:code" element={<InvitePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </NexusProvider>
  );
}
