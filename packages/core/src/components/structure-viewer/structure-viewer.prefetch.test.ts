/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prefetchMolstar } = vi.hoisted(() => ({ prefetchMolstar: vi.fn() }));
vi.mock('./molstar-loader', () => ({ prefetchMolstar, createMolstarViewer: vi.fn() }));

import './structure-viewer';

const hover = (plot: Element, proteinId: string | null) =>
  plot.dispatchEvent(new CustomEvent('protein-hover', { detail: { proteinId } }));

describe('protspace-structure-viewer Mol* prefetch', () => {
  let plot: HTMLElement;
  let viewer: HTMLElementTagNameMap['protspace-structure-viewer'];

  beforeEach(async () => {
    vi.useFakeTimers();
    prefetchMolstar.mockClear();
    plot = document.createElement('div');
    plot.id = 'prefetch-plot';
    document.body.appendChild(plot);
    viewer = document.createElement('protspace-structure-viewer');
    viewer.scatterplotSelector = '#prefetch-plot';
    document.body.appendChild(viewer);
    await viewer.updateComplete;
    // _setupAutoSync looks the plot up after 100 ms.
    vi.advanceTimersByTime(150);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('prefetches nothing before the pointer reaches a point', () => {
    expect(prefetchMolstar).not.toHaveBeenCalled();
    hover(plot, null); // hover cleared, not a hover
    expect(prefetchMolstar).not.toHaveBeenCalled();
  });

  it('prefetches once, on the first hovered point', () => {
    hover(plot, 'P12345');
    hover(plot, 'Q67890');
    expect(prefetchMolstar).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the viewer is removed', () => {
    viewer.remove();
    hover(plot, 'P12345');
    expect(prefetchMolstar).not.toHaveBeenCalled();
  });

  it('does not listen at all when auto-sync is off', async () => {
    document.body.replaceChildren(plot);
    const manual = document.createElement('protspace-structure-viewer');
    manual.autoSync = false;
    manual.scatterplotSelector = '#prefetch-plot';
    document.body.appendChild(manual);
    await manual.updateComplete;
    vi.advanceTimersByTime(150);

    hover(plot, 'P12345');
    expect(prefetchMolstar).not.toHaveBeenCalled();
  });
});
