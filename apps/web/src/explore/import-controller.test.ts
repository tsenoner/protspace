import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';
import { bindImportMenu } from './import-controller';
import type { DatasetChangeSource } from './types';

type LastFile = { name: string; sizeLabel: string } | null;
type ChangeListener = (exampleId: string | null, source: DatasetChangeSource) => void;

const STORED = {
  name: 'mine.parquetbundle',
  size: 12_300_000,
  storedAt: '2026-10-01T00:00:00.000Z',
};

/** Binds the Import menu to a plain event target, with spied loaders and an example on screen. */
function bind(
  overrides: {
    readSummary?: () => Promise<typeof STORED | null>;
    loadLastFile?: () => Promise<File | null>;
  } = {},
) {
  const importMenu = Object.assign(new EventTarget(), { lastFile: null as LastFile });
  const dataLoader = { openFilePicker: vi.fn() };
  const datasetController = {
    loadChosenExample: vi.fn().mockResolvedValue('loaded'),
    tryLoadPersistedAgain: vi.fn().mockResolvedValue(undefined),
  };
  const screen = { exampleId: 'demo' as string | null, name: 'Demo' };
  let changeListener: ChangeListener | null = null;
  const readSummary = vi.fn(overrides.readSummary ?? (async () => STORED));
  const loadLastFile = vi.fn(
    overrides.loadLastFile ?? (async () => new File(['x'], 'mine.parquetbundle')),
  );
  const warn = vi.fn();
  const binding = bindImportMenu({
    listen: (type, listener) => importMenu.addEventListener(type, listener),
    importMenu,
    dataLoader,
    datasetController,
    readSummary,
    loadLastFile,
    subscribeToDatasetChanges: (callback) => {
      changeListener = callback;
      return () => {
        changeListener = null;
      };
    },
    getCurrentExampleId: () => screen.exampleId,
    getShownName: () => screen.name,
    warn,
  });
  const emitChange: ChangeListener = (id, source) => changeListener?.(id, source);
  return {
    importMenu,
    dataLoader,
    datasetController,
    screen,
    readSummary,
    loadLastFile,
    warn,
    binding,
    emitChange,
  };
}

describe('the Import menu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the example the event names, as a menu choice', () => {
    const { importMenu, datasetController } = bind();
    const entry = EXAMPLE_DATASETS[1];

    importMenu.dispatchEvent(new CustomEvent('load-example-dataset', { detail: { id: entry.id } }));

    expect(datasetController.loadChosenExample).toHaveBeenCalledWith(entry, 'menu');
  });

  it('warns on an unknown id and does nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { importMenu, datasetController } = bind();

    importMenu.dispatchEvent(
      new CustomEvent('load-example-dataset', { detail: { id: 'not-a-real-id' } }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-a-real-id'));

    // An event that names no example warns as well, rather than throwing.
    expect(() => importMenu.dispatchEvent(new CustomEvent('load-example-dataset'))).not.toThrow();
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('Unknown example dataset id'));
    expect(datasetController.loadChosenExample).not.toHaveBeenCalled();
  });

  it("open-file-dialog opens the data loader's file picker", () => {
    const { importMenu, dataLoader } = bind();

    importMenu.dispatchEvent(new CustomEvent('open-file-dialog', { detail: {} }));

    expect(dataLoader.openFilePicker).toHaveBeenCalledOnce();
  });

  it('shows the stored import as the last file while an example is on screen', async () => {
    const { importMenu } = bind();
    await vi.waitFor(() =>
      expect(importMenu.lastFile).toEqual({ name: 'mine.parquetbundle', sizeLabel: '12.3 MB' }),
    );
  });

  it('no stored import means no last file', async () => {
    const { importMenu, readSummary } = bind({ readSummary: async () => null });
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(importMenu.lastFile).toBeNull();
  });

  it('lastFile refreshes on a dataset change and is null while that file is on screen', async () => {
    const { importMenu, screen, emitChange, readSummary } = bind();
    await vi.waitFor(() => expect(importMenu.lastFile).not.toBeNull());

    // The user reopens the stored file: it is the dataset on screen now.
    screen.exampleId = null;
    screen.name = 'mine.parquetbundle';
    emitChange(null, 'startup');
    await vi.waitFor(() => expect(importMenu.lastFile).toBeNull());

    // An example replaces it on screen; the stored file is offered again.
    screen.exampleId = 'demo';
    screen.name = 'Demo';
    emitChange('demo', 'menu');
    await vi.waitFor(() => expect(importMenu.lastFile).not.toBeNull());
    expect(readSummary).toHaveBeenCalledTimes(3);
  });

  it('open-last-file loads the stored file and retries it', async () => {
    const stored = new File(['x'], 'mine.parquetbundle');
    const { importMenu, datasetController, warn } = bind({ loadLastFile: async () => stored });

    importMenu.dispatchEvent(new CustomEvent('open-last-file', { detail: {} }));

    await vi.waitFor(() =>
      expect(datasetController.tryLoadPersistedAgain).toHaveBeenCalledWith(stored),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('a null file warns and refreshes', async () => {
    let stored: typeof STORED | null = STORED;
    const { importMenu, datasetController, warn, readSummary } = bind({
      readSummary: async () => stored,
      loadLastFile: async () => null,
    });
    await vi.waitFor(() => expect(importMenu.lastFile).not.toBeNull());
    // The read found the file gone (loadLastImportedFile clears a store whose payload is missing).
    stored = null;

    importMenu.dispatchEvent(new CustomEvent('open-last-file', { detail: {} }));

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('The stored file could not be read'));
    await vi.waitFor(() => expect(importMenu.lastFile).toBeNull());
    expect(readSummary).toHaveBeenCalledTimes(2);
    expect(datasetController.tryLoadPersistedAgain).not.toHaveBeenCalled();
  });

  it('reads the stored import again when the panel opens', async () => {
    let stored: typeof STORED = STORED;
    const { importMenu } = bind({ readSummary: async () => stored });
    await vi.waitFor(() => expect(importMenu.lastFile?.name).toBe('mine.parquetbundle'));

    // A newer import was saved over it after the change that announced it.
    stored = { name: 'newer.parquetbundle', size: 2_000_000, storedAt: '2026-10-02T00:00:00.000Z' };
    importMenu.dispatchEvent(new CustomEvent('ps-open', { bubbles: true, composed: true }));

    await vi.waitFor(() => expect(importMenu.lastFile?.name).toBe('newer.parquetbundle'));
  });

  it('dispose stops the refreshes', async () => {
    const { binding, emitChange, readSummary } = bind();
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledOnce());
    binding.dispose();
    emitChange('demo', 'menu');
    await Promise.resolve();
    expect(readSummary).toHaveBeenCalledOnce();
  });
});
