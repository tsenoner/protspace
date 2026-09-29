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

async function runPersistedOrDefaultFlow(
  datasetController: DatasetController,
  epoch: number,
): Promise<void> {
  const outcome = await datasetController.loadPersistedOrDefaultDataset({ epoch });
  // 'preempted': a user request made meanwhile owns the screen, so no banner.
  if (outcome.kind !== 'recovery-required') return;

  // `loadPersistedOrDefaultDataset` (dataset-controller.ts) itself emits
  // (null, 'startup') for this outcome, so a stale `?dataset=` from a
  // failed/unknown deep link doesn't linger in the URL while the recovery
  // banner (no example showing) is up.
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
 * A known id that was *superseded* by a newer request (a second Back/menu
 * choice landing while this one was still loading) is abandoned silently:
 * some other, newer request already owns the screen, so this one must not
 * run the fallback and load the demo over it. Either way a real fallback's
 * own success is reported through `DatasetController.subscribeToDatasetChanges`
 * with source 'startup', which is what tells the URL sync hook to remove the
 * stale parameter.
 *
 * Everything runs under `epoch`: a Back/Forward passes a new user epoch
 * (`beginUserRequest`), so it supersedes any load still in flight; the
 * startup load passes the epoch current when it began, so its fallback yields
 * to any user request made meanwhile.
 */
export async function loadRequestedDatasetOrFallback(
  datasetController: DatasetController,
  requestedExampleId: string | null | undefined,
  { epoch = datasetController.currentRequestEpoch() }: { epoch?: number } = {},
): Promise<void> {
  if (requestedExampleId) {
    if (findExampleDataset(requestedExampleId)) {
      const outcome = await datasetController.loadExampleDataset(requestedExampleId, { epoch });
      if (outcome !== 'failed') return;
    } else {
      notify.warning(getUnknownExampleDatasetNotification(requestedExampleId));
    }
  }

  await runPersistedOrDefaultFlow(datasetController, epoch);
}

/**
 * A `?dataset=` change after the first load, i.e. Back/Forward: a user
 * request, including one to an entry without `dataset=`. It takes a new
 * request epoch before anything else, so it supersedes any load still in
 * flight (and aborts its download), and its own fallback runs under that
 * epoch.
 */
export async function loadDatasetAfterNavigation(
  datasetController: DatasetController,
  requestedExampleId: string | null,
): Promise<void> {
  await loadRequestedDatasetOrFallback(datasetController, requestedExampleId, {
    epoch: datasetController.beginUserRequest(),
  });
}

export async function startInitialExploreLoad({
  dataLoader,
  datasetController,
  plotElement,
  requestedExampleId,
}: StartupOptions): Promise<void> {
  // App-initiated: a user request made from here on (a menu click while the
  // perf check or the stored-import read is still running) wins.
  const epoch = datasetController.currentRequestEpoch();
  const perfSuiteHandled = await maybeRunWebglPerfSuite({ plotElement, dataLoader });
  if (perfSuiteHandled) return;

  await loadRequestedDatasetOrFallback(datasetController, requestedExampleId, { epoch });
}
