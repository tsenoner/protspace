import { describe, it, expect } from 'vitest';
import type { PlotDataPoint } from '@protspace/utils';
import {
  computeSpiderNodes,
  isClickGesture,
  SPIDERFY_CLICK_DIST2_MAX,
  SPIDERFY_CLICK_MS_MAX,
} from './spiderfy-layer';

const pt = (id: string): PlotDataPoint => ({ id, x: 0, y: 0, originalIndex: 0 });

describe('computeSpiderNodes', () => {
  it('places n nodes on a ring starting at -PI/2 (top), CW', () => {
    const pts = [pt('a'), pt('b'), pt('c'), pt('d')];
    const nodes = computeSpiderNodes(pts);
    expect(nodes).toHaveLength(4);
    expect(nodes[0].x).toBeCloseTo(0, 6); // cos(-PI/2)=0
    expect(nodes[0].y).toBeLessThan(0); // sin(-PI/2)=-1 ⇒ top
    expect(nodes.map((n) => n.idx)).toEqual([0, 1, 2, 3]);
  });

  it('ring radius = min(70, max(22, 12 + n*2))', () => {
    expect(computeSpiderNodes(Array.from({ length: 2 }, () => pt('x')))[0].r).toBe(22); // 12+4=16 → max→22
    expect(computeSpiderNodes(Array.from({ length: 20 }, () => pt('x')))[0].r).toBe(52); // 12+40=52
    expect(computeSpiderNodes(Array.from({ length: 40 }, () => pt('x')))[0].r).toBe(70); // 12+80=92 → min→70
  });
});

describe('isClickGesture', () => {
  it('accepts a short low-movement press/release (dist2<=16 && dt<=700)', () => {
    expect(isClickGesture({ x: 0, y: 0, t: 0 }, { clientX: 3, clientY: 1, now: 500 })).toBe(true); // 9+1=10
  });
  it('rejects a long-distance drag', () => {
    expect(isClickGesture({ x: 0, y: 0, t: 0 }, { clientX: 5, clientY: 5, now: 100 })).toBe(false); // 50>16
  });
  it('rejects a slow press (dt>700)', () => {
    expect(isClickGesture({ x: 0, y: 0, t: 0 }, { clientX: 0, clientY: 0, now: 800 })).toBe(false);
  });
  it('exposes the thresholds as named constants', () => {
    expect(SPIDERFY_CLICK_DIST2_MAX).toBe(16);
    expect(SPIDERFY_CLICK_MS_MAX).toBe(700);
  });
});
