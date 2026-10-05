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
 * Selection/highlight is one `Uint8Array` mark per protein index, filled from
 * the ids through an id index built once per dataset (`IdIndex`).
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
  /**
   * A mark per index into `proteinIds` for exactly the proteins of `ids`, as a
   * lasso builds it from its slots. It stands in for looking the selection up
   * while `selectedProteinIds` holds the same ids in the same order and
   * `proteinIds` is `data.protein_ids`. Never written.
   */
  selectionMask?: {
    ids: readonly string[];
    proteinIds: readonly string[];
    mask: Uint8Array;
  } | null;
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
  /**
   * Whether every protein id occurs once, read off the protein id index (built
   * now if not yet; the first mark builds it anyway). False without data.
   */
  idsUnique(): boolean;
  /**
   * For each of the first `count` slots of plot data with these `proteinIds` and
   * `originalIndices`, 1 when its protein is selected or highlighted, else 0.
   */
  markedSlots(
    proteinIds: readonly string[],
    originalIndices: Int32Array | null,
    count: number,
  ): Uint8Array;
  /**
   * The selection and highlight as one mark: a protein in `markedSlots` has base
   * opacity `marked`, every other one `unmarked`. Null while nothing is marked,
   * and while focus gives the unmarked proteins their opacity by category.
   */
  readonly marks: { readonly marked: number; readonly unmarked: number } | null;
  /** This model with nothing selected, highlighted or focused. */
  readonly unmarked: VisibilityModel;
  /**
   * Changes whenever which points are interactive can: with every opacity tier
   * above 0 only hiding decides it, and this is the hidden mask's stash, the same
   * object while (data, selectedAnnotation, hiddenAnnotationValues) are. With a
   * tier at 0 it is this model.
   */
  readonly interactivityKey: object;
  /**
   * Build the protein id index now instead of on the first mark (an O(N) pass,
   * once per dataset), e.g. while idle after a load. Models computed from this
   * one over the same ids keep it.
   */
  indexIds(): void;
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
  idIndex: IdIndex | null;
}

/**
 * Each protein's index in `proteinIds`: an open-addressing table over the ids'
 * FNV-1a hashes, at most 2/3 full, holding `index + 1` per slot (0 is empty).
 * 4 MB at 573K proteins, where a `Map` held 14 MB of heap. `table` is built on
 * first use (`idTable`), and null when an id repeats.
 */
interface IdIndex {
  proteinIds: readonly string[];
  table?: Int32Array | null;
}

function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 0x01000193);
  return h;
}

function buildIdTable(proteinIds: readonly string[]): Int32Array | null {
  let size = 1;
  while (size < proteinIds.length * 1.5) size *= 2;
  const table = new Int32Array(size);
  for (let i = 0; i < proteinIds.length; i++) {
    const id = proteinIds[i];
    let slot = hashId(id) & (size - 1);
    for (let at = table[slot]; at !== 0; at = table[slot]) {
      if (proteinIds[at - 1] === id) return null;
      slot = (slot + 1) & (size - 1);
    }
    table[slot] = i + 1;
  }
  return table;
}

function idTable(index: IdIndex): Int32Array | null {
  if (index.table === undefined) index.table = buildIdTable(index.proteinIds);
  return index.table;
}

/** The index of `id` in the `proteinIds` that `table` was built over, or -1. */
function findId(table: Int32Array, proteinIds: readonly string[], id: string): number {
  let slot = hashId(id) & (table.length - 1);
  for (let at = table[slot]; at !== 0; at = table[slot]) {
    if (proteinIds[at - 1] === id) return at - 1;
    slot = (slot + 1) & (table.length - 1);
  }
  return -1;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

  const hasSelection = selectedProteinIds.length > 0;
  const anyMarked = hasSelection || highlightedProteinIds.length > 0;
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

  // The id index, kept from `previous` while the ids are the same array. Its
  // table is built the first time something is marked, or ahead by `indexIds`
  // (an O(N) pass, once per dataset).
  const proteinIds = data?.protein_ids ?? null;
  const prevIndex = prevCache?.idIndex ?? null;
  const idIndex: IdIndex | null =
    prevIndex?.proteinIds === proteinIds ? prevIndex : proteinIds ? { proteinIds } : null;

  // The selected and highlighted proteins by index into `proteinIds`, so a point
  // costs a byte read rather than set lookups.
  let markedMask: Uint8Array | null = null;
  const table = anyMarked && idIndex ? idTable(idIndex) : null;
  if (table && proteinIds) {
    // With every id once (a table), a mask of the selected ids is the selection's.
    const given = inputs.selectionMask;
    const fromSlots = given?.proteinIds === proteinIds && sameIds(given.ids, selectedProteinIds);
    let lookups = [selectedProteinIds, highlightedProteinIds];
    if (!fromSlots) markedMask = new Uint8Array(proteinIds.length);
    else {
      markedMask = highlightedProteinIds.length ? given.mask.slice() : given.mask;
      lookups = [highlightedProteinIds];
    }
    for (const ids of lookups) {
      for (const id of ids) {
        const i = findId(table, proteinIds, id);
        if (i >= 0) markedMask[i] = 1;
      }
    }
  }
  // For the points the mask cannot answer: no data, a repeated id, or an index
  // that does not hold the point's id.
  let markedIds: Set<string> | null = null;
  const isMarked = (originalIndex: number, id: string): boolean => {
    if (markedMask && proteinIds![originalIndex] === id) return markedMask[originalIndex] === 1;
    markedIds ??= new Set([...selectedProteinIds, ...highlightedProteinIds]);
    return markedIds.has(id);
  };

  const baseOpacityAt = (originalIndex: number, id: string): number => {
    if (anyMarked) {
      if (isMarked(originalIndex, id)) return opacities.selected;
      if (hasSelection) return opacities.faded;
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

  const markedSlots = (
    slotIds: readonly string[],
    originalIndices: Int32Array | null,
    count: number,
  ): Uint8Array => {
    const slots = new Uint8Array(count);
    if (!anyMarked) return slots;
    if (markedMask && slotIds === proteinIds) {
      for (let s = 0; s < count; s++)
        slots[s] = markedMask[originalIndices ? originalIndices[s] : s];
      return slots;
    }
    for (let s = 0; s < count; s++) {
      const i = originalIndices ? originalIndices[s] : s;
      if (isMarked(i, slotIds[i])) slots[s] = 1;
    }
    return slots;
  };

  // A selection fades the rest whatever the focus; a highlight alone leaves it to focus.
  const marks =
    anyMarked && (hasSelection || !unfocusedMask)
      ? { marked: opacities.selected, unmarked: hasSelection ? opacities.faded : opacities.base }
      : null;
  let unmarked: VisibilityModel | null = null;

  // Mask-relevant inputs + the mask, which a later call reuses on a
  // selection/highlight/opacity-only change; `previous`'s own while they hold.
  const maskCache: MaskCache =
    canReuse && prevCache.idIndex === idIndex
      ? prevCache
      : {
          data,
          selectedAnnotation,
          hiddenAnnotationValues,
          allHidden,
          hiddenMode,
          hiddenMask,
          idIndex,
        };
  const tiersInteractive = opacities.base > 0 && opacities.selected > 0 && opacities.faded > 0;

  const model: VisibilityModel = {
    allHidden,
    opacityOf,
    baseOpacityOf,
    isInteractive,
    opacityAt,
    baseOpacityAt,
    isHiddenAt,
    hidesValues,
    idsUnique: () => idIndex !== null && idTable(idIndex) !== null,
    markedSlots,
    marks,
    get unmarked() {
      unmarked ??=
        anyMarked || focusedValues
          ? computeVisibilityModel(
              { ...inputs, selectedProteinIds: [], highlightedProteinIds: [], focusedValues: null },
              model,
            )
          : model;
      return unmarked;
    },
    indexIds() {
      if (idIndex) idTable(idIndex);
    },
    get interactivityKey() {
      return tiersInteractive ? maskCache : model;
    },
  };

  // Stashed non-enumerably so a later call can reuse the O(N) pass.
  Object.defineProperty(model, MASK_CACHE, {
    value: maskCache,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return model;
}
