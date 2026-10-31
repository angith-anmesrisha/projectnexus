import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { applyAppearance, normalize, type Appearance } from './appearance';
import { getSocket } from './socket';

const CACHE_KEY = 'nexus.appearance';

function readCache(): Appearance {
  try {
    return normalize(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null'));
  } catch {
    return normalize(null);
  }
}

function writeCache(a: Appearance) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(a));
  } catch {
    // Storage can be unavailable (private mode); the server copy still syncs.
  }
}

// Apply the cached look before React renders so there is no flash of the default theme.
const initial = readCache();
applyAppearance(initial);

interface AppearanceState {
  appearance: Appearance;
  update: (patch: Partial<Appearance> | ((a: Appearance) => Appearance)) => void;
  plugin: (id: string) => boolean;
  setPlugin: (id: string, on: boolean) => void;
  replace: (a: Appearance) => void;
}

const Ctx = createContext<AppearanceState | null>(null);

export function useAppearance(): AppearanceState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppearance must be used inside AppearanceProvider');
  return ctx;
}

/** Holds appearance settings, applies them live and syncs them to the account when signed in. */
export function AppearanceProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const [appearance, setAppearance] = useState(initial);
  const saveTimer = useRef<number | undefined>(undefined);
  const loaded = useRef(false);

  useEffect(() => {
    applyAppearance(appearance);
    writeCache(appearance);
  }, [appearance]);

  // Pull the account copy on sign-in and follow changes from other devices.
  useEffect(() => {
    if (!signedIn) return;
    loaded.current = false;
    api.get<{ prefs: unknown }>('/users/me/prefs').then((r) => {
      if (r.prefs && Object.keys(r.prefs as object).length) setAppearance(normalize(r.prefs));
      loaded.current = true;
    });
    const socket = getSocket();
    const onRemote = (p: unknown) => setAppearance(normalize(p));
    socket.on('prefs:update', onRemote);
    return () => {
      socket.off('prefs:update', onRemote);
    };
  }, [signedIn]);

  const persist = useCallback(
    (next: Appearance) => {
      if (!signedIn) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.put('/users/me/prefs', { prefs: next }).catch(() => {});
      }, 600);
    },
    [signedIn],
  );

  const update = useCallback<AppearanceState['update']>(
    (patch) => {
      setAppearance((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const replace = useCallback((a: Appearance) => update(() => normalize(a)), [update]);
  const plugin = useCallback((id: string) => !!appearance.plugins[id], [appearance.plugins]);
  const setPlugin = useCallback(
    (id: string, on: boolean) => update((a) => ({ ...a, plugins: { ...a.plugins, [id]: on } })),
    [update],
  );

  return <Ctx.Provider value={{ appearance, update, plugin, setPlugin, replace }}>{children}</Ctx.Provider>;
}
