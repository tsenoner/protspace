import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SelectionDisabledNotificationDetail } from '@protspace/core';
import { bindControlBarEvents } from './control-bar-events';
import { EXAMPLE_DATASETS } from './example-datasets';

const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../lib/notify', () => ({ notify: notifyMock }));

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
  return { chooseExample, controlBar, datasetController };
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

  it('warns about an event that names no example, rather than throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { controlBar, datasetController } = bind();

    expect(() => controlBar.dispatchEvent(new CustomEvent('load-example-dataset'))).not.toThrow();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown example dataset id'));
    expect(datasetController.loadExampleDatasetAndClearPersistedFile).not.toHaveBeenCalled();
  });
});

describe('the selection-disabled notice', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // The core control bar only fires the event; this listener is what puts it on screen.
  it("shows the control bar's selection-disabled event as a warning toast", () => {
    const { controlBar } = bind();
    const detail: SelectionDisabledNotificationDetail = {
      message: 'Selection mode disabled: Only 1 point remaining',
      severity: 'warning',
      source: 'control-bar',
      context: { reason: 'insufficient-data', dataSize: 1 },
    };

    controlBar.dispatchEvent(new CustomEvent('selection-disabled-notification', { detail }));

    expect(notifyMock.warning).toHaveBeenCalledOnce();
    expect(notifyMock.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Selection mode disabled.',
        description: 'Selection mode disabled: Only 1 point remaining',
      }),
    );
    expect(notifyMock.error).not.toHaveBeenCalled();
  });
});
