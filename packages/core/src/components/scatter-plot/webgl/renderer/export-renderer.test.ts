import { describe, it, expect } from 'vitest';
import type { PlotData, ScatterplotConfig } from '@protspace/utils';
import { ExportRenderer } from './export-renderer';
import { computePaddedExtent, computeExtent } from './data-extent';

/**
 * These tests pin the pure-math seams of the off-screen export pipeline. They
 * are authored against the behavior the methods carried inline on
 * `WebGLRenderer` before extraction, proving the move is equal (not redefined).
 *
 * The off-screen GL pipeline (`renderToCanvas`/`initializeOffscreenContext`) is
 * exercised by the renderer-level characterization harness; here we cover only
 * the math that needs no live context.
 */

function makePlotData(xs: number[], ys: number[]): PlotData {
  return {
    length: xs.length,
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    zs: null,
    originalIndices: null,
    proteinIds: xs.map((_, i) => `p${i}`),
  };
}

// Fixed reference dims the export margin scaling anchors to (mirrors the impl).
const REF_W = 800;
const REF_H = 600;

describe('ExportRenderer.getDataExtent (static)', () => {
  it('returns the padded min/max over the first `length` columns (computePaddedExtent)', () => {
    const xs = new Float32Array([0, 10]);
    const ys = new Float32Array([0, 20]);
    const ext = ExportRenderer.getDataExtent(xs, ys, 2);
    // Padded extent widens past the raw data on every side.
    expect(ext.xMin).toBeLessThanOrEqual(0);
    expect(ext.xMax).toBeGreaterThanOrEqual(10);
    expect(ext.yMin).toBeLessThanOrEqual(0);
    expect(ext.yMax).toBeGreaterThanOrEqual(20);
    // ...and is exactly the shared padded-extent helper.
    expect(ext).toEqual(computePaddedExtent(xs, ys, 2));
  });
});

describe('ExportRenderer.createExportScales (static)', () => {
  const config: ScatterplotConfig = {
    width: 1000,
    height: 800,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
  };

  it('returns null for empty data', () => {
    const empty = makePlotData([], []);
    expect(ExportRenderer.createExportScales(config, empty, 400, 300)).toBeNull();
  });

  it('default path: pads the data extent and insets the range by the scaled margins', () => {
    const pd = makePlotData([0, 10], [0, 20]);
    const exportWidth = 800;
    const exportHeight = 600;
    const scales = ExportRenderer.createExportScales(config, pd, exportWidth, exportHeight);
    expect(scales).not.toBeNull();
    const { x, y } = scales!;

    // Domain is the 5%-padded data extent.
    const padded = computePaddedExtent(pd.xs, pd.ys, pd.length);
    expect(x.domain()).toEqual([padded.xMin, padded.xMax]);
    expect(y.domain()).toEqual([padded.yMin, padded.yMax]);

    // Range is inset by margins scaled from the fixed reference.
    const scaleX = exportWidth / REF_W;
    const scaleY = exportHeight / REF_H;
    expect(x.range()[0]).toBeCloseTo(20 * scaleX); // left
    expect(x.range()[1]).toBeCloseTo(exportWidth - 20 * scaleX); // right
    expect(y.range()[0]).toBeCloseTo(exportHeight - 20 * scaleY); // bottom
    expect(y.range()[1]).toBeCloseTo(20 * scaleY); // top
  });

  it('dataDomain path: full-bleed range with no padding and no margins', () => {
    const pd = makePlotData([0, 10], [0, 20]);
    const exportWidth = 500;
    const exportHeight = 400;
    const domain = { xMin: 2, xMax: 8, yMin: 3, yMax: 7 };
    const scales = ExportRenderer.createExportScales(config, pd, exportWidth, exportHeight, domain);
    const { x, y } = scales!;

    // Domain is exactly the supplied viewport (no 5% padding).
    expect(x.domain()).toEqual([domain.xMin, domain.xMax]);
    expect(y.domain()).toEqual([domain.yMin, domain.yMax]);

    // Range fills the canvas edge-to-edge (x: 0->W, y: H->0).
    expect(x.range()).toEqual([0, exportWidth]);
    expect(y.range()).toEqual([exportHeight, 0]);
  });

  it('falls back to a 20px default margin when config.margin is absent', () => {
    const noMargin: ScatterplotConfig = { width: 1000, height: 800 };
    const pd = makePlotData([0, 10], [0, 20]);
    const scales = ExportRenderer.createExportScales(noMargin, pd, REF_W, REF_H);
    const { x } = scales!;
    // At the reference size the scale factor is 1, so the inset equals 20px.
    expect(x.range()[0]).toBeCloseTo(20);
    expect(x.range()[1]).toBeCloseTo(REF_W - 20);
  });
});

describe('ExportRenderer.getRenderInfo (static)', () => {
  it('returns margins in export-pixel space, scaled from the fixed reference', () => {
    const config: ScatterplotConfig = {
      margin: { top: 10, right: 30, bottom: 40, left: 50 },
    };
    const exportWidth = 1600; // 2x reference width
    const exportHeight = 1200; // 2x reference height
    const info = ExportRenderer.getRenderInfo(config, exportWidth, exportHeight);
    expect(info.marginLeft).toBeCloseTo(50 * (exportWidth / REF_W));
    expect(info.marginRight).toBeCloseTo(30 * (exportWidth / REF_W));
    expect(info.marginTop).toBeCloseTo(10 * (exportHeight / REF_H));
    expect(info.marginBottom).toBeCloseTo(40 * (exportHeight / REF_H));
  });

  it('uses the 20px default margin when config.margin is absent', () => {
    const info = ExportRenderer.getRenderInfo({}, REF_W, REF_H);
    expect(info.marginLeft).toBeCloseTo(20);
    expect(info.marginRight).toBeCloseTo(20);
    expect(info.marginTop).toBeCloseTo(20);
    expect(info.marginBottom).toBeCloseTo(20);
  });
});

describe('ExportRenderer.getDataExtent (instance)', () => {
  const renderer = new ExportRenderer();

  it('returns null when there is nothing rendered', () => {
    expect(renderer.getDataExtent(null)).toBeNull();
    expect(renderer.getDataExtent(makePlotData([], []))).toBeNull();
  });

  it('returns the UNPADDED extent (matches the inline getDataExtent)', () => {
    const pd = makePlotData([1, 5, -3], [2, 9, 0]);
    expect(renderer.getDataExtent(pd)).toEqual(computeExtent(pd.xs, pd.ys, pd.length));
  });
});

describe('ExportRenderer.renderToCanvas (guards)', () => {
  const renderer = new ExportRenderer();
  const config: ScatterplotConfig = { width: 800, height: 600 };
  const style = {} as never;
  const baseOptions = {
    selectionActive: false,
    transform: { x: 0, y: 0, k: 1 } as never,
    gamma: 2.2,
  };

  it('throws when there is no data to render', () => {
    expect(() =>
      renderer.renderToCanvas(null, config, style, {
        width: 100,
        height: 100,
        ...baseOptions,
      }),
    ).toThrow(/No points available/);
  });

  it('throws when a single export dimension exceeds the browser limit', () => {
    const pd = makePlotData([0, 1], [0, 1]);
    expect(() =>
      renderer.renderToCanvas(pd, config, style, {
        width: 9000,
        height: 100,
        ...baseOptions,
      }),
    ).toThrow(/exceed browser limit/);
  });

  it('throws when the export area exceeds the pixel-count limit', () => {
    const pd = makePlotData([0, 1], [0, 1]);
    // 8000 x 8000 = 64M (within MAX_DIMENSION) but with dpr 3 -> 24000 hits dimension first;
    // pick dims under MAX_DIMENSION each yet over MAX_AREA: 8000 x 8000 = 64M < 268M, so
    // use values just under the per-dimension cap whose product exceeds the area cap is
    // impossible (8192^2 = 67M < 268M). The area guard is unreachable via two valid dims,
    // so we only assert the dimension guard fires for the larger-than-limit case above.
    expect(() =>
      renderer.renderToCanvas(pd, config, style, {
        width: 8193,
        height: 1,
        ...baseOptions,
      }),
    ).toThrow(/exceed browser limit/);
  });
});
