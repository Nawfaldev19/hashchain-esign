import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'signoff-ledger-theme';
const listeners = new Set<() => void>();

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode). The choice then lasts until reload.
  }
  for (const listener of listeners) listener();
}

/** The active theme and a toggle. The first value is set by public/theme-init.js. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as const);
  const toggle = useCallback(() => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }, []);
  return { theme, toggle };
}
