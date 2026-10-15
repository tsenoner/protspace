/**
 * @vitest-environment jsdom
 *
 * Which annotations the colour-by dropdown badges as EAT-capable. The control bar derives
 * them from the bundle's `annotation_predicted` cells on each `data-change`; the dropdown
 * only renders what it is handed (annotation-select.component.test.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import './control-bar';
import type { ProtspaceData } from './types';

type Bar = HTMLElement & { autoSync: boolean; updateComplete: Promise<unknown> };
type Plot = HTMLElement & { data?: ProtspaceData };

const PREDICTED = { value: '1.1.1.1', confidence: 0.9, source: 'P1' };

/** Three proteins; `ec` carries a predicted cell for the third only. */
function makeData(predicted: ProtspaceData['annotation_predicted']): ProtspaceData {
  return {
    protein_ids: ['P1', 'P2', 'P3'],
    projections: [{ name: 'UMAP' }],
    annotations: {
      ec: { kind: 'categorical', values: ['1.1.1.1'] },
      family: { kind: 'categorical', values: ['A'] },
      go: { kind: 'categorical', values: ['GO:1'] },
    },
    annotation_predicted: predicted,
  };
}

async function mount(): Promise<{ controlBar: Bar; plot: Plot }> {
  // A plain element under the scatter plot's tag: the control bar finds it and listens.
  const plot = document.createElement('protspace-scatterplot') as Plot;
  document.body.appendChild(plot);
  const controlBar = document.createElement('protspace-control-bar') as Bar;
  controlBar.autoSync = true;
  document.body.appendChild(controlBar);
  await controlBar.updateComplete;
  return { controlBar, plot };
}

async function sendData(controlBar: Bar, plot: Plot, data: ProtspaceData): Promise<string[]> {
  plot.dispatchEvent(new CustomEvent('data-change', { detail: { data } }));
  await controlBar.updateComplete;
  const select = controlBar.shadowRoot?.querySelector('protspace-annotation-select') as
    | (HTMLElement & { eatAnnotations: string[] })
    | null;
  if (!select) throw new Error('annotation select not rendered');
  return select.eatAnnotations;
}

describe('control-bar EAT annotation badges', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('marks only the annotations with at least one predicted cell', async () => {
    const { controlBar, plot } = await mount();

    const eat = await sendData(
      controlBar,
      plot,
      makeData({ ec: [null, null, PREDICTED], family: [null, null, null] }),
    );

    expect(eat).toEqual(['ec']);
  });

  it('reads the badges from the whole dataset, not the visible subset', async () => {
    const { controlBar, plot } = await mount();
    // The plot's own data is the whole dataset; the event carries the visible subset.
    plot.data = makeData({ ec: [null, null, PREDICTED] });

    const eat = await sendData(controlBar, plot, makeData({ ec: [null, null] }));

    expect(eat).toEqual(['ec']);
  });
});
