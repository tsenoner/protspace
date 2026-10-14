import { getStorageItem, setStorageItem } from '@protspace/utils';
import {
  DEFAULT_THEME,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from './theme-defaults';

/**
 * The explore page's theme choice (design decision 16): System, Light or Dark, kept under its own
 * key beside the layout store. The React shell subscribes with useSyncExternalStore. The choice
 * is written as is to data-theme on the root Explore applies it to, and only while it is applied:
 * 'system' stays 'system' and the token sheet's media query follows the OS. No cross-tab sync:
 * another tab keeps its theme until it reloads.
 */

/** A choice from anything stored: one of THEME_CHOICES, else the default. */
export function parseTheme(raw: unknown): ThemeChoice {
  return THEME_CHOICES.includes(raw as ThemeChoice) ? (raw as ThemeChoice) : DEFAULT_THEME;
}

let theme: ThemeChoice | null = null;
let appliedRoot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The choice: read from storage on the first call (a throwing storage gives the default). */
export function getTheme(): ThemeChoice {
  theme ??= parseTheme(getStorageItem<unknown>(THEME_STORAGE_KEY, null));
  return theme;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Commits a choice: stored, written to the applied root and announced; the same choice does nothing. */
export function setTheme(choice: ThemeChoice): void {
  if (choice === getTheme()) return;
  theme = choice;
  setStorageItem(THEME_STORAGE_KEY, choice);
  if (appliedRoot) appliedRoot.dataset.theme = choice;
  for (const listener of [...listeners]) listener();
}

/**
 * Writes the choice to `root`'s data-theme and keeps it there until the returned cleanup, which
 * removes the attribute: the landing, privacy and docs pages keep their look.
 */
export function applyTheme(root: HTMLElement = document.documentElement): () => void {
  root.dataset.theme = getTheme();
  appliedRoot = root;
  return () => {
    delete root.dataset.theme;
    if (appliedRoot === root) appliedRoot = null;
  };
}

export function resetThemeForTests(): void {
  theme = null;
  appliedRoot = null;
  listeners.clear();
}
