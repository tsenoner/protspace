import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { ESCAPE_ORDER, onEscapeFallback } from '../kit/layers';
import type { ProtspaceScatterplot } from './scatter-plot';
import type { TooltipAction, TooltipActionDetail } from './scatter-plot.events';
import './scatter-plot';

const VIEW_STRUCTURE: TooltipAction = { id: 'view-structure', label: 'View structure' };
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Three proteins far apart, with empty plot around each. */
function makeData(): VisualizationData {
  return {
    protein_ids: ['P1', 'P2', 'P3'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0, 5, 5, 10, 10]) }],
    annotations: {
      fam: { kind: 'categorical', values: ['A'], colors: ['#336699'], shapes: ['circle'] },
    },
    annotation_data: { fam: new Int32Array(3) },
  } as unknown as VisualizationData;
}

async function mountPlot(actions: readonly TooltipAction[] = [VIEW_STRUCTURE]) {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.tooltipActions = actions;
  plot.data = makeData();
  document.body.append(plot);
  await plot.updateComplete;
  // Hit tests read the point grid, rebuilt on a frame after the data and the size.
  await gridReady(plot);
  return plot;
}

async function gridReady(plot: ProtspaceScatterplot): Promise<void> {
  // Past waitFor's 1 s default: while the unit project shares the CPU, the first frames of a
  // software-WebGL plot take longer than that.
  await vi.waitFor(() => {
    const rect = plot.getBoundingClientRect();
    const p = at(plot, 'P3');
    expect(plot.pickInteractivePointAt(p.x - rect.left, p.y - rect.top)).not.toBeNull();
  }, 5000);
}

/** A mouse event on the plot's interaction layer at client coordinates. */
function mouse(
  plot: ProtspaceScatterplot,
  type: 'click' | 'mousemove',
  at: { x: number; y: number },
) {
  plot
    .shadowRoot!.querySelector('svg')!
    .dispatchEvent(
      new MouseEvent(type, { clientX: at.x, clientY: at.y, bubbles: true, composed: true }),
    );
}

const at = (plot: ProtspaceScatterplot, id: string) => plot.getProteinClientPosition(id)!;

const pinned = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    'protspace-protein-tooltip.pinned',
  );

/** Any tooltip on screen, pinned or hover. */
const shown = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    'protspace-protein-tooltip.visible',
  );

/** Past the scatterplot's PIN_LEAVE_GRACE_MS (300 ms). */
const LEAVE_GRACE_MS = 400;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The mouse leaves the plot's interaction layer for `to`. */
function leaveSurface(plot: ProtspaceScatterplot, to: Element): void {
  plot
    .shadowRoot!.querySelector('svg')!
    .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
}

function escape(): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

describe('scatterplot tooltip actions', () => {
  it('without actions a click does not pin', async () => {
    const plot = await mountPlot([]);
    const clicks = vi.fn();
    plot.addEventListener('protein-click', clicks);
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(clicks).toHaveBeenCalledOnce();
    expect(pinned(plot)).toBeNull();
  });

  it('with actions a click pins the tooltip, which the mouse may cross to', async () => {
    const plot = await mountPlot();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    const tip = pinned(plot)!;
    await tip.updateComplete;
    expect(tip.shadowRoot!.textContent).toContain('P2');

    // On the way to the tooltip the mouse crosses empty plot and other proteins: the pin holds.
    const rect = plot.getBoundingClientRect();
    mouse(plot, 'mousemove', { x: rect.left + 8, y: rect.bottom - 8 });
    mouse(plot, 'mousemove', at(plot, 'P3'));
    await frame();
    leaveSurface(plot, tip);
    tip.dispatchEvent(new MouseEvent('mouseenter'));
    await wait(LEAVE_GRACE_MS);
    await plot.updateComplete;
    expect(pinned(plot)).toBe(tip);
    expect(tip.shadowRoot!.textContent).toContain('P2');

    // The next click ends it and pins the clicked protein.
    mouse(plot, 'click', at(plot, 'P3'));
    await plot.updateComplete;
    await pinned(plot)!.updateComplete;
    expect(pinned(plot)!.shadowRoot!.textContent).toContain('P3');
  });

  it('resting on another protein ends a pin and shows its hover tooltip', async () => {
    const plot = await mountPlot();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    mouse(plot, 'mousemove', at(plot, 'P3'));
    await frame();
    await wait(LEAVE_GRACE_MS);
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
    const hover = shown(plot)!;
    await hover.updateComplete;
    expect(hover.shadowRoot!.textContent).toContain('P3');
  });

  it('resting on empty plot or leaving the plot ends a pin with no tooltip', async () => {
    const plot = await mountPlot();
    const rect = plot.getBoundingClientRect();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    mouse(plot, 'mousemove', { x: rect.left + 8, y: rect.bottom - 8 });
    await frame();
    await wait(LEAVE_GRACE_MS);
    await plot.updateComplete;
    expect(shown(plot)).toBeNull();

    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();
    leaveSurface(plot, document.body);
    await wait(LEAVE_GRACE_MS);
    await plot.updateComplete;
    expect(shown(plot)).toBeNull();

    // Leaving the plot from the pinned tooltip ends it too.
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    const tip = pinned(plot)!;
    tip.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }));
    await wait(LEAVE_GRACE_MS);
    await plot.updateComplete;
    expect(shown(plot)).toBeNull();
  });

  it('coming back to the pinned protein within the grace keeps the pin', async () => {
    const plot = await mountPlot();
    const rect = plot.getBoundingClientRect();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    // The grace runs on a clock the test moves: under load one frame can outlast it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    cleanups.push(() => vi.useRealTimers());
    mouse(plot, 'mousemove', { x: rect.left + 8, y: rect.bottom - 8 });
    await frame();
    mouse(plot, 'mousemove', at(plot, 'P2'));
    await frame();
    vi.advanceTimersByTime(LEAVE_GRACE_MS);
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();
  });

  it('a zoom ends the pin; a reset glide at the identity keeps it', async () => {
    const plot = await mountPlot();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    plot.resetZoom();
    for (let i = 0; i < 10; i++) await frame();
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();

    const p = at(plot, 'P2');
    plot.shadowRoot!.querySelector('svg')!.dispatchEvent(
      new WheelEvent('wheel', {
        clientX: p.x,
        clientY: p.y,
        deltaY: -200,
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(async () => {
      await plot.updateComplete;
      expect(pinned(plot)).toBeNull();
    });
  });

  it('a click on empty plot ends the pin', async () => {
    const plot = await mountPlot();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();
    const rect = plot.getBoundingClientRect();
    mouse(plot, 'click', { x: rect.left + 8, y: rect.bottom - 8 });
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('a box-select drag start ends the pin', async () => {
    const plot = await mountPlot();
    plot.selectionMode = true;
    plot.selectionTool = 'rectangle';
    await plot.updateComplete;
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();

    // The press that starts a drag, as d3's brush hears it on its overlay.
    const start = at(plot, 'P1');
    const press = (type: string) =>
      new MouseEvent(type, { clientX: start.x, clientY: start.y, bubbles: true, view: window });
    plot.shadowRoot!.querySelector('.brush-container .overlay')!.dispatchEvent(press('mousedown'));
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
    window.dispatchEvent(press('mouseup'));
  });

  it('a lasso start ends the pin', async () => {
    const plot = await mountPlot();
    plot.selectionMode = true;
    plot.selectionTool = 'lasso';
    await plot.updateComplete;
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();

    // The lasso's pointer press calls beginLasso, then captures the pointer, which a synthetic
    // pointer cannot be: start it as that handler does.
    (
      plot as unknown as { _interaction: { beginLasso(start: [number, number]): void } }
    )._interaction.beginLasso([10, 10]);
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('new data ends the pin', async () => {
    const plot = await mountPlot();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();
    plot.data = makeData();
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('the action button dispatches tooltip-action with the protein id', async () => {
    const plot = await mountPlot();
    const actions = vi.fn();
    plot.addEventListener('tooltip-action', (event) =>
      actions((event as CustomEvent<TooltipActionDetail>).detail),
    );
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    const tip = pinned(plot)!;
    await tip.updateComplete;
    const button = tip.shadowRoot!.querySelector('ps-button')!;
    expect(button.textContent?.trim()).toBe('View structure');

    button.click();

    expect(actions).toHaveBeenCalledExactlyOnceWith({ id: 'view-structure', proteinId: 'P2' });
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('Escape and a press outside unpin', async () => {
    const plot = await mountPlot();
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    escape();
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();

    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    outside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await plot.updateComplete;
    expect(pinned(plot)).toBeNull();
  });

  it('emptying tooltipActions unpins', async () => {
    const plot = await mountPlot();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    mouse(plot, 'click', at(plot, 'P2'));
    await plot.updateComplete;
    expect(pinned(plot)).not.toBeNull();

    plot.tooltipActions = [];
    await plot.updateComplete;

    expect(pinned(plot)).toBeNull();
    // Its layer went with it: Escape reaches the fallbacks again.
    escape();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
