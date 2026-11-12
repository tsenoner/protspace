import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';
import { bindImportMenu } from './import-controller';
import type { DatasetChangeSource } from './types';

type LastFile = { name: string; sizeLabel: string; storedAt: string } | null;
type ChangeListener = (exampleId: string | null, source: DatasetChangeSource) => void;

const STORED = {
  name: 'mine.parquetbundle',
  size: 12_300_000,
  storedAt: '2026-10-01T00:00:00.000Z',
};

/** A `ps-open` from a popover whose root node is `root` (the menu's shadow root, or an ⓘ's). */
function psOpenFrom(root: object): Event {
  const event = new CustomEvent('ps-open', { bubbles: true, composed: true });
  Object.defineProperty(event, 'composedPath', { value: () => [{ getRootNode: () => root }] });
  return event;
}

/** Binds the Import menu to a plain event target, with spied loaders and an example on screen. */
function bind(
  overrides: {
    readSummary?: () => Promise<typeof STORED | null>;
    loadLastFile?: () => Promise<File | null>;
    confirmRemove?: (name: string) => Promise<boolean>;
    removeLastFile?: (storedAt: string) => Promise<boolean>;
  } = {},
) {
  const importMenu = Object.assign(new EventTarget(), {
    lastFile: null as LastFile,
    shadowRoot: {} as ShadowRoot,
  });
  const dataLoader = { openFilePicker: vi.fn() };
  const datasetController = {
    loadChosenExample: vi.fn().mockResolvedValue('loaded'),
    tryLoadPersistedAgain: vi.fn().mockResolvedValue(undefined),
    hasDisplayedDataset: vi.fn(() => true),
  };
  const screen = { exampleId: 'demo' as string | null, name: 'Demo' };
  let changeListener: ChangeListener | null = null;
  const readSummary = vi.fn(overrides.readSummary ?? (async () => STORED));
  const loadLastFile = vi.fn(
    overrides.loadLastFile ?? (async () => new File(['x'], 'mine.parquetbundle')),
  );
  const warn = vi.fn();
  const success = vi.fn();
  const confirmRemove = vi.fn(overrides.confirmRemove ?? (async () => true));
  const removeLastFile = vi.fn(overrides.removeLastFile ?? (async () => true));
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
    success,
    confirmRemove,
    removeLastFile,
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
    success,
    confirmRemove,
    removeLastFile,
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
      expect(importMenu.lastFile).toEqual({
        name: 'mine.parquetbundle',
        sizeLabel: '12.3 MB',
        storedAt: STORED.storedAt,
      }),
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

  it('offers the stored file while the recovery banner names it on an empty page', async () => {
    const { importMenu, screen, datasetController } = bind();
    // Startup stopped at the banner: the app bar names the stored file, nothing is on screen.
    datasetController.hasDisplayedDataset.mockReturnValue(false);
    screen.exampleId = null;
    screen.name = 'mine.parquetbundle';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(importMenu.lastFile).toEqual({
      name: 'mine.parquetbundle',
      sizeLabel: '12.3 MB',
      storedAt: STORED.storedAt,
    });
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

  it('a reopen whose load status cannot be written warns instead of rejecting unhandled', async () => {
    const { importMenu, datasetController, warn } = bind();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    datasetController.tryLoadPersistedAgain.mockRejectedValueOnce(new Error('quota'));

    importMenu.dispatchEvent(new CustomEvent('open-last-file', { detail: {} }));

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('The stored file could not be read'));
    expect(error).toHaveBeenCalled();
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
    importMenu.dispatchEvent(psOpenFrom(importMenu.shadowRoot));

    await vi.waitFor(() => expect(importMenu.lastFile?.name).toBe('newer.parquetbundle'));
  });

  it("an example ⓘ's ps-open does not read the stored import again", async () => {
    const { importMenu, readSummary } = bind();
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledOnce());
    // The ⓘ's own popover lives in the info popover's shadow root, not the menu's.
    importMenu.dispatchEvent(psOpenFrom({}));
    importMenu.dispatchEvent(psOpenFrom(importMenu.shadowRoot));
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(readSummary).toHaveBeenCalledTimes(2);
  });

  it('remove-last-file asks first, then removes that stored copy, refreshes and says so', async () => {
    let stored: typeof STORED | null = STORED;
    const { importMenu, confirmRemove, removeLastFile, success, warn } = bind({
      readSummary: async () => stored,
      removeLastFile: async () => {
        stored = null;
        return true;
      },
    });
    await vi.waitFor(() => expect(importMenu.lastFile).not.toBeNull());

    importMenu.dispatchEvent(
      new CustomEvent('remove-last-file', {
        detail: { name: STORED.name, storedAt: STORED.storedAt },
      }),
    );

    await vi.waitFor(() => expect(importMenu.lastFile).toBeNull());
    expect(confirmRemove).toHaveBeenCalledWith('mine.parquetbundle');
    expect(removeLastFile).toHaveBeenCalledWith(STORED.storedAt);
    expect(success).toHaveBeenCalledWith('Removed "mine.parquetbundle" from this browser');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a second remove while the first is still asking does nothing', async () => {
    let answer: (yes: boolean) => void = () => {};
    const { importMenu, confirmRemove, removeLastFile, success } = bind({
      confirmRemove: () => new Promise<boolean>((resolve) => (answer = resolve)),
    });
    await vi.waitFor(() => expect(importMenu.lastFile).not.toBeNull());
    const remove = () =>
      importMenu.dispatchEvent(
        new CustomEvent('remove-last-file', {
          detail: { name: STORED.name, storedAt: STORED.storedAt },
        }),
      );

    remove();
    remove();
    answer(true);

    await vi.waitFor(() => expect(success).toHaveBeenCalledOnce());
    expect(confirmRemove).toHaveBeenCalledOnce();
    expect(removeLastFile).toHaveBeenCalledOnce();
  });

  it('a cancelled remove keeps the stored copy', async () => {
    const { importMenu, removeLastFile, success } = bind({ confirmRemove: async () => false });
    await vi.waitFor(() => expect(importMenu.lastFile).not.toBeNull());

    importMenu.dispatchEvent(
      new CustomEvent('remove-last-file', {
        detail: { name: STORED.name, storedAt: STORED.storedAt },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(removeLastFile).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(importMenu.lastFile?.name).toBe('mine.parquetbundle');
  });

  it('a newer import saved during the question is kept, with a warning', async () => {
    const newer = {
      name: 'newer.parquetbundle',
      size: 2_000_000,
      storedAt: '2026-10-02T00:00:00.000Z',
    };
    let stored: typeof STORED = STORED;
    const { importMenu, success, warn } = bind({
      readSummary: async () => stored,
      confirmRemove: async () => {
        stored = newer;
        return true;
      },
      removeLastFile: async (storedAt) => storedAt === stored.storedAt,
    });
    await vi.waitFor(() => expect(importMenu.lastFile).not.toBeNull());

    importMenu.dispatchEvent(
      new CustomEvent('remove-last-file', {
        detail: { name: STORED.name, storedAt: STORED.storedAt },
      }),
    );

    await vi.waitFor(() => expect(importMenu.lastFile?.name).toBe('newer.parquetbundle'));
    expect(warn).toHaveBeenCalledWith(
      'Kept the stored file: a newer import replaced "mine.parquetbundle"',
    );
    expect(success).not.toHaveBeenCalled();
  });

  it('a removal that fails warns and refreshes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { importMenu, readSummary, success, warn } = bind({
      removeLastFile: async () => {
        throw new Error('locked');
      },
    });
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledOnce());

    importMenu.dispatchEvent(
      new CustomEvent('remove-last-file', {
        detail: { name: STORED.name, storedAt: STORED.storedAt },
      }),
    );

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('The stored file could not be removed'),
    );
    expect(error).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(readSummary).toHaveBeenCalledTimes(2));
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
