import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { compositeExportCanvas, exportBadgeScale } from './export-capture';
import type { ProtspaceScatterplot } from './scatter-plot';
import './scatter-plot';

/** A 2D canvas of the given size, optionally painted. */
function canvas(
  width: number,
  height: number,
  paint?: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  if (paint) paint(element.getContext('2d')!);
  return element;
}

/** One pixel's RGBA. */
function pixel(element: HTMLCanvasElement, x: number, y: number): number[] {
  return Array.from(element.getContext('2d')!.getImageData(x, y, 1, 1).data);
}

/** A 4×4 canvas with one red point in its top-left pixel; the rest is transparent. */
const onePoint = () =>
  canvas(4, 4, (ctx) => {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 1, 1);
  });

describe('compositeExportCanvas', () => {
  it('fills the background under the points', () => {
    const points = onePoint();
    const out = compositeExportCanvas(points, null, '#0000ff');
    expect(out).not.toBe(points);
    expect([out.width, out.height]).toEqual([4, 4]);
    expect(pixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 3, 3)).toEqual([0, 0, 255, 255]);
  });

  it("an empty or 'transparent' background returns the WebGL canvas itself", () => {
    const points = onePoint();
    expect(compositeExportCanvas(points, null, 'transparent')).toBe(points);
    expect(compositeExportCanvas(points, null, '')).toBe(points);
    expect(compositeExportCanvas(points, null, undefined)).toBe(points);
    expect(pixel(points, 3, 3)[3]).toBe(0);
  });

  it('badges are drawn over the points at the output size', () => {
    const points = canvas(8, 8, (ctx) => {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 8, 8);
    });
    // Half the output's size: a live badge canvas stretched to the export.
    const badges = canvas(4, 4, (ctx) => {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 2, 2);
    });
    const out = compositeExportCanvas(points, badges, '#0000ff');
    // Stretched 2×, the badge's 2×2 corner covers the output's 4×4 corner, over the points;
    // the points cover the background everywhere else.
    expect(pixel(out, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(pixel(out, 6, 6)).toEqual([255, 0, 0, 255]);
    // An empty badge canvas is skipped: drawImage of a 0 × 0 canvas would throw.
    expect(() => compositeExportCanvas(canvas(4, 4), canvas(0, 0), 'transparent')).not.toThrow();
  });
});

describe('exportBadgeScale', () => {
  it('exportBadgeScale is dpr at the live size and scales with the reference', () => {
    const live = { width: 800, height: 600 };
    // A 2× export of the live size: the dots keep their size, so badges scale by dpr alone.
    expect(exportBadgeScale({ width: 1600, height: 1200 }, 2, undefined, live)).toBe(2);
    // A larger output at dpr 1: sqrt(1600 × 400 / (800 × 600)).
    expect(exportBadgeScale({ width: 1600, height: 400 }, 1, undefined, live)).toBeCloseTo(
      Math.sqrt(4 / 3),
      10,
    );
    // A reference replaces the output's logical size (an inset sized like the main plot).
    expect(
      exportBadgeScale({ width: 3200, height: 1800 }, 2, { width: 800, height: 600 }, live),
    ).toBe(2);
    expect(
      exportBadgeScale({ width: 400, height: 300 }, 1, { width: 1600, height: 1200 }, live),
    ).toBe(2);
  });
});

describe('captureAtResolution under EAT Dim', () => {
  afterEach(() => document.body.replaceChildren());

  /** P1 curated; P2 a prediction at 20 % and P3 one at 90 %, all family A, far apart. */
  function makeData(): VisualizationData {
    return {
      protein_ids: ['P1', 'P2', 'P3'],
      projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0, 0, 10, 10, 0]) }],
      annotations: {
        fam: { kind: 'categorical', values: ['A'], colors: ['#ff0000'], shapes: ['circle'] },
      },
      annotation_data: { fam: Int32Array.from([0, -1, -1]) },
      annotation_predicted: {
        fam: [
          null,
          { value: 'A', confidence: 0.2, source: 'P1', sourceIndex: 0 },
          { value: 'A', confidence: 0.9, source: 'P1', sourceIndex: 0 },
        ],
      },
    } as unknown as VisualizationData;
  }

  /**
   * The strongest alpha a transparent capture holds within 12 px of a protein's centre: a
   * prediction is a hollow ring, so its centre is empty.
   */
  function alphaAt(plot: ProtspaceScatterplot, out: HTMLCanvasElement, id: string): number {
    const rect = plot.shadowRoot!.querySelector('canvas')!.getBoundingClientRect();
    const at = plot.getProteinClientPosition(id)!;
    const x = Math.round((at.x - rect.left) * (out.width / rect.width));
    const y = Math.round((at.y - rect.top) * (out.height / rect.height));
    const copy = canvas(out.width, out.height, (ctx) => ctx.drawImage(out, 0, 0));
    const box = copy.getContext('2d')!.getImageData(x - 12, y - 12, 25, 25).data;
    let max = 0;
    for (let i = 3; i < box.length; i += 4) max = Math.max(max, box[i]);
    return max;
  }

  it('a dimmed prediction is fainter in the export than a kept one', async () => {
    const plot = document.createElement('protspace-scatterplot');
    plot.style.cssText = 'display: block; width: 480px; height: 360px';
    plot.selectedAnnotation = 'fam';
    plot.config = { baseOpacity: 1 };
    plot.data = makeData();
    document.body.append(plot);
    await plot.updateComplete;
    await vi.waitFor(() => expect(plot.getProteinClientPosition('P2')).toBeTruthy(), {
      timeout: 5_000,
    });

    const before = plot.captureAtResolution(480, 360, { backgroundColor: 'transparent' });
    const undimmed = alphaAt(plot, before, 'P2');
    expect(undimmed).toBeGreaterThan(200);

    plot.eatDim = { min: 0.5, max: 1 };
    await plot.updateComplete;
    const out = plot.captureAtResolution(480, 360, { backgroundColor: 'transparent' });
    expect(alphaAt(plot, out, 'P2')).toBeLessThan(undimmed);
    expect(alphaAt(plot, out, 'P2')).toBeLessThan(100);
    expect(alphaAt(plot, out, 'P3')).toBeGreaterThan(200);
  });
});
