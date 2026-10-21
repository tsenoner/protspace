import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EAT_RELIABILITY,
  type EatReliabilityState,
  type VisualizationData,
} from '@protspace/utils';
import { TEST_DATA } from './dataset-controller.fixtures';
import { createEatPanelController, eatAvailabilityFor } from './eat-panel-controller';
import { getWorkbenchStatus, resetWorkbenchStatusForTests } from './workbench-status';

/** TEST_DATA with a second protein: `ec` carries one prediction, `family` none. */
const EAT_DATA: VisualizationData = {
  ...TEST_DATA,
  protein_ids: ['P1', 'P2'],
  annotations: {
    ...TEST_DATA.annotations,
    family: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
  },
  annotation_data: { ec: new Int32Array([0, -1]), family: new Int32Array([0, 0]) },
  annotation_predicted: {
    ec: [null, { value: '1.1.1.1', confidence: 0.7, source: 'P1' }],
    family: [null, null],
  },
};

describe('eatAvailabilityFor', () => {
  it('is available for an annotation with predictions', () => {
    expect(eatAvailabilityFor(EAT_DATA, 'ec')).toEqual({ kind: 'available' });
  });

  it('names an annotation without predictions when another one has some', () => {
    expect(eatAvailabilityFor(EAT_DATA, 'family')).toEqual({
      kind: 'annotation',
      annotationLabel: 'Family',
    });
  });

  it('is the dataset kind when no annotation has predictions, or with no data', () => {
    expect(eatAvailabilityFor(TEST_DATA, 'ec')).toEqual({ kind: 'dataset' });
    expect(eatAvailabilityFor(null, 'ec')).toEqual({ kind: 'dataset' });
  });
});

function setup(shown: { value: boolean }) {
  const plot = Object.assign(new EventTarget(), {
    data: EAT_DATA as VisualizationData | null,
    selectedAnnotation: 'ec',
    eatOverlayEnabled: true,
  });
  const root = new EventTarget();
  const panel = Object.assign(new EventTarget(), {
    data: null as VisualizationData | null,
    annotation: '',
    context: null as Uint8Array | null,
    active: false,
    reliability: DEFAULT_EAT_RELIABILITY as EatReliabilityState,
    isAtDefaults: true,
    resets: 0,
  });
  const eatPanel = Object.assign(panel, {
    resetForNewDataset() {
      panel.resets += 1;
    },
  });
  const legend = { eatReliability: null as EatReliabilityState | null };
  const filter = {
    mask: null as Uint8Array | null,
    setEatReliability: vi.fn(),
    getContextMask: vi.fn((): Uint8Array | null => filter.mask),
  };
  const panelListeners = new Set<() => void>();
  const controller = createEatPanelController({
    eatPanel,
    plotElement: plot as never,
    legendElement: legend,
    filterController: filter,
    root: root as unknown as Document,
    isPanelShown: () => shown.value,
    subscribePanel(listener) {
      panelListeners.add(listener);
      return () => panelListeners.delete(listener);
    },
  });
  const layoutChanged = () => panelListeners.forEach((listener) => listener());
  /** The panel's own controls moved: its state changes, then it emits. */
  const emit = (enabled: boolean, reliability: EatReliabilityState) => {
    panel.reliability = reliability;
    panel.isAtDefaults = false;
    panel.dispatchEvent(
      new CustomEvent('eat-overlay-change', {
        detail: { enabled, confidenceThreshold: reliability.min, reliability },
      }),
    );
  };
  return { plot, root, panel, legend, filter, controller, layoutChanged, panelListeners, emit };
}

describe('createEatPanelController', () => {
  beforeEach(() => {
    resetWorkbenchStatusForTests();
  });

  it('feeds the panel the plot data and annotation, and publishes availability', () => {
    const { plot, root, panel } = setup({ value: false });
    expect(panel.data).toBe(EAT_DATA);
    expect(panel.annotation).toBe('ec');
    expect(getWorkbenchStatus().eatAvailability).toEqual({ kind: 'available' });

    plot.selectedAnnotation = 'family';
    root.dispatchEvent(new Event('annotation-change'));
    expect(panel.annotation).toBe('family');
    expect(getWorkbenchStatus().eatAvailability).toEqual({
      kind: 'annotation',
      annotationLabel: 'Family',
    });

    plot.data = TEST_DATA;
    plot.dispatchEvent(new Event('data-change'));
    expect(panel.data).toBe(TEST_DATA);
    expect(getWorkbenchStatus().eatAvailability).toEqual({ kind: 'dataset' });
  });

  it('sets active only while the panel is shown', () => {
    const shown = { value: false };
    const { panel, layoutChanged } = setup(shown);
    expect(panel.active).toBe(false);
    shown.value = true;
    layoutChanged();
    expect(panel.active).toBe(true);
    shown.value = false;
    layoutChanged();
    expect(panel.active).toBe(false);
  });

  it('resets the panel for a new dataset and stops listening on dispose', () => {
    const { plot, panel, controller, panelListeners } = setup({ value: false });
    controller.resetForNewDataset();
    expect(panel.resets).toBe(1);
    controller.dispose();
    expect(panelListeners.size).toBe(0);
    plot.data = TEST_DATA;
    plot.dispatchEvent(new Event('data-change'));
    expect(panel.data).toBe(EAT_DATA);
  });

  it('applies the panel’s eat-overlay-change to the plot, the filter, the legend and the rail dot', () => {
    const { plot, panel, legend, filter, emit } = setup({ value: true });
    const reliability: EatReliabilityState = { mode: 'atLeast', min: 0.5, max: 1 };
    filter.mask = Uint8Array.of(1, 0);

    emit(false, reliability);

    expect(plot.eatOverlayEnabled).toBe(false);
    expect(filter.setEatReliability).toHaveBeenCalledWith('ec', reliability);
    expect(legend.eatReliability).toEqual(reliability);
    expect(panel.context).toBe(filter.mask);
    expect(getWorkbenchStatus().eatAdjusted).toBe(true);
  });

  it('refreshes the context and the legend’s note on every data-change', () => {
    const { plot, panel, legend, filter } = setup({ value: true });
    expect(panel.context).toBeNull();

    // An Apply in the Filter panel: the filter moved the panel (no emit) and the plot re-derived.
    filter.mask = Uint8Array.of(0, 1);
    panel.reliability = { mode: 'atMost', min: 0, max: 0.4 };
    plot.dispatchEvent(new Event('data-change'));

    expect(panel.context).toBe(filter.mask);
    expect(legend.eatReliability).toEqual({ mode: 'atMost', min: 0, max: 0.4 });
  });

  it('removes its eat-overlay-change listener on dispose', () => {
    const { filter, controller, emit } = setup({ value: true });
    controller.dispose();
    emit(true, { mode: 'atLeast', min: 0.3, max: 1 });
    expect(filter.setEatReliability).not.toHaveBeenCalled();
  });
});
