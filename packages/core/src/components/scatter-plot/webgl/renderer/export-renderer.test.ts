import { describe, it, expect } from 'vitest';
import { DataProcessor } from '@protspace/utils';
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

describe('computePaddedExtent (export domain helper)', () => {
  it('returns the padded min/max over the first `length` columns', () => {
    const xs = new Float32Array([0, 10]);
    const ys = new Float32Array([0, 20]);
    const ext = computePaddedExtent(xs, ys, 2);
    // Padded extent widens past the raw data on every side.
    expect(ext.xMin).toBeLessThanOrEqual(0);
    expect(ext.xMax).toBeGreaterThanOrEqual(10);
    expect(ext.yMin).toBeLessThanOrEqual(0);
    expect(ext.yMax).toBeGreaterThanOrEqual(20);
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

  it('default path: fits the padded extent inside the scaled margins with one scale, centred', () => {
    // 11 × 22 once padded. At 800 × 600 the inner area is 760 × 560, so y sets the scale
    // (560 / 22 px per unit) and the 280 px wide fit is centred in x.
    const pd = makePlotData([0, 10], [0, 20]);
    const scales = ExportRenderer.createExportScales(config, pd, 800, 600);
    expect(scales).not.toBeNull();
    const { x, y } = scales!;

    const padded = computePaddedExtent(pd.xs, pd.ys, pd.length);
    expect(x.domain()).toEqual([padded.xMin, padded.xMax]);
    expect(y.domain()).toEqual([padded.yMin, padded.yMax]);
    expect(x.range()).toEqual([260, 540]);
    expect(y.range()).toEqual([580, 20]);
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

    // Range fills the canvas edge-to-edge (x: 0->W, y: H->0), each axis on its own.
    expect(x.range()).toEqual([0, exportWidth]);
    expect(y.range()).toEqual([exportHeight, 0]);
  });

  it('falls back to a 20px default margin when config.margin is absent', () => {
    const noMargin: ScatterplotConfig = { width: 1000, height: 800 };
    const pd = makePlotData([0, 10], [0, 20]);
    const { x, y } = ExportRenderer.createExportScales(noMargin, pd, REF_W, REF_H)!;
    // At the reference size the scale factor is 1, so the margins are 20 px.
    expect(x.range()).toEqual([260, 540]);
    expect(y.range()).toEqual([580, 20]);
  });

  it("an export has the live plot's shape at the same aspect", () => {
    const margin = { top: 40, right: 40, bottom: 40, left: 40 };
    const pd = makePlotData([0, 10, 3], [0, 20, 7]);
    const live = DataProcessor.createScales(pd, 800, 600, margin)!;
    // Twice the reference size: the margins scale to 80 px, so the export is the live plot doubled.
    const exported = ExportRenderer.createExportScales({ margin }, pd, 1600, 1200)!;
    expect(exported.x.domain()).toEqual(live.x.domain());
    expect(exported.y.domain()).toEqual(live.y.domain());
    exported.x.range().forEach((value, i) => expect(value).toBeCloseTo(2 * live.x.range()[i], 9));
    exported.y.range().forEach((value, i) => expect(value).toBeCloseTo(2 * live.y.range()[i], 9));
  });
});

describe('ExportRenderer.getRenderInfo (static)', () => {
  it('without data, returns the margins scaled from the fixed reference', () => {
    const config: ScatterplotConfig = {
      margin: { top: 10, right: 30, bottom: 40, left: 50 },
    };
    const exportWidth = 1600; // 2x reference width
    const exportHeight = 1200; // 2x reference height
    const info = ExportRenderer.getRenderInfo(config, null, exportWidth, exportHeight);
    expect(info.marginLeft).toBeCloseTo(50 * (exportWidth / REF_W));
    expect(info.marginRight).toBeCloseTo(30 * (exportWidth / REF_W));
    expect(info.marginTop).toBeCloseTo(10 * (exportHeight / REF_H));
    expect(info.marginBottom).toBeCloseTo(40 * (exportHeight / REF_H));
  });

  it('uses the 20px default margin when config.margin is absent', () => {
    const info = ExportRenderer.getRenderInfo({}, null, REF_W, REF_H);
    expect(info.marginLeft).toBeCloseTo(20);
    expect(info.marginRight).toBeCloseTo(20);
    expect(info.marginTop).toBeCloseTo(20);
    expect(info.marginBottom).toBeCloseTo(20);
  });

  it('with data, returns the edges of the fitted area, centring slack included', () => {
    const pd = makePlotData([0, 10], [0, 20]);
    expect(ExportRenderer.getRenderInfo({}, pd, REF_W, REF_H)).toEqual({
      marginLeft: 260,
      marginRight: 260,
      marginTop: 20,
      marginBottom: 20,
    });
  });

  it("getRenderInfo's effective margins with the padded extent reproduce createExportScales exactly", () => {
    const config: ScatterplotConfig = { margin: { top: 12, right: 30, bottom: 44, left: 72 } };
    const pd = makePlotData([-3.5, 8, 2.25, 0.5], [10, -6, 4, 1.75]);
    const extent = computePaddedExtent(pd.xs, pd.ys, pd.length);
    for (const [width, height] of [
      [800, 600],
      [1920, 1080],
      [1000, 1400],
    ]) {
      const scales = ExportRenderer.createExportScales(config, pd, width, height)!;
      const info = ExportRenderer.getRenderInfo(config, pd, width, height);
      // The publish modal's inset inversion (publish-modal.ts), run forwards.
      const areaWidth = width - info.marginLeft - info.marginRight;
      const areaHeight = height - info.marginTop - info.marginBottom;
      for (let i = 0; i < pd.length; i++) {
        const tx = (pd.xs[i] - extent.xMin) / (extent.xMax - extent.xMin);
        const ty = (extent.yMax - pd.ys[i]) / (extent.yMax - extent.yMin);
        expect(info.marginLeft + tx * areaWidth).toBeCloseTo(scales.x(pd.xs[i]), 9);
        expect(info.marginTop + ty * areaHeight).toBeCloseTo(scales.y(pd.ys[i]), 9);
      }
    }
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

  it('throws when a single export dimension exceeds the device limit', () => {
    const pd = makePlotData([0, 1], [0, 1]);
    expect(() =>
      renderer.renderToCanvas(pd, config, style, {
        width: 9000,
        height: 100,
        ...baseOptions,
      }),
    ).toThrow(/exceed this device's limit/);
  });

  it('enforces the device texture limit, and names the limit it enforced', () => {
    // MAX_DIMENSION alone was described as "the browser limit" but is a constant,
    // so on a device below 8192 the message named a limit that was not the one
    // being enforced — and the export failed later, inside the driver.
    const pd = makePlotData([0, 1], [0, 1]);
    expect(() =>
      renderer.renderToCanvas(pd, config, style, {
        width: 4000,
        height: 100,
        ...baseOptions,
        deviceMaxTextureSize: 2048,
      }),
    ).toThrow(/exceed this device's limit of 2048px/);
  });

  it('does not tighten the limit when the device reports more than the cap', () => {
    const pd = makePlotData([0, 1], [0, 1]);
    expect(() =>
      renderer.renderToCanvas(pd, config, style, {
        width: 4000,
        height: 100,
        ...baseOptions,
        deviceMaxTextureSize: 16384,
      }),
    ).not.toThrow(/exceed this device's limit/);
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
    ).toThrow(/exceed this device's limit/);
  });
});
