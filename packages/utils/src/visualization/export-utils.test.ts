import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProtSpaceExporter, createExporter } from './export-utils';
import type { ExportableElement, ExportableData } from './export-utils';
import { NA_VALUE } from './missing-values';

/**
 * Mock ExportableElement for testing
 */
function createMockElement(overrides: Partial<ExportableElement> = {}): ExportableElement {
  return {
    getCurrentData: () => ({
      protein_ids: ['P1', 'P2', 'P3'],
      annotations: {
        species: {
          values: ['human', 'mouse', null],
          colors: ['#ff0000', '#00ff00', '#888888'],
          shapes: ['circle', 'square', 'triangle'],
        },
      },
      annotation_data: { species: [[0], [1], [2]] },
      projections: [{ name: 'PCA_2' }, { name: 'UMAP_3' }],
    }),
    selectedAnnotation: 'species',
    selectedProjectionIndex: 0,
    ...overrides,
  } as unknown as ExportableElement;
}

describe('createExporter', () => {
  it('creates an exporter instance', () => {
    const mockElement = createMockElement();
    const exporter = createExporter(mockElement);
    expect(exporter).toBeInstanceOf(ProtSpaceExporter);
  });

  it('creates an exporter with selected proteins', () => {
    const mockElement = createMockElement();
    const exporter = createExporter(mockElement, ['P1', 'P2']);
    expect(exporter).toBeInstanceOf(ProtSpaceExporter);
  });
});

describe('ProtSpaceExporter.validateCanvasDimensions', () => {
  // 95% of the 8192px per-side limit = 7782px. The area check behind it is
  // unreachable today (7782² ≈ 60.6M px < 0.95 × 268M px), so no row claims it.
  it.each([
    [2000, 1000],
    [6000, 3000],
    [7700, 4000],
    [7000, 2000],
    [2000, 7000],
    [7782, 7782],
    [100, 100],
  ])('accepts %ix%i', (width, height) => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](width, height);
    expect(result.isValid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it.each([
    [8500, 4000],
    [9000, 1000],
    [1000, 9000],
    [7783, 7783],
    [20000, 20000],
  ])('rejects %ix%i (per-side limit)', (width, height) => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](width, height);
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('8192px');
  });
});

describe('generateExportFileName', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Midday UTC: the date part comes from toISOString().
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const fileNameFor = (overrides: Partial<ExportableElement>, extension = 'png') =>
    createExporter(createMockElement(overrides))['generateExportFileName'](extension);

  it('sanitises and lowercases names and strips a trailing _2/_3 dimension suffix', () => {
    const name = fileNameFor({
      getCurrentData: (): ExportableData => ({
        protein_ids: [],
        annotations: {},
        annotation_data: {},
        projections: [{ name: 'UMAP 3D_3' }],
      }),
      selectedAnnotation: 'Gene Name (EC)',
    });
    expect(name).toBe('protspace_umap_3d_gene_name__ec__2024-01-15.png');
  });

  it('uses the selected projection index', () => {
    expect(fileNameFor({ selectedProjectionIndex: 0 }, 'pdf')).toBe(
      'protspace_pca_species_2024-01-15.pdf',
    );
    expect(fileNameFor({ selectedProjectionIndex: 1 })).toBe(
      'protspace_umap_species_2024-01-15.png',
    );
  });

  it('falls back to "unknown" without projections or a selected annotation', () => {
    const name = fileNameFor({
      getCurrentData: (): ExportableData => ({
        protein_ids: [],
        annotations: {},
        annotation_data: {},
      }),
      selectedAnnotation: '',
    });
    expect(name).toBe('protspace_unknown_unknown_2024-01-15.png');
  });
});

describe('N/A handling in export', () => {
  describe('computeLegendFromData', () => {
    const callComputeLegend = (
      data: ExportableData,
      annotation: string,
      selectedProteinIds?: string[],
    ) => {
      const el = createMockElement({ getCurrentData: () => data, selectedAnnotation: annotation });
      const exporter = createExporter(el);
      return (exporter as unknown as Record<string, unknown>)['computeLegendFromData'](
        data,
        annotation,
        selectedProteinIds,
      ) as Array<{ value: string; color: string; shape: string; count: number }>;
    };

    it('should use __NA__ for null annotation values', () => {
      const data: ExportableData = {
        protein_ids: ['P1', 'P2'],
        annotations: {
          species: {
            values: ['human', null],
            colors: ['#ff0000', '#888888'],
            shapes: ['circle', 'square'],
          },
        },
        annotation_data: { species: [[0], [1]] },
      };

      const items = callComputeLegend(data, 'species');
      expect(items[0].value).toBe('human');
      expect(items[1].value).toBe(NA_VALUE);
    });

    it('should count N/A items correctly', () => {
      const data: ExportableData = {
        protein_ids: ['P1', 'P2', 'P3'],
        annotations: {
          species: {
            values: ['human', null],
            colors: ['#ff0000', '#888888'],
            shapes: ['circle', 'square'],
          },
        },
        annotation_data: { species: [[0], [1], [1]] }, // P2 and P3 are N/A
      };

      const items = callComputeLegend(data, 'species');
      const naItem = items.find((it) => it.value === NA_VALUE);
      expect(naItem).toBeDefined();
      expect(naItem!.count).toBe(2);
    });

    it('should count correctly when filtering by selected proteins', () => {
      const data: ExportableData = {
        protein_ids: ['P1', 'P2', 'P3'],
        annotations: {
          species: {
            values: ['human', null],
            colors: ['#ff0000', '#888888'],
            shapes: ['circle', 'square'],
          },
        },
        annotation_data: { species: [[0], [1], [1]] },
      };

      const items = callComputeLegend(data, 'species', ['P2']); // only P2 selected
      const naItem = items.find((it) => it.value === NA_VALUE);
      expect(naItem).toBeDefined();
      expect(naItem!.count).toBe(1);
    });
  });
});

/**
 * Helper to call exportProteinIds via the real exporter and capture the downloaded IDs: the
 * export writes a Blob through an object URL, so the Blob is read back here.
 */
async function callExportProteinIds(
  data: ExportableData,
  annotation: string,
  hiddenAnnotationValues: string[] = [],
): Promise<string[]> {
  const el = createMockElement({
    getCurrentData: () => data,
    selectedAnnotation: annotation,
    hiddenAnnotationValues,
  });
  const exporter = createExporter(el);

  const captured: { blob?: Blob } = {};
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    captured.blob = blob as Blob;
    return 'blob:protein-ids';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(exporter as any, 'downloadFile').mockImplementation(() => {});

  exporter.exportProteinIds();

  if (!captured.blob) return [];
  const text = await captured.blob.text();
  return text ? text.split('\n') : [];
}

describe('exportProteinIds integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseData: ExportableData = {
    protein_ids: ['P1', 'P2', 'P3', 'P4'],
    annotations: {
      species: {
        values: ['human', 'mouse', null],
        colors: ['#ff0000', '#00ff00', '#888888'],
        shapes: ['circle', 'square', 'triangle'],
      },
    },
    annotation_data: { species: [[0], [1], [2], [0]] },
  };

  it('exports all IDs when nothing is hidden', async () => {
    const ids = await callExportProteinIds(baseData, 'species', []);
    expect(ids).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('excludes N/A proteins when __NA__ is hidden', async () => {
    const ids = await callExportProteinIds(baseData, 'species', [NA_VALUE]);
    expect(ids).toEqual(['P1', 'P2', 'P4']);
    expect(ids).not.toContain('P3');
  });

  it('excludes proteins matching a hidden regular value', async () => {
    const ids = await callExportProteinIds(baseData, 'species', ['mouse']);
    expect(ids).toEqual(['P1', 'P3', 'P4']);
    expect(ids).not.toContain('P2');
  });

  it('excludes multiple hidden values including N/A', async () => {
    const ids = await callExportProteinIds(baseData, 'species', ['mouse', NA_VALUE]);
    expect(ids).toEqual(['P1', 'P4']);
  });

  it('returns no visible IDs when all values are hidden', async () => {
    const ids = await callExportProteinIds(baseData, 'species', ['human', 'mouse', NA_VALUE]);
    expect(ids).toEqual([]);
  });

  it('treats proteins with empty annotation arrays as N/A', async () => {
    const data: ExportableData = {
      protein_ids: ['P1', 'P2'],
      annotations: {
        species: {
          values: ['human'],
          colors: ['#ff0000'],
          shapes: ['circle'],
        },
      },
      annotation_data: { species: [[0], []] },
    };

    const ids = await callExportProteinIds(data, 'species', [NA_VALUE]);
    expect(ids).toEqual(['P1']);
  });

  it('exports all IDs when annotation does not exist (fallback)', async () => {
    const ids = await callExportProteinIds(baseData, 'nonexistent', [NA_VALUE]);
    expect(ids).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('handles multi-value annotations — visible if any value is not hidden', async () => {
    const data: ExportableData = {
      protein_ids: ['P1', 'P2'],
      annotations: {
        tags: {
          values: ['alpha', 'beta', null],
          colors: ['#f00', '#0f0', '#888'],
          shapes: ['circle', 'square', 'triangle'],
        },
      },
      annotation_data: { tags: [[0, 2], [1]] },
    };

    // P1 has both 'alpha' and N/A — hiding N/A still keeps P1 because 'alpha' is visible
    const ids = await callExportProteinIds(data, 'tags', [NA_VALUE]);
    expect(ids).toEqual(['P1', 'P2']);
  });
});

describe('exportCanvasAsPdf', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses [widthMm, heightMm] as the page format with no margin', async () => {
    const addImage = vi.fn();
    const setProperties = vi.fn();
    const save = vi.fn();
    const jsPdfCtor = vi.fn().mockImplementation(function () {
      return { addImage, setProperties, save };
    });

    vi.doMock('jspdf', () => ({ default: jsPdfCtor }));
    const { exportCanvasAsPdf } = await import('./export-utils');

    // Minimal canvas stub: only toDataURL is exercised.
    const canvas = {
      width: 1051,
      height: 591,
      toDataURL: () => 'data:image/png;base64,AAA=',
    } as unknown as HTMLCanvasElement;

    await exportCanvasAsPdf(canvas, { widthMm: 89, heightMm: 50, filename: 'fig.pdf' });

    expect(jsPdfCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: 'mm',
        format: [89, 50],
        orientation: 'landscape',
      }),
    );
    expect(addImage).toHaveBeenCalledWith('data:image/png;base64,AAA=', 'PNG', 0, 0, 89, 50);
    expect(save).toHaveBeenCalledWith('fig.pdf');
    vi.doUnmock('jspdf');
  });

  it('uses portrait orientation when heightMm > widthMm', async () => {
    const addImage = vi.fn();
    const setProperties = vi.fn();
    const save = vi.fn();
    const jsPdfCtor = vi.fn().mockImplementation(function () {
      return { addImage, setProperties, save };
    });

    vi.doMock('jspdf', () => ({ default: jsPdfCtor }));
    const { exportCanvasAsPdf } = await import('./export-utils');

    const canvas = {
      width: 1051,
      height: 2917,
      toDataURL: () => 'data:image/png;base64,AAA=',
    } as unknown as HTMLCanvasElement;

    await exportCanvasAsPdf(canvas, { widthMm: 89, heightMm: 247 });

    expect(jsPdfCtor).toHaveBeenCalledWith(expect.objectContaining({ orientation: 'portrait' }));
    vi.doUnmock('jspdf');
  });
});

describe('exporters report the file they wrote', () => {
  const fakeCanvas = { width: 20, height: 10, toDataURL: () => 'data:image/png;base64,AAA=' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exportProteinIds returns its file name and downloads a Blob URL, not a data: URI', () => {
    const exporter = createExporter(createMockElement());
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:protein-ids');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const download = vi.spyOn(exporter as any, 'downloadFile').mockImplementation(() => {});

    expect(exporter.exportProteinIds()).toBe('protein_ids.txt');
    expect(created).toHaveBeenCalledWith(expect.any(Blob));
    expect((created.mock.calls[0][0] as Blob).type).toBe('text/plain;charset=utf-8');
    expect(download).toHaveBeenCalledWith('blob:protein-ids', 'protein_ids.txt');
    expect(String(download.mock.calls[0][0]).startsWith('data:')).toBe(false);
    // Revoked only after the browser has had time to start the download (Firefox, Safari).
    vi.advanceTimersByTime(59_999);
    expect(revoked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoked).toHaveBeenCalledWith('blob:protein-ids');
  });

  it('exportProteinIds returns null with no data', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exporter = createExporter(createMockElement({ getCurrentData: () => null }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const download = vi.spyOn(exporter as any, 'downloadFile').mockImplementation(() => {});

    expect(exporter.exportProteinIds()).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it('exportTable returns its file name and revokes its Blob URL only after the download starts', () => {
    const exporter = createExporter(createMockElement());
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:table');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const download = vi.spyOn(exporter as any, 'downloadFile').mockImplementation(() => {});

    expect(exporter.exportTable()).toBe('protspace_pca_species_2024-01-15.tsv');
    expect((created.mock.calls[0][0] as Blob).type).toBe('text/tab-separated-values');
    expect(download).toHaveBeenCalledWith('blob:table', 'protspace_pca_species_2024-01-15.tsv');
    vi.advanceTimersByTime(59_999);
    expect(revoked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoked).toHaveBeenCalledWith('blob:table');
  });

  it('exportTable returns null with no data', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exporter = createExporter(createMockElement({ getCurrentData: () => null }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const download = vi.spyOn(exporter as any, 'downloadFile').mockImplementation(() => {});

    expect(exporter.exportTable()).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it('exportPNG returns the generated file name', async () => {
    const exporter = createExporter(createMockElement());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = exporter as any;
    vi.spyOn(internals, 'getScatterplotElement').mockReturnValue({});
    vi.spyOn(internals, 'captureScatterplotCanvas').mockResolvedValue(fakeCanvas);
    const download = vi.spyOn(internals, 'downloadFile').mockImplementation(() => {});

    const name = await exporter.exportPNG({ includeLegend: false });

    expect(name).toBe('protspace_pca_species_2024-01-15.png');
    expect(download).toHaveBeenCalledWith('data:image/png;base64,AAA=', name);
    expect(await exporter.exportPNG({ includeLegend: false, exportName: 'mine.png' })).toBe(
      'mine.png',
    );
  });

  it('exportPNG returns null with no data or no scatterplot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const empty = createExporter(createMockElement({ getCurrentData: () => null }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emptyDownload = vi.spyOn(empty as any, 'downloadFile').mockImplementation(() => {});
    expect(await empty.exportPNG()).toBeNull();
    expect(emptyDownload).not.toHaveBeenCalled();

    const detached = createExporter(createMockElement());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(detached as any, 'getScatterplotElement').mockReturnValue(null);
    expect(await detached.exportPNG()).toBeNull();
  });
});

describe('exportPDF reports the file it saved', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock('jspdf');
  });

  it('exportPDF returns the file it saved', async () => {
    const save = vi.fn();
    const jsPdfCtor = vi.fn().mockImplementation(function () {
      return { addImage: vi.fn(), setProperties: vi.fn(), save };
    });
    vi.doMock('jspdf', () => ({ default: jsPdfCtor }));
    const fresh = await import('./export-utils');
    const exporter = fresh.createExporter(createMockElement());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = exporter as any;
    vi.spyOn(internals, 'getScatterplotElement').mockReturnValue({});
    vi.spyOn(internals, 'captureScatterplotCanvas').mockResolvedValue({
      width: 20,
      height: 10,
      toDataURL: () => 'data:image/png;base64,AAA=',
    });

    const name = await exporter.exportPDF({ includeLegend: false });

    expect(name).toBe('protspace_pca_species_2024-01-15.pdf');
    expect(save).toHaveBeenCalledWith(name);
  });
});

describe('the quick export legend', () => {
  it('is titled with the annotation display name, not its key', () => {
    const element = createMockElement({
      selectedAnnotation: 'ec',
      getCurrentData: () => ({
        protein_ids: ['P1'],
        annotations: { ec: { values: ['1.1.1.1'], colors: ['#ff0000'], shapes: ['circle'] } },
        annotation_data: { ec: [[0]] },
        projections: [{ name: 'PCA_2' }],
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = createExporter(element) as any;
    vi.spyOn(internals, 'readLegendExportState').mockReturnValue(null);
    vi.spyOn(internals, 'buildLegendItems').mockReturnValue([]);
    const render = vi
      .spyOn(internals, 'renderLegendToCanvas')
      .mockReturnValue({} as HTMLCanvasElement);

    internals.generateLegendCanvas(
      { width: 300, height: 200 },
      internals.getOptionsWithDefaults({}),
    );

    expect(render.mock.calls[0][4]).toBe('EC number');
  });
});

/**
 * Call exportTable via the real exporter and return the downloaded TSV text. The Blob is
 * captured where the exporter turns it into an object URL.
 */
async function exportTableText(
  data: ExportableData,
  annotation: string,
  hiddenAnnotationValues: string[] = [],
): Promise<string> {
  const el = createMockElement({
    getCurrentData: () => data,
    selectedAnnotation: annotation,
    hiddenAnnotationValues,
  });
  const exporter = createExporter(el);
  let blob: Blob | undefined;
  let fileName = '';
  vi.stubGlobal('URL', {
    createObjectURL: (b: Blob) => {
      blob = b;
      return 'blob:table';
    },
    revokeObjectURL: () => {},
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(exporter as any, 'downloadFile').mockImplementation((_url, name) => {
    fileName = name as string;
  });
  vi.useFakeTimers();
  try {
    exporter.exportTable();
    // The Blob URL is revoked a minute after the download starts.
    vi.runAllTimers();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
  expect(fileName).toMatch(/\.tsv$/);
  return blob!.text();
}

/** {@link exportTableText}, split into rows of fields (no field in these fixtures is quoted). */
async function callExportTable(
  data: ExportableData,
  annotation: string,
  hiddenAnnotationValues: string[] = [],
): Promise<string[][]> {
  const text = await exportTableText(data, annotation, hiddenAnnotationValues);
  expect(text.endsWith('\n')).toBe(true);
  return text
    .slice(0, -1)
    .split('\n')
    .map((line) => line.split('\t'));
}

describe('exportTable', () => {
  const tableData: ExportableData = {
    protein_ids: ['P1', 'P2', 'P3', 'P4'],
    annotations: {
      species: {
        kind: 'categorical',
        // The loader gives every missing cell the synthetic NA category, not a null.
        values: ['human', 'mouse', NA_VALUE],
        colors: ['#ff0000', '#00ff00', '#888888'],
        shapes: ['circle', 'square', 'triangle'],
      },
      length: {
        kind: 'numeric',
        values: ['0-100', '100-200'],
        colors: ['#000', '#111'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: {
      species: [[0], [1], [2], [0, 1]],
      length: Int32Array.from([0, 1, 1, -1]),
    },
    numeric_annotation_data: { length: Float64Array.from([42, 150, 199.5, NaN]) },
    projections: [
      { name: 'UMAP 2', dimension: 2, data: Float32Array.from([0.1, 1, 2, 3, 4, 5, -6.5, 7]) },
    ],
  };

  it('writes protein_id, the projection coordinates and every annotation', async () => {
    const [header, ...rows] = await callExportTable(tableData, 'species');
    expect(header).toEqual(['protein_id', 'UMAP 2_x', 'UMAP 2_y', 'species', 'length']);
    expect(rows).toEqual([
      ['P1', '0.1', '1', 'human', '42'],
      ['P2', '2', '3', 'mouse', '150'],
      // N/A is empty; a numeric cell is its raw value, not its bin label.
      ['P3', '4', '5', '', '199.5'],
      ['P4', '-6.5', '7', 'human;mouse', ''],
    ]);
  });

  it('writes no z column for a legacy 3D projection', async () => {
    const data: ExportableData = {
      ...tableData,
      projections: [
        { name: 'PCA 3', dimension: 3, data: Float32Array.from({ length: 12 }, (_, i) => i) },
      ],
    };
    const [header, first] = await callExportTable(data, 'species');
    expect(header.slice(0, 3)).toEqual(['protein_id', 'PCA 3_x', 'PCA 3_y']);
    expect(header).not.toContain('PCA 3_z');
    expect(first.slice(0, 3)).toEqual(['P1', '0', '1']);
  });

  it('holds the proteins the ID export holds', async () => {
    for (const hidden of [['mouse'], [NA_VALUE], ['human', NA_VALUE]]) {
      const [, ...rows] = await callExportTable(tableData, 'species', hidden);
      expect(rows.map((row) => row[0])).toEqual(
        await callExportProteinIds(tableData, 'species', hidden),
      );
    }
  });

  it('writes predictions in their own columns and leaves the curated cell empty', async () => {
    const data: ExportableData = {
      protein_ids: ['Q', 'R'],
      annotations: {
        fam: { kind: 'categorical', values: ['kunitz'], colors: ['#f00'], shapes: ['circle'] },
        fam__eat_confidence: {
          kind: 'numeric',
          values: [],
          colors: [],
          shapes: [],
          runtime: { role: 'eat-confidence', baseAnnotation: 'fam' },
        },
      },
      // The overlay materialises the prediction into the base column for display.
      annotation_data: {
        fam: Int32Array.from([0, 0]),
        fam__eat_confidence: Int32Array.from([-1, -1]),
      },
      numeric_annotation_data: { fam__eat_confidence: Float64Array.from([0.75, NaN]) },
      annotation_predicted: {
        fam: [{ value: 'kunitz', confidence: Math.fround(0.9), source: 'R' }, null],
      },
    };
    const [header, ...rows] = await callExportTable(data, 'fam');
    expect(header).toEqual([
      'protein_id',
      'fam',
      'fam__pred_value',
      'fam__pred_confidence',
      'fam__pred_source',
    ]);
    expect(rows).toEqual([
      ['Q', '', 'kunitz', '0.9', 'R'],
      ['R', 'kunitz', '', '', ''],
    ]);
  });

  it('quotes a field that holds a tab, a line break or a quote', async () => {
    const data: ExportableData = {
      protein_ids: ['P1'],
      annotations: {
        note: { values: ['a\tb "c"'], colors: ['#000'], shapes: ['circle'] },
      },
      annotation_data: { note: [[0]] },
    };
    expect(await exportTableText(data, 'note')).toBe('protein_id\tnote\nP1\t"a\tb ""c"""\n');
  });
});
