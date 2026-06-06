import { sampleColorSchemeColor } from './color-scheme';
import { NA_VALUE, NA_DEFAULT_COLOR } from './missing-values';
import type {
  Annotation,
  NumericBinningStrategy,
  NumericBinDefinition,
  NumericAnnotationType,
  NumericAnnotationMetadata,
  LegendPersistedSettings,
  VisualizationData,
} from '../types';
import { djb2Hash } from '../storage/data-hash';

export const DEFAULT_NUMERIC_PALETTE_ID = 'batlow';
export const DEFAULT_NUMERIC_STRATEGY: NumericBinningStrategy = 'quantile';
export const GRADIENT_COLOR_SCHEME_IDS = new Set([
  'viridis',
  'cividis',
  'inferno',
  'batlow',
  'plasma',
]);
const NUMERIC_COLOR_ALGORITHM_VERSION = 'numeric-gradient-v2';

export interface NumericAnnotationDisplaySettings {
  binCount: number;
  strategy: NumericBinningStrategy;
  paletteId: string;
  reverseGradient: boolean;
}

export type NumericAnnotationDisplaySettingsMap = Record<string, NumericAnnotationDisplaySettings>;

export interface NumericSettingsResolutionInput {
  persistedSettings?: Partial<LegendPersistedSettings> | null;
  liveSettings?: Partial<NumericAnnotationDisplaySettings> | null;
  defaultBinCount?: number;
  overrideSettings?: Partial<NumericAnnotationDisplaySettings> | null;
}

interface NumericSummary {
  nonNullCount: number;
  min: number;
  max: number;
  distinctCount: number;
  sortedValues?: number[];
  logSupported: boolean;
  allIntegers: boolean;
}

const numericSummaryCache = new WeakMap<Array<number | null | undefined>, NumericSummary>();

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function isValidNumericStrategy(value: unknown): value is NumericBinningStrategy {
  return value === 'linear' || value === 'quantile' || value === 'logarithmic';
}

export function normalizeNumericPaletteId(paletteId: string): string {
  return isGradientPalette(paletteId) ? paletteId : DEFAULT_NUMERIC_PALETTE_ID;
}

export function resolveNumericAnnotationDisplaySettings({
  persistedSettings,
  liveSettings,
  defaultBinCount = 10,
  overrideSettings,
}: NumericSettingsResolutionInput): {
  settings: NumericAnnotationDisplaySettings;
  hadInvalidPersistedSettings: boolean;
} {
  const persistedStrategy = persistedSettings?.numericSettings?.strategy;
  const normalizedPersistedStrategy = isValidNumericStrategy(persistedStrategy)
    ? persistedStrategy
    : null;
  const hadInvalidPersistedSettings =
    persistedSettings?.numericSettings !== undefined && normalizedPersistedStrategy === null;

  const baseSettings: NumericAnnotationDisplaySettings = hadInvalidPersistedSettings
    ? {
        binCount: defaultBinCount,
        strategy: DEFAULT_NUMERIC_STRATEGY,
        paletteId: DEFAULT_NUMERIC_PALETTE_ID,
        reverseGradient: false,
      }
    : {
        binCount: Math.max(
          1,
          persistedSettings?.maxVisibleValues ?? liveSettings?.binCount ?? defaultBinCount,
        ),
        strategy: normalizedPersistedStrategy ?? liveSettings?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
        paletteId: normalizeNumericPaletteId(
          persistedSettings?.selectedPaletteId ??
            liveSettings?.paletteId ??
            DEFAULT_NUMERIC_PALETTE_ID,
        ),
        reverseGradient:
          persistedSettings?.numericSettings?.reverseGradient ??
          liveSettings?.reverseGradient ??
          false,
      };

  return {
    settings: {
      binCount: Math.max(1, overrideSettings?.binCount ?? baseSettings.binCount),
      strategy: isValidNumericStrategy(overrideSettings?.strategy)
        ? overrideSettings.strategy
        : baseSettings.strategy,
      paletteId: normalizeNumericPaletteId(overrideSettings?.paletteId ?? baseSettings.paletteId),
      reverseGradient: overrideSettings?.reverseGradient ?? baseSettings.reverseGradient,
    },
    hadInvalidPersistedSettings,
  };
}

function createSummary(
  values: Array<number | null | undefined>,
  options: { includeSortedValues?: boolean } = {},
): NumericSummary {
  const includeSortedValues = options.includeSortedValues === true;
  const cached = numericSummaryCache.get(values);

  if (cached && (!includeSortedValues || cached.sortedValues)) {
    return cached;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let nonNullCount = 0;
  let logSupported = true;
  let allIntegers = true;
  const distinctValues = new Set<number>();
  const finiteValues = includeSortedValues ? ([] as number[]) : null;

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }

    nonNullCount += 1;
    if (value < min) min = value;
    if (value > max) max = value;
    if (value <= 0) logSupported = false;
    if (!Number.isInteger(value)) allIntegers = false;
    distinctValues.add(value);
    finiteValues?.push(value);
  }

  const summary: NumericSummary = {
    nonNullCount,
    min: nonNullCount > 0 ? min : 0,
    max: nonNullCount > 0 ? max : 0,
    distinctCount: distinctValues.size,
    sortedValues: includeSortedValues
      ? finiteValues!.sort((left, right) => left - right)
      : undefined,
    logSupported: nonNullCount > 0 ? logSupported : false,
    allIntegers: nonNullCount > 0 ? allIntegers : true,
  };

  numericSummaryCache.set(values, summary);
  return summary;
}

const FLOAT_LABEL_FORMATTER = new Intl.NumberFormat('en-US', {
  useGrouping: true,
  minimumFractionDigits: 1,
  maximumFractionDigits: 6,
});

function shouldUseTinyFloatFormat(value: number): boolean {
  const abs = Math.abs(value);
  return abs > 0 && abs < 0.001;
}

function formatFloatValue(value: number): string {
  if (shouldUseTinyFloatFormat(value)) {
    return Number(value.toPrecision(6)).toString();
  }
  return FLOAT_LABEL_FORMATTER.format(value);
}

function formatNumericValue(value: number, numericType: NumericAnnotationType): string {
  if (!Number.isFinite(value)) return String(value);
  if (numericType === 'int') return String(Math.trunc(value));
  return formatFloatValue(value);
}

function serializeNumericValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toPrecision(17);
}

function formatNumericValueWithPrecision(
  value: number,
  precision: number,
  numericType: NumericAnnotationType,
): string {
  if (!Number.isFinite(value)) return String(value);
  if (numericType === 'int') return String(Math.trunc(value));
  if (shouldUseTinyFloatFormat(value)) {
    return Number(value.toPrecision(6)).toString();
  }

  return new Intl.NumberFormat('en-US', {
    useGrouping: true,
    minimumFractionDigits: 1,
    maximumFractionDigits: Math.min(20, precision),
  }).format(value);
}

function createNumericBinId(
  strategy: NumericBinningStrategy,
  lowerBound: number,
  upperBound: number,
): string {
  return [
    'num',
    strategy,
    serializeNumericValue(lowerBound),
    serializeNumericValue(upperBound),
  ].join(':');
}

interface ObservedBinRange {
  min: number;
  max: number;
}

function formatRangeLabel(min: number, max: number, formatter: (value: number) => string): string {
  return min === max ? formatter(min) : `${formatter(min)} - ${formatter(max)}`;
}

function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (lowerIndex === upperIndex) return lower;
  const weight = position - lowerIndex;
  return lower + (upper - lower) * weight;
}

function createLinearEdges(summary: NumericSummary, binCount: number): number[] {
  if (summary.nonNullCount === 0) return [];
  if (summary.min === summary.max) return [summary.min, summary.max];

  const step = (summary.max - summary.min) / binCount;
  return Array.from({ length: binCount + 1 }, (_, index) =>
    index === binCount ? summary.max : summary.min + step * index,
  );
}

function createQuantileEdges(summary: NumericSummary, binCount: number): number[] {
  if (summary.nonNullCount === 0) return [];
  if (summary.min === summary.max) return [summary.min, summary.max];
  const sortedValues = summary.sortedValues ?? [];

  return Array.from({ length: binCount + 1 }, (_, index) =>
    index === binCount ? summary.max : quantile(sortedValues, index / binCount),
  );
}

function createLogEdges(summary: NumericSummary, binCount: number): number[] {
  if (!summary.logSupported || summary.nonNullCount === 0) {
    return createLinearEdges(summary, binCount);
  }
  if (summary.min === summary.max) return [summary.min, summary.max];

  const minLog = Math.log10(summary.min);
  const maxLog = Math.log10(summary.max);
  const step = (maxLog - minLog) / binCount;

  return Array.from({ length: binCount + 1 }, (_, index) =>
    index === binCount ? summary.max : 10 ** (minLog + step * index),
  );
}

function dedupeEdges(edges: number[]): number[] {
  const deduped: number[] = [];
  for (const edge of edges) {
    if (deduped.length === 0 || Math.abs(deduped[deduped.length - 1] - edge) > Number.EPSILON) {
      deduped.push(edge);
    }
  }
  return deduped;
}

function createEdges(
  summary: NumericSummary,
  settings: NumericAnnotationDisplaySettings,
): number[] {
  const requestedBinCount = Math.max(1, Math.min(settings.binCount, summary.distinctCount || 1));
  const strategy = resolveEffectiveStrategy(settings.strategy, summary, requestedBinCount);

  const edges =
    strategy === 'quantile'
      ? createQuantileEdges(summary, requestedBinCount)
      : strategy === 'logarithmic'
        ? createLogEdges(summary, requestedBinCount)
        : createLinearEdges(summary, requestedBinCount);

  const deduped = dedupeEdges(edges);
  if (deduped.length < 2 && summary.nonNullCount > 0) {
    return [summary.min, summary.max];
  }
  return deduped;
}

function assignBinIndex(value: number, edges: number[]): number {
  for (let index = 0; index < edges.length - 1; index += 1) {
    const lowerBound = edges[index];
    const upperBound = edges[index + 1];
    const isLast = index === edges.length - 2;
    if (value >= lowerBound && (isLast ? value <= upperBound : value < upperBound)) {
      return index;
    }
  }
  return Math.max(0, edges.length - 2);
}

function createObservedBinLabels(
  observedRanges: ObservedBinRange[],
  exactBounds: Array<{ lowerBound: number; upperBound: number }>,
  numericType: NumericAnnotationType,
): string[] {
  const formatWith = (formatter: (value: number) => string) =>
    observedRanges.map(({ min, max }) => formatRangeLabel(min, max, formatter));

  const defaultLabels = formatWith((value) => formatNumericValue(value, numericType));
  if (new Set(defaultLabels).size === defaultLabels.length) {
    return defaultLabels;
  }

  for (const precision of [6, 8, 10, 12, 14, 16]) {
    const labels = formatWith((value) =>
      formatNumericValueWithPrecision(value, precision, numericType),
    );
    if (new Set(labels).size === labels.length) {
      return labels;
    }
  }

  const fallback = exactBounds.map(({ lowerBound, upperBound }) =>
    formatRangeLabel(lowerBound, upperBound, serializeNumericValue),
  );
  if (new Set(fallback).size === fallback.length) {
    return fallback;
  }

  return exactBounds.map(({ lowerBound, upperBound }, index) => {
    const base = formatRangeLabel(lowerBound, upperBound, serializeNumericValue);
    return `${base} (${index + 1})`;
  });
}

function createSignature(
  settings: NumericAnnotationDisplaySettings,
  bins: NumericBinDefinition[],
): string {
  const seed = [
    NUMERIC_COLOR_ALGORITHM_VERSION,
    settings.strategy,
    settings.binCount,
    settings.paletteId,
    settings.reverseGradient ? 'reversed' : 'forward',
    ...bins.map((bin) =>
      [
        bin.id,
        serializeNumericValue(bin.lowerBound),
        serializeNumericValue(bin.upperBound),
        bin.count,
        serializeNumericValue(bin.colorPosition ?? 0.5),
      ].join('|'),
    ),
  ].join('::');

  return djb2Hash(seed).toString(16).padStart(8, '0');
}

function createTopologySignature(
  strategy: NumericBinningStrategy,
  bins: NumericBinDefinition[],
): string {
  const seed = [
    strategy,
    ...bins.map((bin) =>
      [bin.id, serializeNumericValue(bin.lowerBound), serializeNumericValue(bin.upperBound)].join(
        '|',
      ),
    ),
  ].join('::');
  return djb2Hash(seed).toString(16).padStart(8, '0');
}

export function isGradientPalette(paletteId: string): boolean {
  return GRADIENT_COLOR_SCHEME_IDS.has(paletteId);
}

export function isNumericAnnotation(
  annotation?: { kind?: string; sourceKind?: string } | null,
): boolean {
  return annotation?.kind === 'numeric' || annotation?.sourceKind === 'numeric';
}

type NumericAnnotationLike = {
  kind?: Annotation['kind'];
  sourceKind?: Annotation['sourceKind'];
  numericMetadata?: Annotation['numericMetadata'];
};

export function getNumericBinDefinitions(
  annotation?: NumericAnnotationLike | null,
): NumericBinDefinition[] {
  if (!isNumericAnnotation(annotation as Annotation | null)) {
    return [];
  }
  return annotation?.numericMetadata?.bins ?? [];
}

export function getNumericBinLabelMap(
  annotation?: NumericAnnotationLike | null,
): Map<string, string> {
  return new Map(getNumericBinDefinitions(annotation).map((bin) => [bin.id, bin.label]));
}

export function getNumericBinLowerBoundMap(
  annotation?: NumericAnnotationLike | null,
): Map<string, number> {
  return new Map(getNumericBinDefinitions(annotation).map((bin) => [bin.id, bin.lowerBound]));
}

export function getOrderedNumericBinIds(
  annotation: NumericAnnotationLike | null | undefined,
  sortMode: 'alpha-asc' | 'alpha-desc' | 'manual' | 'manual-reverse',
  manualOrderIds: string[] = [],
): string[] {
  const bins = getNumericBinDefinitions(annotation);
  const canonicalIds = [...bins]
    .sort((left, right) => left.lowerBound - right.lowerBound)
    .map((bin) => bin.id);

  if (sortMode === 'alpha-desc') {
    return [...canonicalIds].reverse();
  }

  if (sortMode === 'manual' || sortMode === 'manual-reverse') {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const id of manualOrderIds) {
      if (canonicalIds.includes(id) && !seen.has(id)) {
        merged.push(id);
        seen.add(id);
      }
    }

    for (const id of canonicalIds) {
      if (!seen.has(id)) {
        merged.push(id);
      }
    }

    return sortMode === 'manual-reverse' ? merged.reverse() : merged;
  }

  return canonicalIds;
}

export function getNumericAnnotationSettings(
  settings: NumericAnnotationDisplaySettingsMap,
  annotationName: string,
  defaultBinCount: number,
): NumericAnnotationDisplaySettings {
  const existing = settings[annotationName];

  return {
    binCount: Math.max(1, existing?.binCount ?? defaultBinCount),
    strategy: existing?.strategy ?? DEFAULT_NUMERIC_STRATEGY,
    paletteId: normalizeNumericPaletteId(existing?.paletteId ?? DEFAULT_NUMERIC_PALETTE_ID),
    reverseGradient: existing?.reverseGradient ?? false,
  };
}

function resolveEffectiveStrategy(
  strategy: NumericBinningStrategy,
  summary: NumericSummary,
  binCount?: number,
): NumericBinningStrategy {
  // Log requires positive values — fall back to default (quantile → linear via sparsity check)
  if (strategy === 'logarithmic' && !summary.logSupported) {
    return resolveEffectiveStrategy(DEFAULT_NUMERIC_STRATEGY, summary, binCount);
  }
  // Quantile edges collapse when distinct values are sparse — fall back to linear
  if (strategy === 'quantile' && binCount !== undefined && summary.distinctCount <= binCount) {
    return 'linear';
  }
  return strategy;
}

function getLinearColorPosition(
  lowerBound: number,
  upperBound: number,
  summary: NumericSummary,
): number {
  if (summary.min === summary.max) return 0.5;
  return clamp01(((lowerBound + upperBound) / 2 - summary.min) / (summary.max - summary.min));
}

function getLogarithmicColorPosition(
  lowerBound: number,
  upperBound: number,
  summary: NumericSummary,
): number {
  if (
    !summary.logSupported ||
    summary.min <= 0 ||
    summary.max <= 0 ||
    summary.min === summary.max
  ) {
    return 0.5;
  }
  const geometricMidpoint = Math.sqrt(lowerBound * upperBound);
  const minLog = Math.log10(summary.min);
  const maxLog = Math.log10(summary.max);
  return clamp01((Math.log10(geometricMidpoint) - minLog) / (maxLog - minLog));
}

function getQuantileColorPositions(counts: number[], totalCount: number): number[] {
  if (counts.length === 0) return [];
  if (counts.length === 1 || totalCount <= 0) return [0.5];

  let cumulative = 0;
  const positions = counts.map((count) => {
    const lower = cumulative / totalCount;
    cumulative += count;
    const upper = cumulative / totalCount;
    return clamp01((lower + upper) / 2);
  });
  positions[0] = 0;
  positions[positions.length - 1] = 1;
  return positions;
}

function createColorPositions(
  strategy: NumericBinningStrategy,
  bins: NumericBinDefinition[],
  summary: NumericSummary,
): number[] {
  if (bins.length === 0) return [];
  if (bins.length === 1) return [0.5];

  if (strategy === 'quantile') {
    return getQuantileColorPositions(
      bins.map((bin) => bin.count),
      bins.reduce((sum, bin) => sum + bin.count, 0),
    );
  }

  const positions = bins.map((bin) =>
    strategy === 'logarithmic'
      ? getLogarithmicColorPosition(bin.lowerBound, bin.upperBound, summary)
      : getLinearColorPosition(bin.lowerBound, bin.upperBound, summary),
  );
  positions[0] = 0;
  positions[positions.length - 1] = 1;
  return positions;
}

function createBinColors(
  paletteId: string,
  positions: number[],
  reverseGradient: boolean,
): string[] {
  return positions.map((position) =>
    sampleColorSchemeColor(paletteId, reverseGradient ? 1 - position : position),
  );
}

export function materializeNumericAnnotation(
  values: Array<number | null | undefined>,
  settings: NumericAnnotationDisplaySettings,
  numericType?: NumericAnnotationType,
): {
  annotation: Annotation;
  annotationData: Int32Array;
} {
  const summary = createSummary(values, {
    includeSortedValues: settings.strategy === 'quantile',
  });
  const resolvedNumericType = numericType ?? (summary.allIntegers ? 'int' : 'float');
  // Reserve one slot for N/A when missing values exist, so the total
  // (numeric bins + N/A) fits within the requested binCount.
  const hasMissingValues = summary.nonNullCount < values.length;
  const effectiveBinCount =
    hasMissingValues && settings.binCount > 1 ? settings.binCount - 1 : settings.binCount;
  const effectiveSettings = {
    ...settings,
    binCount: effectiveBinCount,
    strategy: resolveEffectiveStrategy(settings.strategy, summary, effectiveBinCount),
    paletteId: normalizeNumericPaletteId(settings.paletteId),
    reverseGradient: settings.reverseGradient,
  };

  if (summary.nonNullCount === 0) {
    const emptyTopologySignature = createTopologySignature(effectiveSettings.strategy, []);
    return {
      annotation: {
        kind: 'categorical',
        values: [],
        colors: [],
        shapes: [],
        sourceKind: 'numeric',
        numericType: resolvedNumericType,
        numericMetadata: {
          strategy: effectiveSettings.strategy,
          binCount: 0,
          numericType: resolvedNumericType,
          signature: createSignature(effectiveSettings, []),
          topologySignature: emptyTopologySignature,
          logSupported: summary.logSupported,
          bins: [],
        },
      },
      annotationData: new Int32Array(values.length).fill(-1),
    };
  }

  const edges = createEdges(summary, effectiveSettings);
  const counts = new Array(Math.max(0, edges.length - 1)).fill(0);
  const observedRanges: Array<ObservedBinRange | null> = Array.from(
    { length: counts.length },
    () => null,
  );
  const rawBinIndices = values.map((value) => {
    if (value == null || !Number.isFinite(value)) return -1;
    const binIndex = assignBinIndex(value, edges);
    counts[binIndex] += 1;
    const currentRange = observedRanges[binIndex];
    observedRanges[binIndex] =
      currentRange === null
        ? { min: value, max: value }
        : {
            min: Math.min(currentRange.min, value),
            max: Math.max(currentRange.max, value),
          };
    return binIndex;
  });

  const allBins = counts.map((count, index) => ({
    id: createNumericBinId(effectiveSettings.strategy, edges[index], edges[index + 1]),
    lowerBound: edges[index],
    upperBound: edges[index + 1],
    count,
  }));
  const realizedBounds = allBins.filter((bin) => bin.count > 0);
  const realizedRanges = observedRanges.filter(
    (range): range is ObservedBinRange => range !== null,
  );
  const labels = createObservedBinLabels(
    realizedRanges,
    realizedBounds.map((bin) => ({
      lowerBound: bin.lowerBound,
      upperBound: bin.upperBound,
    })),
    resolvedNumericType,
  );
  const bins: NumericBinDefinition[] = realizedBounds.map((bin, index) => ({
    ...bin,
    label:
      labels[index] ??
      formatRangeLabel(bin.lowerBound, bin.upperBound, (value) =>
        formatNumericValue(value, resolvedNumericType),
      ),
  }));
  const shapes = Array.from({ length: bins.length }, () => 'circle');
  const originalToRealizedIndex = new Map<number, number>();
  for (const [index, bin] of allBins.entries()) {
    if (bin.count > 0) {
      originalToRealizedIndex.set(index, originalToRealizedIndex.size);
    }
  }

  const annotationData = new Int32Array(rawBinIndices.length);
  for (let i = 0; i < rawBinIndices.length; i++) {
    const binIndex = rawBinIndices[i];
    if (binIndex < 0) {
      annotationData[i] = -1;
    } else {
      const realizedIndex = originalToRealizedIndex.get(binIndex);
      annotationData[i] = realizedIndex == null ? -1 : realizedIndex;
    }
  }

  const colorPositions = createColorPositions(effectiveSettings.strategy, bins, summary);
  const colors = createBinColors(
    effectiveSettings.paletteId,
    colorPositions,
    effectiveSettings.reverseGradient,
  );
  const binsWithColorPositions: NumericBinDefinition[] = bins.map((bin, index) => ({
    ...bin,
    colorPosition: colorPositions[index] ?? 0.5,
  }));
  const topologySignature = createTopologySignature(
    effectiveSettings.strategy,
    binsWithColorPositions,
  );

  const numericMetadata: NumericAnnotationMetadata = {
    strategy: effectiveSettings.strategy,
    binCount: bins.length,
    numericType: resolvedNumericType,
    signature: createSignature(effectiveSettings, binsWithColorPositions),
    topologySignature,
    logSupported: summary.logSupported,
    bins: binsWithColorPositions,
  };

  // Append N/A pseudo-bin for missing values so they appear in the legend
  const finalValues = bins.map((bin) => bin.id);
  const finalColors = [...colors];
  const finalShapes = [...shapes];

  // Numeric NA pseudo-bin: color and shape are intentionally LOCKED to defaults.
  // Numeric annotations are palette-driven (no per-item user customization), and
  // NA inherits that contract. The legend processor enforces the lock at render
  // time by ignoring persistedCategories[NA_VALUE] for numeric annotations.
  if (hasMissingValues) {
    const naIndex = finalValues.length;
    finalValues.push(NA_VALUE);
    finalColors.push(NA_DEFAULT_COLOR);
    finalShapes.push('circle');

    for (let i = 0; i < annotationData.length; i++) {
      if (annotationData[i] < 0) annotationData[i] = naIndex;
    }
  }

  return {
    annotation: {
      kind: 'categorical',
      values: finalValues,
      colors: finalColors,
      shapes: finalShapes,
      sourceKind: 'numeric',
      numericType: resolvedNumericType,
      numericMetadata,
    },
    annotationData,
  };
}

export function materializeVisualizationData(
  data: VisualizationData,
  settingsMap: NumericAnnotationDisplaySettingsMap = {},
  defaultBinCount: number = 10,
  selectedNumericAnnotation: string | null = null,
  annotationsToMaterialize?: Iterable<string> | null,
): VisualizationData {
  if (!data.numeric_annotation_data || Object.keys(data.numeric_annotation_data).length === 0) {
    return data;
  }

  const annotations: VisualizationData['annotations'] = {};
  const annotationData: VisualizationData['annotation_data'] = { ...data.annotation_data };
  const requestedAnnotations = annotationsToMaterialize ? new Set(annotationsToMaterialize) : null;

  for (const [annotationName, annotation] of Object.entries(data.annotations)) {
    if (annotation.kind !== 'numeric') {
      annotations[annotationName] = annotation;
      continue;
    }

    const shouldMaterialize = requestedAnnotations
      ? requestedAnnotations.has(annotationName)
      : annotationName === selectedNumericAnnotation;

    if (!shouldMaterialize) {
      annotations[annotationName] = annotation;
      continue;
    }

    const numericValues = data.numeric_annotation_data?.[annotationName] ?? [];
    const materialized = materializeNumericAnnotation(
      numericValues,
      getNumericAnnotationSettings(settingsMap, annotationName, defaultBinCount),
      annotation.numericType ?? annotation.numericMetadata?.numericType,
    );

    annotations[annotationName] = materialized.annotation;
    annotationData[annotationName] = materialized.annotationData;
  }

  return {
    ...data,
    annotations,
    annotation_data: annotationData,
  };
}
