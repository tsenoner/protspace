import { afterEach, describe, expect, it, vi } from 'vitest';

// Node has neither the custom elements nor the lazy publish chunk: the handler needs only the
// two values it reads from core and a module to import.
vi.mock('@protspace/core', () => ({
  EXPORT_DEFAULTS: {
    IMAGE_WIDTH: 2048,
    IMAGE_HEIGHT: 1024,
    LEGEND_WIDTH_PERCENT: 20,
    LEGEND_FONT_SIZE_PX: 15,
    BASE_FONT_SIZE: 15,
  },
  pxToMm: (px: number) => px,
}));
vi.mock('@protspace/core/publish', () => ({ ProtspacePublishModal: class {} }));

import { createExportHandler } from './export-handler';

/** The figure editor as the handler sees it: properties it sets, events it hears. */
class FakeModal extends EventTarget {
  plotElement: unknown = null;
  legendElement: unknown = null;
  savedPublishState: unknown = null;
  currentProjection: unknown = undefined;
  showExportError = vi.fn();
  remove = vi.fn();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Creates the handler, opens the editor through its listener, and returns the editor. */
async function openEditor(plotElement: unknown) {
  const modal = new FakeModal();
  const appendChild = vi.fn();
  vi.stubGlobal('document', {
    querySelector: (): null => null,
    createElement: () => modal,
    body: { appendChild },
  });
  const listeners = new Map<string, (event: Event) => unknown>();
  const notify = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
  createExportHandler({
    exportMenu: new EventTarget() as never,
    listen: ((type: string, listener: (event: Event) => unknown) => {
      listeners.set(type, listener);
    }) as never,
    getSelectedProteins: () => [],
    getUnplacedProteinCount: () => 0,
    legendElement: {} as never,
    eatPanel: { reliability: { min: 0, max: 1 }, outcome: 'hide' },
    plotElement: plotElement as never,
    notify: notify as never,
  });
  listeners.get('open-publish-editor')!(new Event('open-publish-editor'));
  // The listener starts the editor's lazy import and returns; the editor is ready when appended.
  await vi.waitFor(() => expect(appendChild).toHaveBeenCalledWith(modal));
  return { modal, notify };
}

const plot = {
  data: { projections: [{ name: 'PCA 2' }, { name: 'UMAP 3', dimension: 3 }] },
  selectedProjectionIndex: 1,
};

describe('figure editor host', () => {
  it('the modal receives currentProjection', async () => {
    const { modal } = await openEditor(plot);
    expect(modal.currentProjection).toEqual({ projection: 'UMAP 3', dimensionality: 3 });

    const empty = await openEditor({ data: null, selectedProjectionIndex: 0 });
    expect(empty.modal.currentProjection).toBeNull();
  });

  it('a publish-export failure calls showExportError and does not toast', async () => {
    const { modal, notify } = await openEditor(plot);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A canvas that cannot produce a PNG blob: the export throws before anything downloads.
    const canvas = {
      width: 10,
      height: 10,
      toBlob: (done: (b: Blob | null) => void) => done(null),
    };

    modal.dispatchEvent(
      new CustomEvent('publish-export', {
        detail: { canvas, state: { format: 'png', dpi: 300 } },
      }),
    );

    await vi.waitFor(() => expect(modal.showExportError).toHaveBeenCalledOnce());
    expect(modal.showExportError.mock.calls[0][0]).toMatch(
      /^Export failed\. canvas\.toBlob produced no blob/,
    );
    expect(notify.error).not.toHaveBeenCalled();
    expect(modal.remove).not.toHaveBeenCalled();
  });
});
