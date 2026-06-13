import type {
  DataErrorEventDetail,
  LegendErrorEventDetail,
  SelectionDisabledNotificationDetail,
} from '@protspace/core';
import type { NotifyOptions } from '../lib/notify';
import { buildBugContext, buildMailto, clientContext } from '../lib/support';
import { FastaPrepError } from './fasta-prep-client';
import { MAX_UPLOAD_LABEL, MAX_SEQUENCES } from './fasta-prep-limits';

/**
 * Build a "Report this" toast action that opens a prefilled support email
 * describing the failing operation and its error.
 */
function buildReportAction(operation: string, error: unknown): NotifyOptions['action'] {
  return {
    label: 'Report this',
    href: buildMailto({
      subject: `[Bug] ${operation} failed`,
      body: buildBugContext({ operation, error, ...clientContext() }),
    }),
  };
}

/**
 * Friendly, actionable copy for the prep backend's known error codes. When a
 * code is absent or unknown we fall back to the raw server message.
 */
const FASTA_PREP_CODE_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: `The FASTA file is larger than the ${MAX_UPLOAD_LABEL} upload limit. Trim it or split it into smaller batches.`,
  TOO_MANY_SEQUENCES: `That FASTA has more than ${MAX_SEQUENCES} sequences. Reduce it to ${MAX_SEQUENCES} or fewer, or use the Colab notebook for larger datasets.`,
  SEQUENCE_TOO_LONG:
    'At least one sequence exceeds the 2000-residue limit. Shorten or remove the long sequences and try again.',
  MALFORMED_FASTA:
    'The file could not be parsed as FASTA. Check that every record starts with a ">" header followed by sequence lines.',
  DUPLICATE_IDENTIFIERS:
    'The FASTA contains duplicate sequence identifiers. Make each header unique and try again.',
  EMPTY_FASTA: 'The FASTA file appears to be empty. Add at least one sequence and try again.',
  TOTAL_RESIDUES_EXCEEDED:
    'The combined sequence length is too large for the prep backend. Reduce the number or length of sequences.',
  BIOCENTRAL_UNAVAILABLE:
    'The embedding service is temporarily unavailable. Please wait a moment and try again.',
};

function asFastaPrepError(detail: DataErrorEventDetail): FastaPrepError | null {
  const original = detail.originalError;
  return original instanceof FastaPrepError ? original : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

export function getDatasetPersistenceFailureNotification(error: unknown): NotifyOptions {
  const title = 'Dataset loaded, but automatic reload is unavailable.';

  if (error instanceof DOMException && error.name === 'SecurityError') {
    return {
      title,
      description:
        'ProtSpace could not access browser storage. This usually happens in private/incognito mode or when browser storage is restricted. Reopen ProtSpace in a normal browser window to restore automatic dataset reloads.',
      durationMs: 12_000,
      dedupeKey: 'dataset-persistence-security-error',
    };
  }

  if (
    error instanceof Error &&
    error.message === 'Origin Private File System is not supported in this browser.'
  ) {
    return {
      title,
      description:
        'This browser does not support the Origin Private File System (OPFS) used to restore your last imported dataset after a page reload.',
      durationMs: 12_000,
      dedupeKey: 'dataset-persistence-unsupported',
    };
  }

  return {
    title,
    description:
      'ProtSpace could not save this dataset in browser storage, so you may need to import it again after reloading the page.',
    durationMs: 12_000,
    dedupeKey: 'dataset-persistence-generic',
  };
}

export function getCorruptedPersistedDatasetNotification(context: string): NotifyOptions {
  return {
    title: 'Saved dataset was cleared.',
    description: `The dataset previously stored in browser storage ${context}. ProtSpace removed it and loaded the default demo dataset instead.`,
    durationMs: 10_000,
    dedupeKey: 'persisted-dataset-corrupt',
  };
}

export function getDataLoadFailureNotification(detail: DataErrorEventDetail): NotifyOptions {
  const prepError = asFastaPrepError(detail);
  const code = prepError?.code;
  const jobId = prepError?.jobId;

  // Prefer actionable copy for known backend codes; otherwise show the raw
  // server message so we never hide useful detail.
  const baseDescription = (code ? FASTA_PREP_CODE_MESSAGES[code] : undefined) ?? detail.message;
  const description = jobId ? `${baseDescription} (Reference: ${jobId})` : baseDescription;

  // Dedupe on the most specific stable identifier available.
  const dedupeKey = `data-error:${code ?? detail.message}`;

  return {
    title: 'Dataset import failed.',
    description,
    durationMs: 10_000,
    dedupeKey,
    action: buildReportAction('Dataset import', prepError ?? detail.message),
  };
}

export function getExportSuccessNotification(filename: string): NotifyOptions {
  return {
    title: 'Export ready.',
    description: filename,
    durationMs: 4_000,
  };
}

export function getExportFailureNotification(error: unknown): NotifyOptions {
  return {
    title: 'Export failed.',
    description: getErrorMessage(error),
    durationMs: 10_000,
    dedupeKey: `export-error:${getErrorMessage(error)}`,
    action: buildReportAction('Export', error),
  };
}

export function getSelectionDisabledNotification(
  detail: SelectionDisabledNotificationDetail,
): NotifyOptions {
  const reason = detail.context?.reason ?? 'unknown';
  const dataSize = detail.context?.dataSize ?? 'unknown';

  return {
    title: 'Selection mode disabled.',
    description: detail.message,
    durationMs: 5_000,
    dedupeKey: `selection-disabled:${reason}:${dataSize}`,
  };
}

export function getLegendErrorNotification(detail: LegendErrorEventDetail): NotifyOptions {
  return {
    title: 'Legend update failed.',
    description: detail.message,
    durationMs: 10_000,
    dedupeKey: `legend-error:${detail.source}:${detail.message}`,
  };
}

export interface RecoveryBannerCopy {
  title: string;
  body: string;
  retryLabel: string;
  loadDefaultLabel: string;
  clearLabel: string;
}

export function getLoadRecoveryCopy(
  fileName: string,
  failedAttempts: number,
  lastError?: string,
): RecoveryBannerCopy {
  if (failedAttempts >= 3) {
    return {
      title: 'This dataset has failed to load multiple times',
      body:
        `"${fileName}" has not finished loading after ${failedAttempts} attempts.` +
        (lastError ? ` Last error: ${lastError}.` : '') +
        ' Consider clearing it or loading the default demo bundle.',
      retryLabel: 'Try again',
      loadDefaultLabel: 'Load default',
      clearLabel: 'Clear stored data',
    };
  }

  return {
    title: 'Previous dataset did not finish loading',
    body:
      `"${fileName}" was not fully loaded last time` +
      (lastError ? ` (${lastError})` : '') +
      '. You can retry, switch to the default demo, or clear the stored copy.',
    retryLabel: 'Try again',
    loadDefaultLabel: 'Load default',
    clearLabel: 'Clear stored data',
  };
}
