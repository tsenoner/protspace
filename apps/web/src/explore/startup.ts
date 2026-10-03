import type { DataLoader as ProtspaceDataLoader, ProtspaceScatterplot } from '@protspace/core';
import { notify } from '../lib/notify';
import { maybeRunWebglPerfSuite } from '../perf/webgl-perf-suite';
import type { DatasetController, ExampleLoadCancel } from './dataset-controller';
import { findExampleDataset } from './example-datasets';
import { getUnknownExampleDatasetNotification } from './notifications';
import { clearLastImportedFile } from './opfs-dataset-store';
import type { PersistedLoadOutcome } from './persisted-dataset';
import { dismissRecoveryBanner, showRecoveryBanner } from './recovery-banner';
import type { ExampleLoadOutcome } from './types';
import type { ViewController } from './view-controller';

/**
 * What a dataset request came to: the example's own outcome, or `'fallback'`
 * when the startup load (stored import, demo or recovery banner) ran instead,
 * or `'preempted'` when a user request took over before that could start.
 * `'failed'` also covers a startup load whose demo download failed (no import
 * stored): either way nothing new is on screen.
 */
type DatasetRequestOutcome = ExampleLoadOutcome | 'fallback' | 'preempted';

interface StartupOptions {
  dataLoader: ProtspaceDataLoader;
  datasetController: DatasetController;
  plotElement: ProtspaceScatterplot;
  /** The `dataset` URL param at the time startup runs, or null. */
  requestedExampleId: string | null;
}

async function runPersistedOrDefaultFlow(
  datasetController: DatasetController,
  epoch: number,
): Promise<PersistedLoadOutcome['kind']> {
  const outcome = await datasetController.loadPersistedOrDefaultDataset({ epoch });
  // 'preempted': a user request made meanwhile owns the screen, so no banner.
  if (outcome.kind !== 'recovery-required') return outcome.kind;

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
  return outcome.kind;
}

/**
 * Loads the example named by `requestedExampleId`, or falls back to the
 * stored import / default demo. Used both for the very first load and for
 * every subsequent `?dataset=` change the URL sync hook reports (Back/Forward,
 * or a direct edit of the URL) — unlike `startInitialExploreLoad`, it never
 * re-runs the perf-suite override.
 *
 * An unknown id warns and falls back; a known id whose fetch fails has
 * already been reported by the loader (`notify.error`, with Retry) and falls
 * back too — unless `keepCurrentOnFailure` is set because a dataset is
 * already on screen (a failed Back/Forward): then it resolves `'failed'` and
 * leaves the plot, the URL and the history entry alone, so Retry or a reload
 * can re-attempt the entry.
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
  requestedExampleId: string | null,
  {
    epoch = datasetController.currentRequestEpoch(),
    keepCurrentOnFailure = false,
  }: { epoch?: number; keepCurrentOnFailure?: boolean } = {},
): Promise<DatasetRequestOutcome> {
  if (requestedExampleId) {
    const entry = findExampleDataset(requestedExampleId);
    if (entry) {
      const outcome = await datasetController.loadExampleDataset(entry, 'url', { epoch });
      if (outcome !== 'failed' || keepCurrentOnFailure) return outcome;
    } else {
      notify.warning(getUnknownExampleDatasetNotification(requestedExampleId));
    }
  }

  const kind = await runPersistedOrDefaultFlow(datasetController, epoch);
  if (kind === 'preempted') return 'preempted';
  return kind === 'default-failed' ? 'failed' : 'fallback';
}

/**
 * A `?dataset=` change after the first load, i.e. Back/Forward (or Retry): a
 * user request, including one to an entry without `dataset=`. It takes a new
 * request epoch before anything else, so it supersedes any load still in
 * flight (and aborts its download), and its own fallback runs under that
 * epoch.
 *
 * With a dataset on screen, a failed example keeps it: no fallback, and the
 * URL and history entry stay as they are. The view request recorded for the
 * failed entry is then replaced by the view on screen, so a later import or
 * load doesn't inherit the failed entry's parameters; Retry records them
 * again. The same holds when the entry names no dataset and the demo its
 * startup load falls back to fails to download.
 */
export async function loadDatasetAfterNavigation(
  datasetController: DatasetController,
  viewController: Pick<ViewController, 'recordCurrentView'>,
  requestedExampleId: string | null,
): Promise<void> {
  const outcome = await loadRequestedDatasetOrFallback(datasetController, requestedExampleId, {
    epoch: datasetController.beginUserRequest(),
    keepCurrentOnFailure: datasetController.hasDisplayedDataset(),
  });
  if (outcome === 'failed' && datasetController.hasDisplayedDataset()) {
    viewController.recordCurrentView();
  }
}

/**
 * What follows the loading overlay's Cancel of an example download, which
 * has already aborted the download and dismissed the overlay under a new user
 * epoch (`cancel.epoch`), with no notification.
 *
 * With a dataset on screen, that is all: it stays, and the URL is left alone.
 * After a cancelled Back/Forward the entry still names the example, as after
 * a failed one, so the recorded view becomes the one on screen again.
 *
 * With nothing on screen yet (a startup `?dataset=` link), the normal
 * startup load runs under that epoch: the stored import, the demo or the
 * recovery banner. Its outcome is reported with source 'startup', which
 * replace-removes the `dataset` parameter.
 */
export async function handleCancelledExampleLoad(
  datasetController: DatasetController,
  viewController: Pick<ViewController, 'recordCurrentView'>,
  { epoch, source }: ExampleLoadCancel,
): Promise<void> {
  if (datasetController.hasDisplayedDataset()) {
    if (source === 'url') {
      viewController.recordCurrentView();
    }
    return;
  }
  await loadRequestedDatasetOrFallback(datasetController, null, { epoch });
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
