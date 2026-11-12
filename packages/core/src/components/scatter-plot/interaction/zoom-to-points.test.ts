import { describe, expect, it } from 'vitest';
import { zoomTransformFor } from './zoom-to-points';

const VIEW = {
  width: 400,
  height: 300,
  margin: 40,
  currentK: 1,
  extent: [0.1, 1000] as const,
  singleK: 8,
};

/** Where a point at k = 1 lands under the transform. */
const onScreen = (t: { k: number; x: number; y: number }, [x, y]: readonly [number, number]) => [
  t.k * x + t.x,
  t.k * y + t.y,
];

describe('zoomTransformFor', () => {
  it('one point centres at max(currentK, singleK)', () => {
    const t = zoomTransformFor([[100, 50]], VIEW)!;
    expect(t.k).toBe(8);
    expect(onScreen(t, [100, 50])).toEqual([200, 150]);
  });

  it('a current k above singleK is kept', () => {
    const t = zoomTransformFor([[100, 50]], { ...VIEW, currentK: 20 })!;
    expect(t.k).toBe(20);
    expect(onScreen(t, [100, 50])).toEqual([200, 150]);
  });

  it('several points fit inside the margin', () => {
    // 320 × 220 px of room; the 200 × 100 box is limited by its width: k = 1.6.
    const t = zoomTransformFor(
      [
        [0, 0],
        [100, 50],
        [200, 100],
      ],
      VIEW,
    )!;
    expect(t.k).toBeCloseTo(1.6);
    const [left, top] = onScreen(t, [0, 0]);
    const [right, bottom] = onScreen(t, [200, 100]);
    expect(left).toBeCloseTo(40);
    expect(right).toBeCloseTo(360);
    expect(top).toBeGreaterThanOrEqual(40);
    expect(bottom).toBeLessThanOrEqual(260);
    expect((top + bottom) / 2).toBeCloseTo(150);
  });

  it('k clamps to the extent', () => {
    const tiny = zoomTransformFor(
      [
        [0, 0],
        [0.001, 0.001],
      ],
      VIEW,
    )!;
    expect(tiny.k).toBe(1000);
    expect(zoomTransformFor([[5, 5]], { ...VIEW, singleK: 5000 })!.k).toBe(1000);
    const huge = zoomTransformFor(
      [
        [0, 0],
        [1e6, 1e6],
      ],
      VIEW,
    )!;
    expect(huge.k).toBe(0.1);
  });

  it('no points returns null', () => {
    expect(zoomTransformFor([], VIEW)).toBeNull();
  });

  it('two identical points behave as one', () => {
    expect(
      zoomTransformFor(
        [
          [5, 5],
          [5, 5],
        ],
        VIEW,
      ),
    ).toEqual(zoomTransformFor([[5, 5]], VIEW));
  });

  it('insets fit the box inside what the chrome leaves, and centre it there', () => {
    const insets = { top: 0, right: 0, bottom: 100, left: 60 };
    const t = zoomTransformFor(
      [
        [0, 0],
        [100, 100],
      ],
      { ...VIEW, insets },
    )!;
    const [x0, y0] = [t.x, t.y];
    const [x1, y1] = [t.x + 100 * t.k, t.y + 100 * t.k];
    expect(x0).toBeGreaterThanOrEqual(insets.left + VIEW.margin - 1e-9);
    expect(y1).toBeLessThanOrEqual(VIEW.height - insets.bottom - VIEW.margin + 1e-9);
    expect((x0 + x1) / 2).toBeCloseTo((insets.left + VIEW.width) / 2);
    expect((y0 + y1) / 2).toBeCloseTo((VIEW.height - insets.bottom) / 2);
  });
});
