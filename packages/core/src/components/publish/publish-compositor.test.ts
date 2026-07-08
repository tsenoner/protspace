/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeLayout,
  computeInsetBoost,
  composeFigure,
  MAX_CANVAS_PIXELS,
  capturePlotCanvas,
  waitForFonts,
} from './publish-compositor';
import { createDefaultPublishState } from './publish-state';
import type { LegendLayout } from './publish-state';

function makeLegend(overrides: Partial<LegendLayout> = {}): LegendLayout {
  return {
    visible: true,
    position: 'right',
    widthPercent: 20,
    fontSizePx: 15,
    columns: 1,
    overflow: 'multi-column',
    ...overrides,
  };
}

describe('publish-compositor', () => {
  describe('computeLayout', () => {
    const W = 2000;
    const H = 1000;

    it('right position reserves legend on the right', () => {
      const { plotRect, legendRect } = computeLayout(W, H, makeLegend({ position: 'right' }));
      expect(legendRect).not.toBeNull();
      expect(legendRect!.x).toBeGreaterThan(0);
      expect(legendRect!.x + legendRect!.w).toBe(W);
      expect(plotRect.x).toBe(0);
      expect(plotRect.w + legendRect!.w).toBe(W);
    });

    it('left position reserves legend on the left', () => {
      const { plotRect, legendRect } = computeLayout(W, H, makeLegend({ position: 'left' }));
      expect(legendRect).not.toBeNull();
      expect(legendRect!.x).toBe(0);
      expect(plotRect.x).toBe(legendRect!.w);
      expect(plotRect.w + legendRect!.w).toBe(W);
    });

    it('top position reserves legend at the top', () => {
      const { plotRect, legendRect } = computeLayout(W, H, makeLegend({ position: 'top' }));
      expect(legendRect).not.toBeNull();
      expect(legendRect!.y).toBe(0);
      expect(plotRect.y).toBe(legendRect!.h);
      expect(plotRect.h + legendRect!.h).toBe(H);
    });

    it('bottom position reserves legend at the bottom', () => {
      const { plotRect, legendRect } = computeLayout(W, H, makeLegend({ position: 'bottom' }));
      expect(legendRect).not.toBeNull();
      expect(legendRect!.y + legendRect!.h).toBe(H);
      expect(plotRect.y).toBe(0);
      expect(plotRect.h + legendRect!.h).toBe(H);
    });

    it('corner positions give full canvas to plot', () => {
      for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
        const { plotRect, legendRect } = computeLayout(W, H, makeLegend({ position: pos }));
        expect(plotRect.x).toBe(0);
        expect(plotRect.y).toBe(0);
        expect(plotRect.w).toBe(W);
        expect(plotRect.h).toBe(H);
        expect(legendRect).not.toBeNull();
      }
    });

    it('tr corner places legend in top-right', () => {
      const { legendRect } = computeLayout(W, H, makeLegend({ position: 'tr' }));
      expect(legendRect).not.toBeNull();
      expect(legendRect!.x + legendRect!.w).toBe(W);
      expect(legendRect!.y).toBe(0);
    });

    it('bl corner places legend in bottom-left', () => {
      const { legendRect } = computeLayout(W, H, makeLegend({ position: 'bl' }));
      expect(legendRect).not.toBeNull();
      expect(legendRect!.x).toBe(0);
      expect(legendRect!.y + legendRect!.h).toBe(H);
    });

    it('br corner places legend in bottom-right', () => {
      const { legendRect } = computeLayout(W, H, makeLegend({ position: 'br' }));
      expect(legendRect).not.toBeNull();
      expect(legendRect!.x + legendRect!.w).toBe(W);
      expect(legendRect!.y + legendRect!.h).toBe(H);
    });

    it('tl corner places legend in top-left', () => {
      const { legendRect } = computeLayout(W, H, makeLegend({ position: 'tl' }));
      expect(legendRect).not.toBeNull();
      expect(legendRect!.x).toBe(0);
      expect(legendRect!.y).toBe(0);
    });

    it('none position returns null legendRect', () => {
      const { plotRect, legendRect } = computeLayout(W, H, makeLegend({ position: 'none' }));
      expect(legendRect).toBeNull();
      expect(plotRect.w).toBe(W);
      expect(plotRect.h).toBe(H);
    });

    it('invisible legend returns null legendRect', () => {
      const { legendRect } = computeLayout(W, H, makeLegend({ visible: false }));
      expect(legendRect).toBeNull();
    });

    it('legend width respects widthPercent for side positions', () => {
      const { legendRect } = computeLayout(
        W,
        H,
        makeLegend({ position: 'right', widthPercent: 30 }),
      );
      expect(legendRect).not.toBeNull();
      expect(legendRect!.w).toBe(Math.round(W * 0.3));
    });

    it('top position uses widthPercent as height fraction', () => {
      const pct = 25;
      const { legendRect } = computeLayout(
        W,
        H,
        makeLegend({ position: 'top', widthPercent: pct }),
      );
      expect(legendRect).not.toBeNull();
      expect(legendRect!.h).toBe(Math.round(H * (pct / 100)));
      expect(legendRect!.w).toBe(W);
    });

    it('bottom position uses widthPercent as height fraction', () => {
      const pct = 30;
      const { legendRect } = computeLayout(
        W,
        H,
        makeLegend({ position: 'bottom', widthPercent: pct }),
      );
      expect(legendRect).not.toBeNull();
      expect(legendRect!.h).toBe(Math.round(H * (pct / 100)));
    });

    it('all side positions correctly sum to full width/height', () => {
      for (const pos of ['right', 'left'] as const) {
        const { plotRect, legendRect } = computeLayout(W, H, makeLegend({ position: pos }));
        expect(plotRect.w + legendRect!.w).toBe(W);
        expect(plotRect.h).toBe(H);
        expect(legendRect!.h).toBe(H);
      }
      for (const pos of ['top', 'bottom'] as const) {
        const { plotRect, legendRect } = computeLayout(W, H, makeLegend({ position: pos }));
        expect(plotRect.h + legendRect!.h).toBe(H);
        expect(plotRect.w).toBe(W);
        expect(legendRect!.w).toBe(W);
      }
    });

    it('corner legend height uses visibleItemCount when provided', () => {
      const { legendRect: noCount } = computeLayout(
        W,
        H,
        makeLegend({ position: 'tr', widthPercent: 20 }),
      );
      const { legendRect: withCount } = computeLayout(
        W,
        H,
        makeLegend({ position: 'tr', widthPercent: 20 }),
        3,
      );
      expect(noCount).not.toBeNull();
      expect(withCount).not.toBeNull();
      // With only 3 items, the legend should be shorter (tight) than the fallback 50%
      expect(withCount!.h).toBeLessThanOrEqual(noCount!.h);
    });
  });

  describe('free legend position', () => {
    it('returns full canvas for plotRect when legend is free', () => {
      const { plotRect, legendRect } = computeLayout(
        2000,
        1000,
        makeLegend({ position: 'free', widthPercent: 20 }),
      );
      expect(plotRect.w).toBe(2000);
      expect(plotRect.h).toBe(1000);
      expect(legendRect).not.toBeNull();
    });

    it('positions free legend using freePos coordinates', () => {
      const { legendRect } = computeLayout(
        2000,
        1000,
        makeLegend({
          position: 'free',
          widthPercent: 20,
          freePos: { nx: 0.5, ny: 0.3 },
        }),
      );
      expect(legendRect).not.toBeNull();
      expect(legendRect!.x).toBe(Math.round(2000 * 0.5));
      expect(legendRect!.y).toBe(Math.round(1000 * 0.3));
    });

    it('defaults free legend to center when no freePos', () => {
      const { legendRect } = computeLayout(
        2000,
        1000,
        makeLegend({ position: 'free', widthPercent: 20 }),
      );
      expect(legendRect).not.toBeNull();
      const expectedW = Math.round(2000 * 0.2);
      expect(legendRect!.x).toBe(Math.round((2000 - expectedW) / 2));
    });

    it('free legend uses tight height with visibleItemCount', () => {
      const { legendRect } = computeLayout(
        2000,
        1000,
        makeLegend({ position: 'free', widthPercent: 20 }),
        5,
      );
      expect(legendRect).not.toBeNull();
      // Should be tighter than 50% of canvas
      expect(legendRect!.h).toBeLessThan(500);
    });
  });

  describe('computeInsetBoost', () => {
    it('returns 1 when there are no insets', () => {
      expect(computeInsetBoost([])).toBe(1);
    });

    it('computes boost from target/source size ratio', () => {
      const insets = [
        {
          sourceRect: { x: 0, y: 0, w: 0.1, h: 0.1 },
          targetRect: { x: 0.5, y: 0.5, w: 0.3, h: 0.3 },
          border: 2,
          connector: 'lines' as const,
        },
      ];
      // 0.3 / 0.1 = 3x zoom → boost = 3
      expect(computeInsetBoost(insets)).toBe(3);
    });

    it('caps boost at maxBoost', () => {
      const insets = [
        {
          sourceRect: { x: 0, y: 0, w: 0.05, h: 0.05 },
          targetRect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
          border: 2,
          connector: 'lines' as const,
        },
      ];
      // 0.5 / 0.05 = 10x → capped at 4
      expect(computeInsetBoost(insets)).toBe(4);
      expect(computeInsetBoost(insets, 2)).toBe(2);
    });

    it('uses the max zoom across multiple insets', () => {
      const insets = [
        {
          sourceRect: { x: 0, y: 0, w: 0.2, h: 0.2 },
          targetRect: { x: 0.5, y: 0, w: 0.3, h: 0.3 },
          border: 2,
          connector: 'lines' as const,
        },
        {
          sourceRect: { x: 0, y: 0, w: 0.1, h: 0.1 },
          targetRect: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 },
          border: 2,
          connector: 'lines' as const,
        },
      ];
      // First: 0.3/0.2 = 1.5x, Second: 0.4/0.1 = 4x → boost = 4
      expect(computeInsetBoost(insets)).toBe(4);
    });

    it('uses max of width and height ratios', () => {
      const insets = [
        {
          sourceRect: { x: 0, y: 0, w: 0.1, h: 0.2 },
          targetRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.6 },
          border: 2,
          connector: 'lines' as const,
        },
      ];
      // width ratio: 0.2/0.1 = 2x, height ratio: 0.6/0.2 = 3x → boost = 3
      expect(computeInsetBoost(insets)).toBe(3);
    });

    it('returns 1 when target is smaller than source', () => {
      const insets = [
        {
          sourceRect: { x: 0, y: 0, w: 0.5, h: 0.5 },
          targetRect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
          border: 2,
          connector: 'lines' as const,
        },
      ];
      expect(computeInsetBoost(insets)).toBe(1);
    });
  });

  describe('capturePlotCanvas', () => {
    it('uses captureAtResolution when available', () => {
      const mockCanvas = document.createElement('canvas');
      mockCanvas.width = 800;
      mockCanvas.height = 400;

      const plotEl = document.createElement('div') as HTMLElement & {
        captureAtResolution?: () => HTMLCanvasElement;
      };
      plotEl.captureAtResolution = () => mockCanvas;

      const result = capturePlotCanvas(plotEl, {
        width: 800,
        height: 400,
        backgroundColor: '#ffffff',
      });
      expect(result).toBe(mockCanvas);
    });

    // The figure editor relies on this passthrough to force the default
    // (unzoomed) view (#294); guard it so a dropped forward is caught.
    it('forwards resetView to captureAtResolution', () => {
      const mockCanvas = document.createElement('canvas');
      const seen: Array<{ resetView?: boolean }> = [];
      const plotEl = document.createElement('div') as HTMLElement & {
        captureAtResolution?: (
          w: number,
          h: number,
          opts: { resetView?: boolean },
        ) => HTMLCanvasElement;
      };
      plotEl.captureAtResolution = (_w, _h, opts) => {
        seen.push(opts);
        return mockCanvas;
      };

      capturePlotCanvas(plotEl, {
        width: 800,
        height: 400,
        backgroundColor: '#ffffff',
        resetView: true,
      });
      capturePlotCanvas(plotEl, { width: 800, height: 400, backgroundColor: '#ffffff' });

      expect(seen[0].resetView).toBe(true);
      expect(seen[1].resetView).toBeUndefined();
    });

    /**
     * jsdom doesn't implement canvas 2d. Instead of pixel sampling, spy on
     * the output canvas's 2d context and assert drawImage's call signature.
     */
    function spyOutputContext(out: HTMLCanvasElement) {
      const calls: Array<unknown[]> = [];
      const ctx = {
        clearRect: () => {},
        fillRect: () => {},
        drawImage: (...args: unknown[]) => calls.push(args),
        fillStyle: '',
      } as unknown as CanvasRenderingContext2D;
      const origCreate = document.createElement.bind(document);
      const createSpy = (tag: string) => {
        const el = origCreate(tag);
        if (tag === 'canvas') {
          (el as HTMLCanvasElement).getContext = (() => ctx) as HTMLCanvasElement['getContext'];
        }
        return el;
      };
      document.createElement = createSpy as typeof document.createElement;
      return {
        calls,
        restore: () => {
          document.createElement = origCreate;
          void out;
        },
      };
    }

    it('fallback uses 9-arg drawImage with source full pixel rect (no DPR halving)', () => {
      const existing = document.createElement('canvas');
      existing.width = 800;
      existing.height = 600;
      const plotEl = document.createElement('div');
      plotEl.appendChild(existing);

      // Activate the spy AFTER creating the source canvas so existing.getContext
      // is unaffected; only newly-created canvases (the output) get the stub.
      const spy = spyOutputContext(existing);
      try {
        const out = capturePlotCanvas(plotEl as HTMLElement, {
          width: 800,
          height: 600,
          backgroundColor: '#ffffff',
        });
        expect(out.width).toBe(800);
        expect(out.height).toBe(600);
      } finally {
        spy.restore();
      }

      // drawImage should be called with the 9-arg form: (img, sx, sy, sw, sh, dx, dy, dw, dh)
      expect(spy.calls.length).toBe(1);
      const args = spy.calls[0];
      expect(args.length).toBe(9);
      expect(args[0]).toBe(existing);
      expect(args[1]).toBe(0); // sx
      expect(args[2]).toBe(0); // sy
      expect(args[3]).toBe(800); // sw — full source pixel width
      expect(args[4]).toBe(600); // sh — full source pixel height
      expect(args[5]).toBe(0); // dx
      expect(args[6]).toBe(0); // dy
      expect(args[7]).toBe(800); // dw
      expect(args[8]).toBe(600); // dh
    });

    it('fallback samples the full source rect when source is HiDPI (2× CSS width)', () => {
      const existing = document.createElement('canvas');
      existing.width = 1600; // physical pixels
      existing.height = 1200;
      const plotEl = document.createElement('div');
      plotEl.appendChild(existing);

      const spy = spyOutputContext(existing);
      try {
        capturePlotCanvas(plotEl as HTMLElement, {
          width: 800, // CSS pixels
          height: 600,
          backgroundColor: '#ffffff',
        });
      } finally {
        spy.restore();
      }

      // Must use the 9-arg form passing full source pixel rect — only then is
      // the HiDPI source sampled fully (5-arg form would silently halve it).
      expect(spy.calls.length).toBe(1);
      const args = spy.calls[0];
      expect(args.length).toBe(9);
      expect(args[0]).toBe(existing);
      expect(args[3]).toBe(1600); // sw = source.width (full pixels), not 800
      expect(args[4]).toBe(1200); // sh = source.height (full pixels), not 600
      expect(args[7]).toBe(800); // dw = output CSS width
      expect(args[8]).toBe(600); // dh = output CSS height
    });
  });
});

describe('computeInsetBoost area cap', () => {
  const inset = (zoom: number) => ({
    sourceRect: { x: 0, y: 0, w: 1 / zoom, h: 1 / zoom },
    targetRect: { x: 0, y: 0, w: 1, h: 1 },
    border: 0,
    connector: 'lines' as const,
  });

  it('passes boost through unchanged when plotPixelArea is small', () => {
    const boost = computeInsetBoost([inset(4)], 4, 1_000_000);
    expect(boost).toBe(4);
  });

  it('caps boost when plotPixelArea * boost² would exceed MAX_CANVAS_PIXELS', () => {
    // 8192² = ~67M; with boost 4 that's ~67M × 16 ≈ 1.07B > 256M.
    const boost = computeInsetBoost([inset(4)], 4, 8192 * 8192);
    expect(boost).toBeLessThan(4);
    expect(boost * boost * 8192 * 8192).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  });

  it('returns at least 1 even at extreme plotPixelArea', () => {
    const boost = computeInsetBoost([inset(4)], 4, 100_000_000_000);
    expect(boost).toBeGreaterThanOrEqual(1);
  });

  it('ignores plotPixelArea when undefined or zero', () => {
    expect(computeInsetBoost([inset(4)], 4, undefined)).toBe(4);
    expect(computeInsetBoost([inset(4)], 4, 0)).toBe(4);
  });
});

describe('composeFigure geometric inset path', () => {
  function makeStateWithInset() {
    return {
      ...createDefaultPublishState(),
      insets: [
        {
          sourceRect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
          targetRect: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 },
          border: 0,
          connector: 'none' as const,
        },
      ],
      legend: { ...createDefaultPublishState().legend, visible: false, position: 'none' as const },
    };
  }

  /**
   * Spy on drawImage on the output canvas's 2d context. Returns the calls
   * recorded on the *output* canvas (the inset render canvas itself doesn't
   * receive any drawImage calls during composeFigure).
   */
  function spyDrawImage(outCanvas: HTMLCanvasElement) {
    const calls: Array<unknown[]> = [];
    const ctx = {
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      setLineDash: () => {},
      save: () => {},
      restore: () => {},
      drawImage: (...args: unknown[]) => calls.push(args),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      globalAlpha: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      closePath: () => {},
    } as unknown as CanvasRenderingContext2D;
    outCanvas.getContext = (() => ctx) as HTMLCanvasElement['getContext'];
    return calls;
  }

  it('draws pre-rendered inset whole into target (geometric path)', () => {
    const out = document.createElement('canvas');
    out.width = 1000;
    out.height = 1000;
    const calls = spyDrawImage(out);

    const plotCanvas = document.createElement('canvas');
    plotCanvas.width = 1000;
    plotCanvas.height = 1000;
    const insetCanvas = document.createElement('canvas');
    insetCanvas.width = 300;
    insetCanvas.height = 300;

    composeFigure(out, {
      state: makeStateWithInset(),
      plotCanvas,
      legendItems: [],
      legendTitle: '',
      insetRenders: [insetCanvas],
    });

    // The 2nd drawImage call (after the main plot) should draw the inset.
    // Geometric path: source rect = full src canvas, target = inset target rect.
    const insetCall = calls[1];
    expect(insetCall[0]).toBe(insetCanvas);
    // ctx.drawImage(srcCanvas, 0, 0, srcW, srcH, tx, ty, tw, th)
    expect(insetCall[1]).toBe(0); // sx0 = 0 (no crop offset)
    expect(insetCall[2]).toBe(0); // sy0 = 0
    expect(insetCall[3]).toBe(300); // src width = whole inset canvas
    expect(insetCall[4]).toBe(300); // src height = whole inset canvas
    expect(insetCall[5]).toBe(600); // tx = 0.6 × 1000
    expect(insetCall[6]).toBe(600); // ty = 0.6 × 1000
    expect(insetCall[7]).toBe(300); // tw = 0.3 × 1000
    expect(insetCall[8]).toBe(300); // th = 0.3 × 1000
  });

  it('falls back to raster crop path when insetRenders entry is null', () => {
    const out = document.createElement('canvas');
    out.width = 1000;
    out.height = 1000;
    const calls = spyDrawImage(out);

    const plotCanvas = document.createElement('canvas');
    plotCanvas.width = 1000;
    plotCanvas.height = 1000;

    composeFigure(out, {
      state: makeStateWithInset(),
      plotCanvas,
      legendItems: [],
      legendTitle: '',
      insetRenders: [null],
    });

    const insetCall = calls[1];
    // Raster path: crops sourceRect from plotCanvas. sourceRect (0.1, 0.1, 0.2, 0.2)
    // → cropX=100, cropY=100, cropW=200, cropH=200 on the 1000×1000 plot.
    expect(insetCall[0]).toBe(plotCanvas);
    expect(insetCall[1]).toBe(100);
    expect(insetCall[2]).toBe(100);
    expect(insetCall[3]).toBe(200);
    expect(insetCall[4]).toBe(200);
    expect(insetCall[5]).toBe(600);
    expect(insetCall[6]).toBe(600);
    expect(insetCall[7]).toBe(300);
    expect(insetCall[8]).toBe(300);
  });
});

describe('waitForFonts', () => {
  let originalFonts: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  });

  afterEach(() => {
    if (originalFonts) {
      Object.defineProperty(document, 'fonts', originalFonts);
    } else {
      delete (document as Document & { fonts?: unknown }).fonts;
    }
  });

  it('resolves immediately when document.fonts.ready resolves', async () => {
    Object.defineProperty(document, 'fonts', {
      value: { ready: Promise.resolve() },
      configurable: true,
    });
    await expect(waitForFonts()).resolves.toBeUndefined();
  });

  it('resolves when document.fonts is missing', async () => {
    Object.defineProperty(document, 'fonts', { value: undefined, configurable: true });
    await expect(waitForFonts()).resolves.toBeUndefined();
  });
});

describe('composeFigure null context', () => {
  it('composeFigure does not throw when getContext returns null', () => {
    const out = document.createElement('canvas');
    out.width = 100;
    out.height = 100;
    const orig = out.getContext;
    (out as unknown as { getContext: typeof out.getContext }).getContext = () => null;
    expect(() =>
      composeFigure(out, {
        state: createDefaultPublishState(),
        plotCanvas: document.createElement('canvas'),
        legendItems: [],
        legendTitle: '',
      }),
    ).not.toThrow();
    (out as unknown as { getContext: typeof out.getContext }).getContext = orig;
  });
});
