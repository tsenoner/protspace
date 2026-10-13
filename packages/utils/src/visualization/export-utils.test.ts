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
 * Helper to call exportProteinIds via the real exporter and capture the downloaded IDs.
 * Mocks the private downloadFile method to intercept the data URI.
 */
function callExportProteinIds(
  data: ExportableData,
  annotation: string,
  hiddenAnnotationValues: string[] = [],
): string[] {
  const el = createMockElement({
    getCurrentData: () => data,
    selectedAnnotation: annotation,
    hiddenAnnotationValues,
  });
  const exporter = createExporter(el);

  let capturedUri = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(exporter as any, 'downloadFile').mockImplementation((uri: string) => {
    capturedUri = uri;
  });

  exporter.exportProteinIds();

  if (!capturedUri) return [];
  const encoded = capturedUri.replace('data:text/plain;charset=utf-8,', '');
  const decoded = decodeURIComponent(encoded);
  return decoded ? decoded.split('\n') : [];
}

describe('exportProteinIds integration', () => {
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

  it('exports all IDs when nothing is hidden', () => {
    const ids = callExportProteinIds(baseData, 'species', []);
    expect(ids).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('excludes N/A proteins when __NA__ is hidden', () => {
    const ids = callExportProteinIds(baseData, 'species', [NA_VALUE]);
    expect(ids).toEqual(['P1', 'P2', 'P4']);
    expect(ids).not.toContain('P3');
  });

  it('excludes proteins matching a hidden regular value', () => {
    const ids = callExportProteinIds(baseData, 'species', ['mouse']);
    expect(ids).toEqual(['P1', 'P3', 'P4']);
    expect(ids).not.toContain('P2');
  });

  it('excludes multiple hidden values including N/A', () => {
    const ids = callExportProteinIds(baseData, 'species', ['mouse', NA_VALUE]);
    expect(ids).toEqual(['P1', 'P4']);
  });

  it('returns no visible IDs when all values are hidden', () => {
    const ids = callExportProteinIds(baseData, 'species', ['human', 'mouse', NA_VALUE]);
    expect(ids).toEqual([]);
  });

  it('treats proteins with empty annotation arrays as N/A', () => {
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

    const ids = callExportProteinIds(data, 'species', [NA_VALUE]);
    expect(ids).toEqual(['P1']);
  });

  it('exports all IDs when annotation does not exist (fallback)', () => {
    const ids = callExportProteinIds(baseData, 'nonexistent', [NA_VALUE]);
    expect(ids).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('handles multi-value annotations — visible if any value is not hidden', () => {
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
    const ids = callExportProteinIds(data, 'tags', [NA_VALUE]);
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
