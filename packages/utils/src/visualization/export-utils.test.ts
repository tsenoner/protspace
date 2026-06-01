import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtSpaceExporter, createExporter } from './export-utils';
import type { ExportableElement, ExportableData, ExportOptions } from './export-utils';
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

  it('creates an exporter with all parameters', () => {
    const mockElement = createMockElement();
    const exporter = createExporter(mockElement, ['P1']);
    expect(exporter).toBeInstanceOf(ProtSpaceExporter);
  });
});

describe('ProtSpaceExporter.validateCanvasDimensions', () => {
  it('should accept small dimensions', () => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](2000, 1000);
    expect(result.isValid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should accept 6000px dimensions', () => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](6000, 3000);
    expect(result.isValid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should accept dimensions up to ~7782px (95% of 8192)', () => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](7700, 4000);
    expect(result.isValid).toBe(true);
  });

  it('should reject dimensions exceeding 8192px limit', () => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](8500, 4000);
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('8192px');
  });

  it('should reject very large dimensions that exceed area limit', () => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](20000, 20000);
    expect(result.isValid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('should handle non-square aspect ratios', () => {
    // Wide but within limits
    const result1 = ProtSpaceExporter['validateCanvasDimensions'](7000, 2000);
    expect(result1.isValid).toBe(true);

    // Tall but within limits
    const result2 = ProtSpaceExporter['validateCanvasDimensions'](2000, 7000);
    expect(result2.isValid).toBe(true);
  });

  it('should reject if width exceeds limit', () => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](9000, 1000);
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('limit');
  });

  it('should reject if height exceeds limit', () => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](1000, 9000);
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('limit');
  });

  it('should accept maximum safe dimensions', () => {
    // 95% of 8192 = 7782
    const maxSafe = Math.floor(8192 * 0.95);
    const result = ProtSpaceExporter['validateCanvasDimensions'](maxSafe, maxSafe);
    expect(result.isValid).toBe(true);
  });

  it('should accept very small dimensions', () => {
    const result = ProtSpaceExporter['validateCanvasDimensions'](100, 100);
    expect(result.isValid).toBe(true);
  });
});

describe('Export scale factor calculations', () => {
  const BASE_FONT_SIZE = 24;

  it('calculates correct scale factor for default font size', () => {
    const fontSizePx = 24;
    const scaleFactor = fontSizePx / BASE_FONT_SIZE;
    expect(scaleFactor).toBe(1.0);
  });

  it('calculates correct scale factor for smaller font', () => {
    const fontSizePx = 12;
    const scaleFactor = fontSizePx / BASE_FONT_SIZE;
    expect(scaleFactor).toBe(0.5);
  });

  it('calculates correct scale factor for larger font', () => {
    const fontSizePx = 48;
    const scaleFactor = fontSizePx / BASE_FONT_SIZE;
    expect(scaleFactor).toBe(2.0);
  });

  it('handles minimum font size', () => {
    const fontSizePx = 8;
    const scaleFactor = fontSizePx / BASE_FONT_SIZE;
    expect(scaleFactor).toBeCloseTo(0.333, 2);
  });

  it('handles maximum font size', () => {
    const fontSizePx = 120;
    const scaleFactor = fontSizePx / BASE_FONT_SIZE;
    expect(scaleFactor).toBe(5.0);
  });
});

describe('Export options validation', () => {
  it('accepts valid export options', () => {
    const options: ExportOptions = {
      targetWidth: 2048,
      targetHeight: 1024,
      legendWidthPercent: 25,
      legendScaleFactor: 1.0,
      includeSelection: false,
      backgroundColor: '#ffffff',
    };

    expect(options.targetWidth).toBe(2048);
    expect(options.targetHeight).toBe(1024);
    expect(options.legendWidthPercent).toBe(25);
    expect(options.legendScaleFactor).toBe(1.0);
  });

  it('handles optional properties', () => {
    const minimalOptions: ExportOptions = {};

    expect(minimalOptions.targetWidth).toBeUndefined();
    expect(minimalOptions.targetHeight).toBeUndefined();
    expect(minimalOptions.legendWidthPercent).toBeUndefined();
  });

  it('accepts custom export name', () => {
    const options: ExportOptions = {
      exportName: 'my_custom_export.png',
    };

    expect(options.exportName).toBe('my_custom_export.png');
  });

  it('accepts includeLegend option', () => {
    const withLegend: ExportOptions = { includeLegend: true };
    const withoutLegend: ExportOptions = { includeLegend: false };

    expect(withLegend.includeLegend).toBe(true);
    expect(withoutLegend.includeLegend).toBe(false);
  });

  it('defaults includeLegend to undefined (resolved to true by getOptionsWithDefaults)', () => {
    const options: ExportOptions = {};
    expect(options.includeLegend).toBeUndefined();
  });
});

describe('Export filename generation', () => {
  it('generates consistent filename format', () => {
    // Expected format: protspace_{projection}_{annotation}_{date}.{ext}
    const pattern = /^protspace_[a-z0-9_-]+_[a-z0-9_-]+_\d{4}-\d{2}-\d{2}\.(png|pdf)$/;

    expect('protspace_pca_species_2024-01-15.png').toMatch(pattern);
    expect('protspace_umap_gene_2024-12-31.pdf').toMatch(pattern);
  });

  it('sanitizes projection names', () => {
    // Spaces and special chars should be replaced with underscores
    const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    expect(sanitize('PCA 2D')).toBe('pca_2d');
    expect(sanitize('UMAP@3D')).toBe('umap_3d');
    expect(sanitize('t-SNE')).toBe('t-sne');
  });

  it('removes dimension suffix from projection names', () => {
    const removeDimensionSuffix = (name: string) => name.replace(/_[23]$/, '');

    expect(removeDimensionSuffix('pca_2')).toBe('pca');
    expect(removeDimensionSuffix('umap_3')).toBe('umap');
    expect(removeDimensionSuffix('tsne_2d')).toBe('tsne_2d'); // Only removes _2 or _3
  });
});

describe('Export aspect ratio calculations', () => {
  it('maintains aspect ratio when scaling width', () => {
    const originalWidth = 2048;
    const originalHeight = 1024;
    const newWidth = 4096;

    const aspectRatio = originalWidth / originalHeight;
    const newHeight = Math.round(newWidth / aspectRatio);

    expect(newHeight).toBe(2048);
  });

  it('maintains aspect ratio when scaling height', () => {
    const originalWidth = 2048;
    const originalHeight = 1024;
    const newHeight = 2048;

    const aspectRatio = originalWidth / originalHeight;
    const newWidth = Math.round(newHeight * aspectRatio);

    expect(newWidth).toBe(4096);
  });

  it('handles non-standard aspect ratios', () => {
    const width = 1920;
    const height = 1080;
    const aspectRatio = width / height;

    expect(aspectRatio).toBeCloseTo(16 / 9, 2);
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

  describe('exportProteinIds N/A visibility', () => {
    it('should exclude N/A proteins when __NA__ is hidden', () => {
      const data: ExportableData = {
        protein_ids: ['P1', 'P2', 'P3'],
        annotations: {
          species: {
            values: ['human', 'mouse', null],
            colors: ['#ff0000', '#00ff00', '#888888'],
            shapes: ['circle', 'square', 'triangle'],
          },
        },
        annotation_data: { species: [[0], [1], [2]] },
      };

      // Simulate the visibility filtering logic from exportProteinIds
      const hiddenValues = [NA_VALUE];
      const hiddenSet = new Set(hiddenValues);
      const annotationInfo = data.annotations.species;
      const indices = data.annotation_data.species;

      const visibleIds = data.protein_ids.filter((_id, i) => {
        const viArray = indices[i];
        if (!Array.isArray(viArray) || viArray.length === 0) {
          return !hiddenSet.has(NA_VALUE);
        }
        return viArray.some((vi) => {
          const value =
            typeof vi === 'number' && vi >= 0 && vi < annotationInfo.values.length
              ? (annotationInfo.values[vi] ?? null)
              : null;
          const key = value === null ? NA_VALUE : String(value);
          return !hiddenSet.has(key);
        });
      });

      expect(visibleIds).toEqual(['P1', 'P2']);
      expect(visibleIds).not.toContain('P3');
    });

    it('should include N/A proteins when __NA__ is not hidden', () => {
      const data: ExportableData = {
        protein_ids: ['P1', 'P2', 'P3'],
        annotations: {
          species: {
            values: ['human', 'mouse', null],
            colors: ['#ff0000', '#00ff00', '#888888'],
            shapes: ['circle', 'square', 'triangle'],
          },
        },
        annotation_data: { species: [[0], [1], [2]] },
      };

      const hiddenValues: string[] = [];
      const hiddenSet = new Set(hiddenValues);
      const annotationInfo = data.annotations.species;
      const indices = data.annotation_data.species;

      const visibleIds = data.protein_ids.filter((_id, i) => {
        const viArray = indices[i];
        if (!Array.isArray(viArray) || viArray.length === 0) {
          return !hiddenSet.has(NA_VALUE);
        }
        return viArray.some((vi) => {
          const value =
            typeof vi === 'number' && vi >= 0 && vi < annotationInfo.values.length
              ? (annotationInfo.values[vi] ?? null)
              : null;
          const key = value === null ? NA_VALUE : String(value);
          return !hiddenSet.has(key);
        });
      });

      expect(visibleIds).toEqual(['P1', 'P2', 'P3']);
    });

    it('should exclude proteins with missing annotation data when __NA__ is hidden', () => {
      const data: ExportableData = {
        protein_ids: ['P1', 'P2'],
        annotations: {
          species: {
            values: ['human'],
            colors: ['#ff0000'],
            shapes: ['circle'],
          },
        },
        annotation_data: { species: [[0], []] }, // P2 has empty annotation data
      };

      const hiddenValues = [NA_VALUE];
      const hiddenSet = new Set(hiddenValues);

      const visibleIds = data.protein_ids.filter((_id, i) => {
        const viArray = data.annotation_data.species[i];
        if (!Array.isArray(viArray) || viArray.length === 0) {
          return !hiddenSet.has(NA_VALUE);
        }
        return true;
      });

      expect(visibleIds).toEqual(['P1']);
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
