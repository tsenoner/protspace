import {
  conditionsForReliability,
  createCondition,
  evaluateQuery,
  findConditionsForAnnotation,
  hasConfiguredCondition,
  queryChanges,
  reliabilityFromConditions,
  replaceConditionsForAnnotation,
  sameConditions,
  type FilterQuery,
  type ProtspaceEatPanel,
  type ProtspaceQueryBuilder,
  type ProtspaceScatterplot,
} from '@protspace/core';
import {
  DEFAULT_EAT_RELIABILITY,
  isEatConfidenceAnnotation,
  isSameReliability,
  type EatReliabilityInput,
  type EatReliabilityState,
  type VisualizationData,
} from '@protspace/utils';
import { pickableAnnotations } from './view-bar-controller';
import { setWorkbenchStatus } from './workbench-status';

/**
 * A filter as the plot holds it: the query that produced it and the protein ids it keeps, by
 * reference. `matchedIds` null: nothing is filtered (no query, or one that matches nothing, #380).
 */
export interface FilterSnapshot {
  query: FilterQuery;
  matchedIds: readonly string[] | null;
}

/** An applied filter changed through the panel or the chip: what undo records (Task 4.6). */
export interface FilterCommit {
  before: FilterSnapshot;
  after: FilterSnapshot;
  cause: 'apply' | 'reset' | 'clear';
}

interface FilterControllerOptions {
  plotElement: ProtspaceScatterplot;
  /** The EAT panel, which follows the applied filter's reliability condition. */
  eatPanel: Pick<ProtspaceEatPanel, 'setReliabilityState'>;
  queryBuilder: ProtspaceQueryBuilder;
  /** Where `annotation-change` is heard; the document in the app. */
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  /** Whether the Filter panel is on screen: the builder counts only then. */
  isPanelShown(): boolean;
  /** Calls `listener` whenever `isPanelShown()` may have changed. */
  subscribePanel(listener: () => void): () => void;
  /** An Apply, a Reset or a removal changed the applied filter. */
  onFilterCommitted?(commit: FilterCommit): void;
}

export interface FilterController {
  /** The colouring annotation changed: move the reliability control to its column's state. */
  setSelectedAnnotation(annotation: string): void;
  /** The EAT panel's reliability filter: replaces its base's condition and applies the filter. */
  setEatReliability(baseKey: string, state: EatReliabilityInput): void;
  /**
   * Proteins that pass the applied filter without the selected base's reliability condition, as a
   * 0/1 mask over the snapshot's protein indices; null when no other condition constrains anything.
   * Cached: a new mask only when that reduced query or the snapshot changes.
   */
  getContextMask(): Uint8Array | null;
  /**
   * The reliability conditions the applied filter holds for annotations other than the selected
   * one, by base annotation: what a Color by switch leaves behind.
   */
  getOtherEatReliabilities(): { annotation: string; reliability: EatReliabilityState }[];
  /** The filter chip's ✕: removes the applied filter; a dirty draft keeps its edits. */
  clear(): void;
  /**
   * Undo and redo: makes `snapshot` the applied filter as it was, without evaluating, except that
   * the EAT reliability conditions stay as they are now (re-evaluated when they differ).
   */
  restore(snapshot: FilterSnapshot): void;
  getApplied(): FilterSnapshot;
  /** A new dataset has other proteins, so the filter, the draft and the mirror record go. */
  resetForNewDataset(): void;
  dispose(): void;
}

const NO_FILTER: FilterSnapshot = { query: [], matchedIds: null };

/** Leaf conditions that constrain something: a group counts its own, an empty row counts 0. */
function countConfigured(items: FilterQuery): number {
  let count = 0;
  for (const item of items) {
    if ('conditions' in item) count += countConfigured(item.conditions);
    else if (hasConfiguredCondition([item])) count += 1;
  }
  return count;
}

/**
 * The filter the sidebar's Filter panel builds (design decision 14).
 *
 * The panel edits a draft; Apply makes it the applied filter, Cancel returns the draft to it, and
 * Reset or the chip's ✕ removes it. A filter applies through the plot's filter channel
 * (`filteredProteinIds`, `filtersActive`), which is idempotent: a filter is neither a selection
 * nor an isolation (#257). Matched indices are positions in the materialized snapshot the builder
 * evaluated, never in the isolated subset `getCurrentData()` returns.
 *
 * The EAT panel's reliability filter writes the applied filter at once and also updates the
 * draft: a clean draft follows the applied filter, a dirty one gets only that column's condition.
 * The applied filter moves the panel back, per eat-confidence column (#6b, #380); both
 * directions compare against the last state recorded for that column, so they cannot ping-pong.
 */
export function createFilterController({
  plotElement,
  eatPanel,
  queryBuilder,
  root,
  isPanelShown,
  subscribePanel,
  onFilterCommitted,
}: FilterControllerOptions): FilterController {
  let applied: FilterSnapshot = NO_FILTER;
  /** The empty row a fresh panel shows; the draft is clean while it equals it and nothing applies. */
  let seed: FilterQuery = [createCondition()];
  let draft: FilterQuery = seed;
  let selectedAnnotation = '';
  /** The materialized snapshot the builder evaluates; refreshed on every plot data-change. */
  let snapshot: VisualizationData | undefined;
  let shown = isPanelShown();
  const lastMirrored = new Map<string, EatReliabilityState>();
  /** The last context mask and what it was computed from. */
  let context: {
    query: FilterQuery;
    snapshot: VisualizationData | undefined;
    mask: Uint8Array | null;
  } | null = null;

  const readSnapshot = (): VisualizationData | undefined =>
    plotElement.getMaterializedData() ?? plotElement.getCurrentData() ?? snapshot;

  /** What a clean draft equals: the applied query, or the seed while none is applied. */
  const baseline = (): FilterQuery => (applied.query.length > 0 ? applied.query : seed);
  /** Incomplete rows do not count: an empty condition added or removed leaves the draft clean. */
  const isDirty = () => queryChanges(draft, baseline()).count > 0;

  const publish = () =>
    setWorkbenchStatus({
      appliedFilterConditions: applied.matchedIds ? countConfigured(applied.query) : 0,
      unappliedFilterChanges: queryChanges(draft, baseline()).count,
    });

  /**
   * The builder re-counts the whole dataset whenever its data or query changes, so it gets them
   * only while the panel shows it; becoming shown hands it the latest.
   */
  const syncBuilder = () => {
    publish();
    if (!isPanelShown()) return;
    if (queryBuilder.data !== snapshot) {
      queryBuilder.annotations = pickableAnnotations(snapshot);
      queryBuilder.data = snapshot;
    }
    queryBuilder.query = draft;
    queryBuilder.appliedQuery = baseline();
    queryBuilder.dirty = isDirty();
  };

  /**
   * Writes `ids` to the plot's filter channel, or releases it. Releases only when something is
   * set: a fresh `[]` over an empty one still rebuilds the plot's geometry.
   */
  const writeChannel = (ids: readonly string[] | null) => {
    if (ids) {
      // The snapshot's own array: undo writes back the ids it recorded, never a copy.
      plotElement.filteredProteinIds = ids as string[];
      plotElement.filtersActive = true;
    } else if (plotElement.filtersActive || (plotElement.filteredProteinIds?.length ?? 0) > 0) {
      plotElement.filteredProteinIds = [];
      plotElement.filtersActive = false;
    }
  };

  const setApplied = (next: FilterSnapshot) => {
    applied = next;
    writeChannel(next.matchedIds);
    publish();
  };

  /** The ids at `indices` in the snapshot; null for none (#380: the plot stays unfiltered). */
  const idsAt = (indices: Iterable<number>, proteinIds: readonly string[]): string[] | null => {
    // One pass, no intermediates: this runs on every slider commit at Swiss-Prot scale.
    const matched: string[] = [];
    for (const index of indices) {
      const id = proteinIds[index];
      if (id !== undefined) matched.push(id);
    }
    return matched.length > 0 ? matched : null;
  };

  /** Evaluates `query` on the snapshot and makes it the applied filter. */
  const applyQuery = (query: FilterQuery) => {
    const proteinIds = snapshot?.protein_ids;
    if (!snapshot || !proteinIds || !hasConfiguredCondition(query)) {
      setApplied({ query, matchedIds: null });
      return;
    }
    setApplied({ query, matchedIds: idsAt(evaluateQuery(query, snapshot), proteinIds) });
  };

  /** The snapshot's eat-confidence columns, each with the annotation it rates. */
  const eatColumns = (): { key: string; base: string | undefined }[] =>
    Object.entries(snapshot?.annotations ?? {})
      .filter(([, annotation]) => isEatConfidenceAnnotation(annotation))
      .map(([key, annotation]) => ({ key, base: annotation.runtime?.baseAnnotation }));

  /** The eat-confidence column whose runtime base is `baseKey`, if any. */
  const findEatKey = (baseKey: string): string | undefined =>
    eatColumns().find((column) => column.base === baseKey)?.key;

  /**
   * Reverse mirror: tells the EAT panel what the applied filter says for the selected base. `force`
   * repositions the control after an annotation change even when this base's state is unchanged.
   */
  const mirrorToPanel = (force = false) => {
    const key = findEatKey(selectedAnnotation);
    if (!key) {
      // Nothing on this annotation to follow: the panel shows its resting position.
      if (force) eatPanel.setReliabilityState(DEFAULT_EAT_RELIABILITY);
      return;
    }
    const derived = reliabilityFromConditions(findConditionsForAnnotation(applied.query, key));
    // No record yet: nothing moved this column off its resting position, which the panel shows.
    const last = lastMirrored.get(key) ?? DEFAULT_EAT_RELIABILITY;
    if (!force && isSameReliability(last, derived)) return;
    lastMirrored.set(key, derived);
    eatPanel.setReliabilityState(derived);
  };

  const setSelectedAnnotation = (annotation: string) => {
    if (annotation === selectedAnnotation) return;
    selectedAnnotation = annotation;
    snapshot = readSnapshot();
    mirrorToPanel(true);
  };

  /** The draft edits nothing on screen: no plot, no EAT panel, until Apply. */
  const onQueryChanged = (event: Event) => {
    draft = (event as CustomEvent<{ query: FilterQuery }>).detail.query;
    syncBuilder();
  };

  const onQueryApply = (event: Event) => {
    const proteinIds = snapshot?.protein_ids;
    if (!proteinIds) return;
    const before = applied;
    const { matchedIndices } = (event as CustomEvent<{ matchedIndices: Set<number> }>).detail;
    setApplied({ query: draft, matchedIds: idsAt(matchedIndices, proteinIds) });
    mirrorToPanel();
    // The panel stays: the draft is now clean and Apply says there is nothing new.
    syncBuilder();
    onFilterCommitted?.({ before, after: applied, cause: 'apply' });
  };

  const onQueryCancel = () => {
    draft = baseline();
    syncBuilder();
  };

  const onQueryReset = () => {
    const before = applied;
    setApplied(NO_FILTER);
    draft = seed;
    // A full reset drops any reliability condition too: pull the panel's control back.
    mirrorToPanel();
    syncBuilder();
    if (before.query.length > 0) onFilterCommitted?.({ before, after: applied, cause: 'reset' });
  };

  const onAnnotationChange = (event: Event) => {
    const annotation = (event as CustomEvent<{ annotation?: unknown }>).detail?.annotation;
    if (typeof annotation === 'string') setSelectedAnnotation(annotation);
  };

  const onDataChange = (event: Event) => {
    const data = (event as CustomEvent<{ data?: VisualizationData | null }>).detail?.data;
    if (!data) return;
    snapshot = readSnapshot();
    syncBuilder();
  };

  /** The layout changed: a panel that just came on screen gets the latest data and draft. */
  const onPanelChange = () => {
    const next = isPanelShown();
    if (next === shown) return;
    shown = next;
    if (!shown) {
      // A picker left open under `display: none` would keep its layer, and the next Escape would
      // be spent closing something the user cannot see.
      queryBuilder.closePopups();
      return;
    }
    snapshot = readSnapshot();
    syncBuilder();
  };

  queryBuilder.addEventListener('query-changed', onQueryChanged);
  queryBuilder.addEventListener('query-apply', onQueryApply);
  queryBuilder.addEventListener('query-reset', onQueryReset);
  queryBuilder.addEventListener('query-cancel', onQueryCancel);
  root.addEventListener('annotation-change', onAnnotationChange);
  plotElement.addEventListener('data-change', onDataChange);
  const unsubscribePanel = subscribePanel(onPanelChange);

  return {
    setSelectedAnnotation,
    setEatReliability(baseKey, state) {
      // Resync first: on a dataset switch the slider can fire before data-change refreshes the
      // snapshot, and stale indices would map onto the previous dataset.
      snapshot = readSnapshot();
      const key = findEatKey(baseKey);
      if (!key) return;
      const existing = findConditionsForAnnotation(applied.query, key);
      // A reliability state is one un-negated condition, or none at all.
      const nextConditions = conditionsForReliability(key, state, existing[0]?.id);
      const [replacement = null] = nextConditions;
      // Record what the filter will READ BACK as, before the guard below, so the next mirror
      // compares against the canonical range rather than the spelling handed in.
      lastMirrored.set(key, reliabilityFromConditions(nextConditions));
      const draftWasClean = !isDirty();
      if (!sameConditions(existing, nextConditions)) {
        applyQuery(replaceConditionsForAnnotation(applied.query, key, replacement));
      }
      if (draftWasClean) {
        draft = baseline();
      } else {
        // Only this column's condition changes in a dirty draft, under the draft's own id, so
        // the row keeps its live count and any half-typed bound (decision 14).
        const inDraft = findConditionsForAnnotation(draft, key);
        // A row new to the draft takes the applied condition's id, so it reads as applied.
        const forDraft = conditionsForReliability(key, state, inDraft[0]?.id ?? replacement?.id);
        if (!sameConditions(inDraft, forDraft)) {
          draft = replaceConditionsForAnnotation(draft, key, forDraft[0] ?? null);
        }
      }
      syncBuilder();
    },
    clear() {
      if (applied.query.length === 0) return;
      const before = applied;
      const draftWasClean = !isDirty();
      setApplied(NO_FILTER);
      if (draftWasClean) draft = seed;
      else {
        // A dirty draft keeps its rows, but not the reliability rows the clear took away: they
        // only mirror the EAT slider, which goes back to the full range, and Apply would bring
        // the cut back.
        for (const { key } of eatColumns()) {
          if (findConditionsForAnnotation(before.query, key).length === 0) continue;
          draft = replaceConditionsForAnnotation(draft, key, null);
        }
      }
      mirrorToPanel();
      syncBuilder();
      onFilterCommitted?.({ before, after: applied, cause: 'clear' });
    },
    restore(next) {
      const draftWasClean = !isDirty();
      // The EAT slider is not an undo step: the reliability conditions stay as they are now.
      let query = next.query;
      for (const { key } of eatColumns()) {
        const current = findConditionsForAnnotation(applied.query, key);
        if (sameConditions(findConditionsForAnnotation(query, key), current)) continue;
        query = replaceConditionsForAnnotation(query, key, current[0] ?? null);
      }
      if (query === next.query) setApplied(next);
      else applyQuery(query);
      if (draftWasClean) draft = baseline();
      mirrorToPanel();
      syncBuilder();
    },
    getContextMask() {
      const key = findEatKey(selectedAnnotation);
      const query = key ? replaceConditionsForAnnotation(applied.query, key, null) : applied.query;
      if (
        context &&
        context.snapshot === snapshot &&
        queryChanges(context.query, query).count === 0
      ) {
        return context.mask;
      }
      let mask: Uint8Array | null = null;
      if (snapshot && hasConfiguredCondition(query)) {
        mask = new Uint8Array(snapshot.protein_ids.length);
        for (const index of evaluateQuery(query, snapshot)) mask[index] = 1;
      }
      context = { query, snapshot, mask };
      return mask;
    },
    getOtherEatReliabilities() {
      const others: { annotation: string; reliability: EatReliabilityState }[] = [];
      for (const { key, base } of eatColumns()) {
        if (!base || base === selectedAnnotation) continue;
        const conditions = findConditionsForAnnotation(applied.query, key);
        if (conditions.length === 0) continue;
        const reliability = reliabilityFromConditions(conditions);
        if (!isSameReliability(reliability, DEFAULT_EAT_RELIABILITY)) {
          others.push({ annotation: base, reliability });
        }
      }
      return others;
    },
    getApplied: () => applied,
    resetForNewDataset() {
      // The plot's own filter channel is reset with its data (data-renderer applyPlotState).
      applied = NO_FILTER;
      seed = [createCondition()];
      draft = seed;
      lastMirrored.clear();
      context = null;
      // A hidden panel's builder still holds the dataset it last showed; let it go.
      if (!isPanelShown()) queryBuilder.data = undefined;
      syncBuilder();
    },
    dispose() {
      queryBuilder.removeEventListener('query-changed', onQueryChanged);
      queryBuilder.removeEventListener('query-apply', onQueryApply);
      queryBuilder.removeEventListener('query-reset', onQueryReset);
      queryBuilder.removeEventListener('query-cancel', onQueryCancel);
      root.removeEventListener('annotation-change', onAnnotationChange);
      plotElement.removeEventListener('data-change', onDataChange);
      unsubscribePanel();
      // The status store outlives this page: no stale count after leaving /explore.
      setWorkbenchStatus({ appliedFilterConditions: 0, unappliedFilterChanges: 0 });
    },
  };
}
