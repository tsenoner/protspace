/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildStorageKey } from '@protspace/utils';
import './legend';

type ShapeSizeLegend = HTMLElement & {
  shapeSize: number;
  selectedAnnotation: string;
  annotationData: { name: string; values: string[]; kind?: 'categorical' | 'numeric' };
  _dialogSettings: Record<string, unknown> & { shapeSize: number };
  _handleSettingsSave: () => void;
  _handleSettingsReset: () => void;
  _updateLegendItems: () => void;
  _dispatchLegendStateChange: () => void;
  _scatterplotController: { updateConfig: (config: { pointSize?: number }) => void };
  _persistenceController: {
    _datasetHash: string;
    updateDatasetHash: (ids: string[]) => boolean;
    updateSelectedAnnotation: (annotation: string) => boolean;
    loadSettings: () => void;
  };
  data: { annotations: Record<string, { values: string[] }> } | null;
  getAllPersistedSettings: () => Record<string, { shapeSize: number }>;
  applyShapeSize: (size: number, datasetHash?: string) => void;
};

function makeLegend() {
  const el = document.createElement('protspace-legend') as ShapeSizeLegend;
  const pointSizes: number[] = [];
  el._scatterplotController.updateConfig = (config) => {
    if (config.pointSize !== undefined) pointSizes.push(config.pointSize);
  };
  el._updateLegendItems = vi.fn();
  el._dispatchLegendStateChange = vi.fn();
  el._persistenceController.updateDatasetHash(['p1', 'p2']);
  const hash = el._persistenceController._datasetHash;
  const switchTo = (annotation: string) => {
    el.selectedAnnotation = annotation;
    el.annotationData = { name: annotation, values: ['x'], kind: 'categorical' };
    el._persistenceController.updateSelectedAnnotation(annotation);
    el._persistenceController.loadSettings();
  };
  const store = (annotation: string, shapeSize: number) =>
    localStorage.setItem(
      buildStorageKey('legend', hash, annotation),
      JSON.stringify({ shapeSize, maxVisibleValues: 10, hiddenValues: [], categories: {} }),
    );
  const pick = (shapeSize: number) => {
    el._dialogSettings = { ...el._dialogSettings, shapeSize, annotationSortModes: {} };
    el._handleSettingsSave();
  };
  return { el, hash, pointSizes, switchTo, store, pick };
}

describe('legend shape size', () => {
  beforeEach(() => localStorage.clear());

  it('starts a fresh dataset at 5, drawn as point size 40', () => {
    const { el, pointSizes, switchTo } = makeLegend();
    switchTo('a');
    expect(el.shapeSize).toBe(5);
    expect(pointSizes.at(-1)).toBe(40);
  });

  it('shows the new default for a legacy 30 record and keeps any other stored size', () => {
    const { el, switchTo, store } = makeLegend();
    store('a', 30);
    store('b', 50);
    switchTo('a');
    expect(el.shapeSize).toBe(5);
    switchTo('b');
    expect(el.shapeSize).toBe(50);
  });

  it('carries a picked size across annotation switches and a new legend', () => {
    const { el, pointSizes, switchTo, store, pick } = makeLegend();
    store('b', 50);
    switchTo('a');
    pick(12);
    switchTo('b');
    expect(el.shapeSize).toBe(12);
    expect(pointSizes.at(-1)).toBe(96);
    switchTo('a');
    expect(el.shapeSize).toBe(12);

    const next = makeLegend();
    next.switchTo('b');
    expect(next.el.shapeSize).toBe(12);
  });

  it('resets the whole dataset to 5', () => {
    const { el, switchTo, pick } = makeLegend();
    switchTo('a');
    pick(12);
    switchTo('b');
    el._handleSettingsReset();
    expect(el.shapeSize).toBe(5);
    switchTo('a');
    expect(el.shapeSize).toBe(5);
  });

  it('takes a bundle size as picked, including 30', () => {
    const { el, hash, pointSizes, switchTo } = makeLegend();
    switchTo('a');
    el.applyShapeSize(30, hash);
    expect(pointSizes.at(-1)).toBe(240);
    switchTo('b');
    expect(el.shapeSize).toBe(30);
  });

  it('exports the picked size on every annotation', () => {
    const { el, switchTo, store, pick } = makeLegend();
    store('b', 50);
    switchTo('a');
    pick(12);
    el.data = { annotations: { a: { values: ['x'] }, b: { values: ['x'] } } };
    const exported = el.getAllPersistedSettings();
    expect(exported.a.shapeSize).toBe(12);
    expect(exported.b.shapeSize).toBe(12);
  });
});
