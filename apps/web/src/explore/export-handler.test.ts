import type * as Utils from '@protspace/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getExportFailureNotification, getExportSuccessNotification } from './notifications';

const exporter = vi.hoisted(() => ({
  exportPNG: vi.fn(),
  exportPDF: vi.fn(),
  exportProteinIds: vi.fn(),
  exportTable: vi.fn(),
}));
const bundle = vi.hoisted(() => ({
  exportParquetBundle: vi.fn(),
  generateBundleFilename: vi.fn(),
}));

vi.mock('@protspace/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof Utils>()),
  createExporter: () => exporter,
  exportParquetBundle: bundle.exportParquetBundle,
  generateBundleFilename: bundle.generateBundleFilename,
}));

// Lit cannot load in node: the two values the handler reads come from core's plain-TS sources.
vi.mock('@protspace/core', async () => {
  const { EXPORT_DEFAULTS } =
    await import('../../../../packages/core/src/components/export-menu/export-defaults');
  const { pxToMm } =
    await import('../../../../packages/core/src/components/publish/dimension-utils');
  return { EXPORT_DEFAULTS, pxToMm };
});

import { createExportHandler } from './export-handler';

type Listener = (event: Event) => unknown;

function setup(options: { unplaced?: number; outcome?: 'hide' | 'dim' } = {}) {
  const listeners = new Map<string, Listener>();
  const notify = { success: vi.fn(), error: vi.fn() };
  const plotElement = {
    getCurrentData: () => ({ protein_ids: ['P1', 'P2'] }),
    eatOverlayEnabled: false,
  };
  const legendElement = {
    getAllPersistedSettings: () => ({ species: { maxVisibleValues: 10 } }),
    pickedShapeSize: undefined as number | undefined,
  };
  createExportHandler({
    exportMenu: new EventTarget() as never,
    listen: (type, listener) => listeners.set(type, listener as Listener),
    getSelectedProteins: () => [],
    getUnplacedProteinCount: () => options.unplaced ?? 0,
    legendElement: legendElement as never,
    eatPanel: { reliability: { min: 0.5, max: 0.8 }, outcome: options.outcome ?? 'hide' },
    plotElement: plotElement as never,
    notify,
  });
  const exportAs = (detail: Record<string, unknown>) =>
    Promise.resolve(listeners.get('export')!(new CustomEvent('export', { detail })));
  return { listeners, notify, exportAs };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  bundle.generateBundleFilename.mockReturnValue('protspace_data_with_settings.parquetbundle');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  exporter.exportPNG.mockReset();
  exporter.exportPDF.mockReset();
  exporter.exportProteinIds.mockReset();
  exporter.exportTable.mockReset();
  bundle.exportParquetBundle.mockReset();
});

describe('createExportHandler', () => {
  it('export and open-publish-editor are registered through listen', () => {
    const { listeners } = setup();
    expect([...listeners.keys()].sort()).toEqual(['export', 'open-publish-editor']);
  });

  it('each quick export type toasts with the returned file name', async () => {
    const { notify, exportAs } = setup({ unplaced: 3 });
    exporter.exportPNG.mockResolvedValue('protspace_pca_species_2026-10-13.png');
    exporter.exportPDF.mockResolvedValue('protspace_pca_species_2026-10-13.pdf');
    exporter.exportProteinIds.mockReturnValue('protein_ids.txt');
    exporter.exportTable.mockReturnValue('protspace_pca_species_2026-10-13.tsv');

    await exportAs({ type: 'png' });
    await exportAs({ type: 'pdf' });
    await exportAs({ type: 'ids' });
    await exportAs({ type: 'tsv' });

    expect(notify.success.mock.calls.map(([options]) => options)).toEqual([
      getExportSuccessNotification('protspace_pca_species_2026-10-13.png'),
      getExportSuccessNotification('protspace_pca_species_2026-10-13.pdf'),
      getExportSuccessNotification('protein_ids.txt'),
      getExportSuccessNotification('protspace_pca_species_2026-10-13.tsv'),
    ]);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('the bundle toasts its file name and the unplaced count', async () => {
    const { notify, exportAs } = setup({ unplaced: 4 });
    await exportAs({ type: 'parquet', includeLegendSettings: false });

    expect(bundle.exportParquetBundle).toHaveBeenCalledOnce();
    expect(notify.success).toHaveBeenCalledWith(
      getExportSuccessNotification('protspace_data_with_settings.parquetbundle', 4),
    );
  });

  it('the bundle carries the stored publish state with legend settings', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'protspace_publishState' ? JSON.stringify({ preset: 'nature' }) : null,
      setItem: () => {},
    });
    const { exportAs } = setup();
    await exportAs({ type: 'parquet', includeLegendSettings: true });

    const [, , options] = bundle.exportParquetBundle.mock.calls[0];
    expect(options.includeSettings).toBe(true);
    expect(options.settings.publishState).toEqual({ preset: 'nature' });
    expect(options.settings.eatConfidenceThreshold).toBe(0.5);
  });

  it('a bundle saved in Dim stores its range and that it fades', async () => {
    const { exportAs } = setup({ outcome: 'dim' });
    await exportAs({ type: 'parquet', includeLegendSettings: true });

    const [, , options] = bundle.exportParquetBundle.mock.calls[0];
    expect(options.settings.eatConfidenceThreshold).toBe(0.5);
    // Both bounds: a 50–80 % band must not reopen as 50–100 %.
    expect(options.settings.eatConfidenceMax).toBe(0.8);
    expect(options.settings.eatOutcome).toBe('dim');
  });

  it('a null file name toasts the failure', async () => {
    const { notify, exportAs } = setup();
    exporter.exportPNG.mockResolvedValue(null);

    await exportAs({ type: 'png' });

    expect(notify.success).not.toHaveBeenCalled();
    // The handler's own Error carries its own stack (the report link quotes it), so compare the
    // visible fields.
    expect(notify.error).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Export failed.',
        description: 'No data available for export',
      }),
    );
  });

  it('a throw toasts the failure', async () => {
    const { notify, exportAs } = setup();
    const failure = new Error('Canvas too large');
    exporter.exportPDF.mockRejectedValue(failure);

    await exportAs({ type: 'pdf' });

    expect(notify.error).toHaveBeenCalledWith(getExportFailureNotification(failure));
  });
});
