import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindControlBarEvents } from './control-bar-events';
import { EXAMPLE_DATASETS } from './example-datasets';

/** Binds the control-bar listeners to a plain event target, with a spied dataset controller. */
function bind() {
  const controlBar = new EventTarget();
  const datasetController = {
    loadExampleDatasetAndClearPersistedFile: vi.fn().mockResolvedValue('loaded'),
  };
  bindControlBarEvents({
    addControlBarListener: (type, listener, options) =>
      controlBar.addEventListener(type, listener, options),
    datasetController: datasetController as never,
    handleExport: vi.fn(),
    interactionController: {} as never,
    viewController: {} as never,
  });
  const chooseExample = (id: string) =>
    controlBar.dispatchEvent(new CustomEvent('load-example-dataset', { detail: { id } }));
  return { chooseExample, datasetController };
}

describe("the Import menu's example choice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the catalog entry the menu names, in place of the stored import', () => {
    const { chooseExample, datasetController } = bind();
    const entry = EXAMPLE_DATASETS[1];

    chooseExample(entry.id);

    expect(datasetController.loadExampleDatasetAndClearPersistedFile).toHaveBeenCalledWith(
      entry,
      'menu',
    );
  });

  it('warns about an id the catalog does not hold, and loads nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chooseExample, datasetController } = bind();

    chooseExample('not-a-real-id');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-a-real-id'));
    expect(datasetController.loadExampleDatasetAndClearPersistedFile).not.toHaveBeenCalled();
  });
});
