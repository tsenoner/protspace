import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LAYOUT,
  LAYOUT_QUERIES,
  LAYOUT_STORAGE_KEY,
  type LayoutState,
} from './layout-defaults';
import {
  focusFilterTitle,
  getLayout,
  openPanel,
  parseLayout,
  resetLayoutForTests,
  subscribeLayout,
  updateLayout,
} from './layout-state';
import { resetLayoutModeForTests } from './layout-mode';

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

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', storage);
  resetLayoutForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('layout store', () => {
  it('loads the defaults when nothing is stored', () => {
    expect(getLayout()).toEqual(DEFAULT_LAYOUT);
    expect(storage.getItem).toHaveBeenCalledWith(LAYOUT_STORAGE_KEY);
  });

  it('round-trips every field', () => {
    const layout: LayoutState = {
      sidebarOpen: false,
      sidebarWidth: 412,
      legendFraction: 0.35,
      structurePlacement: 'floating',
      floatingRect: { x: 40, y: 24, width: 360, height: 300 },
      panel: 'filter',
      panelFolded: true,
      structureHidden: true,
    };
    updateLayout(layout);
    resetLayoutForTests();
    expect(getLayout()).toEqual(layout);
  });

  it('falls back per field on wrong types, NaN, Infinity and an unknown placement', () => {
    expect(
      parseLayout({
        sidebarOpen: 'yes',
        sidebarWidth: Number.NaN,
        legendFraction: Number.POSITIVE_INFINITY,
        structurePlacement: 'sideways',
        floatingRect: 'bottom-right',
        panel: 'structure',
        panelFolded: 'yes',
        structureHidden: 'yes',
      }),
    ).toEqual(DEFAULT_LAYOUT);
    // A bad field leaves the good ones alone.
    expect(parseLayout({ sidebarOpen: false, sidebarWidth: '320', extra: 1 })).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarOpen: false,
    });
  });

  it('rounds and clamps the sidebar width to 240–480', () => {
    expect(parseLayout({ sidebarWidth: 100 }).sidebarWidth).toBe(240);
    expect(parseLayout({ sidebarWidth: 999 }).sidebarWidth).toBe(480);
    expect(parseLayout({ sidebarWidth: 301.6 }).sidebarWidth).toBe(302);
  });

  it('clamps the legend fraction to 0.2–0.8', () => {
    expect(parseLayout({ legendFraction: 0 }).legendFraction).toBe(0.2);
    expect(parseLayout({ legendFraction: 1 }).legendFraction).toBe(0.8);
    expect(parseLayout({ legendFraction: 0.63 }).legendFraction).toBe(0.63);
  });

  it('drops a floating rect with a non-finite number and raises a small one to 280 × 240', () => {
    expect(
      parseLayout({ floatingRect: { x: 1, y: 2, width: Number.NaN, height: 300 } }).floatingRect,
    ).toBeNull();
    expect(parseLayout({ floatingRect: { x: 1, y: 2, width: 300 } }).floatingRect).toBeNull();
    expect(
      parseLayout({ floatingRect: { x: 10.4, y: 20.6, width: 100, height: 50 } }).floatingRect,
    ).toEqual({ x: 10, y: 21, width: 280, height: 240 });
  });

  it('loads the defaults from garbage JSON, an array or null', () => {
    for (const raw of ['{not json', '[1, 2, 3]', 'null', '"text"']) {
      store.set(LAYOUT_STORAGE_KEY, raw);
      resetLayoutForTests();
      expect(getLayout()).toEqual(DEFAULT_LAYOUT);
    }
  });

  it('loads the defaults when getItem throws, and survives a throwing setItem', () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    });
    expect(getLayout()).toEqual(DEFAULT_LAYOUT);

    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    expect(() => updateLayout({ sidebarWidth: 360 })).not.toThrow();
    expect(getLayout().sidebarWidth).toBe(360);
  });

  it('returns the same object until a change', () => {
    const first = getLayout();
    expect(getLayout()).toBe(first);
    expect(storage.getItem).toHaveBeenCalledTimes(1);

    updateLayout({ sidebarOpen: false });
    const second = getLayout();
    expect(second).not.toBe(first);
    expect(getLayout()).toBe(second);
  });

  it('an equal patch neither notifies nor writes', () => {
    const listener = vi.fn();
    subscribeLayout(listener);
    const before = getLayout();

    updateLayout({ sidebarWidth: DEFAULT_LAYOUT.sidebarWidth, floatingRect: null });

    expect(listener).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(getLayout()).toBe(before);
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLayout(listener);
    updateLayout({ sidebarOpen: false });
    unsubscribe();
    updateLayout({ sidebarOpen: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('writes once per update, to protspace:layout:v1 only', () => {
    updateLayout({ sidebarWidth: 360 });
    updateLayout({ legendFraction: 0.3, structurePlacement: 'floating' });

    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual([
      'protspace:layout:v1',
      'protspace:layout:v1',
    ]);
    expect(JSON.parse(store.get('protspace:layout:v1')!)).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarWidth: 360,
      legendFraction: 0.3,
      structurePlacement: 'floating',
    });
  });

  it('panel defaults to legend, and an unknown panel falls back', () => {
    expect(getLayout().panel).toBe('legend');
    expect(parseLayout({ panel: 'filter' }).panel).toBe('filter');
    expect(parseLayout({ panel: 'Filter' }).panel).toBe('legend');
    expect(parseLayout({ panel: 3 }).panel).toBe('legend');
  });

  it('openPanel opens the sidebar on that panel, in one write', () => {
    updateLayout({ sidebarOpen: false });
    storage.setItem.mockClear();
    const listener = vi.fn();
    subscribeLayout(listener);

    openPanel('filter');

    expect(getLayout()).toMatchObject({ sidebarOpen: true, panel: 'filter' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('panelFolded parses, defaults to false and survives a round trip', () => {
    expect(getLayout().panelFolded).toBe(false);
    expect(parseLayout({ panelFolded: true }).panelFolded).toBe(true);
    expect(parseLayout({ panelFolded: 'yes' }).panelFolded).toBe(false);
    expect(parseLayout({ panelFolded: 1 }).panelFolded).toBe(false);

    updateLayout({ panelFolded: true });
    resetLayoutForTests();
    expect(getLayout().panelFolded).toBe(true);
  });

  it('structureHidden parses, defaults to false and survives a round trip', () => {
    expect(getLayout().structureHidden).toBe(false);
    expect(parseLayout({ structureHidden: true }).structureHidden).toBe(true);
    expect(parseLayout({ structureHidden: 1 }).structureHidden).toBe(false);

    updateLayout({ structureHidden: true });
    resetLayoutForTests();
    expect(getLayout().structureHidden).toBe(true);
  });

  it('an old stored layout without panelFolded loads unfolded', () => {
    store.set(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        sidebarOpen: false,
        sidebarWidth: 320,
        legendFraction: 0.4,
        structurePlacement: 'docked',
        floatingRect: null,
        panel: 'filter',
      }),
    );
    expect(getLayout()).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarOpen: false,
      sidebarWidth: 320,
      legendFraction: 0.4,
      panel: 'filter',
      panelFolded: false,
    });
  });

  it('openPanel unfolds', () => {
    updateLayout({ panelFolded: true, panel: 'legend' });
    storage.setItem.mockClear();
    const listener = vi.fn();
    subscribeLayout(listener);

    openPanel('filter');

    expect(getLayout()).toMatchObject({ sidebarOpen: true, panel: 'filter', panelFolded: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('panelFolded and sidebarOpen are independent', () => {
    updateLayout({ panelFolded: true });
    expect(getLayout()).toMatchObject({ panelFolded: true, sidebarOpen: true });
    updateLayout({ sidebarOpen: false });
    expect(getLayout()).toMatchObject({ panelFolded: true, sidebarOpen: false });
    updateLayout({ panelFolded: false });
    expect(getLayout()).toMatchObject({ panelFolded: false, sidebarOpen: false });
  });
});

describe('focusFilterTitle', () => {
  afterEach(() => resetLayoutModeForTests());

  it.each([
    [1280, 900, true],
    [800, 1000, true],
    [390, 844, true],
    [740, 360, false],
  ])(
    'at %i×%i px, lets focus scroll only on a phone on its side',
    (width, height, preventScroll) => {
      const title = { focus: vi.fn() };
      vi.stubGlobal('document', {
        getElementById: (id: string) => (id === 'wb-filter-title' ? title : null),
        activeElement: title,
      });
      vi.stubGlobal('window', {
        matchMedia: (query: string) => ({
          matches:
            query === LAYOUT_QUERIES.landscape
              ? width > height && height <= 500 && width < 951
              : query === LAYOUT_QUERIES.desktop
                ? width >= 951
                : query === LAYOUT_QUERIES.phone
                  ? width <= 640
                  : false,
          addEventListener() {},
          removeEventListener() {},
        }),
      });

      focusFilterTitle();

      expect(title.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll });
    },
  );
});
