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
    eatDim: null as EatReliabilityState | null,
    zoomToProteins: vi.fn(() => true),
    touchTooltipInsets: { top: 0, right: 0, bottom: 90, left: 48 },
  });
  const root = new EventTarget();
  const panel = Object.assign(new EventTarget(), {
    data: null as VisualizationData | null,
    annotation: '',
    context: null as Uint8Array | null,
    labelColors: new Map<string, string>() as ReadonlyMap<string, string>,
    focusProtein: null as number | null,
    otherFilters: [] as readonly { annotation: string; reliability: EatReliabilityState }[],
    active: false,
    reliability: DEFAULT_EAT_RELIABILITY as EatReliabilityState,
    outcome: 'hide' as 'hide' | 'dim',
    overlayEnabled: true,
    isAtDefaults: true,
    resets: 0,
  });
  const eatPanel = Object.assign(panel, {
    resetForNewDataset() {
      panel.resets += 1;
    },
    reset: vi.fn(),
  });
  const legend = { eatReliability: null as EatReliabilityState | null, eatFade: false };
  const pickAnnotation = vi.fn();
  const selectProteins = vi.fn();
  const requestStructure = vi.fn();
  const traceProtein = vi.fn(() => true);
  const setTracing = vi.fn();
  const downloadIds = vi.fn();
  const notify = { success: vi.fn(), error: vi.fn() };
  const filter = {
    mask: null as Uint8Array | null,
    setEatReliability: vi.fn(),
    getContextMask: vi.fn((): Uint8Array | null => filter.mask),
    others: [] as { annotation: string; reliability: EatReliabilityState }[],
    getOtherEatReliabilities: () => filter.others,
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
    selectProteins,
    requestStructure,
    traceProtein,
    setTracing,
    downloadIds,
    notify,
  });
  const layoutChanged = () => panelListeners.forEach((listener) => listener());
  /** The panel's own controls moved: its state changes, then it emits. */
  const emit = (enabled: boolean, reliability: EatReliabilityState) => {
    panel.reliability = reliability;
    panel.overlayEnabled = enabled;
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
    selectProteins,
    requestStructure,
    traceProtein,
    setTracing,
    downloadIds,
    notify,
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
    const reliability: EatReliabilityState = { min: 0.5, max: 1 };
    filter.mask = Uint8Array.of(1, 0);

    emit(false, reliability);

    expect(plot.eatOverlayEnabled).toBe(false);
    expect(filter.setEatReliability).toHaveBeenCalledWith('ec', reliability);
    expect(legend.eatReliability).toEqual(reliability);
    expect(panel.context).toBe(filter.mask);
    expect(getWorkbenchStatus().eatAdjusted).toBe(true);
  });

  it('Dim clears the reliability condition and fades through eatDim; Hide puts the condition back', () => {
    const { plot, panel, legend, filter, emit } = setup({ value: true });
    const reliability: EatReliabilityState = { min: 0.5, max: 1 };
    emit(true, reliability);
    const choose = (outcome: 'hide' | 'dim') => {
      panel.outcome = outcome;
      panel.dispatchEvent(
        new CustomEvent('eat-outcome-change', { detail: { outcome, reliability } }),
      );
    };

    choose('dim');
    expect(filter.setEatReliability).toHaveBeenLastCalledWith('ec', DEFAULT_EAT_RELIABILITY);
    expect(plot.eatDim).toEqual(reliability);
    // The legend names the range and says it fades.
    expect(legend.eatReliability).toEqual(reliability);
    expect(legend.eatFade).toBe(true);
    expect(getWorkbenchStatus().eatDim).toEqual(reliability);

    // A threshold commit in Dim moves the fade, still without a condition.
    const tighter: EatReliabilityState = { min: 0.6, max: 1 };
    emit(true, tighter);
    expect(filter.setEatReliability).toHaveBeenLastCalledWith('ec', DEFAULT_EAT_RELIABILITY);
    expect(plot.eatDim).toEqual(tighter);
    // The same state again keeps the plot's object: no re-stage.
    const drawn = plot.eatDim;
    emit(true, { ...tighter });
    expect(plot.eatDim).toBe(drawn);
    // Show off fades nothing, so the chip goes too; Show on brings both back.
    emit(false, tighter);
    expect(plot.eatDim).toBeNull();
    expect(getWorkbenchStatus().eatDim).toBeNull();
    emit(true, tighter);
    expect(plot.eatDim).toEqual(tighter);

    panel.reliability = reliability;
    choose('hide');
    expect(filter.setEatReliability).toHaveBeenLastCalledWith('ec', reliability);
    expect(plot.eatDim).toBeNull();
    expect(legend.eatReliability).toEqual(reliability);
    expect(legend.eatFade).toBe(false);
    expect(getWorkbenchStatus().eatDim).toBeNull();
  });

  it('refreshes the context and the legend’s note on every data-change', () => {
    const { plot, panel, legend, filter } = setup({ value: true });
    expect(panel.context).toBeNull();

    // An Apply in the Filter panel: the filter moved the panel (no emit) and the plot re-derived.
    filter.mask = Uint8Array.of(0, 1);
    panel.reliability = { min: 0, max: 0.4 };
    plot.dispatchEvent(new Event('data-change'));

    expect(panel.context).toBe(filter.mask);
    expect(legend.eatReliability).toEqual({ min: 0, max: 0.4 });
  });

  it('tells the panel of another annotation’s reliability filter, and clears it from there', () => {
    const { plot, panel, filter } = setup({ value: true });
    filter.others = [{ annotation: 'family', reliability: { min: 0.5, max: 1 } }];
    plot.dispatchEvent(new Event('data-change'));
    expect(panel.otherFilters).toEqual(filter.others);

    filter.setEatReliability.mockImplementation(() => (filter.others = []));
    panel.dispatchEvent(new CustomEvent('eat-clear-filter', { detail: { annotation: 'family' } }));
    expect(filter.setEatReliability).toHaveBeenCalledWith('family', DEFAULT_EAT_RELIABILITY);
    expect(panel.otherFilters).toEqual([]);
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
    emit(true, { min: 0.3, max: 1 });
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

  it('colorByBase switches Color by to another base only', () => {
    const { controller, pickAnnotation } = setup({ value: true });
    controller.colorByBase(undefined);
    controller.colorByBase('ec');
    expect(pickAnnotation).not.toHaveBeenCalled();
    controller.colorByBase('family');
    expect(pickAnnotation).toHaveBeenCalledExactlyOnceWith('family');
  });

  it('selects the proteins of eat-select-proteins and shows a single one’s structure collapsed', () => {
    const { panel, controller, selectProteins, requestStructure } = setup({ value: true });
    const select = (proteinIds: string[], zoom: boolean) =>
      panel.dispatchEvent(new CustomEvent('eat-select-proteins', { detail: { proteinIds, zoom } }));
    select(['P2'], true);
    expect(selectProteins).toHaveBeenCalledWith(['P2'], { zoom: true });
    expect(requestStructure).toHaveBeenCalledExactlyOnceWith('P2', { collapsed: true });
    select(['P1', 'P2'], false);
    expect(selectProteins).toHaveBeenLastCalledWith(['P1', 'P2'], { zoom: false });
    expect(requestStructure).toHaveBeenCalledTimes(1);
    controller.dispose();
    select(['P1'], true);
    expect(selectProteins).toHaveBeenCalledTimes(2);
  });

  it('points the card at a single selected protein, by index in the current data', () => {
    const { plot, panel, controller } = setup({ value: true });
    controller.setSelection(['P2']);
    expect(panel.focusProtein).toBe(1);
    controller.setSelection(['P1', 'P2']);
    expect(panel.focusProtein).toBeNull();
    controller.setSelection(['P1']);
    expect(panel.focusProtein).toBe(0);
    controller.setSelection(['missing']);
    expect(panel.focusProtein).toBeNull();

    // A new dataset re-reads the selection against its own ids.
    controller.setSelection(['P2']);
    plot.data = { ...EAT_DATA, protein_ids: ['P2', 'P1'] };
    plot.dispatchEvent(new Event('data-change'));
    expect(panel.focusProtein).toBe(0);
    controller.setSelection([]);
    expect(panel.focusProtein).toBeNull();
  });

  it('looks the card’s protein up only while the panel shows a dataset with predictions', () => {
    const shown = { value: false };
    const { plot, panel, controller, layoutChanged } = setup(shown);
    controller.setSelection(['P2']);
    expect(panel.focusProtein).toBeNull();
    shown.value = true;
    layoutChanged();
    expect(panel.focusProtein).toBe(1);
    shown.value = false;
    layoutChanged();
    expect(panel.focusProtein).toBeNull();

    shown.value = true;
    plot.data = { ...TEST_DATA, protein_ids: ['P1', 'P2'] };
    plot.dispatchEvent(new Event('data-change'));
    expect(panel.focusProtein).toBeNull();
  });

  it('Go to source selects the source, draws the pair and fits both clear of the chrome', () => {
    const { plot, panel, controller, selectProteins, traceProtein, requestStructure } = setup({
      value: true,
    });
    panel.dispatchEvent(
      new CustomEvent('eat-go-to-source', {
        detail: { targetId: 'P2', targetIndex: 1, sourceId: 'P1' },
      }),
    );
    expect(selectProteins).toHaveBeenCalledExactlyOnceWith(['P1'], { zoom: false });
    expect(requestStructure).toHaveBeenCalledExactlyOnceWith('P1', { collapsed: true });
    expect(traceProtein).toHaveBeenCalledExactlyOnceWith('P2', 1, 'auto', 'P1');
    expect(plot.zoomToProteins).toHaveBeenCalledExactlyOnceWith(['P2', 'P1'], {
      insets: { top: 0, right: 0, bottom: 90, left: 48 },
    });

    panel.dispatchEvent(
      new CustomEvent('eat-trace-source', { detail: { sourceId: 'P1', sourceIndex: 0 } }),
    );
    expect(traceProtein).toHaveBeenLastCalledWith('P1', 0, 'source');
    expect(selectProteins).toHaveBeenCalledTimes(1);

    controller.dispose();
    panel.dispatchEvent(
      new CustomEvent('eat-trace-source', { detail: { sourceId: 'P1', sourceIndex: 0 } }),
    );
    expect(traceProtein).toHaveBeenCalledTimes(2);
  });

  it('hands the Drawing switches to plot clicks and lights the rail dot, until disposed', () => {
    const { panel, controller, setTracing } = setup({ value: true });
    const drawing = (trace: boolean, linesPerSource: number) => {
      panel.isAtDefaults = trace && linesPerSource === 20;
      panel.dispatchEvent(
        new CustomEvent('eat-drawing-change', { detail: { trace, linesPerSource } }),
      );
    };

    drawing(false, 50);
    expect(setTracing).toHaveBeenCalledExactlyOnceWith({ trace: false, linesPerSource: 50 });
    expect(getWorkbenchStatus().eatAdjusted).toBe(true);
    drawing(true, 20);
    expect(getWorkbenchStatus().eatAdjusted).toBe(false);

    controller.dispose();
    drawing(false, 10);
    expect(setTracing).toHaveBeenCalledTimes(2);
  });

  it('downloads Export IDs and confirms with the export toast, until disposed', () => {
    const { panel, controller, downloadIds, notify } = setup({ value: true });
    const exportIds = () =>
      panel.dispatchEvent(
        new CustomEvent('eat-export-ids', {
          detail: { proteinIds: ['P2', 'P1'], fileName: 'ec-eat-in-range-ids.txt' },
        }),
      );

    exportIds();
    expect(downloadIds).toHaveBeenCalledExactlyOnceWith(['P2', 'P1'], 'ec-eat-in-range-ids.txt');
    expect(notify.success).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Export ready.', description: 'ec-eat-in-range-ids.txt' }),
    );

    downloadIds.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    exportIds();
    expect(notify.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Export failed.', description: 'blocked' }),
    );
    expect(notify.success).toHaveBeenCalledTimes(1);

    controller.dispose();
    exportIds();
    expect(downloadIds).toHaveBeenCalledTimes(2);
  });
});
