import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayoutMode } from './layout-defaults';
import { bindPhoneDim, touchDarkSource } from './phone-dim';
import { resetThemeForTests, setTheme } from './theme-state';

function fakeFlag(initial: boolean) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: boolean) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

function fakeMode(initial: LayoutMode) {
  let mode = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => mode,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: LayoutMode) {
      mode = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('bindPhoneDim', () => {
  it("fades unselected points less on a phone, and gives the plot's own fade back elsewhere", () => {
    const plot: { config?: Record<string, unknown> } = { config: { densityLayer: 'x' } };
    const source = fakeMode('desktop');
    const writes: unknown[] = [];
    const watched = {
      get config() {
        return plot.config;
      },
      set config(next) {
        writes.push(next);
        plot.config = next;
      },
    };
    const stop = bindPhoneDim(watched as never, source, fakeFlag(false));
    // Desktop: the plot's default stays, and nothing is written.
    expect(writes).toEqual([]);

    source.set('phone');
    expect(plot.config).toEqual({ densityLayer: 'x', fadedOpacity: 0.25 });
    source.set('landscape');
    expect(writes).toHaveLength(1);
    source.set('tablet');
    expect(plot.config).toEqual({ densityLayer: 'x', fadedOpacity: 0.15 });

    stop();
    source.set('phone');
    expect(plot.config!.fadedOpacity).toBe(0.15);
  });

  it('fades unselected points less on a dark touch screen of any layout, and only there', () => {
    const plot: { config?: Record<string, unknown> } = { config: {} };
    const source = fakeMode('tablet');
    const touchDark = fakeFlag(false);
    const stop = bindPhoneDim(plot as never, source, touchDark);
    // A light touch tablet, or a mouse in any theme: the plot's own fade.
    expect(plot.config!.fadedOpacity).toBeUndefined();

    touchDark.set(true);
    expect(plot.config!.fadedOpacity).toBe(0.25);
    source.set('desktop');
    expect(plot.config!.fadedOpacity).toBe(0.25);
    touchDark.set(false);
    expect(plot.config!.fadedOpacity).toBe(0.15);
    // A phone keeps its own lighter fade whatever the theme.
    source.set('phone');
    expect(plot.config!.fadedOpacity).toBe(0.25);

    stop();
    source.set('tablet');
    touchDark.set(true);
    expect(plot.config!.fadedOpacity).toBe(0.25);
    touchDark.set(false);
    expect(plot.config!.fadedOpacity).toBe(0.25);
  });
});

describe('touchDarkSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetThemeForTests();
  });

  it('is true for a coarse pointer under Dark, or System on a dark OS, and reports changes', () => {
    const queries = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
    vi.stubGlobal('localStorage', {
      getItem: (): null => null,
      setItem(): void {},
      removeItem(): void {},
    });
    vi.stubGlobal('matchMedia', (query: string) => {
      const entry = { matches: false, listeners: new Set<() => void>() };
      queries.set(query, entry);
      return {
        get matches() {
          return entry.matches;
        },
        addEventListener: (_: string, listener: () => void) => entry.listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => entry.listeners.delete(listener),
      };
    });
    const flip = (query: string, matches: boolean) => {
      const entry = queries.get(query)!;
      entry.matches = matches;
      for (const listener of entry.listeners) listener();
    };
    resetThemeForTests();
    const source = touchDarkSource();
    let calls = 0;
    const stop = source.subscribe(() => calls++);

    // System on a light OS, with a mouse.
    expect(source.get()).toBe(false);
    flip('(pointer: coarse)', true);
    expect(source.get()).toBe(false);
    flip('(prefers-color-scheme: dark)', true);
    expect(source.get()).toBe(true);
    setTheme('light');
    expect(source.get()).toBe(false);
    setTheme('dark');
    flip('(prefers-color-scheme: dark)', false);
    expect(source.get()).toBe(true);
    flip('(pointer: coarse)', false);
    expect(source.get()).toBe(false);
    expect(calls).toBe(6);

    stop();
    flip('(pointer: coarse)', true);
    setTheme('light');
    expect(calls).toBe(6);
  });
});
