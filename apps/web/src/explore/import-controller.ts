import type { DataLoader as ProtspaceDataLoader, ProtspaceImportMenu } from '@protspace/core';
import type { DatasetController } from './dataset-controller';
import { findExampleDataset, formatMegabytes } from './example-datasets';
import type { DatasetChangeSource } from './types';

const STORED_FILE_UNREADABLE = 'The stored file could not be read';

interface StoredImportSummary {
  name: string;
  size: number;
  storedAt: string;
}

interface ImportMenuOptions {
  /** Adds a listener on the Import menu for as long as the runtime lives. */
  listen(type: string, listener: EventListener): void;
  importMenu: Pick<ProtspaceImportMenu, 'lastFile' | 'shadowRoot'>;
  dataLoader: Pick<ProtspaceDataLoader, 'openFilePicker'>;
  datasetController: Pick<DatasetController, 'loadChosenExample' | 'tryLoadPersistedAgain'>;
  /** The stored import's metadata (`readStoredImportSummary`), never its bytes. */
  readSummary(): Promise<StoredImportSummary | null>;
  /** The stored import itself (`loadLastImportedFile`). */
  loadLastFile(): Promise<File | null>;
  subscribeToDatasetChanges(
    callback: (exampleId: string | null, source: DatasetChangeSource) => void,
  ): () => void;
  /** The example on screen, or null for a file. */
  getCurrentExampleId(): string | null;
  /** The name the app bar shows for the dataset on screen. */
  getShownName(): string;
  /** Shows a warning notification titled `title`. */
  warn(title: string): void;
}

/**
 * The Import menu's choices: an example loads as a menu choice (the stored import stays), "Open a
 * file…" opens the data loader's file picker, and "Last file" reopens the stored import. The
 * menu's `lastFile` follows every dataset change and is null while that file is on screen.
 */
export function bindImportMenu({
  listen,
  importMenu,
  dataLoader,
  datasetController,
  readSummary,
  loadLastFile,
  subscribeToDatasetChanges,
  getCurrentExampleId,
  getShownName,
  warn,
}: ImportMenuOptions): { refreshLastFile(): Promise<void>; dispose(): void } {
  // A slower, older read must not overwrite a newer one.
  let refreshes = 0;
  const refreshLastFile = async (): Promise<void> => {
    const ticket = ++refreshes;
    let summary: StoredImportSummary | null;
    try {
      summary = await readSummary();
    } catch {
      summary = null;
    }
    if (ticket !== refreshes) return;
    const onScreen =
      summary !== null && getCurrentExampleId() === null && summary.name === getShownName();
    importMenu.lastFile =
      summary && !onScreen
        ? { name: summary.name, sizeLabel: formatMegabytes(summary.size) }
        : null;
  };

  const reopenLastFile = async (): Promise<void> => {
    let file: File | null;
    try {
      file = await loadLastFile();
    } catch {
      file = null;
    }
    if (!file) {
      warn(STORED_FILE_UNREADABLE);
      await refreshLastFile();
      return;
    }
    // Through the recovery path: an OPFS load, which keeps the user's stored legend settings.
    await datasetController.tryLoadPersistedAgain(file);
  };

  // This event name is part of the import menu's contract in @protspace/core.
  listen('load-example-dataset', (event) => {
    // A dispatch without a detail names no example: warn rather than throw.
    const id = (event as CustomEvent<{ id?: string } | null>).detail?.id;
    const entry = id === undefined ? undefined : findExampleDataset(id);
    if (!entry) {
      console.warn(`Unknown example dataset id: ${id}`);
      return;
    }
    // A menu choice keeps the stored import, even one whose last load failed (recovery-required):
    // the recovery banner then returns on the next bare /explore until "Clear stored data".
    void datasetController.loadChosenExample(entry, 'menu');
  });
  // Runs inside the menu's click, so the browser lets the picker open.
  listen('open-file-dialog', () => dataLoader.openFilePicker());
  listen('open-last-file', () => {
    void reopenLastFile();
  });
  // The stored import can change after the dataset change that announced it (the save step runs
  // after the render, so a second import is announced while the first is still stored): read it
  // again whenever the panel opens. `ps-open` from the inner `ps-popover` bubbles and is composed,
  // and so does each example ⓘ's: only the panel's own popover, in the menu's shadow root, counts.
  listen('ps-open', (event) => {
    const origin = event.composedPath()[0] as Node | undefined;
    if (!origin || origin.getRootNode() !== importMenu.shadowRoot) return;
    void refreshLastFile();
  });

  const unsubscribe = subscribeToDatasetChanges(() => {
    void refreshLastFile();
  });
  void refreshLastFile();

  return { refreshLastFile, dispose: unsubscribe };
}
