import { useCallback, useSyncExternalStore } from 'react';

/** The person's choice of colour scheme: the system's, or light or dark whatever the system says. */
export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'mwc.theme';
const listeners = new Set<() => void>();
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** The choice saved in this browser (`index.html` applies it before the first paint). */
export function readThemeChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** Writes the choice to `<html data-theme>` (none for the system's) so `tokens.css` switches, and remembers it. */
export function setThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked (a private window): the choice lasts for this page only.
  }
  for (const listener of listeners) listener();
}

/** The scheme on screen now: the explicit choice, else what the system prefers. */
export function resolvedTheme(): ResolvedTheme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return darkQuery().matches ? 'dark' : 'light';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const query = darkQuery();
  query.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    query.removeEventListener('change', listener);
  };
}

/** The scheme on screen, kept current when the person or the system changes it. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, resolvedTheme, () => 'light');
}

/** The choice and a setter; `toggle` flips between light and dark from whatever is on screen. */
export function useThemeChoice() {
  const choice = useSyncExternalStore(subscribe, readThemeChoice, () => 'system' as const);
  const resolved = useResolvedTheme();
  const toggle = useCallback(() => setThemeChoice(resolved === 'dark' ? 'light' : 'dark'), [resolved]);
  return { choice, resolved, set: setThemeChoice, toggle };
}
