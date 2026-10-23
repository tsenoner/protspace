import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_MIN_WIDTH,
  LANDSCAPE_PHONE_MAX_HEIGHT,
  LAYOUT_QUERIES,
  PHONE_MAX_WIDTH,
  type LayoutMode,
} from './layout-defaults';
import {
  getLayoutMode,
  hasStructureSheet,
  resetLayoutModeForTests,
  resolveLayoutMode,
  subscribeLayoutMode,
} from './layout-mode';

interface Size {
  width: number;
  height: number;
}

/**
 * A window of `size` whose matchMedia answers the three layout queries, and only those: a query
 * string that drifts throws. `matches` is live, and resize() fires change on every list whose
 * answer changed, as browsers do.
 */
function fakeWindow(initial: Size) {
  let size = initial;
  const evaluate = (query: string): boolean => {
    const { width, height } = size;
    if (query === '(orientation: landscape) and (max-height: 500px) and (max-width: 950px)') {
      return width > height && height <= 500 && width <= 950;
    }
    if (query === '(min-width: 951px)') return width >= 951;
    if (query === '(max-width: 640px)') return width <= 640;
    throw new Error(`Unexpected media query: ${query}`);
  };
  const lists: Array<{ query: string; last: boolean; events: EventTarget }> = [];
  const matchMedia = vi.fn((query: string) => {
    const entry = { query, last: evaluate(query), events: new EventTarget() };
    lists.push(entry);
    return {
      media: query,
      get matches() {
        return evaluate(query);
      },
      addEventListener: entry.events.addEventListener.bind(entry.events),
      removeEventListener: entry.events.removeEventListener.bind(entry.events),
    };
  });
  vi.stubGlobal('window', { matchMedia });
  return {
    matchMedia,
    resize(next: Size) {
      size = next;
      for (const entry of lists) {
        const now = evaluate(entry.query);
        if (now === entry.last) continue;
        entry.last = now;
        entry.events.dispatchEvent(new Event('change'));
      }
    },
  };
}

beforeEach(() => resetLayoutModeForTests());

afterEach(() => {
  resetLayoutModeForTests();
  vi.unstubAllGlobals();
});

describe('layout queries', () => {
  it('are exactly these strings, from the breakpoint constants', () => {
    expect(LAYOUT_QUERIES).toEqual({
      landscape: '(orientation: landscape) and (max-height: 500px) and (max-width: 950px)',
      desktop: '(min-width: 951px)',
      phone: '(max-width: 640px)',
    });
    expect([DESKTOP_MIN_WIDTH, PHONE_MAX_WIDTH, LANDSCAPE_PHONE_MAX_HEIGHT]).toEqual([
      951, 640, 500,
    ]);
  });
});

describe('resolveLayoutMode', () => {
  it('takes landscape first, then desktop, then phone, else tablet', () => {
    expect(resolveLayoutMode({ landscape: true, desktop: true, phone: true })).toBe('landscape');
    expect(resolveLayoutMode({ landscape: false, desktop: true, phone: true })).toBe('desktop');
    expect(resolveLayoutMode({ landscape: false, desktop: false, phone: true })).toBe('phone');
    expect(resolveLayoutMode({ landscape: false, desktop: false, phone: false })).toBe('tablet');
  });
});

describe('getLayoutMode', () => {
  it.each<[number, number, LayoutMode]>([
    [1280, 720, 'desktop'],
    // A short desktop window is no phone on its side: landscape stops at 950 px wide.
    [1024, 420, 'desktop'],
    [951, 400, 'desktop'],
    [950, 1024, 'tablet'],
    [641, 900, 'tablet'],
    [640, 900, 'phone'],
    [390, 844, 'phone'],
    [915, 412, 'landscape'],
    [740, 360, 'landscape'],
    [640, 360, 'landscape'],
    [950, 500, 'landscape'],
    [950, 501, 'tablet'],
  ])('%i × %i is %s', (width, height, mode) => {
    fakeWindow({ width, height });
    expect(getLayoutMode()).toBe(mode);
  });

  it('makes the three lists once and returns the same mode until one fires change', () => {
    const win = fakeWindow({ width: 1280, height: 720 });
    expect(getLayoutMode()).toBe('desktop');
    expect(getLayoutMode()).toBe('desktop');
    expect(win.matchMedia).toHaveBeenCalledTimes(3);

    win.resize({ width: 390, height: 844 });
    expect(getLayoutMode()).toBe('phone');
    expect(win.matchMedia).toHaveBeenCalledTimes(3);
  });
});

describe('subscribeLayoutMode', () => {
  it('notifies once per resolved change, and not for a change that keeps the mode', () => {
    const win = fakeWindow({ width: 1280, height: 720 });
    const listener = vi.fn();
    subscribeLayoutMode(listener);

    win.resize({ width: 800, height: 800 }); // desktop list fires: tablet
    expect(listener).toHaveBeenCalledTimes(1);
    win.resize({ width: 700, height: 800 }); // no list fires
    expect(listener).toHaveBeenCalledTimes(1);
    win.resize({ width: 700, height: 400 }); // landscape list fires: landscape
    expect(listener).toHaveBeenCalledTimes(2);
    win.resize({ width: 600, height: 400 }); // phone list fires, landscape still wins
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getLayoutMode()).toBe('landscape');
    win.resize({ width: 1280, height: 400 }); // three lists fire, one change: desktop
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getLayoutMode()).toBe('desktop');
  });

  it('stops notifying once unsubscribed', () => {
    const win = fakeWindow({ width: 1280, height: 720 });
    const listener = vi.fn();
    const unsubscribe = subscribeLayoutMode(listener);
    unsubscribe();
    win.resize({ width: 390, height: 844 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('hasStructureSheet', () => {
  it('is true on a phone, upright or on its side, only', () => {
    expect(hasStructureSheet('phone')).toBe(true);
    expect(hasStructureSheet('landscape')).toBe(true);
    expect(hasStructureSheet('tablet')).toBe(false);
    expect(hasStructureSheet('desktop')).toBe(false);
  });
});
