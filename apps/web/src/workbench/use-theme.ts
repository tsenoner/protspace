import { useState, useSyncExternalStore } from 'react';
import { THEME_MODE_LABELS, themeButtonLabel, type ThemeMode } from '../explore/theme-defaults';
import { getResolvedTheme, subscribeTheme, toggleThemeMode } from '../explore/theme-state';

/** The mode the page shows (System resolved against the OS); re-renders when it changes. */
export function useResolvedTheme(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, () => 'light');
}

/**
 * A theme button's state (Explore's app bar and Home's header): the mode on screen, the button's
 * name, and its press, which flips the mode and announces the new one. A screen reader may not
 * read the new name of the focused button, so the button renders `announcement` in a live region;
 * it stays empty until the first press, so loading the page announces nothing.
 */
export function useThemeToggle(): {
  mode: ThemeMode;
  label: string;
  announcement: string;
  toggle(): void;
} {
  const mode = useResolvedTheme();
  const [announcement, setAnnouncement] = useState('');
  const toggle = () => {
    toggleThemeMode();
    setAnnouncement(`Theme: ${THEME_MODE_LABELS[getResolvedTheme()]}`);
  };
  return { mode, label: themeButtonLabel(mode), announcement, toggle };
}
