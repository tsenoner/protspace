/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from 'lit';
import {
  renderSettingsDialog,
  type SettingsDialogCallbacks,
  type SettingsDialogState,
} from './legend-settings-dialog';
import type { LegendPersistedSettings, LegendSortMode } from './types';
import {
  DEFAULT_NUMERIC_PALETTE_ID,
  DEFAULT_NUMERIC_STRATEGY,
  type NumericBinningStrategy,
} from '@protspace/utils';

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
  _showSettingsDialog: boolean;
  _dialogSettings: {
    maxVisibleValues: number;
    shapeSize: number;
    enableDuplicateStackUI: boolean;
    annotationSortModes: Record<string, LegendSortMode>;
    selectedPaletteId: string;
    numericStrategy: NumericBinningStrategy;
    reverseGradient: boolean;
  };
  _renderSettingsDialog: () => unknown;
  _handlePaletteChange: (paletteId: string) => void;
  _handleSettingsSave: () => void;
  _handleSettingsReset: () => void;
  _applyPersistedSettings: (settings: LegendPersistedSettings) => void;
  _syncNumericSettingsFromPersistence: () => void;
  _updateLegendItems: () => void;
  _dispatchLegendStateChange: () => void;
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

function renderSettingsDialogToContainer(overrides = {}) {
  const callbacks = {
    onMaxVisibleValuesChange: vi.fn(),
    onShapeSizeChange: vi.fn(),
    onEnableDuplicateStackUIChange: vi.fn(),
    onSortModeChange: vi.fn<(annotation: string, mode: LegendSortMode) => void>(),
    onPaletteChange: vi.fn(),
    onNumericStrategyChange: vi.fn<(strategy: NumericBinningStrategy) => void>(),
    onReverseGradientChange: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    onReset: vi.fn(),
    onKeydown: vi.fn(),
    onOverlayMouseDown: vi.fn(),
    onOverlayMouseUp: vi.fn(),
  } as SettingsDialogCallbacks;

  const container = document.createElement('div');
  render(
    renderSettingsDialog(
      {
        maxVisibleValues: 25,
        shapeSize: 12,
        defaultShapeSize: 10,
        enableDuplicateStackUI: false,
        selectedAnnotation: 'score',
        annotationSortModes: {},
        isNumericAnnotation: true,
        selectedNumericStrategy: 'linear',
        logBinningAvailable: true,
        hasPersistedSettings: false,
        selectedPaletteId: 'viridis',
        reverseGradient: false,
        hasCategoryScores: false,
        ...overrides,
      },
      callbacks,
    ),
    container,
  );

  return { container, callbacks };
}

describe('renderSettingsDialog', () => {
  it('keeps "By separation" checked on reload, before this projection\'s scores arrive', () => {
    // The deliberate reload case: hasCategoryScores is false (statistics have not synced
    // yet) but the persisted sort mode is still 'silhouette-desc'. Dropping the option here
    // would render the radio group with nothing checked.
    const { container } = renderSettingsDialogToContainer({
      selectedAnnotation: 'major_group',
      isNumericAnnotation: false,
      annotationSortModes: { major_group: 'silhouette-desc' },
      hasCategoryScores: false,
    });

    const labels = [...container.querySelectorAll('label')].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toContain('By separation');

    const checkedLabel = [...container.querySelectorAll('input[type="radio"]')]
      .find((input) => (input as HTMLInputElement).checked)
      ?.closest('label')
      ?.textContent?.trim();
    expect(checkedLabel).toBe('By separation');
  });
});

/**
 * The dialog's copy, numeric and categorical. These were checked only by the
 * numeric-binning e2e dialog reads; the rendering is the same here, without a browser.
 */
describe('settings dialog copy', () => {
  const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';
  const fieldLabel = (container: HTMLElement, inputId: string) =>
    text(
      container
        .querySelector(`#${inputId}`)
        ?.closest('.other-items-list-item')
        ?.querySelector('.other-items-list-item-label'),
    );
  const sortingLabels = (container: HTMLElement) =>
    [...container.querySelectorAll('input[type="radio"][name^="sort-type-"]')].map((input) =>
      text(input.closest('label')),
    );
  const selectOptions = (container: HTMLElement, selectId: string) => [
    ...((container.querySelector(`#${selectId}`) as HTMLSelectElement | null)?.options ?? []),
  ];

  it('names the numeric controls and offers the gradient palettes', () => {
    const { container } = renderSettingsDialogToContainer({
      selectedAnnotation: 'length',
      isNumericAnnotation: true,
      selectedPaletteId: 'batlow',
      selectedNumericStrategy: 'quantile',
    });

    expect(text(container.querySelector('#legend-settings-title'))).toBe('Legend settings: length');
    expect(fieldLabel(container, 'max-visible-input')).toBe('Max legend items');
    expect(fieldLabel(container, 'shape-size-input')).toBe('Point size');
    expect(sortingLabels(container)).toEqual(['By numeric value', 'Manual order']);
    expect(selectOptions(container, 'palette-select').map(text)).toEqual([
      'Batlow - Scientific sequential gradient',
      'Cividis - Colorblind-friendly sequential gradient',
      'Inferno - High-contrast sequential gradient',
      'Plasma - Vivid sequential gradient',
      'Viridis - Perceptually uniform sequential gradient',
    ]);
    expect(container.querySelector('.color-palette-gradient-bar')?.getAttribute('aria-label')).toBe(
      'Batlow continuous gradient preview',
    );
    expect([...container.querySelectorAll('.color-palette-gradient-scale span')].map(text)).toEqual(
      ['Low', 'High'],
    );
    expect(
      selectOptions(container, 'numeric-distribution-select').map((option) => [
        option.value,
        text(option),
      ]),
    ).toEqual([
      ['linear', 'Linear'],
      ['quantile', 'Quantile'],
      ['logarithmic', 'Logarithmic'],
    ]);
  });

  it('names the categorical controls and offers no gradient palette or preview', () => {
    const { container } = renderSettingsDialogToContainer({
      selectedAnnotation: 'family',
      isNumericAnnotation: false,
      selectedPaletteId: 'kellys',
    });

    expect(text(container.querySelector('#legend-settings-title'))).toBe('Legend settings: family');
    expect(fieldLabel(container, 'max-visible-input')).toBe('Max legend items');
    expect(fieldLabel(container, 'shape-size-input')).toBe('Shape size');
    expect(sortingLabels(container)).toEqual(['By category size', 'Alphabetical', 'Manual order']);
    expect(selectOptions(container, 'palette-select').map((option) => option.value)).toEqual([
      'dark2',
      'kellys',
      'okabeIto',
      'set2',
      'tableau10',
      'tolBright',
    ]);
    expect(container.querySelector('.color-palette-gradient-bar')).toBeNull();
    expect(container.querySelector('#numeric-distribution-select')).toBeNull();
  });
});

describe('shape size input', () => {
  function typeSize(value: string) {
    const { container, callbacks } = renderSettingsDialogToContainer();
    const input = container.querySelector('#shape-size-input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    return { input, callbacks };
  }

  function renderSize(state: Partial<SettingsDialogState>) {
    const { container } = renderSettingsDialogToContainer(state);
    const input = container.querySelector('#shape-size-input') as HTMLInputElement;
    const hint = input.parentElement?.querySelector('.settings-note')?.textContent ?? '';
    return { input, hint };
  }

  it('accepts sizes down to 1', () => {
    const { input, callbacks } = typeSize('1');
    expect(input.min).toBe('1');
    expect(callbacks.onShapeSizeChange).toHaveBeenCalledWith(1);
  });

  it("suggests the dataset's own default and names it in a hint", () => {
    const { input, hint } = renderSize({ shapeSize: 2, defaultShapeSize: 2 });
    expect(input.value).toBe('2');
    expect(input.placeholder).toBe('2');
    expect(hint).toContain('Default for this dataset: 2');
  });

  it('caps typed sizes at 64', () => {
    const { input, callbacks } = typeSize('100');
    expect(callbacks.onShapeSizeChange).toHaveBeenCalledWith(64);
    expect(input.value).toBe('64');
  });

  it('reports an emptied field as no size, so Save applies the default', () => {
    const { callbacks } = typeSize('');
    expect(callbacks.onShapeSizeChange).toHaveBeenCalledWith(null);
  });

  it('ignores a size below 1', () => {
    const { callbacks } = typeSize('0');
    expect(callbacks.onShapeSizeChange).not.toHaveBeenCalled();
  });

  it('shows an emptied field as empty, with the default as placeholder', () => {
    const { input, hint } = renderSize({ shapeSize: null, defaultShapeSize: 2 });
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('2');
    expect(hint).toContain('clear the field to use it');
  });
});

describe('ProtspaceLegend settings dialog numeric inference integration', () => {
  function createLegend(): LegendTestElement {
    return document.createElement('protspace-legend') as LegendTestElement;
  }

  function configureOpenSettingsDialog(el: LegendTestElement, selectedPaletteId = 'kellys') {
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind: 'numeric' };
    el._showSettingsDialog = true;
    el._dialogSettings = {
      maxVisibleValues: 5,
      shapeSize: 12,
      enableDuplicateStackUI: false,
      annotationSortModes: {},
      selectedPaletteId,
      numericStrategy: 'linear',
      reverseGradient: false,
    };
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

  it('renders numeric-dependent controls for inferred numeric annotations', () => {
    const el = createLegend();
    configureOpenSettingsDialog(el, DEFAULT_NUMERIC_PALETTE_ID);
    el._dialogSettings.annotationSortModes = { score: 'alpha-asc' };
    const container = document.createElement('div');

    render(el._renderSettingsDialog(), container);

    expect(container.querySelector('#numeric-distribution-select')).not.toBeNull();
    expect(
      [...container.querySelectorAll('.settings-section-title')].map((section) =>
        section.textContent?.trim(),
      ),
    ).toContain('Bin order');
  });

  it('normalizes palette changes using the inferred numeric annotation type', () => {
    const el = createLegend();
    configureOpenSettingsDialog(el);

    el._handlePaletteChange('kellys');

    expect(el._dialogSettings.selectedPaletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
  });

  it('saves numeric-only settings for inferred numeric annotations', () => {
    const el = createLegend();
    configureOpenSettingsDialog(el);
    el._updateLegendItems = vi.fn();
    el._dispatchLegendStateChange = vi.fn();

    el._handleSettingsSave();

    expect(el._annotationSortModes.score).toBe('alpha-asc');
    expect(el._selectedPaletteId).toBe(DEFAULT_NUMERIC_PALETTE_ID);
    expect(el._numericSettingsByAnnotation.score).toMatchObject({
      binCount: 5,
      strategy: 'linear',
      paletteId: DEFAULT_NUMERIC_PALETTE_ID,
      reverseGradient: false,
    });
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

    el._applyPersistedSettings({
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

    el._syncNumericSettingsFromPersistence();

    expect(syncNumericAnnotationSettings).toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});

/** The header's reverse button is named for what it does to the current order. */
describe('legend header reverse button', () => {
  it.each([
    ['categorical', 'size-desc', 'Reverse z-order (keep Other last)'],
    ['numeric', 'alpha-asc', 'Show high to low'],
    ['numeric', 'alpha-desc', 'Show low to high'],
    ['numeric', 'manual', 'Reverse manual order'],
  ] as const)('labels it for a %s legend in %s order', (kind, sortMode, label) => {
    const el = document.createElement('protspace-legend') as LegendTestElement & {
      render: () => unknown;
    };
    el.selectedAnnotation = 'score';
    el.annotationData = { name: 'score', values: ['1', '2'], kind };
    el._annotationSortModes = { score: sortMode };
    const container = document.createElement('div');

    render(el.render(), container);

    const button = container.querySelector('button.reverse-button');
    expect(button?.getAttribute('aria-label')).toBe(label);
    expect(button?.getAttribute('title')).toBe(label);
  });
});
