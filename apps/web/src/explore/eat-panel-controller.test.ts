import { beforeEach, describe, expect, it } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
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
  });
  const root = new EventTarget();
  const panel = {
    data: null as VisualizationData | null,
    annotation: '',
    active: false,
    resets: 0,
  };
  const eatPanel = Object.assign(panel, {
    resetForNewDataset() {
      panel.resets += 1;
    },
  });
  const panelListeners = new Set<() => void>();
  const controller = createEatPanelController({
    eatPanel,
    plotElement: plot as never,
    root: root as unknown as Document,
    isPanelShown: () => shown.value,
    subscribePanel(listener) {
      panelListeners.add(listener);
      return () => panelListeners.delete(listener);
    },
  });
  const layoutChanged = () => panelListeners.forEach((listener) => listener());
  return { plot, root, panel, controller, layoutChanged, panelListeners };
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
});
