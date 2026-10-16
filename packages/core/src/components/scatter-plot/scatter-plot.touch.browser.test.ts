import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import type { ProtspaceScatterplot } from './scatter-plot';
import type { TooltipAction } from './scatter-plot.events';
import './scatter-plot';

const VIEW_STRUCTURE: TooltipAction = { id: 'view-structure', label: 'View structure' };

afterEach(() => {
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Three proteins far apart, with empty plot around each (stacked: P1 and P2 share a position). */
function makeData(stacked = false): VisualizationData {
  const coords = stacked ? [0, 0, 0, 0, 10, 10] : [0, 0, 5, 5, 10, 10];
  return {
    protein_ids: ['P1', 'P2', 'P3'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array(coords) }],
    annotations: {
      fam: { kind: 'categorical', values: ['A'], colors: ['#336699'], shapes: ['circle'] },
    },
    annotation_data: { fam: new Int32Array(3) },
  } as unknown as VisualizationData;
}

const at = (plot: ProtspaceScatterplot, id: string) => plot.getProteinClientPosition(id)!;
const svgOf = (plot: ProtspaceScatterplot) => plot.shadowRoot!.querySelector('svg')!;
const right = (point: { x: number; y: number }, dx: number) => ({ x: point.x + dx, y: point.y });

async function mountPlot(actions: readonly TooltipAction[] = [], stacked = false) {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.tooltipActions = actions;
  if (stacked) plot.config = { enableDuplicateStackUI: true };
  plot.data = makeData(stacked);
  document.body.append(plot);
  await plot.updateComplete;
  // Hit tests read the point grid, rebuilt on a frame after the data and the size.
  await vi.waitFor(() => {
    const rect = plot.getBoundingClientRect();
    const p = at(plot, 'P3');
    expect(plot.pickInteractivePointAt(p.x - rect.left, p.y - rect.top)).not.toBeNull();
  });
  return plot;
}

/** A finger's tap as Chromium reports it: a touch press and release, then a click that names it. */
function tap(plot: ProtspaceScatterplot, point: { x: number; y: number }) {
  const init: PointerEventInit = {
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    composed: true,
    pointerType: 'touch',
    pointerId: 2,
    isPrimary: true,
  };
  const svg = svgOf(plot);
  svg.dispatchEvent(new PointerEvent('pointerdown', init));
  svg.dispatchEvent(new PointerEvent('pointerup', init));
  svg.dispatchEvent(new PointerEvent('click', init));
}

function mouse(
  plot: ProtspaceScatterplot,
  type: 'click' | 'mousemove',
  point: { x: number; y: number },
) {
  svgOf(plot).dispatchEvent(
    new MouseEvent(type, { clientX: point.x, clientY: point.y, bubbles: true, composed: true }),
  );
}

type Tooltip = HTMLElement & { updateComplete: Promise<unknown> };
const tooltip = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelector<Tooltip>('protspace-protein-tooltip');
const pinned = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelector<Tooltip>('protspace-protein-tooltip.pinned');

function clicks(plot: ProtspaceScatterplot) {
  const ids: string[] = [];
  plot.addEventListener('protein-click', (event) =>
    ids.push((event as CustomEvent<{ proteinId: string }>).detail.proteinId),
  );
  return ids;
}

describe('scatterplot touch', () => {
  it('a touch tap within 20 px of a point pins its tooltip with no actions offered', async () => {
    const plot = await mountPlot();
    const ids = clicks(plot);
    tap(plot, right(at(plot, 'P2'), 12));
    await plot.updateComplete;

    expect(ids).toEqual(['P2']);
    const tip = pinned(plot)!;
    expect(tip).not.toBeNull();
    await tip.updateComplete;
    expect(tip.shadowRoot!.textContent).toContain('P2');
    expect(tip.shadowRoot!.querySelector('ps-button')).toBeNull();
  });

  it('a mouse click at the same 12 px distance selects nothing', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    const ids = clicks(plot);
    mouse(plot, 'click', right(at(plot, 'P2'), 12));
    await plot.updateComplete;
    expect(ids).toEqual([]);
    expect(pinned(plot)).toBeNull();
  });

  it('tapTooltips false: a touch tap selects but pins nothing', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    plot.tapTooltips = false;
    await plot.updateComplete;
    const ids = clicks(plot);
    tap(plot, at(plot, 'P2'));
    await plot.updateComplete;
    expect(ids).toEqual(['P2']);
    expect(pinned(plot)).toBeNull();
  });

  it('setting tapTooltips false unpins', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    tap(plot, at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();

    plot.tapTooltips = false;
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('emptying tooltipActions keeps a touch pin', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    tap(plot, at(plot, 'P2'));
    await plot.updateComplete;
    await pinned(plot)!.updateComplete;
    expect(pinned(plot)!.shadowRoot!.querySelector('ps-button')).not.toBeNull();

    plot.tooltipActions = [];
    await plot.updateComplete;
    const tip = pinned(plot)!;
    expect(tip).not.toBeNull();
    await tip.updateComplete;
    expect(tip.shadowRoot!.querySelector('ps-button')).toBeNull();
  });

  it('a pinned touch tooltip lies inside the plot near the right edge', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    tap(plot, at(plot, 'P3'));
    // The card is placed by an estimate first, then by its measured height.
    await vi.waitFor(async () => {
      await plot.updateComplete;
      const tip = pinned(plot)!;
      expect(tip).not.toBeNull();
      const area = plot.getBoundingClientRect();
      const card = tip.getBoundingClientRect();
      expect(card.width).toBeGreaterThan(0);
      expect(card.left).toBeGreaterThanOrEqual(area.left);
      expect(card.right).toBeLessThanOrEqual(area.right);
      expect(card.top).toBeGreaterThanOrEqual(area.top);
      expect(card.bottom).toBeLessThanOrEqual(area.bottom);
    });
  });

  it('a pinned touch tooltip keeps clear of touchTooltipInsets', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    plot.touchTooltipInsets = { top: 0, right: 0, bottom: 120, left: 100 };
    // P1 sits in the plot's bottom-left corner, under both insets.
    tap(plot, at(plot, 'P1'));
    await vi.waitFor(async () => {
      await plot.updateComplete;
      const tip = pinned(plot)!;
      expect(tip).not.toBeNull();
      const area = plot.getBoundingClientRect();
      const card = tip.getBoundingClientRect();
      expect(card.width).toBeGreaterThan(0);
      expect(card.left).toBeGreaterThanOrEqual(area.left + 100);
      expect(card.right).toBeLessThanOrEqual(area.right);
      expect(card.bottom).toBeLessThanOrEqual(area.bottom - 120);
    });
  });

  it('a tap pins the compact card beside its protein; a mouse click pins the full one', async () => {
    const plot = await mountPlot([VIEW_STRUCTURE]);
    const p2 = at(plot, 'P2');
    tap(plot, p2);
    await vi.waitFor(async () => {
      await plot.updateComplete;
      const tip = pinned(plot)!;
      await tip.updateComplete;
      const root = tip.shadowRoot!;
      expect(root.querySelector('.tooltip.compact')).not.toBeNull();
      expect(root.querySelector('.resource-links')).toBeNull();
      expect(getComputedStyle(root.querySelector('.tooltip-swatch')!).backgroundColor).toBe(
        'rgb(51, 102, 153)',
      );
      const card = root.querySelector('.tooltip')!.getBoundingClientRect();
      expect(card.width).toBe(240);
      // The tapped protein (and its 9 px selection ring) stays in view.
      const covered =
        p2.x >= card.left - 9 &&
        p2.x <= card.right + 9 &&
        p2.y >= card.top - 9 &&
        p2.y <= card.bottom + 9;
      expect(covered).toBe(false);
    });

    plot.remove();
    const desktop = await mountPlot([VIEW_STRUCTURE]);
    mouse(desktop, 'click', at(desktop, 'P3'));
    await desktop.updateComplete;
    const tip = pinned(desktop)!;
    await tip.updateComplete;
    expect(tip.shadowRoot!.querySelector('.tooltip.compact')).toBeNull();
    expect(tip.shadowRoot!.querySelector('.resource-links')).not.toBeNull();
  });

  it("a tap's compat mouseenter on a spider node shows no hover tooltip", async () => {
    const plot = await mountPlot([], true);
    await vi.waitFor(() => expect(plot.getDuplicateStacks()).toHaveLength(1), { timeout: 3_000 });
    tap(plot, at(plot, 'P1'));
    await plot.updateComplete;
    expect(plot.hasExpandedDuplicateStack()).toBe(true);
    const node = await vi.waitFor(() => {
      const found = plot.shadowRoot!.querySelector('.dup-spiderfy-node');
      expect(found).not.toBeNull();
      return found!;
    });
    node.dispatchEvent(new MouseEvent('mouseenter'));
    await plot.updateComplete;
    expect(tooltip(plot)).toBeNull();
  });

  it('a compat mousemove after a touch press shows no hover tooltip', async () => {
    const plot = await mountPlot();
    const p = at(plot, 'P3');
    svgOf(plot).dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: p.x,
        clientY: p.y,
        bubbles: true,
        composed: true,
        pointerType: 'touch',
      }),
    );
    mouse(plot, 'mousemove', p);
    await frame();
    await plot.updateComplete;
    expect(tooltip(plot)).toBeNull();
  });

  it("the svg's touch-action is none", async () => {
    const plot = await mountPlot();
    expect(getComputedStyle(svgOf(plot)).touchAction).toBe('none');
  });
});
