// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import './legend';
import type { ProtspaceLegend } from './legend';

function makeData(): VisualizationData {
  return {
    protein_ids: ['observed', 'predicted', 'missing'],
    projections: [{ name: 'pca', dimension: 2, data: new Float32Array(6) }],
    annotations: {
      ec: {
        kind: 'categorical',
        values: ['observed', 'predicted', '__NA__'],
        colors: ['#111', '#555', '#ccc'],
        shapes: ['circle', 'circle', 'circle'],
      },
      family: {
        kind: 'categorical',
        values: ['family'],
        colors: ['#111'],
        shapes: ['circle'],
      },
    },
    annotation_data: {
      ec: new Int32Array([0, 2, 2]),
      family: new Int32Array([0, 0, 0]),
    },
    annotation_predicted: {
      ec: [null, { value: 'predicted', confidence: 0.8, source: 'observed' }, null],
    },
  };
}

async function setup() {
  const data = makeData();
  const plot = document.createElement('protspace-scatterplot') as HTMLElement & {
    data: VisualizationData;
    selectedAnnotation: string;
    eatOverlayEnabled: boolean;
    hiddenAnnotationValues: string[];
    otherAnnotationValues: string[];
    config: Record<string, never>;
    filtersActive: boolean;
    filteredProteinIds: string[];
    getCurrentData(): VisualizationData;
    isIsolationMode(): boolean;
    getIsolationHistory(): string[][];
  };
  Object.assign(plot, {
    data,
    selectedAnnotation: 'ec',
    eatOverlayEnabled: true,
    hiddenAnnotationValues: [],
    otherAnnotationValues: [],
    config: {},
    filtersActive: false,
    filteredProteinIds: [],
    getCurrentData: () => data,
    isIsolationMode: () => false,
    getIsolationHistory: () => [],
  });
  document.body.append(plot);

  const legend = document.createElement('protspace-legend') as ProtspaceLegend;
  document.body.append(legend);
  await legend.updateComplete;

  return { data, legend, plot };
}

describe('legend-owned EAT controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders the controls with counts', async () => {
    const { legend } = await setup();
    const root = legend.shadowRoot!;
    const group = root.querySelector<HTMLElement>('.eat-legend')!;

    expect(group.getAttribute('aria-label')).toBe('Embedding Annotation Transfer');
    expect(group.textContent).toContain('Predicted (transferred)');
    expect(group.textContent).toContain('Observed');
    expect(group.textContent).toContain('Predicted by EAT');
    // Default reliability position is 0 (show everything, clean filter box).
    expect(root.querySelector<HTMLInputElement>('.eat-threshold-percent')?.value).toBe('0');
  });

  it('syncs the overlay switch with the scatter plot and emits threshold changes for the filter', async () => {
    const { legend, plot } = await setup();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const toggle = legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-switch input')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await legend.updateComplete;

    // The overlay switch still coalesces predictions on the scatter plot.
    expect(plot.eatOverlayEnabled).toBe(false);
    expect(legend.shadowRoot!.querySelector('.eat-legend')).not.toBeNull();
    expect(legend.shadowRoot!.querySelector('.eat-legend-counts')).toBeNull();
    expect(
      legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold input')?.disabled,
    ).toBe(true);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    range.value = '0.73';
    range.dispatchEvent(new Event('input'));
    await legend.updateComplete;

    expect(plot.eatOverlayEnabled).toBe(true);
    // The threshold is no longer pushed onto the scatter plot as a dimming input;
    // it rides the eat-overlay-change contract and the range/percent stay in sync.
    expect(plot).not.toHaveProperty('eatConfidenceThreshold');
    expect(
      legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')?.value,
    ).toBe('73');
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: { enabled: true, confidenceThreshold: 0.73 },
      }),
    );

    const percent = legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')!;
    percent.value = '34';
    percent.dispatchEvent(new Event('input'));
    await legend.updateComplete;
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: { enabled: true, confidenceThreshold: 0.34 } }),
    );
    expect(range.value).toBe('0.34');
  });

  it('setReliabilityThreshold updates the slider without re-emitting (reverse mirror)', async () => {
    const { legend } = await setup();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    legend.setReliabilityThreshold(0.42);
    await legend.updateComplete;

    expect(legend.reliabilityThreshold).toBe(0.42);
    expect(
      legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')?.value,
    ).toBe('42');
    // Reverse direction must stay silent so it can't loop back to the control bar.
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses stable dataset capability and omits controls for a non-EAT selection', async () => {
    const { data, legend, plot } = await setup();
    const filteredView = {
      ...data,
      protein_ids: ['observed'],
      annotation_data: {
        ec: new Int32Array([0]),
        family: new Int32Array([0]),
      },
      annotation_predicted: { ec: [null] },
    };
    plot.getCurrentData = () => filteredView;
    plot.dispatchEvent(new CustomEvent('data-change', { detail: { data: filteredView } }));
    await legend.updateComplete;
    expect(legend.shadowRoot!.querySelector('.eat-legend')).not.toBeNull();

    plot.selectedAnnotation = 'family';
    legend.selectedAnnotation = 'family';
    legend.requestUpdate();
    await legend.updateComplete;
    expect(legend.shadowRoot!.querySelector('.eat-legend')).toBeNull();
  });
});
