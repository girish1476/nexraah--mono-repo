'use client';

import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

/**
 * Dark mode is a per-viewer display preference, not a company setting, so it
 * lives in the browser rather than on the account or in `MODULE_ACCESS` —
 * every role gets the same switch, in the same place, and it never touches
 * anything the server knows about.
 *
 * The palette itself has been sitting complete in `globals.css` under
 * `:root[data-theme='dark']` since dark mode was designed; nothing before
 * this ever set the attribute, so it was unreachable from the app. This is
 * the other half.
 */
const STORAGE_KEY = 'nexraah-theme';

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    // Private browsing / storage blocked — fall back silently to light.
    return 'light';
  }
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Reads the stored preference on mount (the blocking script in `layout.tsx`
 * already applied it to `<html>` before first paint, so there is no flash of
 * the wrong theme — this just brings React's own state in sync with it) and
 * returns a toggle that flips the attribute and persists the choice.
 */
export function useTheme(): [ThemeMode, () => void] {
  const [theme, setThemeState] = useState<ThemeMode>('light');

  useEffect(() => {
    setThemeState(getStoredTheme());
  }, []);

  const toggle = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked — the toggle still works for this page load, it just
      // won't be remembered on the next visit.
    }
  };

  return [theme, toggle];
}
