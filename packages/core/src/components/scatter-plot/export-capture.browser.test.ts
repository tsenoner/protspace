import { describe, expect, it } from 'vitest';
import { compositeExportCanvas, exportBadgeScale } from './export-capture';

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
