import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, THEME_STORAGE_KEY } from './theme-defaults';
import {
  applyTheme,
  getTheme,
  parseTheme,
  resetThemeForTests,
  setTheme,
  subscribeTheme,
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
  clear: vi.fn(() => store.clear()),
  key: vi.fn((index: number) => [...store.keys()][index] ?? null),
  get length() {
    return store.size;
  },
};

/** `<html>` as the store sees it: only its dataset. */
let root: { dataset: Record<string, string | undefined> };
const asElement = (value: typeof root) => value as unknown as HTMLElement;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  root = { dataset: {} };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { documentElement: root });
  resetThemeForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme store', () => {
  it('defaults to DEFAULT_THEME with nothing stored', () => {
    expect(getTheme()).toBe(DEFAULT_THEME);
    expect(storage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it('defaults when storage throws', () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError: storage is disabled');
    });
    expect(getTheme()).toBe(DEFAULT_THEME);
  });

  it("parseTheme rejects 'blue', null, 1 and an object", () => {
    for (const raw of ['blue', 'Dark', null, undefined, 1, { theme: 'dark' }, ['dark']]) {
      expect(parseTheme(raw)).toBe(DEFAULT_THEME);
    }
    for (const choice of ['system', 'light', 'dark'] as const) {
      expect(parseTheme(choice)).toBe(choice);
    }
  });

  it('reads a stored JSON choice once', () => {
    store.set(THEME_STORAGE_KEY, '"dark"');
    expect(getTheme()).toBe('dark');
    expect(getTheme()).toBe('dark');
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it(`setTheme writes '"dark"' under protspace:theme, notifies once and sets the applied root's data-theme`, () => {
    applyTheme(asElement(root));
    const listener = vi.fn();
    subscribeTheme(listener);

    setTheme('dark');

    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('protspace:theme', '"dark"');
    expect(listener).toHaveBeenCalledOnce();
    expect(root.dataset.theme).toBe('dark');
    expect(getTheme()).toBe('dark');
  });

  it('setTheme with the current choice does nothing (no write, no notify)', () => {
    const listener = vi.fn();
    subscribeTheme(listener);

    setTheme(getTheme());

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('setTheme before applyTheme stores without touching any element', () => {
    setTheme('dark');

    expect(store.get(THEME_STORAGE_KEY)).toBe('"dark"');
    expect(root.dataset.theme).toBeUndefined();
    applyTheme(asElement(root));
    expect(root.dataset.theme).toBe('dark');
  });

  it('applyTheme sets data-theme and its cleanup deletes it', () => {
    store.set(THEME_STORAGE_KEY, '"dark"');
    // No argument: the document's root element, as Explore.tsx calls it.
    const cleanup = applyTheme();
    expect(root.dataset.theme).toBe('dark');

    cleanup();
    expect('theme' in root.dataset).toBe(false);
    // The root is forgotten: a later choice is stored but never written back onto it.
    setTheme('system');
    expect('theme' in root.dataset).toBe(false);
    expect(store.get(THEME_STORAGE_KEY)).toBe('"system"');
  });

  it('an unsubscribed listener is not called', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    unsubscribe();

    setTheme('dark');

    expect(listener).not.toHaveBeenCalled();
  });
});
