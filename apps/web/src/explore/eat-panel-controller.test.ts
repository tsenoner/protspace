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
    labelColors: new Map<string, string>() as ReadonlyMap<string, string>,
    active: false,
    reliability: DEFAULT_EAT_RELIABILITY as EatReliabilityState,
    isAtDefaults: true,
    resets: 0,
  });
  const eatPanel = Object.assign(panel, {
    resetForNewDataset() {
      panel.resets += 1;
    },
    reset: vi.fn(),
  });
  const legend = { eatReliability: null as EatReliabilityState | null };
  const pickAnnotation = vi.fn();
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
    pickAnnotation,
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
  return {
    plot,
    root,
    panel: eatPanel,
    legend,
    filter,
    controller,
    layoutChanged,
    panelListeners,
    emit,
    pickAnnotation,
  };
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
    expect(getWorkbenchStatus().eatAnnotationLabel).toBe('EC number');

    plot.selectedAnnotation = 'family';
    root.dispatchEvent(new Event('annotation-change'));
    expect(panel.annotation).toBe('family');
    expect(getWorkbenchStatus().eatAnnotationLabel).toBe('Family');
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

  it('asks for no context while hidden, and for the current one when the panel shows', () => {
    const shown = { value: false };
    const { plot, panel, filter, layoutChanged } = setup(shown);
    filter.mask = Uint8Array.of(1, 0);
    filter.getContextMask.mockClear();

    plot.dispatchEvent(new Event('data-change'));
    expect(filter.getContextMask).not.toHaveBeenCalled();

    shown.value = true;
    layoutChanged();
    expect(filter.getContextMask).toHaveBeenCalledTimes(1);
    expect(panel.context).toBe(filter.mask);
  });

  it('a locked Filter row’s ✕ resets the panel for the coloured base, or that base’s condition', () => {
    const { root, panel, filter, controller } = setup({ value: false });
    const reset = (annotation: string) =>
      root.dispatchEvent(new CustomEvent('eat-reliability-reset', { detail: { annotation } }));

    reset('ec');
    expect(panel.reset).toHaveBeenCalledTimes(1);
    expect(filter.setEatReliability).not.toHaveBeenCalled();

    // A condition left from an earlier Color by: the panel shows another annotation.
    reset('family');
    expect(panel.reset).toHaveBeenCalledTimes(1);
    expect(filter.setEatReliability).toHaveBeenCalledWith('family', DEFAULT_EAT_RELIABILITY);

    controller.dispose();
    reset('ec');
    expect(panel.reset).toHaveBeenCalledTimes(1);
  });

  it('removes its eat-overlay-change listener on dispose', () => {
    const { filter, controller, emit } = setup({ value: true });
    controller.dispose();
    emit(true, { mode: 'atLeast', min: 0.3, max: 1 });
    expect(filter.setEatReliability).not.toHaveBeenCalled();
  });

  it('gives the panel the colours of each legend colour mapping', () => {
    const { plot, panel } = setup({ value: false });
    const recolour = (colorMapping: Record<string, string>) =>
      plot.dispatchEvent(
        new CustomEvent('legend-colormapping-change', {
          detail: { colorMapping, shapeMapping: {}, colorOnly: false },
        }),
      );
    recolour({ '1.1.1.1': '#f00' });
    expect([...panel.labelColors]).toEqual([['1.1.1.1', '#f00']]);
    const first = panel.labelColors;
    recolour({ '1.1.1.1': '#f00' });
    expect(panel.labelColors).toBe(first);
    recolour({ '1.1.1.1': '#00f' });
    expect([...panel.labelColors]).toEqual([['1.1.1.1', '#00f']]);
  });

  it('switches Color by on the panel’s eat-color-by, until disposed', () => {
    const { panel, controller, pickAnnotation } = setup({ value: true });
    const colorBy = (annotation: string) =>
      panel.dispatchEvent(new CustomEvent('eat-color-by', { detail: { annotation } }));
    colorBy('family');
    expect(pickAnnotation).toHaveBeenCalledWith('family');
    controller.dispose();
    colorBy('ec');
    expect(pickAnnotation).toHaveBeenCalledTimes(1);
  });
});
