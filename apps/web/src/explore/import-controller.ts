import type { DataLoader as ProtspaceDataLoader } from '@protspace/core';
import type { DatasetController } from './dataset-controller';
import { findExampleDataset } from './example-datasets';

interface ImportMenuOptions {
  /** Adds a listener on the Import menu for as long as the runtime lives. */
  listen(type: string, listener: EventListener): void;
  dataLoader: Pick<ProtspaceDataLoader, 'openFilePicker'>;
  datasetController: Pick<DatasetController, 'loadExampleDatasetAndClearPersistedFile'>;
}

/**
 * The Import menu's two choices: an example loads in place of the stored import, as a menu
 * choice, and "Load your dataset" opens the data loader's file picker.
 */
export function bindImportMenu({ listen, dataLoader, datasetController }: ImportMenuOptions): void {
  // This event name is part of the import menu's contract in @protspace/core.
  listen('load-example-dataset', (event) => {
    // A dispatch without a detail names no example: warn rather than throw.
    const id = (event as CustomEvent<{ id?: string } | null>).detail?.id;
    const entry = id === undefined ? undefined : findExampleDataset(id);
    if (!entry) {
      console.warn(`Unknown example dataset id: ${id}`);
      return;
    }
    void datasetController.loadExampleDatasetAndClearPersistedFile(entry, 'menu');
  });
  // Runs inside the menu's click, so the browser lets the picker open.
  listen('open-file-dialog', () => dataLoader.openFilePicker());
}
