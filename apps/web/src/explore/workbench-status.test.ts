import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDatasetNamePublisher,
  getWorkbenchStatus,
  resetWorkbenchStatusForTests,
  setWorkbenchStatus,
  subscribeWorkbenchStatus,
} from './workbench-status';

beforeEach(() => {
  resetWorkbenchStatusForTests();
});

describe('workbench status', () => {
  it('starts empty', () => {
    expect(getWorkbenchStatus()).toEqual({ datasetName: null, proteinCount: null });
  });

  it('merges a patch and notifies once', () => {
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle', proteinCount: 7831 });
    expect(listener).toHaveBeenCalledOnce();

    setWorkbenchStatus({ proteinCount: 12 });
    expect(getWorkbenchStatus()).toEqual({ datasetName: 'demo.parquetbundle', proteinCount: 12 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('an equal patch does not notify', () => {
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle', proteinCount: 7831 });
    const listener = vi.fn();
    subscribeWorkbenchStatus(listener);
    setWorkbenchStatus({ datasetName: 'demo.parquetbundle' });
    setWorkbenchStatus({});
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the snapshot until a change', () => {
    const first = getWorkbenchStatus();
    setWorkbenchStatus({ datasetName: null });
    expect(getWorkbenchStatus()).toBe(first);
    setWorkbenchStatus({ datasetName: 'mine.parquetbundle' });
    expect(getWorkbenchStatus()).not.toBe(first);
  });
});

describe('createDatasetNamePublisher', () => {
  const ids = (n: number) => ({ protein_ids: Array.from({ length: n }, (_, i) => `P${i}`) });

  it('names a loaded dataset with its count', () => {
    let data: { protein_ids: string[] } | null = null;
    const publish = createDatasetNamePublisher(() => data);
    data = ids(10);
    publish('demo.parquetbundle');
    expect(getWorkbenchStatus()).toEqual({ datasetName: 'demo.parquetbundle', proteinCount: 10 });
  });

  it('never pairs a name set before its load with the previous dataset count', () => {
    let data = ids(10);
    const publish = createDatasetNamePublisher(() => data);
    data = ids(10);
    publish('old.parquetbundle');

    // An OPFS restore names its file before the load starts; the old data is still on screen.
    publish('new.parquetbundle');
    expect(getWorkbenchStatus()).toEqual({ datasetName: 'new.parquetbundle', proteinCount: null });

    data = ids(3);
    publish('new.parquetbundle');
    expect(getWorkbenchStatus()).toEqual({ datasetName: 'new.parquetbundle', proteinCount: 3 });
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
    });
  });
});
