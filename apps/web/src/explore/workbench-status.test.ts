import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
