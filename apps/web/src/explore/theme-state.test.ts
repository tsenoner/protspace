import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from './theme-defaults';
import {
  applyTheme,
  getResolvedTheme,
  getTheme,
  resetThemeForTests,
  setTheme,
  setThemeMode,
  subscribeTheme,
  toggleThemeMode,
} from './theme-state';

const store = new Map<string, string>();
const storage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
};

/** `<html>` as the store sees it: only its dataset. */
let root: { dataset: Record<string, string | undefined> };

/** The OS scheme, as matchMedia reports it, with its change listeners. */
const os = { dark: false, listeners: new Set<() => void>() };
const flipOs = (dark: boolean) => {
  os.dark = dark;
  for (const listener of [...os.listeners]) listener();
};

/** The window's storage listeners: another tab's write. */
const storageListeners = new Set<(event: { key: string | null }) => void>();
const otherTabWrites = (key: string, value: string | null) => {
  if (value === null) store.delete(key);
  else store.set(key, value);
  for (const listener of [...storageListeners]) listener({ key });
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  root = { dataset: {} };
  os.dark = false;
  os.listeners.clear();
  storageListeners.clear();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return os.dark;
    },
    addEventListener: (_: string, listener: () => void) => os.listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => os.listeners.delete(listener),
  }));
  vi.stubGlobal('window', {
    addEventListener: (_: string, listener: (event: { key: string | null }) => void) =>
      storageListeners.add(listener),
    removeEventListener: (_: string, listener: (event: { key: string | null }) => void) =>
      storageListeners.delete(listener),
  });
  resetThemeForTests();
});

afterEach(() => {
  resetThemeForTests();
  vi.unstubAllGlobals();
});

describe('theme store', () => {
  it('follows the system with nothing stored', () => {
    expect(getTheme()).toBe(DEFAULT_THEME);
    expect(getResolvedTheme()).toBe('light');
    os.dark = true;
    expect(getResolvedTheme()).toBe('dark');
  });

  it('follows the system when storage throws', () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError: storage is disabled');
    });
    expect(getTheme()).toBe(DEFAULT_THEME);
  });

  it('reads a stored raw choice once', () => {
    store.set(THEME_STORAGE_KEY, 'dark');
    expect(getTheme()).toBe('dark');
    expect(getTheme()).toBe('dark');
    expect(storage.getItem.mock.calls.filter(([key]) => key === THEME_STORAGE_KEY)).toHaveLength(1);
  });

  it('moves a legacy JSON choice to the shared key', () => {
    store.set(LEGACY_THEME_STORAGE_KEY, '"light"');
    expect(getTheme()).toBe('light');
    expect(Object.fromEntries(store)).toEqual({ [THEME_STORAGE_KEY]: 'light' });
  });

  it("moves a legacy override over VitePress's 'auto', never over a shared override", () => {
    // Any docs visit leaves 'auto' under the shared key: it must not erase Explore's Dark.
    store.set(LEGACY_THEME_STORAGE_KEY, '"dark"');
    store.set(THEME_STORAGE_KEY, 'auto');
    expect(getTheme()).toBe('dark');
    expect(Object.fromEntries(store)).toEqual({ [THEME_STORAGE_KEY]: 'dark' });

    resetThemeForTests();
    store.clear();
    store.set(LEGACY_THEME_STORAGE_KEY, '"dark"');
    store.set(THEME_STORAGE_KEY, 'light');
    expect(getTheme()).toBe('light');
    expect(Object.fromEntries(store)).toEqual({ [THEME_STORAGE_KEY]: 'light' });
  });

  it('a press on a light OS stores dark, applies it and notifies once', () => {
    const listener = vi.fn();
    subscribeTheme(listener);

    toggleThemeMode();

    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(THEME_STORAGE_KEY, 'dark');
    expect(listener).toHaveBeenCalledOnce();
    expect(root.dataset.theme).toBe('dark');
    expect(getResolvedTheme()).toBe('dark');
  });

  it("a press back to the OS's mode clears the key and follows the system", () => {
    toggleThemeMode();
    toggleThemeMode();

    expect(store.has(THEME_STORAGE_KEY)).toBe(false);
    expect(getTheme()).toBe('system');
    expect(root.dataset.theme).toBe('system');
    // Following the system again: an OS flip shows its mode.
    flipOs(true);
    expect(getResolvedTheme()).toBe('dark');
  });

  it('an override outlives an OS flip', () => {
    setTheme('light');
    flipOs(true);
    expect(getResolvedTheme()).toBe('light');
    expect(store.get(THEME_STORAGE_KEY)).toBe('light');
  });

  it("setThemeMode stores an override, and the OS's own mode as the system", () => {
    os.dark = true;
    setThemeMode('light');
    expect(getTheme()).toBe('light');
    setThemeMode('dark');
    expect(getTheme()).toBe('system');
    expect(store.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it('setTheme with the current choice does nothing (no write, no notify)', () => {
    const listener = vi.fn();
    subscribeTheme(listener);

    setTheme(getTheme());

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('applyTheme writes the choice to <html data-theme>', () => {
    store.set(THEME_STORAGE_KEY, 'dark');
    applyTheme();
    expect(root.dataset.theme).toBe('dark');
  });

  it('subscribers hear an OS flip, since the shown mode may change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    flipOs(true);
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    flipOs(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(os.listeners.size).toBe(0);
  });

  it("another tab's choice is applied and announced", () => {
    const listener = vi.fn();
    subscribeTheme(listener);
    expect(getTheme()).toBe('system');

    otherTabWrites(THEME_STORAGE_KEY, 'dark');
    expect(getTheme()).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(listener).toHaveBeenCalledOnce();

    // Another key, or the same choice again: nothing.
    otherTabWrites('protspace:layout', '{}');
    otherTabWrites(THEME_STORAGE_KEY, 'dark');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('an unsubscribed listener is not called', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    unsubscribe();

    setTheme('dark');

    expect(listener).not.toHaveBeenCalled();
  });
});
