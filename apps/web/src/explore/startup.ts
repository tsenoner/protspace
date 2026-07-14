import type { DataLoader as ProtspaceDataLoader, ProtspaceScatterplot } from '@protspace/core';
import { maybeRunWebglPerfSuite } from '../perf/webgl-perf-suite';
import type { DatasetController } from './dataset-controller';
import { clearLastImportedFile } from './opfs-dataset-store';
import { dismissRecoveryBanner, showRecoveryBanner } from './recovery-banner';

interface StartupOptions {
  dataLoader: ProtspaceDataLoader;
  datasetController: DatasetController;
  plotElement: ProtspaceScatterplot;
}

export async function startInitialExploreLoad({
  dataLoader,
  datasetController,
  plotElement,
}: StartupOptions): Promise<void> {
  const perfSuiteHandled = await maybeRunWebglPerfSuite({ plotElement, dataLoader });
  if (perfSuiteHandled) return;

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
