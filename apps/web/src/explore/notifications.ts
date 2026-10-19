import type {
  DataErrorEventDetail,
  LegendErrorEventDetail,
  RendererDegradedDetail,
} from '@protspace/core';
import { countNoun } from '@protspace/utils';
import type { NotifyOptions } from '../lib/notify';
import { buildBugContext, buildMailto, clientContext } from '../lib/support';
import type { ExampleDataset } from './example-datasets';
import { FastaPrepError } from './fasta-prep-client';
import { COLAB_NOTEBOOK_URL, MAX_UPLOAD_LABEL, MAX_SEQUENCES } from './fasta-prep-limits';
import type { DatasetChangeSource } from './types';

/**
 * Build a "Report this" toast action that opens a prefilled support email
 * describing the failing operation and its error.
 */
function buildReportAction(
  operation: string,
  error: unknown,
  traceId?: string,
): NotifyOptions['action'] {
  return {
    label: 'Report this',
    href: buildMailto({
      subject: `[Bug] ${operation} failed`,
      body: buildBugContext({ operation, error, traceId, ...clientContext() }),
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
    'The embedding service is currently unavailable. You can run the same preparation in Google Colab.',
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
    // A Biocentral outage is a known, routine condition with a clear next step
    // (Colab), so it takes the single action slot; every other failure offers
    // the "Report this" bug-report action instead.
    action:
      code === 'BIOCENTRAL_UNAVAILABLE'
        ? { label: 'Open in Colab ↗', href: COLAB_NOTEBOOK_URL }
        : buildReportAction('Dataset import', prepError ?? detail.message, jobId),
  };
}

/**
 * A failed example download (a bundle that downloads but fails to parse is
 * reported by `getDataLoadFailureNotification` instead): Retry is the primary
 * action and "Report this" the secondary one.
 *
 * The dedupe key names how the load began (`source`), because Retry repeats
 * that request: a menu choice and a Back/Forward to the same example that both
 * fail within the dedupe window each keep their own toast and their own Retry.
 */
export function getExampleLoadFailureNotification(
  entry: ExampleDataset,
  error: unknown,
  { source, onRetry }: { source: DatasetChangeSource; onRetry: () => void },
): NotifyOptions {
  return {
    title: `Couldn't load "${entry.label}".`,
    description: getErrorMessage(error),
    durationMs: 10_000,
    dedupeKey: `example-load-error:${source}:${entry.id}`,
    action: { label: 'Retry', onClick: onRetry },
    secondaryAction: buildReportAction(`Example dataset "${entry.id}"`, error),
  };
}

export function getUnknownExampleDatasetNotification(id: string): NotifyOptions {
  return {
    title: `Unknown example dataset "${id}".`,
    description: "That link doesn't match any example dataset. Showing your usual dataset instead.",
    durationMs: 8_000,
    dedupeKey: `unknown-example-dataset:${id}`,
  };
}

/** "1 protein" / "3 proteins": proteins a loaded file holds without coordinates. */
function unplacedProteins(count: number): string {
  return `${countNoun(count, 'protein', 'proteins')} without coordinates`;
}

/**
 * A user imported a bundle holding 3-D projections: they load, shown as their X/Y view,
 * but reading them ends in protspace 5.0.0. Only for PCA is that view the 2-D projection;
 * for a non-linear method it is the 3-D layout seen from one side, so recomputing with the
 * 2-D method beats `protspace convert --flatten-3d`, which keeps the view as it is.
 */
export function getThreeDProjectionNotification(projectionNames: readonly string[]): NotifyOptions {
  const shown = projectionNames.slice(0, 3).join(', ');
  const rest = projectionNames.length - 3;
  const listed = rest > 0 ? `${shown} and ${rest} more` : shown;
  const verb = projectionNames.length === 1 ? 'is' : 'are';
  return {
    title: 'This file has 3-D projections.',
    description: `${listed} ${verb} shown as their X/Y view. For PCA the X/Y view is the same as pca2; for UMAP, t-SNE, PaCMAP and other non-linear methods it is the 3-D layout seen from one side, which can overlap points that are far apart. Reading 3-D projections ends in ProtSpace 5.0.0. Recompute them with the 2-D method (e.g. umap2) when you have the embeddings. Or run "protspace convert --flatten-3d" on the file to keep this view as 2-D.`,
    durationMs: 12_000,
    dedupeKey: 'three-d-projections',
  };
}

/**
 * A user imported a v1/v2 bundle: it loads, but reading that format ends in 5.0.0.
 *
 * An export from the app holds only the proteins it shows, so a file that also holds
 * proteins no projection places is pointed at `protspace convert` alone, which keeps them.
 */
export function getLegacyBundleFormatNotification(
  formatVersion: number,
  unplacedProteinCount = 0,
): NotifyOptions {
  const upgrade =
    unplacedProteinCount > 0
      ? `To upgrade this file, run "protspace convert" on it. It also holds ${unplacedProteins(unplacedProteinCount)}, which an export from here leaves out.`
      : 'To upgrade this file, export it again as a .parquetbundle from here, or run "protspace convert" on it.';
  return {
    title: 'This file uses an older bundle format.',
    description: `Format v${formatVersion} bundles will stop opening in ProtSpace 5.0.0. ${upgrade}`,
    durationMs: 12_000,
    dedupeKey: 'legacy-bundle-format',
  };
}

/**
 * `unplacedProteinCount` is what the loaded file holds beyond the dataset the app shows (see
 * `DataLoadedEventDetail`): a .parquetbundle export leaves those proteins out, so it says so.
 */
export function getExportSuccessNotification(
  filename: string,
  unplacedProteinCount = 0,
): NotifyOptions {
  if (unplacedProteinCount > 0) {
    return {
      title: 'Export ready.',
      description: `${filename} leaves out the ${unplacedProteins(unplacedProteinCount)} the loaded file holds. "protspace convert" keeps them.`,
      durationMs: 10_000,
    };
  }
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

/** Why the plot turned selection off (its `auto-disable-selection` event). */
export function getSelectionDisabledNotification({
  reason,
  dataSize,
}: {
  reason: string;
  dataSize: number;
}): NotifyOptions {
  return {
    title: 'Selection mode disabled.',
    description:
      reason === 'insufficient-data'
        ? `Selection mode disabled: Only ${countNoun(dataSize, 'protein', 'proteins')} remaining`
        : 'Selection mode disabled',
    durationMs: 5_000,
    dedupeKey: `selection-disabled:${reason}:${dataSize}`,
  };
}

/** Copy IDs put the selection on the clipboard, one ID per line. */
export function getSelectionCopiedNotification(count: number): NotifyOptions {
  return { title: `Copied ${countNoun(count, 'protein ID', 'protein IDs')}` };
}

/** The clipboard refused Copy IDs (permission, or a page that is not a secure context). */
export function getSelectionCopyFailedNotification(): NotifyOptions {
  return {
    title: 'Could not copy the IDs',
    description: 'The browser did not allow access to the clipboard.',
  };
}

/**
 * Copy for a renderer capability reduction.
 *
 * Every one of these was previously silent or console-only, on hardware that
 * never said anything was out of range. The toast shows the user-facing message;
 * the report action carries the measured numbers instead, because the device
 * limit and the point count are what identify the device class in a bug report.
 */
export function getRendererDegradedNotification(detail: RendererDegradedDetail): NotifyOptions {
  const context = detail.context;
  const reason = context?.reason ?? 'unknown';
  return {
    // Contours are a feature the user switched on, not a quality level, and a
    // dataset past the point limit is not drawn at all.
    title:
      reason === 'density-unavailable'
        ? 'Contours unavailable.'
        : reason === 'point-limit-exceeded'
          ? 'Too many points to draw.'
          : 'Rendering quality reduced.',
    description: detail.message,
    durationMs: 10_000,
    dedupeKey: `renderer-degraded:${reason}`,
    action: buildReportAction(
      'Rendering',
      context
        ? `${reason} (maxTextureSize=${context.maxTextureSize}, stride=${context.stride}, ` +
            `points=${context.pointCount}${context.detail ? `, cause=${context.detail}` : ''})`
        : detail.message,
    ),
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

/** Reset or the filter chip's ✕ removed the filter; the toast offers Undo (decision 13). */
export function getFilterRemovedNotification(): { title: string } {
  return { title: 'Filter removed' };
}

/**
 * The question before the recovery banner's "Clear stored data" or "Load default" deletes the
 * OPFS copy, which nothing can restore.
 */
export function getClearStoredDataConfirm(
  fileName: string,
  action: 'clear' | 'load-default',
): {
  heading: string;
  body: string;
  confirmLabel: string;
  danger: true;
} {
  if (action === 'load-default') {
    return {
      heading: 'Load the default dataset?',
      body: `Loading the default deletes the copy of "${fileName}" saved in this browser. It cannot be undone.`,
      confirmLabel: 'Load default',
      danger: true,
    };
  }
  return {
    heading: 'Clear stored data?',
    body: `This deletes the copy of "${fileName}" saved in this browser. It cannot be undone.`,
    confirmLabel: 'Clear data',
    danger: true,
  };
}
