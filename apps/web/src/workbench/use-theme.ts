import { useSyncExternalStore } from 'react';
import type { ThemeMode } from '../explore/theme-defaults';
import { getResolvedTheme, subscribeTheme } from '../explore/theme-state';

/** The mode the page shows (System resolved against the OS); re-renders when it changes. */
export function useResolvedTheme(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, () => 'light');
}
