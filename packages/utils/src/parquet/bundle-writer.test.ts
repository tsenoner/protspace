import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createParquetBundle, generateBundleFilename } from './bundle-writer';
import { countBundleDelimiters, findBundleDelimiterPositions } from './delimiter-utils';
import { BUNDLE_DELIMITER, BUNDLE_DELIMITER_BYTES } from './constants';
import type { BundleSettings, VisualizationData } from '../types';

// Mock visualization data
const createMockVisualizationData = (): VisualizationData => ({
  protein_ids: ['P001', 'P002', 'P003'],
  projections: [
    {
      name: 'PCA_2',
      metadata: { dimension: 2 },
      data: Float32Array.of(1.0, 2.0, 3.0, 4.0, 5.0, 6.0),
      dimension: 2,
    },
    {
      name: 'UMAP_3',
      metadata: { dimension: 3 },
      data: Float32Array.of(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0),
      dimension: 3,
    },
  ],
  annotations: {
    organism: {
      values: ['human', 'mouse'],
      colors: ['#ff0000', '#00ff00'],
      shapes: ['circle', 'square'],
    },
    family: {
      values: ['kinase', 'protease', null],
      colors: ['#0000ff', '#ffff00', '#888888'],
      shapes: ['diamond', 'triangle-up', 'circle'],
    },
  },
  annotation_data: {
    organism: [[0], [1], [0]],
    family: [[0], [1], [2]],
  },
});

const createMockSettings = (): BundleSettings => ({
  legendSettings: {
    organism: {
      maxVisibleValues: 10,
      shapeSize: 24,
      sortMode: 'size-desc',
      hiddenValues: [],
      categories: {
        human: { zOrder: 0, color: '#ff0000', shape: 'circle' },
        mouse: { zOrder: 1, color: '#00ff00', shape: 'square' },
      },
      enableDuplicateStackUI: false,
      selectedPaletteId: 'kellys',
    },
  },
  exportOptions: {
    organism: {
      imageWidth: 2048,
      imageHeight: 1024,
      lockAspectRatio: true,
      legendWidthPercent: 25,
      legendFontSizePx: 24,
      includeLegendSettings: true,
      includeExportOptions: true,
    },
  },
});

describe('bundle-writer', () => {
  describe('createParquetBundle', () => {
    /** Byte length of every part, in slot order. */
    const partSizes = (buffer: ArrayBuffer): number[] => {
      const bytes = new Uint8Array(buffer);
      const starts = [
        0,
        ...findBundleDelimiterPositions(bytes).map((at) => at + BUNDLE_DELIMITER_BYTES.length),
      ];
      const ends = [...findBundleDelimiterPositions(bytes), bytes.length];
      return starts.map((start, index) => ends[index] - start);
    };

    it('always writes the six v3 slots, settings and statistics as zero bytes when absent', () => {
      const buffer = createParquetBundle(createMockVisualizationData());

      expect(countBundleDelimiters(new Uint8Array(buffer))).toBe(5);
      const [annotations, metadata, projections, settings, statistics, payloads] =
        partSizes(buffer);
      expect(settings).toBe(0);
      expect(statistics).toBe(0);
      for (const size of [annotations, metadata, projections, payloads]) {
        expect(size).toBeGreaterThan(0);
      }
    });

    it('fills the settings slot when settings are included', () => {
      const buffer = createParquetBundle(createMockVisualizationData(), {
        includeSettings: true,
        settings: createMockSettings(),
      });

      expect(countBundleDelimiters(new Uint8Array(buffer))).toBe(5);
      expect(partSizes(buffer)[3]).toBeGreaterThan(0);
    });

    it.each([
      ['undefined', undefined],
      ['empty', { legendSettings: {}, exportOptions: {} }],
    ])('leaves the settings slot empty when the settings are %s', (_, settings) => {
      const buffer = createParquetBundle(createMockVisualizationData(), {
        includeSettings: true,
        settings,
      });

      expect(partSizes(buffer)[3]).toBe(0);
    });

    it('copies a statistics part into slot five byte for byte', () => {
      const statistics = new TextEncoder().encode('PAR1-statistics').buffer as ArrayBuffer;
      const buffer = createParquetBundle({ ...createMockVisualizationData(), statistics });

      const sizes = partSizes(buffer);
      expect(sizes[3]).toBe(0);
      expect(sizes[4]).toBe(statistics.byteLength);
    });

    it('refuses to write a part whose contents contain the bundle delimiter', () => {
      // The delimiter is in-band and unescaped, so a part carrying it would split
      // into two on read-back. Annotation labels are user-authored, so this is
      // reachable from the UI — and the reader cannot distinguish the resulting
      // bundle from a genuinely malformed one. Mirrors the Python producer's
      // `_check_no_delimiter`; failing at write time is the only safe moment.
      const data = createMockVisualizationData();
      data.annotations.family.values = [`kinase${BUNDLE_DELIMITER}family`, 'protease', null];

      expect(() => createParquetBundle(data)).toThrow(/contains the bundle delimiter/);
    });

    it('refuses a multi-valued column whose count column another annotation already uses', () => {
      const data = createMockVisualizationData();
      data.annotations.organism__count = { ...data.annotations.organism };
      data.annotation_data.organism__count = data.annotation_data.organism;
      data.annotation_data.organism = [[0, 1], [1], [0]];

      expect(() => createParquetBundle(data)).toThrow(/"organism__count", which already exists/);
    });

    it('writes a settings part when EAT settings are the only persisted state', () => {
      const buffer = createParquetBundle(createMockVisualizationData(), {
        includeSettings: true,
        settings: {
          legendSettings: {},
          exportOptions: {},
          eatOverlayEnabled: false,
          eatConfidenceThreshold: 0.75,
        },
      });
      expect(partSizes(buffer)[3]).toBeGreaterThan(0);
    });

    it('writes a settings part when the shape size is the only persisted state', () => {
      const buffer = createParquetBundle(createMockVisualizationData(), {
        includeSettings: true,
        settings: { legendSettings: {}, exportOptions: {}, shapeSize: 12 },
      });
      expect(partSizes(buffer)[3]).toBeGreaterThan(0);
    });
  });

  describe('generateBundleFilename', () => {
    beforeEach(() => {
      // Mock Date to get consistent filenames
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should generate filename without settings suffix', () => {
      const filename = generateBundleFilename(false);

      expect(filename).toBe('protspace_2024-06-15.parquetbundle');
    });

    it('should generate filename with settings suffix', () => {
      const filename = generateBundleFilename(true);

      expect(filename).toBe('protspace_with_settings_2024-06-15.parquetbundle');
    });

    it('should generate filename without settings by default', () => {
      const filename = generateBundleFilename();

      expect(filename).toBe('protspace_2024-06-15.parquetbundle');
    });
  });
});
