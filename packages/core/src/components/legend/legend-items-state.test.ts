import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_SCHEMES,
  type CategoryScore,
  type LegendPersistedSettings,
  type LegendSortMode,
} from '@protspace/utils';
import { LEGEND_VALUES, NA_VALUE } from './config';
import {
  applyDerivedNumericColors,
  applyNumericDisplayLabels,
  applyPaletteColors,
  normalizeCategoricalPaletteId,
  normalizeSortModeForType,
  numericOrderFromItems,
  reorderByValues,
  resolvePersistedSettings,
  reverseKeepingOtherLast,
  reverseSortMode,
  sortItemsForDisplay,
} from './legend-items-state';
import type { LegendAnnotationData, LegendItem } from './types';

const OTHER = LEGEND_VALUES.OTHER;

function item(value: string, zOrder: number, patch: Partial<LegendItem> = {}): LegendItem {
  return { value, color: '#000000', shape: 'circle', count: 1, isVisible: true, zOrder, ...patch };
}

const values = (items: readonly LegendItem[]) => items.map((each) => each.value);
const zOrders = (items: readonly LegendItem[]) => items.map((each) => each.zOrder);

function score(category: string, silhouette: number | null): CategoryScore {
  return { category, silhouette, silhouetteEmbedding: null, daviesBouldin: null };
}

function record(patch: Partial<LegendPersistedSettings> = {}): LegendPersistedSettings {
  return {
    maxVisibleValues: 10,
    shapeSize: 10,
    sortMode: 'size-desc',
    hiddenValues: [],
    categories: {},
    enableDuplicateStackUI: false,
    selectedPaletteId: 'kellys',
    ...patch,
  };
}

/** A categorical context: no numeric signatures are ever asked for. */
const categorical = {
  isNumeric: false,
  signatures: () => ({ signature: null, topologySignature: null }),
};

/** A numeric context whose live binning has these signatures. */
function numeric(signature: string, topologySignature: string) {
  return {
    isNumeric: true,
    signatures: vi.fn(() => ({ signature, topologySignature })),
  };
}

const numericRecord = (patch: Partial<LegendPersistedSettings> = {}) =>
  record({
    maxVisibleValues: 7,
    sortMode: 'manual',
    hiddenValues: ['bin-0'],
    selectedPaletteId: 'viridis',
    numericSettings: {
      strategy: 'quantile',
      signature: 'sig',
      topologySignature: 'topo',
      manualOrderIds: ['bin-1', 'bin-0'],
      reverseGradient: true,
    },
    ...patch,
  });

const NUMERIC: LegendAnnotationData = {
  name: 'length',
  kind: 'numeric',
  values: ['bin-0', 'bin-1', null],
  colors: ['#111111', '#222222', '#cccccc'],
  numericMetadata: {
    strategy: 'linear',
    binCount: 2,
    signature: 's',
    topologySignature: 't',
    logSupported: true,
    bins: [
      { id: 'bin-0', label: '1–5', lowerBound: 1, upperBound: 5, count: 2 },
      { id: 'bin-1', label: '5–9', lowerBound: 5, upperBound: 9, count: 1 },
    ],
  },
};

describe('normalizeSortModeForType', () => {
  it('keeps the value and manual orders of a numeric annotation and maps the rest to by value', () => {
    expect(normalizeSortModeForType('alpha-desc', true)).toBe('alpha-desc');
    expect(normalizeSortModeForType('manual-reverse', true)).toBe('manual-reverse');
    expect(normalizeSortModeForType('size-desc', true)).toBe('alpha-asc');
    expect(normalizeSortModeForType('silhouette-desc', true)).toBe('alpha-asc');
    expect(normalizeSortModeForType(undefined, true)).toBe('alpha-asc');
  });

  it('keeps any categorical mode and defaults to by count', () => {
    expect(normalizeSortModeForType('silhouette-asc', false)).toBe('silhouette-asc');
    expect(normalizeSortModeForType(undefined, false)).toBe('size-desc');
  });
});

describe('normalizeCategoricalPaletteId', () => {
  it('maps an empty or gradient id to kellys and keeps a categorical one', () => {
    expect(normalizeCategoricalPaletteId(undefined)).toBe('kellys');
    expect(normalizeCategoricalPaletteId(null)).toBe('kellys');
    expect(normalizeCategoricalPaletteId('')).toBe('kellys');
    expect(normalizeCategoricalPaletteId('viridis')).toBe('kellys');
    expect(normalizeCategoricalPaletteId('okabeIto')).toBe('okabeIto');
  });
});

describe('reverseSortMode', () => {
  it('maps all eight modes', () => {
    const pairs: [LegendSortMode, LegendSortMode][] = [
      ['size-asc', 'size-desc'],
      ['size-desc', 'size-asc'],
      ['alpha-asc', 'alpha-desc'],
      ['alpha-desc', 'alpha-asc'],
      ['manual', 'manual-reverse'],
      ['manual-reverse', 'manual'],
      ['silhouette-desc', 'silhouette-asc'],
      ['silhouette-asc', 'silhouette-desc'],
    ];
    expect(pairs.map(([mode]) => reverseSortMode(mode))).toEqual(pairs.map(([, back]) => back));
  });
});

describe('sortItemsForDisplay', () => {
  const items = [item('A', 0), item(OTHER, 3), item('B', 1), item('C', 2)];

  it('orders by zOrder for every mode but separation, without touching its input', () => {
    const before = values(items);
    expect(values(sortItemsForDisplay(items, 'size-desc', [score('B', 0.9)]))).toEqual([
      'A',
      'B',
      'C',
      OTHER,
    ]);
    expect(values(items)).toEqual(before);
  });

  it('keeps Other last and unscored categories after scored ones in both directions', () => {
    const scores = [score('A', 0.1), score('B', 0.9)];
    expect(values(sortItemsForDisplay(items, 'silhouette-desc', scores))).toEqual([
      'B',
      'A',
      'C',
      OTHER,
    ]);
    expect(values(sortItemsForDisplay(items, 'silhouette-asc', scores))).toEqual([
      'A',
      'B',
      'C',
      OTHER,
    ]);
  });
});

describe('reverseKeepingOtherLast', () => {
  it('reverses the rows by zOrder, keeps Other last and renumbers', () => {
    const reversed = reverseKeepingOtherLast([
      item('A', 0),
      item(OTHER, 3),
      item('B', 1),
      item('C', 2),
    ]);
    expect(values(reversed)).toEqual(['C', 'B', 'A', OTHER]);
    expect(zOrders(reversed)).toEqual([0, 1, 2, 3]);
  });

  it('reverses a legend without Other', () => {
    expect(values(reverseKeepingOtherLast([item('A', 0), item('B', 1)]))).toEqual(['B', 'A']);
  });
});

describe('reorderByValues', () => {
  it('follows the given order, numbers it and appends Other last', () => {
    const reordered = reorderByValues(
      [item('A', 0), item('B', 1), item('C', 2), item(OTHER, 3, { count: 9 })],
      ['C', 'A', 'B'],
    );
    expect(values(reordered)).toEqual(['C', 'A', 'B', OTHER]);
    expect(zOrders(reordered)).toEqual([0, 1, 2, 3]);
    expect(reordered[3].count).toBe(9);
  });

  it('adds no Other when the legend has none', () => {
    expect(values(reorderByValues([item('A', 0), item('B', 1)], ['B', 'A']))).toEqual(['B', 'A']);
  });
});

describe('applyPaletteColors', () => {
  it('colours rows by their position in the palette and leaves Other and N/A alone', () => {
    const palette = COLOR_SCHEMES.okabeIto;
    const coloured = applyPaletteColors(
      [
        item('A', 0),
        item(OTHER, 1, { color: '#888888' }),
        item('B', 2),
        item(NA_VALUE, 3, { color: '#cccccc' }),
      ],
      'okabeIto',
    );
    expect(coloured.map((each) => each.color)).toEqual([
      palette[0],
      '#888888',
      palette[2],
      '#cccccc',
    ]);
  });

  it('falls back to kellys for an unknown palette', () => {
    expect(applyPaletteColors([item('A', 0)], 'no-such-palette')[0].color).toBe(
      COLOR_SCHEMES.kellys[0],
    );
  });
});

describe('applyNumericDisplayLabels', () => {
  it('labels bins from the annotation and keeps Other, N/A and unknown ids as they were', () => {
    const labelled = applyNumericDisplayLabels(
      [
        item('bin-0', 0),
        item('bin-1', 1, { displayValue: 'old' }),
        item('bin-9', 2, { displayValue: 'kept' }),
        item(OTHER, 3),
        item(NA_VALUE, 4),
      ],
      NUMERIC,
    );
    expect(labelled.map((each) => each.displayValue)).toEqual([
      '1–5',
      '5–9',
      'kept',
      undefined,
      undefined,
    ]);
  });
});

describe('applyDerivedNumericColors', () => {
  it('takes each bin colour from the annotation and leaves Other and N/A alone', () => {
    const coloured = applyDerivedNumericColors(
      [
        item('bin-0', 0),
        item('bin-1', 1),
        item('bin-9', 2, { color: '#999999' }),
        item(NA_VALUE, 3, { color: '#abcdef' }),
        item(OTHER, 4, { color: '#888888' }),
      ],
      NUMERIC,
    );
    expect(coloured.map((each) => each.color)).toEqual([
      '#111111',
      '#222222',
      '#999999',
      '#abcdef',
      '#888888',
    ]);
  });
});

describe('numericOrderFromItems', () => {
  it('lists the bin ids by zOrder without Other and N/A', () => {
    expect(
      numericOrderFromItems([
        item('bin-1', 0),
        item(OTHER, 1),
        item(NA_VALUE, 2),
        item('bin-0', 3),
      ]),
    ).toEqual(['bin-1', 'bin-0']);
  });

  it('is undefined when only Other and N/A are left', () => {
    expect(numericOrderFromItems([item(OTHER, 0), item(NA_VALUE, 1)])).toBeUndefined();
  });
});

describe('resolvePersistedSettings', () => {
  it('reads a categorical record into live values', () => {
    expect(
      resolvePersistedSettings(
        record({
          maxVisibleValues: 8,
          sortMode: 'manual-reverse',
          hiddenValues: ['C'],
          enableDuplicateStackUI: true,
          selectedPaletteId: 'okabeIto',
        }),
        categorical,
      ),
    ).toEqual({
      maxVisibleValues: 8,
      annotationShapeSize: null,
      hiddenValues: ['C'],
      paletteId: 'okabeIto',
      sortMode: 'manual-reverse',
      enableDuplicateStackUI: true,
      numeric: null,
      clearPendingCategories: false,
    });
  });

  it('caps a stored size of 640 at 64', () => {
    expect(
      resolvePersistedSettings(record({ shapeSize: 640 }), categorical).annotationShapeSize,
    ).toBe(64);
    expect(
      resolvePersistedSettings(record({ shapeSize: 24 }), categorical).annotationShapeSize,
    ).toBe(24);
  });

  it('treats the filler sizes 10 and 30 as unset', () => {
    expect(
      resolvePersistedSettings(record({ shapeSize: 10 }), categorical).annotationShapeSize,
    ).toBe(null);
    expect(
      resolvePersistedSettings(record({ shapeSize: 30 }), categorical).annotationShapeSize,
    ).toBe(null);
  });

  it('reads a numeric record whose signatures match, asking for them with the resolved binning', () => {
    const context = numeric('sig', 'topo');
    const resolved = resolvePersistedSettings(numericRecord(), context);
    expect(context.signatures).toHaveBeenCalledWith(7, 'quantile', 'viridis', true);
    expect(resolved).toEqual({
      maxVisibleValues: 7,
      annotationShapeSize: null,
      hiddenValues: ['bin-0'],
      paletteId: 'viridis',
      sortMode: 'manual',
      enableDuplicateStackUI: false,
      numeric: {
        binCount: 7,
        strategy: 'quantile',
        paletteId: 'viridis',
        reverseGradient: true,
        manualOrderIds: ['bin-1', 'bin-0'],
      },
      clearPendingCategories: true,
    });
  });

  it('drops hidden values and the manual order on a topology mismatch', () => {
    const resolved = resolvePersistedSettings(numericRecord(), numeric('sig', 'other-topology'));
    expect(resolved.hiddenValues).toEqual([]);
    expect(resolved.numeric?.manualOrderIds).toBeUndefined();
  });

  it('clears pending categories on a signature mismatch', () => {
    const resolved = resolvePersistedSettings(numericRecord(), numeric('other-signature', 'topo'));
    expect(resolved.clearPendingCategories).toBe(true);
    // The topology still matches, so what the user hid and ordered survives a recolour.
    expect(resolved.hiddenValues).toEqual(['bin-0']);
    expect(resolved.numeric?.manualOrderIds).toEqual(['bin-1', 'bin-0']);
    expect(resolvePersistedSettings(record(), categorical).clearPendingCategories).toBe(false);
  });

  it('normalises a gradient id on a categorical record to kellys and a categorical id on a numeric record to batlow', () => {
    expect(
      resolvePersistedSettings(record({ selectedPaletteId: 'viridis' }), categorical).paletteId,
    ).toBe('kellys');
    const resolved = resolvePersistedSettings(
      numericRecord({ selectedPaletteId: 'kellys' }),
      numeric('sig', 'topo'),
    );
    expect(resolved.paletteId).toBe('batlow');
    expect(resolved.numeric?.paletteId).toBe('batlow');
  });

  it('normalises the stored sort mode by type', () => {
    expect(
      resolvePersistedSettings(numericRecord({ sortMode: 'size-desc' }), numeric('sig', 'topo'))
        .sortMode,
    ).toBe('alpha-asc');
  });
});
