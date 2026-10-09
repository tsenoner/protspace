import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';
import { bindImportMenu } from './import-controller';

/** Binds the Import menu's listeners to a plain event target, with a spied loader and controller. */
function bind() {
  const importMenu = new EventTarget();
  const dataLoader = { openFilePicker: vi.fn() };
  const datasetController = {
    loadExampleDatasetAndClearPersistedFile: vi.fn().mockResolvedValue('loaded'),
  };
  bindImportMenu({
    listen: (type, listener) => importMenu.addEventListener(type, listener),
    dataLoader,
    datasetController,
  });
  return { importMenu, dataLoader, datasetController };
}

describe('the Import menu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the example the event names, as a menu choice', () => {
    const { importMenu, datasetController } = bind();
    const entry = EXAMPLE_DATASETS[1];

    importMenu.dispatchEvent(new CustomEvent('load-example-dataset', { detail: { id: entry.id } }));

    expect(datasetController.loadExampleDatasetAndClearPersistedFile).toHaveBeenCalledWith(
      entry,
      'menu',
    );
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
    expect(datasetController.loadExampleDatasetAndClearPersistedFile).not.toHaveBeenCalled();
  });

  it("open-file-dialog opens the data loader's file picker", () => {
    const { importMenu, dataLoader } = bind();

    importMenu.dispatchEvent(new CustomEvent('open-file-dialog', { detail: {} }));

    expect(dataLoader.openFilePicker).toHaveBeenCalledOnce();
  });
});
