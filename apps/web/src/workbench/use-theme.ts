import { useSyncExternalStore } from 'react';
import type { ThemeChoice } from '../explore/theme-defaults';
import { getTheme, subscribeTheme } from '../explore/theme-state';

/** The explore page's theme choice; re-renders when it changes. */
export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
