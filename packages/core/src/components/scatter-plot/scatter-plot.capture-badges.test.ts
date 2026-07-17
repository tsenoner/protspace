/**
 * @vitest-environment jsdom
 *
 * #294/#301/#302: the figure editor captures the scatter-plot with
 * `resetView: true` so the points render at the default fit-all view. On that
 * (non-inset) path, captureAtResolution re-renders the badges at the OUTPUT
 * geometry: export-scale projection from the renderer facade, physical output
 * dims from the rendered webgl canvas, and the dots' own dpr×sizeScaleFactor
 * size rule. These tests pin the projection wiring; the controller-level
 * suite (duplicate-stack-overlay-controller.capture-badges.test.ts) pins
 * coverage and canvas geometry.
 *
 * Constructed via createElement without appending (no connectedCallback), so
 * the WebGL/canvas init never runs under jsdom. ResizeObserver is stubbed
 * before the element module is imported (the constructor news one up).
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
import { computeSizeScaleFactor } from './webgl';
import type { BadgeCaptureProjection } from './duplicate-stacks/duplicate-stack-types';

type CaptureInternals = HTMLElement & {
  _webglRenderer: unknown;
  _dupOverlay: { captureBadges(projection: BadgeCaptureProjection): unknown };
  captureAtResolution(
    width: number,
    height: number,
    options?: {
      dpr?: number;
      resetView?: boolean;
      dataDomain?: { xMin: number; xMax: number; yMin: number; yMax: number };
    },
  ): HTMLCanvasElement;
};

const fakeScales = { x: (n: number) => n, y: (n: number) => n };

function stubRenderer(el: CaptureInternals, opts: { scales?: typeof fakeScales | null } = {}) {
  const renderToCanvas = vi.fn((w: number, h: number, dpr: number) => {
    const c = document.createElement('canvas');
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    return c;
  });
  const createExportScales = vi.fn(() => (opts.scales === undefined ? fakeScales : opts.scales));
  el._webglRenderer = { renderToCanvas, createExportScales };
  return { renderToCanvas, createExportScales };
}

describe('scatter-plot captureAtResolution — badge projection wiring (#301/#302)', () => {
  let el: CaptureInternals;

  beforeEach(() => {
    el = document.createElement('protspace-scatterplot') as CaptureInternals;
  });

  it('passes the export-geometry projection to captureBadges when resetView is true', () => {
    const { createExportScales } = stubRenderer(el);
    const captureBadges = vi.spyOn(el._dupOverlay, 'captureBadges').mockReturnValue(null);

    el.captureAtResolution(1600, 400, { resetView: true });

    expect(captureBadges).toHaveBeenCalledTimes(1);
    const projection = captureBadges.mock.calls[0][0];
    // Physical output dims come straight from the rendered webgl canvas.
    expect(projection.width).toBe(1600);
    expect(projection.height).toBe(400);
    // Scales are the renderer facade's export scales — the dots' own mapping.
    expect(createExportScales).toHaveBeenCalledWith(1600, 400);
    expect(projection.scales).toBe(fakeScales);
    // badgeScale = dpr × sizeScaleFactor (default merged config is 800×600, dpr 1).
    expect(projection.badgeScale).toBeCloseTo(computeSizeScaleFactor(1600, 400, 800, 600));
  });

  it('applies dpr once (not dpr²): physical canvas dims, logical size reference', () => {
    stubRenderer(el);
    const captureBadges = vi.spyOn(el._dupOverlay, 'captureBadges').mockReturnValue(null);

    el.captureAtResolution(800, 600, { resetView: true, dpr: 2 });

    const projection = captureBadges.mock.calls[0][0];
    // The canvas is physical (dpr raises pixel density, not composition).
    expect(projection.width).toBe(1600);
    expect(projection.height).toBe(1200);
    // sizeScaleFactor uses LOGICAL dims (800×600 → 1), so badgeScale = dpr × 1 = 2.
    // The old bug fed physical dims (1600×1200 → 2), giving dpr × 2 = 4 (dpr²).
    expect(projection.badgeScale).toBeCloseTo(2 * computeSizeScaleFactor(800, 600, 800, 600));
    expect(projection.badgeScale).toBeCloseTo(2);
  });

  it('skips badge capture when export scales are unavailable (null contract)', () => {
    stubRenderer(el, { scales: null });
    const captureBadges = vi.spyOn(el._dupOverlay, 'captureBadges').mockReturnValue(null);

    expect(() => el.captureAtResolution(800, 600, { resetView: true })).not.toThrow();
    expect(captureBadges).not.toHaveBeenCalled();
  });

  it('uses the live badge canvas (no re-render) when resetView is not requested', () => {
    stubRenderer(el);
    const captureBadges = vi.spyOn(el._dupOverlay, 'captureBadges').mockReturnValue(null);

    el.captureAtResolution(800, 600);

    expect(captureBadges).not.toHaveBeenCalled();
  });

  it('does not re-render badges on the inset (dataDomain) path even with resetView', () => {
    stubRenderer(el);
    const captureBadges = vi.spyOn(el._dupOverlay, 'captureBadges').mockReturnValue(null);

    el.captureAtResolution(200, 200, {
      resetView: true,
      dataDomain: { xMin: 0.1, xMax: 0.4, yMin: 0.1, yMax: 0.4 },
    });

    expect(captureBadges).not.toHaveBeenCalled();
  });
});
