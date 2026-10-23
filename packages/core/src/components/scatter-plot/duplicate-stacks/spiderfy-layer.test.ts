/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import * as d3 from 'd3';
import type { PlotDataPoint } from '@protspace/utils';
import {
  computeSpiderNodes,
  isClickGesture,
  SpiderfyLayer,
  SPIDERFY_CLICK_DIST2_MAX,
  SPIDERFY_CLICK_MS_MAX,
} from './spiderfy-layer';
import type { ViewportDuplicateStack } from './duplicate-stack-types';

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

describe('SpiderfyLayer.render', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const stack = (key: string, ids: string[], px = 0) =>
    ({ key, px, py: 0, points: ids.map(pt) }) as unknown as ViewportDuplicateStack;

  function setup() {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const layer = new SpiderfyLayer({
      getColor: () => '#888',
      onActivate: vi.fn(),
      onHover: vi.fn(),
      onHoverEnd: vi.fn(),
    });
    const g = d3.select(document.body).append('svg').append('g') as unknown as Parameters<
      SpiderfyLayer['render']
    >[0];
    const ring = () => g.node()!.querySelector('g.dup-spiderfy')!;
    return { layer, g, ring };
  }

  it('moves the same ring in place on a zoom', () => {
    const { layer, g, ring } = setup();
    layer.render(g, stack('a', ['p1', 'p2']), 1);
    const first = ring();
    layer.render(g, stack('a', ['p1', 'p2'], 50), 2);
    expect(ring()).toBe(first);
    expect(first.getAttribute('transform')).toBe('translate(50,0) scale(0.5)');
  });

  it('rebuilds for the same stack with other members, and for another stack', () => {
    const { layer, g, ring } = setup();
    layer.render(g, stack('a', ['p1', 'p2']), 1);
    const first = ring();
    layer.render(g, stack('a', ['p1', 'p2', 'p3']), 1);
    const second = ring();
    expect(second).not.toBe(first);
    expect(second.querySelectorAll('.dup-spiderfy-node')).toHaveLength(3);
    layer.render(g, stack('b', ['p1', 'p2', 'p3']), 1);
    expect(ring()).not.toBe(second);
  });

  it('rebuilds after reset() even for the same stack', () => {
    const { layer, g, ring } = setup();
    layer.render(g, stack('a', ['p1', 'p2']), 1);
    const first = ring();
    layer.reset();
    layer.render(g, stack('a', ['p1', 'p2']), 1);
    expect(ring()).not.toBe(first);
  });
});
