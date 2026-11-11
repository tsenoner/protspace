/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as d3 from 'd3';
import type { PlotDataPoint } from '@protspace/utils';
import { SpiderfyLayer } from './spiderfy-layer';
import type { ViewportDuplicateStack } from './duplicate-stack-types';

const pt = (id: string): PlotDataPoint => ({ id, x: 0, y: 0, originalIndex: 0 });

/** Renders a ring of `count` duplicates with the pointer coarse or fine. */
function renderRing(coarse: boolean, count: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query.includes('coarse') }));
  const onActivate = vi.fn();
  const layer = new SpiderfyLayer({
    getColor: () => '#888888',
    onActivate,
    onHover: vi.fn(),
    onHoverEnd: vi.fn(),
  });
  const svg = d3.select(document.body).append('svg');
  const g = svg.append('g') as unknown as Parameters<SpiderfyLayer['render']>[0];
  const points = Array.from({ length: count }, (_, i) => pt(`p${i}`));
  layer.render(g, { px: 0, py: 0, points } as unknown as ViewportDuplicateStack, 1);
  return { root: svg.node()!, onActivate };
}

/** A pointer event as jsdom can build it: a MouseEvent of that type with a pointer id. */
function pointer(type: string, target: Element): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

describe('spiderfy ring on a touch screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('with a coarse pointer each node has a 20 px tap disc that selects it', () => {
    const { root, onActivate } = renderRing(true, 2);
    const discs = root.querySelectorAll('.dup-spiderfy-node-hit');
    expect(discs).toHaveLength(2);
    // Two nodes on a 22 px ring sit 44 px apart: room for the whole 20 px disc.
    expect(Number(discs[0].getAttribute('r'))).toBe(20);
    expect(discs[0].getAttribute('fill')).toBe('transparent');
    // Under the dot, so the dot still draws on top.
    expect(discs[0].nextElementSibling?.classList.contains('dup-spiderfy-node-circle')).toBe(true);

    pointer('pointerdown', discs[1]);
    pointer('pointerup', discs[1]);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate.mock.calls[0][1].id).toBe('p1');
  });

  it('keeps neighbouring discs apart on a crowded ring', () => {
    const { root } = renderRing(true, 30);
    const r = Number(root.querySelector('.dup-spiderfy-node-hit')!.getAttribute('r'));
    // Ring radius 70: neighbours sit 2 · 70 · sin(π / 30) ≈ 14.6 px apart.
    expect(r).toBeCloseTo(70 * Math.sin(Math.PI / 30), 6);
  });

  it('with a fine pointer there is no disc, and the dot still selects', () => {
    const { root, onActivate } = renderRing(false, 3);
    expect(root.querySelectorAll('.dup-spiderfy-node-hit')).toHaveLength(0);
    const dots = root.querySelectorAll('.dup-spiderfy-node-circle');
    expect(dots).toHaveLength(3);
    pointer('pointerdown', dots[2]);
    pointer('pointerup', dots[2]);
    expect(onActivate.mock.calls[0][1].id).toBe('p2');
  });
});
