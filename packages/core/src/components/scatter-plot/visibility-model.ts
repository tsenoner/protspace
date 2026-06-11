/**
 * Pure point-visibility model.
 *
 * Single authority for per-point display state (tier, opacity, base opacity,
 * interactivity). Pure and side-effect free: no DOM, no WebGL, no Lit — safe to
 * import under jsdom and from workers.
 *
 * This module replicates the opacity semantics of `createStyleGetters`
 * (`style-getters.ts` — `computeAllHidden`, `getBaseOpacity`, `getOpacity`)
 * BIT-FOR-BIT. The authoritative contract is the design D5 table in
 * `openspec/changes/unified-visibility-model/design.md`; the decisive reference
 * is the current code, not intuition. Subtleties preserved on purpose:
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
import { toInternalValue } from '@protspace/utils';

export type DisplayTier = 'hidden' | 'faded' | 'base' | 'selected';

export interface VisibilityInputs {
  /** MATERIALIZED, un-query-filtered display data (keeps global indices). */
  data: VisualizationData | null;
  selectedAnnotation: string;
  /** Raw legend-hidden values; normalized via `toInternalValue` internally. */
  hiddenAnnotationValues: string[];
  selectedProteinIds: string[];
  highlightedProteinIds: string[];
  opacities: { base: number; selected: number; faded: number };
}

export interface VisibilityModel {
  /** True when every value of the selected annotation is hidden (escape hatch). */
  allHidden: boolean;
  /** Display tier — hidden beats selected. Convenience view; never collapses selected into base. */
  tierOf(point: PlotDataPoint): DisplayTier;
  /** Render opacity — exactly `0` for hidden (load-bearing). */
  opacityOf(point: PlotDataPoint): number;
  /** Base opacity, ignoring hidden — feeds depth sorting. */
  baseOpacityOf(point: PlotDataPoint): number;
  /** Interactivity ≡ `opacityOf(point) > 0` (numeric, not tier-based). */
  isInteractive(point: PlotDataPoint): boolean;
}

/**
 * Exact replica of `createStyleGetters`' `computeAllHidden`. Note the deliberate
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

  const isHidden = (point: PlotDataPoint): boolean => {
    if (hiddenMode === 'none') return false;
    if (hiddenMode === 'all') return true;
    const idx = point.originalIndex;
    // Out-of-range index → accessor returns [] → vacuously hidden.
    // The mask is sized to protein_ids.length, which equals annotationRows.length under the materialized-data invariant.
    if (idx < 0 || idx >= hiddenMask!.length) return true; // hiddenMode === 'mask' guarantees non-null
    return hiddenMask![idx] === 1; // hiddenMode === 'mask' guarantees non-null
  };

  const baseOpacityOf = (point: PlotDataPoint): number => {
    const isSelected = selectedIdsSet.has(point.id);
    const isHighlighted = highlightedIdsSet.has(point.id);
    if (isSelected || isHighlighted) return opacities.selected;
    if (hasSelection && !isSelected) return opacities.faded;
    return opacities.base;
  };

  const opacityOf = (point: PlotDataPoint): number => {
    if (isHidden(point)) return 0;
    return baseOpacityOf(point);
  };

  const tierOf = (point: PlotDataPoint): DisplayTier => {
    if (isHidden(point)) return 'hidden';
    const isSelected = selectedIdsSet.has(point.id);
    if (isSelected || highlightedIdsSet.has(point.id)) return 'selected';
    if (hasSelection && !isSelected) return 'faded';
    return 'base';
  };

  const isInteractive = (point: PlotDataPoint): boolean => opacityOf(point) > 0;

  const model: VisibilityModel = {
    allHidden,
    tierOf,
    opacityOf,
    baseOpacityOf,
    isInteractive,
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
