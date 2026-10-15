import type * as Utils from '@protspace/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LayoutMode from '../explore/layout-mode';
import { getLayout, resetLayoutForTests, updateLayout } from '../explore/layout-state';
import { startTour } from './product-tour';
import { TOUR_STORAGE_KEY } from './storage-key';
import { tourSteps, type TourContext } from './tour-steps';

const driverApi = vi.hoisted(() => ({ drive: vi.fn(), setConfig: vi.fn(), destroy: vi.fn() }));
const layers = vi.hoisted(() => {
  const release = vi.fn();
  return {
    release,
    push: vi.fn((_layer: { close(): void; dismissOnOutsidePress?: boolean }) => release),
  };
});
const mode = vi.hoisted(() => ({
  value: 'desktop' as 'desktop' | 'tablet' | 'phone' | 'landscape',
}));
const modeListeners = vi.hoisted(() => new Set<() => void>());

vi.mock('driver.js', () => ({
  driver: () => ({
    ...driverApi,
    getActiveElement: (): undefined => undefined,
    moveNext: vi.fn(),
    movePrevious: vi.fn(),
  }),
}));
vi.mock('./product-tour.css', () => ({}));
// The real kit registers Lit elements, which node cannot load.
vi.mock('@protspace/core/kit', () => ({ pushLayer: layers.push }));
vi.mock('@protspace/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof Utils>()),
  isMacOrIos: () => false,
}));
vi.mock('../explore/layout-mode', async (importOriginal) => ({
  ...(await importOriginal<typeof LayoutMode>()),
  getLayoutMode: () => mode.value,
  subscribeLayoutMode: (listener: () => void) => {
    modeListeners.add(listener);
    return () => modeListeners.delete(listener);
  },
}));

type FakeElement = {
  getBoundingClientRect(): { width: number; height: number };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  classList: { remove(...names: string[]): void };
  shadowRoot: { querySelector(selector: string): FakeElement | null };
};

/** A shown element (or a 0×0 one), with attributes and an optional shadow root's contents. */
function fakeElement(
  size = 10,
  attributes: Record<string, string> = {},
  shadow: Record<string, FakeElement> = {},
): FakeElement {
  const attrs = new Map(Object.entries(attributes));
  return {
    getBoundingClientRect: () => ({ width: size, height: size }),
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
    classList: { remove: () => {} },
    shadowRoot: { querySelector: (selector) => shadow[selector] ?? null },
  };
}

const selector = (id: string) => `[data-driver-id="${id}"]`;
const DESKTOP: TourContext = { mode: 'desktop', coarse: false, mac: false };

const store = new Map<string, string>();
const media = { reduced: false, coarse: false };
let elements = new Map<string, FakeElement>();

/** Every desktop target shown, the Other row inside the legend's shadow root. */
function showDesktopTargets(): void {
  elements = new Map(
    ['data-actions', 'view-bar', 'search', 'scatterplot', 'selection', 'rail', 'theme', 'help'].map(
      (id) => [selector(id), fakeElement()],
    ),
  );
  elements.set(selector('legend'), fakeElement(10, {}, { [selector('other-row')]: fakeElement() }));
}

/** The app's TypeScript target has no `Array.prototype.at`. */
const last = <T>(items: readonly T[]): T => items[items.length - 1];
const lastConfig = () =>
  last(driverApi.setConfig.mock.calls)[0] as {
    animate: boolean;
    steps: Array<{ popover?: { title?: string } }>;
  };
const drivenTitles = () => lastConfig().steps.map((step) => step.popover?.title);
const lastLayer = () => last(layers.push.mock.calls)[0];
const driven = () => vi.waitFor(() => expect(driverApi.drive).toHaveBeenCalledOnce());
/** Long enough for the two stubbed animation frames a start waits for. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  driverApi.drive.mockReset();
  media.reduced = false;
  media.coarse = false;
  mode.value = 'desktop';
  modeListeners.clear();
  showDesktopTargets();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string): void => void store.set(key, value),
    removeItem: (key: string): void => void store.delete(key),
  });
  vi.stubGlobal('document', {
    querySelector: (query: string) => elements.get(query) ?? null,
    getElementById: (): null => null,
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === '(prefers-reduced-motion: reduce)'
        ? media.reduced
        : query === '(pointer: coarse)'
          ? media.coarse
          : false,
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  resetLayoutForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startTour', () => {
  it('opens a collapsed sidebar on the legend, unfolded, before driving', async () => {
    updateLayout({ sidebarOpen: false, panel: 'filter', panelFolded: true });
    let layoutWhenDriven: ReturnType<typeof getLayout> | undefined;
    driverApi.drive.mockImplementation(() => {
      layoutWhenDriven = getLayout();
    });

    startTour('full', { force: true });
    await driven();

    expect(layoutWhenDriven).toMatchObject({
      sidebarOpen: true,
      panel: 'legend',
      panelFolded: false,
    });
  });

  it.each([
    [true, false],
    [false, true],
  ])('under reduced motion %s, animates %s', async (reduced, animate) => {
    media.reduced = reduced;
    startTour('full', { force: true });
    await driven();
    expect(lastConfig().animate).toBe(animate);
  });

  it('writes the kind it starts under the tour key', async () => {
    startTour('whats-new');
    expect(store.get(TOUR_STORAGE_KEY)).toBe('whats-new');
    await driven();
  });

  it('does not start by itself once a tour was recorded', async () => {
    store.set(TOUR_STORAGE_KEY, 'whats-new');
    startTour('full');
    await settle();
    expect(driverApi.drive).not.toHaveBeenCalled();
    expect(store.get(TOUR_STORAGE_KEY)).toBe('whats-new');
  });

  it('starts when forced, whatever was recorded', async () => {
    store.set(TOUR_STORAGE_KEY, 'whats-new');
    startTour('full', { force: true });
    await driven();
    expect(store.get(TOUR_STORAGE_KEY)).toBe('full');
  });

  it('starts nothing and throws nothing when storage is blocked', async () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(() => startTour('full')).not.toThrow();
    await settle();
    expect(driverApi.drive).not.toHaveBeenCalled();
  });

  it('drops a step whose target is missing or has no box', async () => {
    elements.delete(selector('rail'));
    elements.set(selector('theme'), fakeElement(0));
    startTour('full', { force: true });
    await driven();
    expect(drivenTitles()).toEqual(
      tourSteps('full', DESKTOP)
        .map((step) => step.title)
        .filter((title) => title !== 'The Sidebar' && title !== 'Light or Dark'),
    );
  });

  it("drives the What's new list for whats-new", async () => {
    startTour('whats-new', { force: true });
    await driven();
    expect(drivenTitles()).toEqual(tourSteps('whats-new', DESKTOP).map((step) => step.title));
  });

  it('holds an Escape layer that ignores outside presses; closing it ends the tour', async () => {
    startTour('full', { force: true });
    await driven();
    const layer = lastLayer();
    expect(layer.dismissOnOutsidePress).toBe(false);
    driverApi.destroy.mockClear();
    layers.release.mockClear();

    layer.close();

    expect(driverApi.destroy).toHaveBeenCalledOnce();
    expect(layers.release).toHaveBeenCalledOnce();
  });

  it('gives each target back its own aria state when the tour ends', async () => {
    const actions = fakeElement(10, { 'aria-haspopup': 'dialog' });
    elements.set(selector('data-actions'), actions);
    startTour('full', { force: true });
    await driven();
    // What driver.js does to a highlighted element, and when it moves on.
    actions.setAttribute('aria-expanded', 'true');
    actions.removeAttribute('aria-haspopup');

    lastLayer().close();

    expect(actions.getAttribute('aria-haspopup')).toBe('dialog');
    expect(actions.getAttribute('aria-expanded')).toBeNull();
  });

  it('unmarks the Other row when the tour ends during the move onto it', async () => {
    const other = fakeElement();
    elements.set(selector('legend'), fakeElement(10, {}, { [selector('other-row')]: other }));
    startTour('full', { force: true });
    await driven();
    // What driver.js sets on the Other row; destroy() cleans only the step that settled.
    other.setAttribute('aria-expanded', 'true');

    lastLayer().close();

    expect(other.getAttribute('aria-expanded')).toBeNull();
  });

  it('ends when the layout mode changes, and lets go of its listener', async () => {
    startTour('full', { force: true });
    await driven();
    expect(modeListeners.size).toBe(1);
    driverApi.destroy.mockClear();
    for (const listener of [...modeListeners]) listener();
    expect(driverApi.destroy).toHaveBeenCalledOnce();
    expect(layers.release).toHaveBeenCalled();
    expect(modeListeners.size).toBe(0);
  });

  it('a second start before the first has measured drives once, the second kind', async () => {
    startTour('full', { force: true });
    startTour('whats-new', { force: true });
    await driven();
    await settle();
    expect(driverApi.drive).toHaveBeenCalledOnce();
    expect(drivenTitles()).toEqual(tourSteps('whats-new', DESKTOP).map((step) => step.title));
  });
});
