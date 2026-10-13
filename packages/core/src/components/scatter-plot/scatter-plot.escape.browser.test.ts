import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { ESCAPE_ORDER, onEscapeFallback, topLayer } from '../kit/layers';
import type { ProtspaceScatterplot } from './scatter-plot';
import './scatter-plot';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

/** P1 and P2 share a position, so they form a duplicate stack; P3 sits apart. */
function makeData(): VisualizationData {
  return {
    protein_ids: ['P1', 'P2', 'P3'],
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array([0, 0, 0, 0, 10, 10]) }],
    annotations: {
      fam: { kind: 'categorical', values: ['A'], colors: ['#336699'], shapes: ['circle'] },
    },
    annotation_data: { fam: new Int32Array(3) },
  } as unknown as VisualizationData;
}

async function mountPlot(): Promise<ProtspaceScatterplot> {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.config = { enableDuplicateStackUI: true };
  plot.data = makeData();
  document.body.append(plot);
  await plot.updateComplete;
  // The duplicate stacks and the point grid are built on frames after the data and the size.
  await vi.waitFor(
    () => {
      const rect = plot.getBoundingClientRect();
      const p3 = plot.getProteinClientPosition('P3')!;
      expect(plot.pickInteractivePointAt(p3.x - rect.left, p3.y - rect.top)).not.toBeNull();
      expect(plot.getDuplicateStacks()).toHaveLength(1);
    },
    { timeout: 3_000 },
  );
  return plot;
}

function escape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event;
}

const CONNECTORS = {
  pairs: [{ sourceProteinId: 'P1', targetProteinId: 'P3', confidence: 0.9 }],
  totalCandidates: 1,
};

describe('scatterplot Escape', () => {
  it('with connectors drawn, Escape clears them through the fallback before a selection fallback registered at 20 runs', async () => {
    const plot = await mountPlot();
    const selection = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, selection));
    plot.setProvenanceConnectors(CONNECTORS);
    expect(plot.hasActiveProvenanceConnectors()).toBe(true);

    expect(escape().defaultPrevented).toBe(true);
    expect(plot.hasActiveProvenanceConnectors()).toBe(false);
    expect(selection).not.toHaveBeenCalled();

    // Nothing left to hide: the next press reaches the selection.
    escape();
    expect(selection).toHaveBeenCalledOnce();
  });

  it('an expanded spider is a layer: Escape collapses it and no fallback runs', async () => {
    const plot = await mountPlot();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.connectors, fallback));
    const p = plot.getProteinClientPosition('P1')!;
    plot
      .shadowRoot!.querySelector('svg')!
      .dispatchEvent(
        new MouseEvent('click', { clientX: p.x, clientY: p.y, bubbles: true, composed: true }),
      );
    expect(plot.hasExpandedDuplicateStack()).toBe(true);
    expect(topLayer()).toBeDefined();

    escape();

    expect(plot.hasExpandedDuplicateStack()).toBe(false);
    expect(topLayer()).toBeUndefined();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('disconnect unregisters the fallback', async () => {
    const plot = await mountPlot();
    plot.remove();
    // Connectors set on the detached plot: a fallback it left behind would clear them.
    plot.setProvenanceConnectors(CONNECTORS);
    const selection = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, selection));

    escape();

    expect(selection).toHaveBeenCalledOnce();
    expect(plot.hasActiveProvenanceConnectors()).toBe(true);
  });
});
