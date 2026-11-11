import { describe, expect, it } from 'vitest';
import {
  createStructureErrorEventDetail,
  createStructureLoadDetail,
  createStructureProteinChangeDetail,
} from './structure-viewer.events';

describe('structure-viewer events', () => {
  it('builds lifecycle-only structure-load details', () => {
    expect(createStructureLoadDetail('P12345', 'loaded', null)).toEqual({
      proteinId: 'P12345',
      status: 'loaded',
      data: null,
    });
  });

  it('builds normalized structure-error details', () => {
    const originalError = new Error('Network failure');

    expect(
      createStructureErrorEventDetail(
        'P12345',
        'Failed to load structure. Please try again.',
        originalError,
      ),
    ).toEqual({
      message: 'Failed to load structure. Please try again.',
      severity: 'error',
      source: 'structure-viewer',
      context: {
        proteinId: 'P12345',
      },
      originalError,
    });
  });

  it('builds structure-protein-change details', () => {
    expect(createStructureProteinChangeDetail('P12345')).toEqual({ proteinId: 'P12345' });
  });
});
