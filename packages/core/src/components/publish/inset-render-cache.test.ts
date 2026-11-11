import { afterEach, describe, expect, it, vi } from 'vitest';
import { InsetRenderCache, type CaptureablePlotElement } from './inset-render-cache';

const RECT = { w: 1000, h: 800 };

/** One inset over the same source region; `size` is its target's share of the plot. */
function inset(size = 0.2) {
  return {
    sourceRect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    targetRect: { x: 0.5, y: 0.5, w: size, h: size },
    border: 2,
    connector: 'lines' as const,
    pointSizeScale: 1,
  };
}

/** A plot that "renders" a sized stand-in canvas and counts its renders. */
function stubPlot() {
  let calls = 0;
  const plot = {
    captureAtResolution: (w: number, h: number) => {
      calls++;
      return { width: w, height: h } as HTMLCanvasElement;
    },
    getDataExtent: () => ({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 }),
    getRenderInfo: () => ({ marginLeft: 20, marginRight: 20, marginTop: 20, marginBottom: 20 }),
  } as unknown as CaptureablePlotElement;
  return { plot, calls: () => calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('InsetRenderCache', () => {
  it('capture caches by key and reuses the render', () => {
    const cache = new InsetRenderCache(vi.fn());
    const { plot, calls } = stubPlot();

    const [first] = cache.capture(plot, { insets: [inset()] }, RECT, '#ffffff');
    const [second] = cache.capture(plot, { insets: [inset()] }, RECT, '#ffffff');

    expect(calls()).toBe(1);
    expect(second).toBe(first);
    // Rendered at the target's pixel size: 0.2 × 1000 by 0.2 × 800.
    expect(first).toMatchObject({ width: 200, height: 160 });
    expect(cache.renders.size).toBe(1);
    expect(cache.lastCanvases).toEqual([first]);
  });

  it('a burst within 80 ms reuses the last render and asks for one redraw once it settles', () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    const cache = new InsetRenderCache(onSettle);
    const { plot, calls } = stubPlot();

    const [first] = cache.capture(plot, { insets: [inset(0.2)] }, RECT, '#ffffff');
    const [stretched] = cache.capture(plot, { insets: [inset(0.25)] }, RECT, '#ffffff');

    expect(calls()).toBe(1);
    expect(stretched).toBe(first);
    expect(cache.settleTimer).not.toBeNull();
    vi.advanceTimersByTime(120);
    expect(onSettle).toHaveBeenCalledOnce();
    expect(cache.settleTimer).toBeNull();
  });

  it('an export render skips the fast path', () => {
    const cache = new InsetRenderCache(vi.fn());
    const { plot, calls } = stubPlot();

    cache.capture(plot, { insets: [inset(0.2)] }, RECT, '#ffffff');
    cache.capture(plot, { insets: [inset(0.25)] }, RECT, '#ffffff', { forExport: true });

    expect(calls()).toBe(2);
  });

  it('clear drops it', () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    const cache = new InsetRenderCache(onSettle);
    const { plot, calls } = stubPlot();
    cache.capture(plot, { insets: [inset(0.2)] }, RECT, '#ffffff');
    cache.capture(plot, { insets: [inset(0.25)] }, RECT, '#ffffff');
    expect(cache.settleTimer).not.toBeNull();

    cache.clear();

    expect(cache.renders.size).toBe(0);
    expect(cache.lastCanvases).toEqual([]);
    expect(cache.settleTimer).toBeNull();
    vi.advanceTimersByTime(200);
    expect(onSettle).not.toHaveBeenCalled();
    // Nothing is left to reuse: the next capture renders afresh.
    cache.capture(plot, { insets: [inset(0.2)] }, RECT, '#ffffff');
    expect(calls()).toBe(2);
  });
});
