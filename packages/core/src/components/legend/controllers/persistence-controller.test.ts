import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactiveControllerHost } from 'lit';
import { PersistenceController, type PersistenceCallbacks } from './persistence-controller';
import type { LegendItem } from '../types';
import { LEGEND_VALUES, NA_VALUE } from '../config';

function createTestItem(value: string, zOrder: number): LegendItem {
  return {
    value,
    zOrder,
    color: '#000000',
    shape: 'circle',
    count: 1,
    isVisible: true,
  };
}

vi.mock('@protspace/utils', () => ({
  generateDatasetHash: vi.fn((ids: string[]) => `hash_${ids.join('_')}`),
  buildStorageKey: vi.fn(
    (prefix: string, hash: string, annotation: string) => `${prefix}_${hash}_${annotation}`,
  ),
  getStorageItem: vi.fn(),
  setStorageItem: vi.fn(),
  removeStorageItem: vi.fn(),
  removeAllStorageItemsByHash: vi.fn(),
  LEGEND_VALUES: {
    OTHER: 'Other',
  },
  NA_VALUE: '__NA__',
  NA_DISPLAY: 'N/A',
  isNAValue: (value: unknown) => value === '__NA__',
}));

import {
  generateDatasetHash,
  buildStorageKey,
  getStorageItem,
  setStorageItem,
  removeStorageItem,
  removeAllStorageItemsByHash,
} from '@protspace/utils';

describe('PersistenceController', () => {
  let controller: PersistenceController;
  let mockHost: ReactiveControllerHost;
  let mockCallbacks: PersistenceCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();

    mockHost = {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    };

    mockCallbacks = {
      onSettingsLoaded: vi.fn(),
      getLegendItems: vi.fn().mockReturnValue([]),
      getHiddenValues: vi.fn().mockReturnValue([]),
      shouldPersistCategories: vi.fn().mockReturnValue(true),
      shouldPersistCategoryEncodings: vi.fn().mockReturnValue(true),
      getCurrentSettings: vi.fn().mockReturnValue({
        maxVisibleValues: 10,
        shapeSize: 16,
        sortMode: 'size-desc' as const,
        enableDuplicateStackUI: false,
        selectedPaletteId: 'kellys',
      }),
    };

    controller = new PersistenceController(mockHost, mockCallbacks);
  });

  describe('updateDatasetHash', () => {
    it('returns true when hash changes, false when same', () => {
      expect(controller.updateDatasetHash(['protein1', 'protein2'])).toBe(true);
      expect(generateDatasetHash).toHaveBeenCalledWith(['protein1', 'protein2']);
      expect(controller.updateDatasetHash(['protein1', 'protein2'])).toBe(false);
    });

    it('resets settingsLoaded when hash changes', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      vi.mocked(getStorageItem).mockReturnValue({
        maxVisibleValues: 10,
        shapeSize: 16,
        sortMode: 'size-desc',
        hiddenValues: [],
        categories: {},
        enableDuplicateStackUI: false,
      });
      controller.loadSettings();
      expect(controller.settingsLoaded).toBe(true);

      controller.updateDatasetHash(['protein2']);
      expect(controller.settingsLoaded).toBe(false);
    });
  });

  describe('updateSelectedAnnotation', () => {
    it('returns true when annotation changes, false when same', () => {
      expect(controller.updateSelectedAnnotation('annotation1')).toBe(true);
      expect(controller.updateSelectedAnnotation('annotation1')).toBe(false);
    });

    it('resets settingsLoaded when annotation changes', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      vi.mocked(getStorageItem).mockReturnValue({
        maxVisibleValues: 10,
        shapeSize: 16,
        sortMode: 'size-desc',
        hiddenValues: [],
        categories: {},
        enableDuplicateStackUI: false,
      });
      controller.loadSettings();
      expect(controller.settingsLoaded).toBe(true);

      controller.updateSelectedAnnotation('annotation2');
      expect(controller.settingsLoaded).toBe(false);
    });
  });

  describe('loadSettings', () => {
    it('does nothing without dataset hash', () => {
      controller.updateSelectedAnnotation('annotation1');
      controller.loadSettings();
      expect(getStorageItem).not.toHaveBeenCalled();
    });

    it('does nothing without selected annotation', () => {
      controller.updateDatasetHash(['protein1']);
      controller.loadSettings();
      expect(getStorageItem).not.toHaveBeenCalled();
    });

    // Backward-compat: bundles written before the includeShapes removal may still
    // have this field in localStorage. The controller must accept them.
    it('loads legacy payload containing includeShapes without rejecting it', () => {
      const savedSettings = {
        maxVisibleValues: 15,
        includeShapes: true,
        shapeSize: 20,
        sortMode: 'alpha-asc' as const,
        hiddenValues: ['hidden1'],
        categories: {
          cat1: { zOrder: 0, color: '#000', shape: 'circle' },
          cat2: { zOrder: 1, color: '#fff', shape: 'square' },
        },
        enableDuplicateStackUI: true,
      };

      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      vi.mocked(getStorageItem).mockReturnValue(savedSettings);

      controller.loadSettings();

      expect(buildStorageKey).toHaveBeenCalledWith('legend', 'hash_protein1', 'annotation1');
      expect(mockCallbacks.onSettingsLoaded).toHaveBeenCalledWith({
        ...savedSettings,
        selectedPaletteId: 'kellys',
      });
      expect(controller.settingsLoaded).toBe(true);
      expect(controller.pendingCategories).toEqual(savedSettings.categories);
    });

    it('ignores persisted categories when category state should not be restored', () => {
      const savedSettings = {
        maxVisibleValues: 15,
        shapeSize: 20,
        sortMode: 'alpha-asc' as const,
        hiddenValues: ['hidden1'],
        categories: {
          cat1: { zOrder: 0, color: '#000', shape: 'circle' },
        },
        enableDuplicateStackUI: true,
      };

      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      mockCallbacks.shouldPersistCategories = vi.fn().mockReturnValue(false);
      vi.mocked(getStorageItem).mockReturnValue(savedSettings);

      controller.loadSettings();

      expect(controller.pendingCategories).toEqual({});
    });
  });

  describe('saveSettings', () => {
    it('does nothing without storage key', () => {
      controller.saveSettings();
      expect(setStorageItem).not.toHaveBeenCalled();
    });

    it('saves settings excluding Other from categories (N/A uses __NA__)', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');

      mockCallbacks.getLegendItems = vi.fn().mockReturnValue([
        { value: 'cat1', zOrder: 0, color: '#f00', shape: 'circle' },
        { value: NA_VALUE, zOrder: 1, color: '#888', shape: 'circle' },
        { value: 'Other', zOrder: 2, color: '#888', shape: 'circle' },
      ]);
      mockCallbacks.getHiddenValues = vi.fn().mockReturnValue(['hidden1']);
      mockCallbacks.getCurrentSettings = vi.fn().mockReturnValue({
        maxVisibleValues: 15,
        shapeSize: 20,
        sortMode: 'alpha-asc' as const,
        enableDuplicateStackUI: true,
        selectedPaletteId: 'kellys',
      });

      controller.saveSettings();

      // N/A items are included with __NA__ key, Other is excluded
      expect(setStorageItem).toHaveBeenCalledWith('legend_hash_protein1_annotation1', {
        maxVisibleValues: 15,
        shapeSize: 20,
        sortMode: 'alpha-asc',
        hiddenValues: ['hidden1'],
        categories: {
          cat1: { zOrder: 0, color: '#f00', shape: 'circle' },
          [NA_VALUE]: { zOrder: 1, color: '#888', shape: 'circle' },
        },
        enableDuplicateStackUI: true,
        selectedPaletteId: 'kellys',
      });
    });

    it('omits persisted colors and shapes when category encodings are derived', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');

      mockCallbacks.getLegendItems = vi.fn().mockReturnValue([
        { value: 'cat1', zOrder: 0, color: '#f00', shape: 'circle' },
        { value: 'cat2', zOrder: 1, color: '#0f0', shape: 'square' },
      ]);
      mockCallbacks.shouldPersistCategoryEncodings = vi.fn().mockReturnValue(false);
      mockCallbacks.getCurrentSettings = vi.fn().mockReturnValue({
        maxVisibleValues: 5,
        shapeSize: 20,
        sortMode: 'alpha-asc' as const,
        enableDuplicateStackUI: false,
        selectedPaletteId: 'viridis',
        numericSettings: {
          strategy: 'linear',
          signature: 'numeric-signature',
          topologySignature: 'numeric-topology',
          reverseGradient: false,
        },
      });

      controller.saveSettings();

      expect(setStorageItem).toHaveBeenCalledWith('legend_hash_protein1_annotation1', {
        maxVisibleValues: 5,
        shapeSize: 20,
        sortMode: 'alpha-asc',
        hiddenValues: [],
        categories: {
          cat1: { zOrder: 0, color: '', shape: '' },
          cat2: { zOrder: 1, color: '', shape: '' },
        },
        enableDuplicateStackUI: false,
        selectedPaletteId: 'viridis',
        numericSettings: {
          strategy: 'linear',
          signature: 'numeric-signature',
          topologySignature: 'numeric-topology',
          reverseGradient: false,
        },
      });
    });

    it('does not persist NA color/shape for numeric annotations', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');

      mockCallbacks.isNumericAnnotation = vi.fn().mockReturnValue(true);
      mockCallbacks.getLegendItems = vi.fn().mockReturnValue([
        { value: 'bin-0', zOrder: 0, color: '#F3C300', shape: 'circle' },
        { value: NA_VALUE, zOrder: 1, color: '#DDDDDD', shape: 'circle' },
      ]);

      controller.saveSettings();

      expect(setStorageItem).toHaveBeenCalledWith(
        'legend_hash_protein1_annotation1',
        expect.objectContaining({
          categories: {
            'bin-0': { zOrder: 0, color: '#F3C300', shape: 'circle' },
          },
        }),
      );
    });

    it('omits persisted categories entirely when category state is derived', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');

      mockCallbacks.shouldPersistCategories = vi.fn().mockReturnValue(false);
      mockCallbacks.getLegendItems = vi.fn().mockReturnValue([
        { value: 'cat1', zOrder: 0, color: '#f00', shape: 'circle' },
        { value: NA_VALUE, zOrder: 1, color: '#888', shape: 'circle' },
      ]);

      controller.saveSettings();

      expect(setStorageItem).toHaveBeenCalledWith('legend_hash_protein1_annotation1', {
        maxVisibleValues: 10,
        shapeSize: 16,
        sortMode: 'size-desc',
        hiddenValues: [],
        categories: {},
        enableDuplicateStackUI: false,
        selectedPaletteId: 'kellys',
        numericSettings: undefined,
      });
      expect(controller.pendingCategories).toEqual({});
    });
  });

  describe('removeSettings', () => {
    it('removes settings with correct key', () => {
      controller.removeSettings();
      expect(removeStorageItem).not.toHaveBeenCalled();

      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      controller.removeSettings();
      expect(removeStorageItem).toHaveBeenCalledWith('legend_hash_protein1_annotation1');
    });
  });

  describe('hasPersistedSettings', () => {
    const mockGetItem = vi.fn();
    const originalLocalStorage = global.localStorage;

    beforeEach(() => {
      Object.defineProperty(global, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          length: 0,
          key: vi.fn(),
        },
        configurable: true,
      });
      mockGetItem.mockReset();
    });

    afterEach(() => {
      Object.defineProperty(global, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    });

    it('returns false without storage key or when no item exists', () => {
      expect(controller.hasPersistedSettings()).toBe(false);

      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      mockGetItem.mockReturnValue(null);
      expect(controller.hasPersistedSettings()).toBe(false);
    });

    it('returns true when item exists', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      mockGetItem.mockReturnValue('{"some": "data"}');
      expect(controller.hasPersistedSettings()).toBe(true);
      expect(mockGetItem).toHaveBeenCalledWith('legend_hash_protein1_annotation1');
    });
  });

  describe('pendingCategories', () => {
    it('starts empty and clears correctly', () => {
      expect(controller.pendingCategories).toEqual({});
      expect(controller.hasPendingCategories()).toBe(false);

      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      vi.mocked(getStorageItem).mockReturnValue({
        maxVisibleValues: 10,
        shapeSize: 16,
        sortMode: 'size-desc',
        hiddenValues: [],
        categories: { cat1: { zOrder: 0, color: '#f00', shape: 'circle' } },
        enableDuplicateStackUI: false,
      });

      controller.loadSettings();
      expect(controller.hasPendingCategories()).toBe(true);

      controller.clearPendingCategories();
      expect(controller.pendingCategories).toEqual({});
      expect(controller.hasPendingCategories()).toBe(false);
    });
  });

  describe('applyPendingZOrder', () => {
    it('returns items unchanged when no pending categories or empty items', () => {
      const items = [createTestItem('cat1', 0), createTestItem('cat2', 1)];
      expect(controller.applyPendingZOrder(items)).toBe(items);

      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      vi.mocked(getStorageItem).mockReturnValue({
        maxVisibleValues: 10,
        shapeSize: 16,
        sortMode: 'size-desc',
        hiddenValues: [],
        categories: { cat1: { zOrder: 0, color: '#f00', shape: 'circle' } },
        enableDuplicateStackUI: false,
      });
      controller.loadSettings();
      expect(controller.applyPendingZOrder([])).toEqual([]);
    });

    it('applies z-order from categories without clearing them', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      vi.mocked(getStorageItem).mockReturnValue({
        maxVisibleValues: 10,
        shapeSize: 16,
        sortMode: 'size-desc',
        hiddenValues: [],
        categories: {
          cat1: { zOrder: 2, color: '#f00', shape: 'circle' },
          cat2: { zOrder: 0, color: '#0f0', shape: 'square' },
        },
        enableDuplicateStackUI: false,
      });
      controller.loadSettings();

      const items = [
        createTestItem('cat1', 0),
        createTestItem('cat2', 1),
        createTestItem('cat3', 2),
        createTestItem(NA_VALUE, 3),
      ];

      const result = controller.applyPendingZOrder(items);

      expect(result[0].zOrder).toBe(2); // cat1: 0 -> 2
      expect(result[1].zOrder).toBe(0); // cat2: 1 -> 0
      expect(result[2].zOrder).toBe(2); // cat3: unchanged
      expect(result[3].zOrder).toBe(3); // N/A: unchanged (not in persisted categories)
      // pendingCategories are NOT cleared - they're needed for _visibleValues in subsequent updates
      expect(controller.hasPendingCategories()).toBe(true);
    });

    it('applies z-order to N/A items using __NA__ key', () => {
      controller.updateDatasetHash(['protein1']);
      controller.updateSelectedAnnotation('annotation1');
      vi.mocked(getStorageItem).mockReturnValue({
        maxVisibleValues: 10,
        shapeSize: 16,
        sortMode: 'size-desc',
        hiddenValues: [],
        categories: {
          cat1: { zOrder: 1, color: '#f00', shape: 'circle' },
          [NA_VALUE]: { zOrder: 0, color: '#888', shape: 'circle' }, // N/A with __NA__ key
        },
        enableDuplicateStackUI: false,
      });
      controller.loadSettings();

      const items = [
        createTestItem('cat1', 0),
        createTestItem(NA_VALUE, 1), // N/A item with __NA__ value
      ];

      const result = controller.applyPendingZOrder(items);

      expect(result[0].zOrder).toBe(1); // cat1: 0 -> 1
      expect(result[1].zOrder).toBe(0); // N/A: 1 -> 0 (from __NA__ key in categories)
    });
  });

  describe('file-based persistence', () => {
    const fileSettings = {
      annotation1: {
        maxVisibleValues: 20,
        shapeSize: 28,
        sortMode: 'manual' as const,
        hiddenValues: ['hidden_from_file'],
        categories: {
          file_cat1: { zOrder: 0, color: '#aaa', shape: 'diamond' },
        },
        enableDuplicateStackUI: true,
        selectedPaletteId: 'kellys',
      },
      annotation2: {
        maxVisibleValues: 5,
        shapeSize: 12,
        sortMode: 'alpha-desc' as const,
        hiddenValues: [],
        categories: {},
        enableDuplicateStackUI: false,
        selectedPaletteId: 'kellys',
      },
    };

    describe('hasFileSettings', () => {
      it('returns false when no file settings are set', () => {
        expect(controller.hasFileSettings).toBe(false);
      });

      it('returns true when file settings are set', () => {
        controller.setFileSettings(fileSettings);
        expect(controller.hasFileSettings).toBe(true);
      });

      it('returns false after clearing file settings with null', () => {
        controller.setFileSettings(fileSettings);
        controller.setFileSettings(null);
        expect(controller.hasFileSettings).toBe(false);
      });
    });

    describe('setFileSettings', () => {
      it('stores file settings and makes them available', () => {
        controller.setFileSettings(fileSettings);
        expect(controller.hasFileSettings).toBe(true);
        expect(controller.hasFileSettingsForAnnotation('annotation1')).toBe(true);
        expect(controller.hasFileSettingsForAnnotation('annotation2')).toBe(true);
        expect(controller.hasFileSettingsForAnnotation('unknown')).toBe(false);
      });

      it('clears file settings when passed null', () => {
        controller.setFileSettings(fileSettings);
        controller.setFileSettings(null);
        expect(controller.hasFileSettings).toBe(false);
      });

      it('clears all existing localStorage items for the hash before persisting', () => {
        controller.updateDatasetHash(['protein1']);

        controller.setFileSettings(fileSettings, 'hash_protein1');

        // Should clear all existing settings for this hash first
        expect(removeAllStorageItemsByHash).toHaveBeenCalledWith('hash_protein1');

        // Then persist each annotation's settings
        expect(setStorageItem).toHaveBeenCalledWith(
          'legend_hash_protein1_annotation1',
          fileSettings.annotation1,
        );
        expect(setStorageItem).toHaveBeenCalledWith(
          'legend_hash_protein1_annotation2',
          fileSettings.annotation2,
        );
      });

      it('clears existing settings using provided datasetHash when component hash not set', () => {
        // Don't call updateDatasetHash - component hash is empty
        const providedHash = 'external_hash_123';

        controller.setFileSettings(fileSettings, providedHash);

        expect(removeAllStorageItemsByHash).toHaveBeenCalledWith(providedHash);
        expect(setStorageItem).toHaveBeenCalled();
      });

      it('does not clear or persist settings when null is passed', () => {
        vi.clearAllMocks();

        controller.setFileSettings(null);

        expect(removeAllStorageItemsByHash).not.toHaveBeenCalled();
        expect(setStorageItem).not.toHaveBeenCalled();
      });

      it('does not clear or persist settings when no hash is available', () => {
        vi.clearAllMocks();
        // Don't set dataset hash and don't provide one

        controller.setFileSettings(fileSettings);

        // Without a hash, clearing and persisting should be skipped
        expect(removeAllStorageItemsByHash).not.toHaveBeenCalled();
        expect(setStorageItem).not.toHaveBeenCalled();
      });
    });

    describe('loadSettings with file settings', () => {
      it('prioritizes file settings over localStorage on first load', () => {
        controller.updateDatasetHash(['protein1']);
        controller.updateSelectedAnnotation('annotation1');
        controller.setFileSettings(fileSettings);

        // localStorage would return different settings
        vi.mocked(getStorageItem).mockReturnValue({
          maxVisibleValues: 10,
          shapeSize: 16,
          sortMode: 'size-desc' as const,
          hiddenValues: [],
          categories: { local_cat: { zOrder: 0, color: '#000', shape: 'circle' } },
          enableDuplicateStackUI: false,
        });

        controller.loadSettings();

        // Should use file settings, not localStorage
        expect(mockCallbacks.onSettingsLoaded).toHaveBeenCalledWith(
          expect.objectContaining({
            maxVisibleValues: 20,
            sortMode: 'manual',
          }),
        );
      });

      it('uses localStorage for annotations without file settings', () => {
        controller.updateDatasetHash(['protein1']);
        controller.updateSelectedAnnotation('annotation3'); // Not in file settings
        controller.setFileSettings(fileSettings);

        const localSettings = {
          maxVisibleValues: 10,
          shapeSize: 16,
          sortMode: 'size-desc' as const,
          hiddenValues: [],
          categories: {},
          enableDuplicateStackUI: false,
        };
        vi.mocked(getStorageItem).mockReturnValue(localSettings);

        controller.loadSettings();

        // Should use localStorage since annotation3 is not in file settings
        expect(mockCallbacks.onSettingsLoaded).toHaveBeenCalledWith(
          expect.objectContaining({
            maxVisibleValues: 10,
            sortMode: 'size-desc',
          }),
        );
      });

      it('uses localStorage on subsequent loads for same annotation (after file settings applied once)', () => {
        controller.updateDatasetHash(['protein1']);
        controller.updateSelectedAnnotation('annotation1');
        controller.setFileSettings(fileSettings);

        // First load uses file settings
        controller.loadSettings();
        expect(mockCallbacks.onSettingsLoaded).toHaveBeenCalledWith(
          expect.objectContaining({ maxVisibleValues: 20 }),
        );

        vi.clearAllMocks();

        // Simulate a change that triggers reload
        const localSettings = {
          maxVisibleValues: 99,
          shapeSize: 16,
          sortMode: 'size-desc' as const,
          hiddenValues: [],
          categories: {},
          enableDuplicateStackUI: false,
        };
        vi.mocked(getStorageItem).mockReturnValue(localSettings);

        // Second load uses localStorage
        controller.loadSettings();
        expect(mockCallbacks.onSettingsLoaded).toHaveBeenCalledWith(
          expect.objectContaining({ maxVisibleValues: 99 }),
        );
      });
    });

    describe('getCurrentSettingsForExport', () => {
      it('returns current settings from callbacks', () => {
        mockCallbacks.getLegendItems = vi.fn().mockReturnValue([
          { value: 'cat1', zOrder: 0, color: '#f00', shape: 'circle' },
          { value: 'cat2', zOrder: 1, color: '#0f0', shape: 'square' },
        ]);
        mockCallbacks.getHiddenValues = vi.fn().mockReturnValue(['hidden1']);
        mockCallbacks.getCurrentSettings = vi.fn().mockReturnValue({
          maxVisibleValues: 15,
          shapeSize: 20,
          sortMode: 'alpha-asc' as const,
          enableDuplicateStackUI: true,
          selectedPaletteId: 'kellys',
        });

        const settings = controller.getCurrentSettingsForExport();

        expect(settings.maxVisibleValues).toBe(15);
        // includeShapes must not appear in exported settings even if legacy storage carries it.
        expect(settings.includeShapes).toBeUndefined();
        expect(settings.sortMode).toBe('alpha-asc');
        expect(settings.hiddenValues).toEqual(['hidden1']);
        expect(settings.categories).toEqual({
          cat1: { zOrder: 0, color: '#f00', shape: 'circle' },
          cat2: { zOrder: 1, color: '#0f0', shape: 'square' },
        });
      });

      it('excludes Other from categories', () => {
        mockCallbacks.getLegendItems = vi.fn().mockReturnValue([
          { value: 'cat1', zOrder: 0, color: '#f00', shape: 'circle' },
          { value: 'Other', zOrder: 1, color: '#888', shape: 'circle' },
        ]);

        const settings = controller.getCurrentSettingsForExport();

        expect(settings.categories).toEqual({
          cat1: { zOrder: 0, color: '#f00', shape: 'circle' },
        });
        expect(settings.categories['Other']).toBeUndefined();
      });

      it('strips legacy annotation type overrides from stored annotations during export', () => {
        controller.updateDatasetHash(['protein1']);
        controller.updateSelectedAnnotation('selected');
        mockCallbacks.getCurrentSettings = vi.fn().mockReturnValue({
          maxVisibleValues: 10,
          shapeSize: 16,
          sortMode: 'size-desc' as const,
          enableDuplicateStackUI: false,
          selectedPaletteId: 'kellys',
        });
        vi.mocked(getStorageItem).mockImplementation((key: string) =>
          key === 'legend_hash_protein1_other'
            ? {
                maxVisibleValues: 5,
                shapeSize: 20,
                sortMode: 'alpha-asc' as const,
                hiddenValues: [],
                categories: {},
                enableDuplicateStackUI: false,
                selectedPaletteId: 'cividis',
                annotationTypeOverride: 'numeric',
              }
            : {},
        );

        const settings = controller.getAllSettingsForExport(['selected', 'other']);

        expect(settings.other).toEqual({
          maxVisibleValues: 5,
          shapeSize: 20,
          sortMode: 'alpha-asc',
          hiddenValues: [],
          categories: {},
          enableDuplicateStackUI: false,
          selectedPaletteId: 'cividis',
          numericSettings: undefined,
        });
        expect('annotationTypeOverride' in settings.other).toBe(false);
      });
    });
  });
});
