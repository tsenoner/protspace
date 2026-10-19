import { describe, expect, it, vi } from 'vitest';
import type {
  DataErrorEventDetail,
  LegendErrorEventDetail,
  RendererDegradedDetail,
  RendererDegradedReason,
} from '@protspace/core';
import type { NotifyOptions } from '../lib/notify';
import * as notificationMappers from './notifications';
import {
  getClearStoredDataConfirm,
  getCorruptedPersistedDatasetNotification,
  getDataLoadFailureNotification,
  getDatasetPersistenceFailureNotification,
  getExampleLoadFailureNotification,
  getExportFailureNotification,
  getExportSuccessNotification,
  getFilterRemovedNotification,
  getLegendErrorNotification,
  getRendererDegradedNotification,
  getSelectionCopiedNotification,
  getSelectionCopyFailedNotification,
  getThreeDProjectionNotification,
  getSelectionDisabledNotification,
} from './notifications';
import { TEST_EXAMPLE } from './example-catalog.fixtures';
import { FastaPrepError } from './fasta-prep-client';
import { COLAB_NOTEBOOK_URL } from './fasta-prep-limits';

/** The link a notification action opens, or undefined for a callback action. */
function hrefOf(action: NotifyOptions['action']): string | undefined {
  return action && 'href' in action ? action.href : undefined;
}

function dataError(message: string, originalError?: Error): DataErrorEventDetail {
  return {
    message,
    severity: 'error',
    source: 'data-loader',
    context: { operation: 'load' },
    originalError,
  };
}

describe('explore notifications', () => {
  it('classifies OPFS SecurityError failures with private browsing guidance', () => {
    const notification = getDatasetPersistenceFailureNotification(
      new DOMException('Security error when calling GetDirectory', 'SecurityError'),
    );

    expect(notification.title).toBe('Dataset loaded, but automatic reload is unavailable.');
    expect(notification.description).toMatch(/private\/incognito mode/i);
    expect(notification.description).toMatch(/browser storage is restricted/i);
  });

  it('classifies unsupported OPFS failures separately', () => {
    const notification = getDatasetPersistenceFailureNotification(
      new Error('Origin Private File System is not supported in this browser.'),
    );

    expect(notification.description).toMatch(/does not support the Origin Private File System/i);
  });

  it('says why selection was turned off', () => {
    expect(
      getSelectionDisabledNotification({ reason: 'insufficient-data', dataSize: 1 }),
    ).toMatchObject({
      title: 'Selection mode disabled.',
      description: 'Selection mode disabled: Only 1 protein remaining',
      dedupeKey: 'selection-disabled:insufficient-data:1',
    });
    expect(
      getSelectionDisabledNotification({ reason: 'insufficient-data', dataSize: 0 }).description,
    ).toBe('Selection mode disabled: Only 0 proteins remaining');
    expect(getSelectionDisabledNotification({ reason: 'other', dataSize: 5 }).description).toBe(
      'Selection mode disabled',
    );
  });

  it('groups and pluralises its counts', () => {
    expect(
      getSelectionDisabledNotification({ reason: 'insufficient-data', dataSize: 1234 }).description,
    ).toBe('Selection mode disabled: Only 1,234 proteins remaining');
    expect(getExportSuccessNotification('a.parquetbundle', 1).description).toContain(
      'the 1 protein without coordinates',
    );
    expect(getExportSuccessNotification('a.parquetbundle', 1234).description).toContain(
      'the 1,234 proteins without coordinates',
    );
  });

  it('maps normalized data errors to a dataset import failure notification', () => {
    const detail: DataErrorEventDetail = {
      message: 'Invalid parquet bundle',
      severity: 'error',
      source: 'data-loader',
      context: {
        operation: 'load',
      },
      originalError: new Error('Invalid parquet bundle'),
    };

    expect(getDataLoadFailureNotification(detail)).toMatchObject({
      title: 'Dataset import failed.',
      description: 'Invalid parquet bundle',
    });
  });

  it('maps a known FastaPrepError code to actionable copy and appends the job reference', () => {
    const detail = dataError(
      'too many sequences',
      new FastaPrepError('too many sequences', {
        code: 'TOO_MANY_SEQUENCES',
        jobId: 'job-123',
      }),
    );

    const notification = getDataLoadFailureNotification(detail);
    expect(notification.title).toBe('Dataset import failed.');
    // Friendly mapped copy, not the raw server English.
    expect(notification.description).not.toBe('too many sequences');
    expect(notification.description).toMatch(/1500/);
    expect(notification.description).toMatch(/Reference: job-123/);
    expect(notification.dedupeKey).toBe('data-error:TOO_MANY_SEQUENCES');
  });

  it('surfaces the floor for a TOO_FEW_SEQUENCES failure without calling it "empty"', () => {
    const detail = dataError(
      'Need at least 20 sequences; got 5.',
      new FastaPrepError('Need at least 20 sequences; got 5.', {
        code: 'TOO_FEW_SEQUENCES',
        jobId: 'job-few',
      }),
    );

    const notification = getDataLoadFailureNotification(detail);
    expect(notification.title).toBe('Dataset import failed.');
    // No curated copy for this code, so the raw message shows through — it
    // already names the 20-sequence floor and never says "empty".
    expect(notification.description).toMatch(/20/);
    expect(notification.description).not.toMatch(/empty/i);
    expect(notification.dedupeKey).toBe('data-error:TOO_FEW_SEQUENCES');
  });

  it('routes a BIOCENTRAL_UNAVAILABLE failure to Colab with copy and an action', () => {
    const detail = dataError(
      'biocentral down',
      new FastaPrepError('biocentral down', { code: 'BIOCENTRAL_UNAVAILABLE' }),
    );

    const notification = getDataLoadFailureNotification(detail);
    expect(notification.description).toMatch(/Colab/);
    expect(notification.action).toEqual({
      label: 'Open in Colab ↗',
      href: COLAB_NOTEBOOK_URL,
    });
  });

  it('falls back to the server message for an unknown FastaPrepError code', () => {
    const detail = dataError(
      'something obscure failed',
      new FastaPrepError('something obscure failed', { code: 'WEIRD_NEW_CODE' }),
    );

    const notification = getDataLoadFailureNotification(detail);
    expect(notification.description).toBe('something obscure failed');
    expect(notification.dedupeKey).toBe('data-error:WEIRD_NEW_CODE');
  });

  it('includes the job reference even when there is no code', () => {
    const detail = dataError(
      'Lost connection to the prep backend.',
      new FastaPrepError('Lost connection to the prep backend.', { jobId: 'job-xyz' }),
    );

    const notification = getDataLoadFailureNotification(detail);
    expect(notification.description).toMatch(/Lost connection to the prep backend\./);
    expect(notification.description).toMatch(/Reference: job-xyz/);
  });

  it('leaves non-FastaPrepError data errors unchanged', () => {
    const notification = getDataLoadFailureNotification(dataError('Invalid parquet bundle'));
    expect(notification.description).toBe('Invalid parquet bundle');
    expect(notification.dedupeKey).toBe('data-error:Invalid parquet bundle');
  });

  it('maps legend errors to host notifications without exposing a structure toast mapper', () => {
    const legendDetail: LegendErrorEventDetail = {
      message: 'Failed to process legend data',
      severity: 'error',
      source: 'data-processing',
      context: {
        annotation: 'phylum',
      },
    };

    expect(getLegendErrorNotification(legendDetail).title).toBe('Legend update failed.');
    expect('getStructureErrorNotification' in notificationMappers).toBe(false);
  });

  it('maps successful exports to a success notification with the filename', () => {
    expect(getExportSuccessNotification('dataset.parquetbundle')).toMatchObject({
      title: 'Export ready.',
      description: 'dataset.parquetbundle',
    });
  });

  it('says which proteins of the loaded file a bundle export leaves out', () => {
    const notice = getExportSuccessNotification('dataset.parquetbundle', 1);
    expect(notice.title).toBe('Export ready.');
    expect(notice.description).toMatch(/^dataset\.parquetbundle leaves out the 1 protein without/);
    expect(notice.description).toMatch(/protspace convert/);
  });

  it('builds clear recovery copy for corrupted persisted datasets and export failures', () => {
    expect(getCorruptedPersistedDatasetNotification('could not be loaded').description).toMatch(
      /loaded the default demo dataset/i,
    );
    expect(getExportFailureNotification(new Error('Disk full'))).toMatchObject({
      title: 'Export failed.',
      description: 'Disk full',
    });
  });

  it('attaches a "Report this" mailto action to the import failure notification', () => {
    const action = getDataLoadFailureNotification(dataError('Invalid parquet bundle')).action;

    expect(action?.label).toBe('Report this');
    expect(hrefOf(action)).toMatch(/^mailto:hello@protspace\.app\?/);
    expect(hrefOf(action)).toContain('subject=%5BBug%5D%20Dataset%20import%20failed');
  });

  it('includes the trace id in the "Report this" email body for backend failures', () => {
    const detail = dataError(
      'Lost connection to the prep backend.',
      new FastaPrepError('Lost connection to the prep backend.', { jobId: 'job-xyz' }),
    );

    const action = getDataLoadFailureNotification(detail).action;

    expect(action?.label).toBe('Report this');
    // "Trace ID: job-xyz" survives mailto encoding (space → %20, ':' → %3A).
    expect(hrefOf(action)).toContain('Trace%20ID%3A%20job-xyz');
  });

  it('offers Retry first and "Report this" second when an example download fails', () => {
    const entry = TEST_EXAMPLE;
    const onRetry = vi.fn();

    const notification = getExampleLoadFailureNotification(
      entry,
      new Error('File not found: 500 Internal Server Error'),
      { source: 'menu', onRetry },
    );

    expect(notification.title).toBe(`Couldn't load "${entry.label}".`);
    expect(notification.action).toEqual({ label: 'Retry', onClick: onRetry });
    expect(notification.secondaryAction?.label).toBe('Report this');
    expect(hrefOf(notification.secondaryAction)).toContain(
      `subject=%5BBug%5D%20Example%20dataset%20%22${entry.id}%22%20failed`,
    );
  });

  it('dedupes example failures per request kind, so each keeps its own Retry', () => {
    const entry = TEST_EXAMPLE;
    const key = (source: 'menu' | 'url') =>
      getExampleLoadFailureNotification(entry, new Error('x'), { source, onRetry: vi.fn() })
        .dedupeKey;

    expect(key('menu')).not.toBe(key('url'));
    expect(key('url')).toBe(key('url'));
    expect(key('url')).toContain(entry.id);
  });

  it('attaches a "Report this" mailto action to the export failure notification', () => {
    const action = getExportFailureNotification(new Error('Disk full')).action;

    expect(action?.label).toBe('Report this');
    expect(hrefOf(action)).toMatch(/^mailto:hello@protspace\.app\?/);
    expect(hrefOf(action)).toContain('subject=%5BBug%5D%20Export%20failed');
  });
});

describe('getRendererDegradedNotification', () => {
  const degraded = (reason: RendererDegradedReason, detail?: string): RendererDegradedDetail => ({
    message: `${reason} message`,
    severity: 'warning',
    source: 'scatter-plot',
    context: { reason, maxTextureSize: 8192, stride: 8, pointCount: 50, detail },
  });

  it('names contours in the title when they cannot run, and dedupes per reason', () => {
    const n = getRendererDegradedNotification(
      degraded('density-unavailable', 'EXT_float_blend missing'),
    );

    expect(n.title).toBe('Contours unavailable.');
    expect(n.description).toBe('density-unavailable message');
    expect(n.dedupeKey).toBe('renderer-degraded:density-unavailable');
    expect(decodeURIComponent(hrefOf(n.action) ?? '')).toContain(
      'density-unavailable (maxTextureSize=8192, stride=8, points=50, cause=EXT_float_blend missing)',
    );
  });

  it('says a dataset past the point limit is not drawn, rather than drawn worse', () => {
    const n = getRendererDegradedNotification(degraded('point-limit-exceeded'));

    expect(n.title).toBe('Too many points to draw.');
    expect(n.dedupeKey).toBe('renderer-degraded:point-limit-exceeded');
  });

  it('keeps the quality title for every other reduction', () => {
    const n = getRendererDegradedNotification(degraded('gamma-pipeline-unavailable'));

    expect(n.title).toBe('Rendering quality reduced.');
    expect(n.dedupeKey).toBe('renderer-degraded:gamma-pipeline-unavailable');
  });
});

describe('selection copy notifications', () => {
  it('counts the copied IDs, plural-aware', () => {
    expect(getSelectionCopiedNotification(1).title).toBe('Copied 1 protein ID');
    expect(getSelectionCopiedNotification(1234).title).toBe('Copied 1,234 protein IDs');
  });

  it('says when the clipboard refused', () => {
    expect(getSelectionCopyFailedNotification()).toEqual({
      title: 'Could not copy the IDs',
      description: 'The browser did not allow access to the clipboard.',
    });
  });
});

describe('undo and confirmation copy', () => {
  it('names a removed filter', () => {
    expect(getFilterRemovedNotification()).toEqual({ title: 'Filter removed' });
  });

  it('asks before clearing the stored copy, naming the file and that it cannot be undone', () => {
    expect(getClearStoredDataConfirm('mine.parquetbundle', 'clear')).toEqual({
      heading: 'Clear stored data?',
      body: 'This deletes the copy of "mine.parquetbundle" saved in this browser. It cannot be undone.',
      confirmLabel: 'Clear data',
      danger: true,
    });
  });

  it('asks before "Load default" replaces the stored copy', () => {
    expect(getClearStoredDataConfirm('mine.parquetbundle', 'load-default')).toEqual({
      heading: 'Load the default dataset?',
      body: 'Loading the default deletes the copy of "mine.parquetbundle" saved in this browser. It cannot be undone.',
      confirmLabel: 'Load default',
      danger: true,
    });
  });
});

describe('getThreeDProjectionNotification', () => {
  it('names the 3-D projections, the X/Y view, PCA, 5.0.0, recomputing and --flatten-3d', () => {
    const n = getThreeDProjectionNotification(['UMAP 3']);

    expect(n.title).toBe('This file has 3-D projections.');
    expect(n.description).toMatch(/^UMAP 3 is shown as their X\/Y view\./);
    expect(n.description).toContain('For PCA the X/Y view is the same as pca2;');
    expect(n.description).toContain('the 3-D layout seen from one side');
    expect(n.description).toContain('Reading 3-D projections ends in ProtSpace 5.0.0.');
    expect(n.description).toContain('Recompute them with the 2-D method (e.g. umap2)');
    expect(n.description).toContain('"protspace convert --flatten-3d"');
    expect(n.description).not.toContain('To keep this view');
    expect(n.dedupeKey).toBe('three-d-projections');
  });

  it('lists up to three names and counts the rest', () => {
    const n = getThreeDProjectionNotification(['A 3', 'B 3', 'C 3', 'D 3', 'E 3']);

    expect(n.description).toMatch(/^A 3, B 3, C 3 and 2 more are shown as their X\/Y view\./);
  });
});
