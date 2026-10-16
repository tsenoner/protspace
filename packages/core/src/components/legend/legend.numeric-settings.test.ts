/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from 'lit';
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  type NumericBinningStrategy,
} from '@protspace/utils';
import type { ProtspaceLegendSettingsPopover } from './legend-settings-popover';
import type { LegendDisplaySettings, LegendPersistedSettings, LegendSortMode } from './types';

// Import the component to register the custom element for integration coverage.
import './legend';

type LegendTestElement = HTMLElement & {
  selectedAnnotation: string;
  data?: {
    annotations?: Record<string, { kind?: 'categorical' | 'numeric'; values: string[] }>;
    protein_ids?: string[];
    numeric_annotation_data?: Record<string, Float64Array>;
  };
  proteinIds: string[];
  annotationData: { name: string; values: string[]; kind?: 'categorical' | 'numeric' };
  maxVisibleValues: number;
  updated: (changedProperties: Map<string, unknown>) => void;
  _renderSettingsPopover: (label: string) => unknown;
  _applyDisplaySettings: (patch: Partial<LegendDisplaySettings>) => void;
  _handleSettingsReset: () => void;
  _data: {
    applyPersistedSettings: (settings: LegendPersistedSettings) => void;
    syncNumericSettingsFromPersistence: () => void;
  };
  _updateLegendItems: () => void;
  _scatterplotController: {
    scatterplot: {
      data?: {
        protein_ids?: string[];
        annotations?: Record<string, { kind?: 'categorical' | 'numeric'; values: string[] }>;
        numeric_annotation_data?: Record<string, Float64Array>;
      };
      dispatchEvent?: (event: Event) => boolean;
    } | null;
    syncNumericAnnotationSettings: () => void;
  };
  _selectedPaletteId: string;
  _annotationSortModes: Record<string, LegendSortMode>;
  _numericSettingsByAnnotation: Record<
    string,
    {
      binCount: number;
      strategy: NumericBinningStrategy;
      paletteId: string;
      reverseGradient: boolean;
    }
  >;
  _persistenceController: {
    updateDatasetHash: (data: unknown) => boolean;
    callbacks: {
      getCurrentSettings: () => {
        sortMode: LegendSortMode;
        numericSettings?: {
          strategy: NumericBinningStrategy;
          reverseGradient?: boolean;
          manualOrderIds?: string[];
        };
      };
    };
  };
  getAllPersistedSettings: () => Record<string, LegendPersistedSettings>;
};

describe('ProtspaceLegend numeric settings inference', () => {
  function createLegend(): LegendTestElement {
    return document.createElement('protspace-legend') as LegendTestElement;
  }

  /** A detached legend on the inferred numeric annotation `score`, with its redraws stubbed. */
  function configureNumeric(el: LegendTestElement): void {
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el._updateLegendItems = vi.fn();
  }

  function setSourceAnnotationKind(el: LegendTestElement, kind: 'categorical' | 'numeric'): void {
    Object.defineProperty(el._scatterplotController, 'scatterplot', {
      configurable: true,
      value: {
        data: {
          annotations: {
            score: { kind, values: [] },
          },
        },
      },
    });
  }

  it('renders the settings popover as numeric for inferred numeric annotations', () => {
    const el = createLegend();
    configureNumeric(el);
    const container = document.createElement('div');

    render(el._renderSettingsPopover('Score'), container);

    const popover = container.querySelector(
      'protspace-legend-settings-popover',
    ) as ProtspaceLegendSettingsPopover;
    expect(popover.numeric).toBe(true);
    expect(popover.settings.paletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
    expect(popover.annotationLabel).toBe('Score');
  });

  it('normalizes palette edits using the inferred numeric annotation type', () => {
    const el = createLegend();
    configureNumeric(el);

    el._applyDisplaySettings({ paletteId: 'kellys' });

    expect(el._selectedPaletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
    expect(el._numericSettingsByAnnotation.score.paletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
  });

  it('applies numeric edits live for inferred numeric annotations', () => {
    const el = createLegend();
    configureNumeric(el);

    el._applyDisplaySettings({ maxVisibleValues: 5 });
    el._applyDisplaySettings({ numericStrategy: 'linear' });

    expect(el.maxVisibleValues).toBe(5);
    expect(el._numericSettingsByAnnotation.score).toMatchObject({
      binCount: 5,
      strategy: 'linear',
      paletteId: DEFAULT_NUMERIC_PALETTE_ID,
      reverseGradient: false,
    });
    expect(el._updateLegendItems).toHaveBeenCalledTimes(2);
  });

  it('resets to numeric defaults when the source annotation is numeric', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el._selectedPaletteId = 'kellys';
    el._updateLegendItems = vi.fn();
    setSourceAnnotationKind(el, 'numeric');

    el._handleSettingsReset();

    expect(el._annotationSortModes.score).toBe('alpha-asc');
    expect(el._selectedPaletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
    expect(el._numericSettingsByAnnotation.score).toMatchObject({
      binCount: 10,
      strategy: DEFAULT_NUMERIC_STRATEGY,
      paletteId: DEFAULT_NUMERIC_PALETTE_ID,
      reverseGradient: false,
    });
  });

  it('emits numeric settings when the selected annotation is numeric', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el.maxVisibleValues = 7;
    el._numericSettingsByAnnotation = {
      score: {
        binCount: 7,
        strategy: 'quantile',
        paletteId: DEFAULT_NUMERIC_PALETTE_ID,
        reverseGradient: true,
      },
    };

    const settings = el._persistenceController.callbacks.getCurrentSettings();

    expect(settings.numericSettings).toMatchObject({
      strategy: 'quantile',
      reverseGradient: true,
      manualOrderIds: undefined,
    });
  });

  it('normalizes persisted sort mode when the selected annotation is numeric', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el._annotationSortModes = { score: 'size-desc' };

    const settings = el._persistenceController.callbacks.getCurrentSettings();

    expect(settings.sortMode).toBe('alpha-asc');
  });

  it('ignores legacy persisted annotation type overrides and uses inferred numeric type', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };

    el._data.applyPersistedSettings({
      maxVisibleValues: 5,
      shapeSize: 12,
      sortMode: 'size-desc',
      hiddenValues: [],
      categories: {},
      enableDuplicateStackUI: false,
      selectedPaletteId: DEFAULT_NUMERIC_PALETTE_ID,
      annotationTypeOverride: 'string',
    } as LegendPersistedSettings & { annotationTypeOverride: string });

    expect(el._annotationSortModes.score).toBe('alpha-asc');
  });

  it('hashes source scatterplot data instead of the materialized override view', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.proteinIds = ['p1', 'p2'];
    el.data = {
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'categorical', values: ['1', '2'] },
      },
    };
    Object.defineProperty(el._scatterplotController, 'scatterplot', {
      configurable: true,
      value: {
        data: {
          protein_ids: ['p1', 'p2'],
          annotations: {
            score: { kind: 'numeric', values: [] },
          },
          numeric_annotation_data: {
            score: new Float64Array([1, 2]),
          },
        },
      },
    });
    const updateDatasetHash = vi
      .spyOn(el._persistenceController, 'updateDatasetHash')
      .mockReturnValue(false);

    el.updated(new Map([['data', null]]));

    expect(updateDatasetHash).toHaveBeenCalledWith({
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'numeric', values: [] },
      },
      numeric_annotation_data: {
        score: new Float64Array([1, 2]),
      },
    });
  });

  it('falls back to legend data when scatterplot source data is stale', () => {
    const el = createLegend();
    el.selectedAnnotation = 'score';
    el.proteinIds = ['p1', 'p2'];
    el.data = {
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'categorical', values: ['1', '2'] },
      },
    };
    Object.defineProperty(el._scatterplotController, 'scatterplot', {
      configurable: true,
      value: {
        data: {
          protein_ids: ['old-p1', 'old-p2'],
          annotations: {
            score: { kind: 'numeric', values: [] },
          },
          numeric_annotation_data: {
            score: new Float64Array([1, 2]),
          },
        },
      },
    });
    const updateDatasetHash = vi
      .spyOn(el._persistenceController, 'updateDatasetHash')
      .mockReturnValue(false);

    el.updated(new Map([['data', null]]));

    expect(updateDatasetHash).toHaveBeenCalledWith({
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'categorical', values: ['1', '2'] },
      },
      numeric_annotation_data: undefined,
    });
  });

  it('does not manually redispatch data-change while syncing numeric settings', () => {
    const el = createLegend();
    el.data = {
      protein_ids: ['p1', 'p2'],
      annotations: {
        score: { kind: 'numeric', values: [] },
      },
      numeric_annotation_data: {
        score: new Float64Array([1, 2]),
      },
    };
    el._numericSettingsByAnnotation = {};
    el.getAllPersistedSettings = vi.fn().mockReturnValue({});
    const dispatchEvent = vi.fn().mockReturnValue(true);
    Object.defineProperty(el._scatterplotController, 'scatterplot', {
      configurable: true,
      value: {
        data: el.data,
        dispatchEvent,
      },
    });
    const syncNumericAnnotationSettings = vi.spyOn(
      el._scatterplotController,
      'syncNumericAnnotationSettings',
    );

    el._data.syncNumericSettingsFromPersistence();

    expect(syncNumericAnnotationSettings).toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
