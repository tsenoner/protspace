/**
 * Pure point-visibility model.
 *
 * Single authority for per-point display state (tier, opacity, base opacity,
 * interactivity). Pure and side-effect free: no DOM, no WebGL, no Lit — safe to
 * import under jsdom and from workers.
 *
 * This module is the SINGLE authority for those opacity semantics:
 * `style-getters.ts` delegates to it (`getBaseOpacity = visibility.baseOpacityOf`,
 * `getOpacity = visibility.opacityOf`), so there is no second implementation to
 * keep in lockstep. The authoritative contract is the design D5 table in
 * `openspec/changes/unified-visibility-model/design.md`. Subtleties preserved on
 * purpose:
 *
 *   - Hidden ⇒ opacity exactly `0` (consumers agree only at exact 0).
 *   - Hidden beats selected/highlighted.
 *   - Multilabel point hidden iff EVERY value is hidden (`.every`), so a point
 *     with zero values is vacuously hidden (`[].every()` is `true`).
 *   - `computeAllHidden`'s asymmetry: the all-hidden set is built from RAW
 *     `hiddenAnnotationValues` while the annotation values it compares against
 *     are normalized via `toInternalValue`. Replicated as-is (NOT "fixed").
 *   - When the selected annotation / its `annotation_data` rows are missing,
 *     `getProteinAnnotationValues` returns `[]` for every point, so (unless the
 *     all-hidden hatch fires) every point is vacuously hidden. Replicated.
 *   - `baseOpacityOf` ignores hidden entirely (it feeds depth sorting).
 *   - `isInteractive` is numeric (`opacityOf(point) > 0`), so a configured
 *     `fadedOpacity` of 0 makes faded points non-interactive.
 *
 * Performance (design D3): the hidden mask is one allocation-free pass over
 * `annotation_data` into a `Uint8Array` indexed by GLOBAL `originalIndex`, using
 * a precomputed per-bin lookup over `annotation.values`. No
 * `getProteinAnnotationValues` calls, no per-point string/array allocation.
 * Selection/fade is answered by `Set` membership per call — no O(N) selection
 * array.
 */

import type {
  Annotation,
  AnnotationData,
  PlotDataPoint,
  VisualizationData,
} from '@protspace/utils';
import {
  NA_VALUE,
  isCsrAnnotationData,
  isSparseMultiValueAnnotationData,
  toInternalValue,
} from '@protspace/utils';

export interface VisibilityInputs {
  /** MATERIALIZED, un-query-filtered display data (keeps global indices). */
  data: VisualizationData | null;
  selectedAnnotation: string;
  /** Raw legend-hidden values; normalized via `toInternalValue` internally. */
  hiddenAnnotationValues: string[];
  selectedProteinIds: string[];
  highlightedProteinIds: string[];
  opacities: { base: number; selected: number; faded: number };
  /** Internal values to keep in focus (Shift+hover); every other point fades. */
  focusedValues?: string[] | null;
}

export interface VisibilityModel {
  /** True when every value of the selected annotation is hidden (escape hatch). */
  allHidden: boolean;
  /** Render opacity — exactly `0` for hidden (load-bearing). */
  opacityOf(point: PlotDataPoint): number;
  /** Base opacity, ignoring hidden — feeds depth sorting. */
  baseOpacityOf(point: PlotDataPoint): number;
  /** Interactivity ≡ `opacityOf(point) > 0` (numeric, not tier-based). */
  isInteractive(point: PlotDataPoint): boolean;
  /**
   * `opacityOf` for the protein at global `originalIndex` with id `id`: 0 when
   * `isHiddenAt`, otherwise `baseOpacityAt`. The staging loops call these index
   * forms so they need no point object.
   */
  opacityAt(originalIndex: number, id: string): number;
  /** `baseOpacityOf` by index; see {@link opacityAt}. */
  baseOpacityAt(originalIndex: number, id: string): number;
  /** Whether the legend hides the protein at `originalIndex` (opacity exactly 0). */
  isHiddenAt(originalIndex: number): boolean;
  /**
   * `isHiddenAt` for any protein whose selected-annotation values are `values`,
   * normalized with `toInternalValue` (`[]` for no value, `'__NA__'` for a code
   * that names no value). Lets a caller hide a whole category at once.
   */
  hidesValues(values: readonly string[]): boolean;
}

/**
 * The single implementation of the all-hidden escape hatch. Note the deliberate
 * asymmetry: the hidden set is built from RAW strings while the annotation
 * values it tests are normalized.
 */
function computeAllHidden(
  data: VisualizationData | null,
  selectedAnnotation: string,
  hiddenAnnotationValues: string[],
): boolean {
  if (!data || !selectedAnnotation) return false;
  const annotation = data.annotations[selectedAnnotation];
  if (!annotation || !Array.isArray(annotation.values)) return false;
  const hidden = new Set(hiddenAnnotationValues);
  if (hidden.size === 0) return false;
  const normalizedKeys = annotation.values.map((v) => toInternalValue(v));
  return normalizedKeys.length > 0 && normalizedKeys.every((k) => hidden.has(k));
}

/**
 * One allocation-free pass over `annotation_data` → per-point hidden `Uint8Array`
 * indexed by global `originalIndex`. Caller guarantees `annotation` and
 * `annotationRows` are valid and the all-hidden hatch is NOT active.
 */
function buildHiddenMask(
  data: VisualizationData,
  annotation: Annotation,
  annotationRows: AnnotationData,
  hiddenAnnotationValues: string[],
): Uint8Array {
  const n = data.protein_ids.length;
  const hiddenKeysSet = new Set(hiddenAnnotationValues.map((v) => toInternalValue(v)));

  // Per-bin hidden lookup over annotation.values (≤ a few hundred entries).
  const values = annotation.values;
  const binHidden = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    binHidden[i] = hiddenKeysSet.has(toInternalValue(values[i])) ? 1 : 0;
  }
  // Out-of-range bin index resolves to `annotation.values[b] === undefined`,
  // i.e. `toInternalValue(undefined) === '__NA__'` — match that fallback.
  const naHidden = hiddenKeysSet.has('__NA__') ? 1 : 0;
  const isBinHidden = (b: number): number =>
    b >= 0 && b < binHidden.length ? binHidden[b] : naHidden;

  const mask = new Uint8Array(n);

  if (annotationRows instanceof Int32Array) {
    const len = annotationRows.length;
    for (let i = 0; i < n; i++) {
      // i >= len → accessor returns [] → vacuously hidden; sentinel < 0 likewise.
      if (i >= len) {
        mask[i] = 1;
        continue;
      }
      const v = annotationRows[i];
      mask[i] = v < 0 ? 1 : isBinHidden(v);
    }
  } else if (isSparseMultiValueAnnotationData(annotationRows)) {
    const len = annotationRows.length;
    for (let i = 0; i < n; i++) {
      if (i >= len) {
        mask[i] = 1;
        continue;
      }
      const override = annotationRows.overrides.get(i);
      if (!override) {
        const value = annotationRows.base[i];
        mask[i] = value < 0 ? 1 : isBinHidden(value);
        continue;
      }
      let everyHidden = 1;
      for (let k = 0; k < override.length; k++) {
        if (isBinHidden(override[k]) === 0) {
          everyHidden = 0;
          break;
        }
      }
      mask[i] = everyHidden;
    }
  } else if (isCsrAnnotationData(annotationRows)) {
    const { offsets, codes, length: len } = annotationRows;
    for (let i = 0; i < n; i++) {
      if (i >= len) {
        mask[i] = 1;
        continue;
      }
      const stop = offsets[i + 1];
      let everyHidden = 1;
      // Empty row (start === stop) leaves this 1 — vacuously hidden, as `[].every()`.
      for (let k = offsets[i]; k < stop; k++) {
        if (isBinHidden(codes[k]) === 0) {
          everyHidden = 0;
          break;
        }
      }
      mask[i] = everyHidden;
    }
  } else {
    const len = annotationRows.length;
    for (let i = 0; i < n; i++) {
      if (i >= len) {
        mask[i] = 1;
        continue;
      }
      const row = annotationRows[i];
      const rlen = row.length;
      // Empty row → vacuously hidden.
      let everyHidden = 1;
      if (rlen === 0) {
        everyHidden = 1;
      } else {
        for (let k = 0; k < rlen; k++) {
          if (isBinHidden(row[k]) === 0) {
            everyHidden = 0;
            break;
          }
        }
      }
      mask[i] = everyHidden;
    }
  }

  return mask;
}

/**
 * The hidden mask is the only O(N) part of the model. It depends solely on
 * (data, selectedAnnotation, hiddenAnnotationValues) — NOT on selection,
 * highlight, or opacities. To let callers reuse it across selection-only
 * changes, `computeVisibilityModel` accepts a `previous` model and stashes the
 * mask-relevant inputs + the computed mask on the returned model under a
 * non-enumerable symbol (no module-level mutable state, so the module stays
 * pure). When `previous`'s stash matches the new mask-relevant inputs by
 * reference, the prior mask is reused and the O(N) pass is skipped.
 */
const MASK_CACHE: unique symbol = Symbol('visibilityMaskCache');

interface MaskCache {
  data: VisualizationData | null;
  selectedAnnotation: string;
  hiddenAnnotationValues: string[];
  allHidden: boolean;
  hiddenMode: 'none' | 'all' | 'mask';
  hiddenMask: Uint8Array | null;
}

interface InternalVisibilityModel extends VisibilityModel {
  [MASK_CACHE]: MaskCache;
}

export function computeVisibilityModel(
  inputs: VisibilityInputs,
  previous?: VisibilityModel,
): VisibilityModel {
  const {
    data,
    selectedAnnotation,
    hiddenAnnotationValues,
    selectedProteinIds,
    highlightedProteinIds,
    opacities,
  } = inputs;

  const selectedIdsSet = new Set(selectedProteinIds);
  const highlightedIdsSet = new Set(highlightedProteinIds);
  const hasSelection = selectedProteinIds.length > 0;
  const focusedValues = inputs.focusedValues ?? null;

  // Reuse the prior hidden mask iff the mask-relevant inputs are reference-equal.
  let allHidden: boolean;
  // Hidden enforcement mode:
  //   'none' → no hidden filter (no data/annotation, or all-hidden hatch active)
  //   'all'  → every point vacuously hidden (annotation/rows/values invalid)
  //   'mask' → per-point Uint8Array lookup
  let hiddenMode: 'none' | 'all' | 'mask';
  let hiddenMask: Uint8Array | null;

  const prevCache = previous
    ? (previous as Partial<InternalVisibilityModel>)[MASK_CACHE]
    : undefined;
  const canReuse =
    !!prevCache &&
    prevCache.data === data &&
    prevCache.selectedAnnotation === selectedAnnotation &&
    prevCache.hiddenAnnotationValues === hiddenAnnotationValues;

  if (canReuse) {
    allHidden = prevCache.allHidden;
    hiddenMode = prevCache.hiddenMode;
    hiddenMask = prevCache.hiddenMask;
  } else {
    allHidden = computeAllHidden(data, selectedAnnotation, hiddenAnnotationValues);
    hiddenMode = 'none';
    hiddenMask = null;
    if (data && selectedAnnotation && !allHidden) {
      const annotation = data.annotations[selectedAnnotation];
      const annotationRows = data.annotation_data?.[selectedAnnotation];
      if (!annotation || !annotationRows || !Array.isArray(annotation.values)) {
        // getProteinAnnotationValues returns [] for every point → vacuously hidden.
        hiddenMode = 'all';
      } else {
        hiddenMode = 'mask';
        hiddenMask = buildHiddenMask(data, annotation, annotationRows, hiddenAnnotationValues);
      }
    }
  }

  const isHiddenAt = (idx: number): boolean => {
    if (hiddenMode === 'none') return false;
    if (hiddenMode === 'all') return true;
    // Out-of-range index → accessor returns [] → vacuously hidden.
    // The mask is sized to protein_ids.length, which equals annotationRows.length under the materialized-data invariant.
    if (idx < 0 || idx >= hiddenMask!.length) return true; // hiddenMode === 'mask' guarantees non-null
    return hiddenMask![idx] === 1; // hiddenMode === 'mask' guarantees non-null
  };

  // The mask's per-bin test, applied to values instead of codes.
  let hiddenKeys: Set<string> | null = null;
  const hidesValues = (values: readonly string[]): boolean => {
    if (hiddenMode === 'none') return false;
    if (hiddenMode === 'all') return true;
    hiddenKeys ??= new Set(hiddenAnnotationValues.map((v) => toInternalValue(v)));
    for (const v of values) if (!hiddenKeys.has(v)) return false;
    return true; // every value hidden, vacuously for none
  };

  // Out-of-focus mask: the hidden-mask pass with every value except the focused
  // ones treated as "hidden", so a point fades iff none of its values is focused.
  let unfocusedMask: Uint8Array | null = null;
  const annotation = data?.annotations[selectedAnnotation];
  const annotationRows = data?.annotation_data?.[selectedAnnotation];
  if (focusedValues && data && annotation && annotationRows && Array.isArray(annotation.values)) {
    const focused = new Set(focusedValues);
    const others = annotation.values.map((v) => toInternalValue(v)).filter((k) => !focused.has(k));
    if (!focused.has(NA_VALUE)) others.push(NA_VALUE);
    unfocusedMask = buildHiddenMask(data, annotation, annotationRows, others);
  }

  // With neither set populated the two lookups below cannot match, and staging
  // asks once per point.
  const anyMarked = selectedIdsSet.size > 0 || highlightedIdsSet.size > 0;

  const baseOpacityAt = (originalIndex: number, id: string): number => {
    if (anyMarked) {
      const isSelected = selectedIdsSet.has(id);
      const isHighlighted = highlightedIdsSet.has(id);
      if (isSelected || isHighlighted) return opacities.selected;
      if (hasSelection && !isSelected) return opacities.faded;
    }
    // Focus renders like a selection: focused points on top, the rest flat-faded.
    if (unfocusedMask) {
      return unfocusedMask[originalIndex] === 1 ? opacities.faded : opacities.selected;
    }
    return opacities.base;
  };

  const opacityAt = (originalIndex: number, id: string): number => {
    if (isHiddenAt(originalIndex)) return 0;
    return baseOpacityAt(originalIndex, id);
  };

  const baseOpacityOf = (point: PlotDataPoint): number =>
    baseOpacityAt(point.originalIndex, point.id);
  const opacityOf = (point: PlotDataPoint): number => opacityAt(point.originalIndex, point.id);
  const isInteractive = (point: PlotDataPoint): boolean => opacityOf(point) > 0;

  const model: VisibilityModel = {
    allHidden,
    opacityOf,
    baseOpacityOf,
    isInteractive,
    opacityAt,
    baseOpacityAt,
    isHiddenAt,
    hidesValues,
  };

  // Stash mask-relevant inputs + the mask non-enumerably so a later call can
  // reuse the O(N) pass on selection/highlight/opacity-only changes.
  Object.defineProperty(model, MASK_CACHE, {
    value: {
      data,
      selectedAnnotation,
      hiddenAnnotationValues,
      allHidden,
      hiddenMode,
      hiddenMask,
    } satisfies MaskCache,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return model;
}
