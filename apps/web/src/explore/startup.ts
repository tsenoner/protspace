import type { DataLoader as ProtspaceDataLoader, ProtspaceScatterplot } from '@protspace/core';
import { notify } from '../lib/notify';
import { maybeRunWebglPerfSuite } from '../perf/webgl-perf-suite';
import type { DatasetController } from './dataset-controller';
import { findExampleDataset } from './example-datasets';
import { getUnknownExampleDatasetNotification } from './notifications';
import { clearLastImportedFile } from './opfs-dataset-store';
import { dismissRecoveryBanner, showRecoveryBanner } from './recovery-banner';

interface StartupOptions {
  dataLoader: ProtspaceDataLoader;
  datasetController: DatasetController;
  plotElement: ProtspaceScatterplot;
  /** The `dataset` URL param at the time startup runs, if any. */
  requestedExampleId?: string | null;
}

async function runPersistedOrDefaultFlow(datasetController: DatasetController): Promise<void> {
  const outcome = await datasetController.loadPersistedOrDefaultDataset();
  if (outcome.kind !== 'recovery-required') return;

  showRecoveryBanner({
    fileName: outcome.file.name,
    failedAttempts: outcome.failedAttempts,
    lastError: outcome.lastError,
    handlers: {
      onRetry: async () => {
        dismissRecoveryBanner();
        await datasetController.tryLoadPersistedAgain(outcome.file);
      },
      onLoadDefault: async () => {
        dismissRecoveryBanner();
        await datasetController.loadDefaultDatasetAndClearPersistedFile();
      },
      onClear: async () => {
        dismissRecoveryBanner();
        await clearLastImportedFile();
        await datasetController.loadDefaultDatasetAndClearPersistedFile();
      },
    },
  });
}

/**
 * Loads the example named by `requestedExampleId`, or falls back to the
 * stored import / default demo. Used both for the very first load and for
 * every subsequent `?dataset=` change the URL sync hook reports (Back/Forward,
 * or a direct edit of the URL) — unlike `startInitialExploreLoad`, it never
 * re-runs the perf-suite override.
 *
 * An unknown id warns and falls back; a known id whose fetch fails has
 * already been reported by the loader (`notify.error`) and also falls back.
 * Either way the fallback's own success is reported through
 * `DatasetController.subscribeToDatasetChanges` with source 'startup', which
 * is what tells the URL sync hook to remove the stale parameter.
 */
export async function loadRequestedDatasetOrFallback(
  datasetController: DatasetController,
  requestedExampleId: string | null | undefined,
): Promise<void> {
  if (requestedExampleId) {
    if (findExampleDataset(requestedExampleId)) {
      const success = await datasetController.loadExampleDataset(requestedExampleId);
      if (success) return;
    } else {
      notify.warning(getUnknownExampleDatasetNotification(requestedExampleId));
    }
  }

  await runPersistedOrDefaultFlow(datasetController);
}

export async function startInitialExploreLoad({
  dataLoader,
  datasetController,
  plotElement,
  requestedExampleId,
}: StartupOptions): Promise<void> {
  const perfSuiteHandled = await maybeRunWebglPerfSuite({ plotElement, dataLoader });
  if (perfSuiteHandled) return;

  await loadRequestedDatasetOrFallback(datasetController, requestedExampleId);
}
