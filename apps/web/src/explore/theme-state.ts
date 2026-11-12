import {
  chooseMode,
  otherMode,
  parseStoredTheme,
  resolveTheme,
  storedTheme,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  type ThemeMode,
} from './theme-defaults';

/**
 * The site's theme choice (design decision 16), shared with the docs under VitePress's key. The
 * React pages subscribe with useSyncExternalStore. The choice is written as is to <html
 * data-theme> on every page: 'system' stays 'system' and the token sheet's media query follows
 * the OS. Subscribers also hear when the OS scheme changes (the shown mode may change with it) and
 * when another tab, or the docs, store a new choice.
 */

let theme: ThemeChoice | null = null;
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

/** The OS dark-scheme query, made on first use; null where matchMedia is missing. */
let osDarkList: MediaQueryList | null | undefined;
function osDarkQuery(): MediaQueryList | null {
  if (osDarkList === undefined) {
    osDarkList =
      typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  }
  return osDarkList;
}

/** Whether the OS prefers dark (false where matchMedia is missing). */
function osDark(): boolean {
  return osDarkQuery()?.matches ?? false;
}

/**
 * The stored choice. The boot script (config/theme.ts), first on every app and docs page, has
 * already moved a legacy value over.
 */
function readStored(): ThemeChoice {
  try {
    return parseStoredTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return parseStoredTheme(null);
  }
}

function writeStored(choice: ThemeChoice): void {
  try {
    const value = storedTheme(choice);
    if (value === null) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** The choice: read from storage on the first call (a throwing storage gives the default). */
export function getTheme(): ThemeChoice {
  theme ??= readStored();
  return theme;
}

/** The mode the page shows: the choice, with System resolved against the OS. */
export function getResolvedTheme(): ThemeMode {
  return resolveTheme(getTheme(), osDark());
}

/** Writes the choice to <html data-theme>. The boot script already did on a cold load. */
export function applyTheme(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = getTheme();
}

/** Commits a choice: stored, applied and announced; the same choice does nothing. */
export function setTheme(choice: ThemeChoice): void {
  if (choice === getTheme()) return;
  theme = choice;
  writeStored(choice);
  applyTheme();
  notify();
}

/** Shows `mode`: an override, or back to the system when the OS shows it already. */
export function setThemeMode(mode: ThemeMode): void {
  setTheme(chooseMode(mode, osDark()));
}

/** The theme button's press: the other mode. */
export function toggleThemeMode(): void {
  setThemeMode(otherMode(getResolvedTheme()));
}

/** Listens to the OS scheme and to other tabs while anyone subscribes. */
function watch(): () => void {
  const media = osDarkQuery();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    const next = readStored();
    if (next === getTheme()) return;
    theme = next;
    applyTheme();
    notify();
  };
  media?.addEventListener('change', notify);
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    media?.removeEventListener('change', notify);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  stopWatching ??= watch();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

export function resetThemeForTests(): void {
  stopWatching?.();
  stopWatching = null;
  theme = null;
  osDarkList = undefined;
  listeners.clear();
}
