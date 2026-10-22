import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DENSITY_DEFAULT } from '@protspace/utils';
import {
  createDatasetNamePublisher,
  datasetPhaseFor,
  eatUnavailableReason,
  getWorkbenchStatus,
  resetWorkbenchStatus,
  resetWorkbenchStatusForTests,
  setStructureSheet,
  setWorkbenchStatus,
  subscribeWorkbenchStatus,
} from './workbench-status';

beforeEach(() => {
  resetWorkbenchStatusForTests();
});

describe('workbench status', () => {
  it('starts empty', () => {
    expect(getWorkbenchStatus()).toEqual({
      datasetName: null,
      proteinCount: null,
      appliedFilterConditions: 0,
      unappliedFilterChanges: 0,
      densityLayer: 'off',
      structureProteinId: null,
      datasetPhase: 'starting',
      structureSheet: 'folded',
      structureCollapsed: false,
      eatAvailability: { kind: 'dataset' },
      eatAdjusted: false,
      eatAnnotationLabel: '',
      eatDim: null,
    });
  });

  it('resets every field, structure and EAT included, and notifies', () => {
    const empty = getWorkbenchStatus();
    setWorkbenchStatus({
      datasetName: 'demo.parquetbundle',
      proteinCount: 7,
      datasetPhase: 'ready',
      structureProteinId: 'P12345',
      structureSheet: 'expanded',
      structureCollapsed: false,
      eatAvailability: { kind: 'available' },
      eatAdjusted: true,
      eatAnnotationLabel: 'EC',
    });
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    resetWorkbenchStatus();
    expect(getWorkbenchStatus()).toEqual(empty);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('merges a patch and notifies once', () => {
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle', proteinCount: 7831 });
    expect(listener).toHaveBeenCalledOnce();

    setWorkbenchStatus({ proteinCount: 12 });
    expect(getWorkbenchStatus()).toEqual({
      datasetName: 'demo.parquetbundle',
      proteinCount: 12,
      appliedFilterConditions: 0,
      unappliedFilterChanges: 0,
      densityLayer: 'off',
      structureProteinId: null,
      datasetPhase: 'starting',
      structureSheet: 'folded',
      structureCollapsed: false,
      eatAvailability: { kind: 'dataset' },
      eatAdjusted: false,
      eatAnnotationLabel: '',
      eatDim: null,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('an equal EAT availability keeps its object and does not notify', () => {
    setWorkbenchStatus({ eatAvailability: { kind: 'annotation', annotationLabel: 'Family' } });
    const first = getWorkbenchStatus();
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setWorkbenchStatus({ eatAvailability: { kind: 'annotation', annotationLabel: 'Family' } });
    expect(getWorkbenchStatus()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    setWorkbenchStatus({ eatAvailability: { kind: 'annotation', annotationLabel: 'Pfam' } });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('says why the EAT panel cannot open', () => {
    expect(eatUnavailableReason({ kind: 'available' })).toBeNull();
    expect(eatUnavailableReason({ kind: 'annotation', annotationLabel: 'Family' })).toBe(
      'Family has no EAT predictions. Color by an annotation marked EAT.',
    );
    expect(eatUnavailableReason({ kind: 'dataset' })).toBe(
      'This dataset has no transferred annotations (EAT).',
    );
  });

  it('an equal patch does not notify', () => {
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle', proteinCount: 7831 });
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle' });
    setWorkbenchStatus({});
    expect(listener).not.toHaveBeenCalled();
  });

  it('starts with no filter applied', () => {
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    setWorkbenchStatus({ appliedFilterConditions: 2 });
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(2);
  });

  it('keeps the snapshot until a change', () => {
    const first = getWorkbenchStatus();
    setWorkbenchStatus({ datasetName: null });
    expect(getWorkbenchStatus()).toBe(first);
    setWorkbenchStatus({ datasetName: 'mine.parquetbundle' });
    expect(getWorkbenchStatus()).not.toBe(first);
  });

  it("densityLayer starts at the plot's default mode", () => {
    expect(getWorkbenchStatus().densityLayer).toBe(DENSITY_DEFAULT);
    setWorkbenchStatus({ densityLayer: 'auto' });
    expect(getWorkbenchStatus().densityLayer).toBe('auto');
  });

  it('structureProteinId starts null and takes the published protein', () => {
    expect(getWorkbenchStatus().structureProteinId).toBeNull();
    setWorkbenchStatus({ structureProteinId: 'P12345' });
    expect(getWorkbenchStatus().structureProteinId).toBe('P12345');
  });

  it('datasetPhase starts at starting, so the empty state never flashes before startup ends', () => {
    expect(getWorkbenchStatus().datasetPhase).toBe('starting');
    setWorkbenchStatus({ datasetPhase: 'empty' });
    expect(getWorkbenchStatus().datasetPhase).toBe('empty');
  });

  it('structureSheet starts folded; setStructureSheet notifies once per change', () => {
    expect(getWorkbenchStatus().structureSheet).toBe('folded');
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setStructureSheet('expanded');
    expect(getWorkbenchStatus().structureSheet).toBe('expanded');
    expect(listener).toHaveBeenCalledOnce();
    setStructureSheet('expanded');
    expect(listener).toHaveBeenCalledOnce();
    setStructureSheet('folded');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('createDatasetNamePublisher', () => {
  const ids = (n: number) => ({ protein_ids: Array.from({ length: n }, (_, i) => `P${i}`) });

  it('names a loaded dataset with its count', () => {
    let data: { protein_ids: string[] } | null = null;
    const publish = createDatasetNamePublisher(() => data);
    data = ids(10);
    publish('demo.parquetbundle');
    expect(getWorkbenchStatus()).toEqual({
      datasetName: 'demo.parquetbundle',
      proteinCount: 10,
      appliedFilterConditions: 0,
      unappliedFilterChanges: 0,
      densityLayer: 'off',
      structureProteinId: null,
      datasetPhase: 'starting',
      structureSheet: 'folded',
      structureCollapsed: false,
      eatAvailability: { kind: 'dataset' },
      eatAdjusted: false,
      eatAnnotationLabel: '',
      eatDim: null,
    });
  });

  it('never pairs a name set before its load with the previous dataset count', () => {
    let data = ids(10);
    const publish = createDatasetNamePublisher(() => data);
    data = ids(10);
    publish('old.parquetbundle');

    // An OPFS restore names its file before the load starts; the old data is still on screen.
    publish('new.parquetbundle');
    expect(getWorkbenchStatus()).toEqual({
      datasetName: 'new.parquetbundle',
      proteinCount: null,
      appliedFilterConditions: 0,
      unappliedFilterChanges: 0,
      densityLayer: 'off',
      structureProteinId: null,
      datasetPhase: 'starting',
      structureSheet: 'folded',
      structureCollapsed: false,
      eatAvailability: { kind: 'dataset' },
      eatAdjusted: false,
      eatAnnotationLabel: '',
      eatDim: null,
    });

    data = ids(3);
    publish('new.parquetbundle');
    expect(getWorkbenchStatus()).toEqual({
      datasetName: 'new.parquetbundle',
      proteinCount: 3,
      appliedFilterConditions: 0,
      unappliedFilterChanges: 0,
      densityLayer: 'off',
      structureProteinId: null,
      datasetPhase: 'starting',
      structureSheet: 'folded',
      structureCollapsed: false,
      eatAvailability: { kind: 'dataset' },
      eatAdjusted: false,
      eatAnnotationLabel: '',
      eatDim: null,
    });
  });

  it('keeps the count when the same dataset is named again', () => {
    let data = ids(0);
    const publish = createDatasetNamePublisher(() => data);
    data = ids(5);
    publish('demo.parquetbundle');
    publish('demo.parquetbundle');
    expect(getWorkbenchStatus().proteinCount).toBe(5);
  });

  it('a name set with no data on screen has no count', () => {
    const publish = createDatasetNamePublisher(() => null);
    publish('recovered.parquetbundle');
    expect(getWorkbenchStatus()).toEqual({
      datasetName: 'recovered.parquetbundle',
      proteinCount: null,
      appliedFilterConditions: 0,
      unappliedFilterChanges: 0,
      densityLayer: 'off',
      structureProteinId: null,
      datasetPhase: 'starting',
      structureSheet: 'folded',
      structureCollapsed: false,
      eatAvailability: { kind: 'dataset' },
      eatAdjusted: false,
      eatAnnotationLabel: '',
      eatDim: null,
    });
  });
});

describe('datasetPhaseFor', () => {
  it('is loading while the overlay shows, whatever is on screen', () => {
    expect(datasetPhaseFor({ overlayShown: true, displayed: false, startupSettled: false })).toBe(
      'loading',
    );
    expect(datasetPhaseFor({ overlayShown: true, displayed: true, startupSettled: true })).toBe(
      'loading',
    );
  });

  it('is ready with a dataset on screen and no overlay', () => {
    expect(datasetPhaseFor({ overlayShown: false, displayed: true, startupSettled: false })).toBe(
      'ready',
    );
  });

  it('is starting until startup has ended, then empty with nothing on screen', () => {
    expect(datasetPhaseFor({ overlayShown: false, displayed: false, startupSettled: false })).toBe(
      'starting',
    );
    expect(datasetPhaseFor({ overlayShown: false, displayed: false, startupSettled: true })).toBe(
      'empty',
    );
  });
});
