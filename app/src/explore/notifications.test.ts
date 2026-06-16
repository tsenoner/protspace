import { describe, expect, it } from 'vitest';
import type {
  DataErrorEventDetail,
  LegendErrorEventDetail,
  SelectionDisabledNotificationDetail,
} from '@protspace/core';
import * as notificationMappers from './notifications';
import {
  getCorruptedPersistedDatasetNotification,
  getDataLoadFailureNotification,
  getDatasetPersistenceFailureNotification,
  getExportFailureNotification,
  getExportSuccessNotification,
  getLegendErrorNotification,
  getSelectionDisabledNotification,
} from './notifications';
import { FastaPrepError } from './fasta-prep-client';

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

  it('maps normalized selection-disabled events to a warning notification', () => {
    const detail: SelectionDisabledNotificationDetail = {
      message: 'Selection mode disabled: Only 1 point remaining',
      severity: 'warning',
      source: 'control-bar',
      context: {
        reason: 'insufficient-data',
        dataSize: 1,
      },
    };

    expect(getSelectionDisabledNotification(detail)).toMatchObject({
      title: 'Selection mode disabled.',
      description: 'Selection mode disabled: Only 1 point remaining',
    });
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
    expect(action?.href).toMatch(/^mailto:hello@protspace\.app\?/);
    expect(action?.href).toContain('subject=%5BBug%5D%20Dataset%20import%20failed');
  });

  it('attaches a "Report this" mailto action to the export failure notification', () => {
    const action = getExportFailureNotification(new Error('Disk full')).action;

    expect(action?.label).toBe('Report this');
    expect(action?.href).toMatch(/^mailto:hello@protspace\.app\?/);
    expect(action?.href).toContain('subject=%5BBug%5D%20Export%20failed');
  });
});
