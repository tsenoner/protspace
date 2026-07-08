/**
 * @vitest-environment jsdom
 *
 * #294: the figure editor captures the scatter-plot with `resetView: true` so
 * the points render at the default fit-all view. The duplicate-stack badges are
 * a separate Canvas2D overlay whose live `_badgesCanvas` is positioned for the
 * live zoom/pan — compositing it as-is onto an unzoomed render would paste the
 * badges at their zoomed positions. These tests pin the fix: on the resetView
 * (non-inset) path, captureAtResolution re-renders the badges at the identity
 * transform via the overlay controller instead of using the live canvas.
 *
 * Constructed via createElement without appending (no connectedCallback), so the
 * WebGL/canvas init never runs under jsdom. ResizeObserver is stubbed before the
 * element module is imported (the constructor news one up).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';

type CaptureInternals = HTMLElement & {
  _webglRenderer: unknown;
  _dupOverlay: { captureBadges(transform: { x: number; y: number; k: number }): unknown };
  captureAtResolution(
    width: number,
    height: number,
    options?: {
      resetView?: boolean;
      dataDomain?: { xMin: number; xMax: number; yMin: number; yMax: number };
    },
  ): HTMLCanvasElement;
};

describe('scatter-plot captureAtResolution — badges respect resetView (#294)', () => {
  let el: CaptureInternals;

  beforeEach(() => {
    el = document.createElement('protspace-scatterplot') as CaptureInternals;
    // Stub the WebGL renderer so capture proceeds to the badge-composite step
    // without a real WebGL2 context (unavailable under jsdom).
    el._webglRenderer = { renderToCanvas: vi.fn(() => document.createElement('canvas')) };
  });

  it('re-renders badges at the identity transform when resetView is true', () => {
    const captureBadges = vi.spyOn(el._dupOverlay, 'captureBadges').mockReturnValue(null);

    el.captureAtResolution(800, 600, { resetView: true });

    expect(captureBadges).toHaveBeenCalledTimes(1);
    const transform = captureBadges.mock.calls[0][0];
    // d3.zoomIdentity — the default, unzoomed view.
    expect(transform.x).toBe(0);
    expect(transform.y).toBe(0);
    expect(transform.k).toBe(1);
  });

  it('uses the live badge canvas (no re-render) when resetView is not requested', () => {
    const captureBadges = vi.spyOn(el._dupOverlay, 'captureBadges').mockReturnValue(null);

    el.captureAtResolution(800, 600);

    expect(captureBadges).not.toHaveBeenCalled();
  });

  it('does not re-render badges on the inset (dataDomain) path even with resetView', () => {
    const captureBadges = vi.spyOn(el._dupOverlay, 'captureBadges').mockReturnValue(null);

    el.captureAtResolution(200, 200, {
      resetView: true,
      dataDomain: { xMin: 0.1, xMax: 0.4, yMin: 0.1, yMax: 0.4 },
    });

    expect(captureBadges).not.toHaveBeenCalled();
  });
});
