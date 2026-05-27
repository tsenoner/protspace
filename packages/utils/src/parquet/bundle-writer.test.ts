import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createParquetBundle, generateBundleFilename } from './bundle-writer';
import { countBundleDelimiters } from './delimiter-utils';
import type { BundleSettings, VisualizationData } from '../types';

// Mock visualization data
const createMockVisualizationData = (): VisualizationData => ({
  protein_ids: ['P001', 'P002', 'P003'],
  projections: [
    {
      name: 'PCA_2',
      metadata: { dimension: 2 },
      data: [
        [1.0, 2.0],
        [3.0, 4.0],
        [5.0, 6.0],
      ],
    },
    {
      name: 'UMAP_3',
      metadata: { dimension: 3 },
      data: [
        [1.0, 2.0, 3.0],
        [4.0, 5.0, 6.0],
        [7.0, 8.0, 9.0],
      ],
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
    it('should create a bundle without settings (3-part format)', () => {
      const data = createMockVisualizationData();

      const buffer = createParquetBundle(data);

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(0);

      // Check for exactly 2 delimiters (3 parts)
      const uint8Array = new Uint8Array(buffer);
      const delimiterCount = countBundleDelimiters(uint8Array);
      expect(delimiterCount).toBe(2);
    });

    it('should create a bundle with settings (4-part format)', () => {
      const data = createMockVisualizationData();
      const settings = createMockSettings();

      const buffer = createParquetBundle(data, {
        includeSettings: true,
        settings,
      });

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(0);

      // Check for exactly 3 delimiters (4 parts)
      const uint8Array = new Uint8Array(buffer);
      const delimiterCount = countBundleDelimiters(uint8Array);
      expect(delimiterCount).toBe(3);
    });

    it('should create 3-part bundle when includeSettings is true but settings is undefined', () => {
      const data = createMockVisualizationData();

      const buffer = createParquetBundle(data, {
        includeSettings: true,
        settings: undefined,
      });

      const uint8Array = new Uint8Array(buffer);
      const delimiterCount = countBundleDelimiters(uint8Array);
      expect(delimiterCount).toBe(2);
    });

    it('should create 3-part bundle when includeSettings is true but settings is empty', () => {
      const data = createMockVisualizationData();

      const buffer = createParquetBundle(data, {
        includeSettings: true,
        settings: { legendSettings: {}, exportOptions: {} },
      });

      const uint8Array = new Uint8Array(buffer);
      const delimiterCount = countBundleDelimiters(uint8Array);
      expect(delimiterCount).toBe(2);
    });

    it('should handle data with multiple projections', () => {
      const data = createMockVisualizationData();

      const buffer = createParquetBundle(data);

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it('should handle data with null annotation values', () => {
      const data = createMockVisualizationData();
      // Family annotation has null value at index 2

      const buffer = createParquetBundle(data);

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(0);
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
