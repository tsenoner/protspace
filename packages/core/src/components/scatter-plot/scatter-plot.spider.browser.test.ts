import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { VisualizationData } from '@protspace/utils';
import type { ProtspaceScatterplot } from './scatter-plot';
import './scatter-plot';

afterEach(() => {
  document.body.replaceChildren();
});

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** P1 and P2 share a position (one duplicate stack); P3 sits apart. */
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

/** Mounts the plot and opens the P1/P2 spider; resolves with its nodes. */
async function openSpider() {
  const plot = document.createElement('protspace-scatterplot');
  plot.style.cssText = 'display: block; width: 480px; height: 360px';
  plot.selectedAnnotation = 'fam';
  plot.config = { enableDuplicateStackUI: true };
  plot.data = makeData();
  document.body.append(plot);
  await plot.updateComplete;
  await vi.waitFor(() => expect(plot.getDuplicateStacks()).toHaveLength(1), { timeout: 3_000 });
  const p1 = plot.getProteinClientPosition('P1')!;
  plot
    .shadowRoot!.querySelector('svg')!
    .dispatchEvent(
      new MouseEvent('click', { clientX: p1.x, clientY: p1.y, bubbles: true, composed: true }),
    );
  await plot.updateComplete;
  expect(plot.hasExpandedDuplicateStack()).toBe(true);
  await vi.waitFor(() =>
    expect(plot.shadowRoot!.querySelectorAll('.dup-spiderfy-node')).toHaveLength(2),
  );
  return plot;
}

/** Resolves once the view stops moving, so the node stays under a resting mouse. */
async function viewSettled(plot: ProtspaceScatterplot) {
  const transform = () =>
    plot.shadowRoot!.querySelector('g.overlay-container')?.getAttribute('transform');
  await vi.waitFor(
    async () => {
      const before = transform();
      await wait(100);
      expect(transform()).toBe(before);
    },
    { timeout: 3_000 },
  );
}

function clicks(plot: ProtspaceScatterplot) {
  const ids: string[] = [];
  plot.addEventListener('protein-click', (event) =>
    ids.push((event as CustomEvent<{ proteinId: string }>).detail.proteinId),
  );
  return ids;
}

const nodes = (plot: ProtspaceScatterplot) =>
  plot.shadowRoot!.querySelectorAll<SVGGElement>('.dup-spiderfy-node');

describe('scatterplot duplicate spider', () => {
  it('a mouse resting on a spider node leaves the spider alone, and a click selects it', async () => {
    const plot = await openSpider();
    const ids = clicks(plot);
    const hovers: (string | null)[] = [];
    plot.addEventListener('protein-hover', (event) =>
      hovers.push((event as CustomEvent<{ proteinId: string | null }>).detail.proteinId),
    );

    await viewSettled(plot);
    const node = nodes(plot)[0];
    await userEvent.hover(node.querySelector('circle')!);
    await wait(100);
    let mutations = 0;
    const observer = new MutationObserver((records) => (mutations += records.length));
    const layer = plot.shadowRoot!.querySelector('g.duplicate-spiderfy-layer')!;
    observer.observe(layer, { childList: true, subtree: true });
    await wait(300);
    observer.disconnect();

    expect(mutations).toBe(0);
    expect(nodes(plot)[0]).toBe(node);
    expect(hovers).toEqual(['P1']);
    expect(plot.shadowRoot!.querySelector('protspace-protein-tooltip')).not.toBeNull();

    await userEvent.click(node.querySelector('circle')!);
    await plot.updateComplete;
    expect(ids).toEqual(['P1']);
  });

  it('a touch tap on a spider node selects it', async () => {
    const plot = await openSpider();
    const ids = clicks(plot);
    const node = nodes(plot)[1];
    const box = node.getBoundingClientRect();
    const init: PointerEventInit = {
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
      bubbles: true,
      composed: true,
      pointerType: 'touch',
      pointerId: 3,
      isPrimary: true,
    };
    node.dispatchEvent(new PointerEvent('pointerdown', init));
    node.dispatchEvent(new PointerEvent('pointerup', init));
    await plot.updateComplete;
    expect(ids).toEqual(['P2']);
  });
});
