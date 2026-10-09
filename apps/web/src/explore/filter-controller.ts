import {
  conditionsForReliability,
  createCondition,
  evaluateQuery,
  findConditionsForAnnotation,
  hasConfiguredCondition,
  reliabilityFromConditions,
  replaceConditionsForAnnotation,
  sameConditions,
  type FilterQuery,
  type ProtspaceLegend,
  type ProtspaceQueryBuilder,
  type ProtspaceScatterplot,
  type PsDialog,
} from '@protspace/core';
import {
  DEFAULT_EAT_RELIABILITY,
  isEatConfidenceAnnotation,
  isSameReliability,
  type EatReliabilityState,
  type VisualizationData,
} from '@protspace/utils';
import { TOOLTIP_ONLY_ANNOTATIONS } from './view-bar-controller';
import { setWorkbenchStatus } from './workbench-status';

interface FilterControllerOptions {
  plotElement: ProtspaceScatterplot;
  legendElement: ProtspaceLegend;
  queryBuilder: ProtspaceQueryBuilder;
  dialog: PsDialog;
  /** Where `annotation-change` is heard; the document in the app. */
  root: Pick<Document, 'addEventListener' | 'removeEventListener'>;
}

export interface FilterController {
  /** Opens the Filter dialog on the current data, with one empty condition when there is none. */
  open(): void;
  /** The colouring annotation changed: move the reliability control to its column's state. */
  setSelectedAnnotation(annotation: string): void;
  /** The legend's reliability control: replaces its base's condition and applies the query. */
  setEatReliability(baseKey: string, state: EatReliabilityState): void;
  /** A new dataset has other proteins, so the query and the mirror record go. */
  resetForNewDataset(): void;
  dispose(): void;
}

/**
 * The filter the Filter dialog builds (design decision 9, moved from the control bar).
 *
 * A query applies through the plot's filter channel (`filteredProteinIds`, `filtersActive`),
 * which is idempotent: a filter is neither a selection nor an isolation (#257). Matched indices
 * are positions in the materialized snapshot the builder evaluated, never in the isolated
 * subset `getCurrentData()` returns.
 *
 * The legend's EAT reliability control and the query mirror each other, per eat-confidence
 * column (#6b, #380). Both directions compare against the last state recorded for that column, so
 * they cannot ping-pong, and a change on one base is never measured against another's.
 */
export function createFilterController({
  plotElement,
  legendElement,
  queryBuilder,
  dialog,
  root,
}: FilterControllerOptions): FilterController {
  let query: FilterQuery = [];
  let filterActive = false;
  let selectedAnnotation = '';
  /** The materialized snapshot the builder evaluates; refreshed on every plot data-change. */
  let snapshot: VisualizationData | undefined;
  const lastMirrored = new Map<string, EatReliabilityState>();

  const readSnapshot = (): VisualizationData | undefined =>
    plotElement.getMaterializedData() ?? plotElement.getCurrentData() ?? snapshot;

  const filterableAnnotations = (data: VisualizationData | undefined): string[] =>
    Object.keys(data?.annotations ?? {}).filter((key) => !TOOLTIP_ONLY_ANNOTATIONS.has(key));

  const publish = () =>
    setWorkbenchStatus({ appliedFilterConditions: filterActive ? query.length : 0 });

  /**
   * The builder re-counts the whole dataset whenever its data or query changes, so it gets them
   * only while the dialog shows it; open() hands it the latest.
   */
  const syncBuilder = () => {
    if (!dialog.open) return;
    queryBuilder.data = snapshot;
    queryBuilder.query = query;
  };

  const setQuery = (next: FilterQuery) => {
    query = next;
    syncBuilder();
    publish();
  };

  /**
   * Releases the filter channel so every protein returns, leaving isolation alone. Writes only
   * when something is set: a fresh `[]` over an empty one still rebuilds the plot's geometry.
   */
  const clearFilterChannel = () => {
    if (plotElement.filtersActive || (plotElement.filteredProteinIds?.length ?? 0) > 0) {
      plotElement.filteredProteinIds = [];
      plotElement.filtersActive = false;
    }
    filterActive = false;
    publish();
  };

  const applyMatchedIndices = (matchedIndices: Set<number>) => {
    const proteinIds = snapshot?.protein_ids;
    if (!proteinIds) return;
    // One pass, no intermediates: this runs on every slider commit at Swiss-Prot scale.
    const matchedIds: string[] = [];
    for (const index of matchedIndices) {
      const id = proteinIds[index];
      if (id !== undefined) matchedIds.push(id);
    }
    // An empty active channel reads as "nothing is visible", with no way back: leave the plot
    // unfiltered instead; the builder still reports the 0 count (#380).
    if (matchedIds.length === 0) {
      clearFilterChannel();
      return;
    }
    plotElement.filteredProteinIds = matchedIds;
    plotElement.filtersActive = true;
    filterActive = true;
    publish();
  };

  /** Evaluates the query on the snapshot and applies it, or clears the channel when it is empty. */
  const applyQuery = () => {
    if (!snapshot) return;
    if (!hasConfiguredCondition(query)) {
      clearFilterChannel();
      return;
    }
    applyMatchedIndices(evaluateQuery(query, snapshot));
  };

  /** The eat-confidence column whose runtime base is `baseKey`, if any. */
  const findEatKey = (baseKey: string): string | undefined => {
    for (const [key, annotation] of Object.entries(snapshot?.annotations ?? {})) {
      if (isEatConfidenceAnnotation(annotation) && annotation.runtime?.baseAnnotation === baseKey) {
        return key;
      }
    }
    return undefined;
  };

  /**
   * Reverse mirror: tells the legend what the query says for the selected base. `force` repositions
   * the control after an annotation change even when this base's state is unchanged.
   */
  const mirrorToLegend = (force = false) => {
    const key = findEatKey(selectedAnnotation);
    if (!key) return;
    const derived = reliabilityFromConditions(findConditionsForAnnotation(query, key));
    // No record yet: nothing moved this column off its resting position, which the legend shows.
    const last = lastMirrored.get(key) ?? DEFAULT_EAT_RELIABILITY;
    if (!force && isSameReliability(last, derived)) return;
    lastMirrored.set(key, derived);
    legendElement.setReliabilityState(derived);
  };

  const setSelectedAnnotation = (annotation: string) => {
    if (annotation === selectedAnnotation) return;
    selectedAnnotation = annotation;
    snapshot = readSnapshot();
    mirrorToLegend(true);
  };

  const onQueryChanged = (event: Event) => {
    setQuery((event as CustomEvent<{ query: FilterQuery }>).detail.query);
    // A direct edit of the query moves the legend's reliability control (#6b).
    mirrorToLegend();
  };

  const onQueryApply = (event: Event) => {
    applyMatchedIndices(
      (event as CustomEvent<{ matchedIndices: Set<number> }>).detail.matchedIndices,
    );
    dialog.open = false;
  };

  const onQueryReset = () => {
    clearFilterChannel();
    // A fresh row to start the next query; the dialog stays open.
    setQuery([createCondition()]);
    // A full reset drops any reliability condition too: pull the legend control back.
    mirrorToLegend();
  };

  /** The builder's Cancel: close, keeping the edits for the next opening. */
  const onQueryClose = () => {
    dialog.open = false;
  };

  const onAnnotationChange = (event: Event) => {
    const annotation = (event as CustomEvent<{ annotation?: unknown }>).detail?.annotation;
    if (typeof annotation === 'string') setSelectedAnnotation(annotation);
  };

  const onDataChange = (event: Event) => {
    const data = (event as CustomEvent<{ data?: VisualizationData | null }>).detail?.data;
    if (!data) return;
    snapshot = plotElement.getMaterializedData() ?? plotElement.getCurrentData() ?? undefined;
    if (!dialog.open) return;
    queryBuilder.annotations = filterableAnnotations(snapshot);
    queryBuilder.data = snapshot;
  };

  queryBuilder.addEventListener('query-changed', onQueryChanged);
  queryBuilder.addEventListener('query-apply', onQueryApply);
  queryBuilder.addEventListener('query-reset', onQueryReset);
  queryBuilder.addEventListener('query-close', onQueryClose);
  root.addEventListener('annotation-change', onAnnotationChange);
  plotElement.addEventListener('data-change', onDataChange);

  return {
    open() {
      snapshot = readSnapshot();
      // Seed one empty condition so the user sees a row at once.
      if (query.length === 0) query = [createCondition()];
      queryBuilder.annotations = filterableAnnotations(snapshot);
      queryBuilder.data = snapshot;
      queryBuilder.query = query;
      dialog.open = true;
    },
    setSelectedAnnotation,
    setEatReliability(baseKey, state) {
      // Resync first: on a dataset switch the slider can fire before data-change refreshes the
      // snapshot, and stale indices would map onto the previous dataset.
      snapshot = readSnapshot();
      const key = findEatKey(baseKey);
      if (!key) return;
      const existing = findConditionsForAnnotation(query, key);
      // A reliability state is one un-negated condition, or none at all.
      const nextConditions = conditionsForReliability(key, state, existing[0]?.id);
      const [replacement = null] = nextConditions;
      // Record what the query will READ BACK as, before the guard below: state -> conditions is
      // not injective, and a mode that constrains nothing still has a position to keep.
      lastMirrored.set(key, reliabilityFromConditions(nextConditions));
      // The query already expresses this state for THIS base: re-applying could ping-pong.
      if (sameConditions(existing, nextConditions)) return;
      setQuery(replaceConditionsForAnnotation(query, key, replacement));
      applyQuery();
    },
    resetForNewDataset() {
      // The plot's own filter channel is reset with its data (data-renderer applyPlotState).
      query = [];
      filterActive = false;
      lastMirrored.clear();
      // A closed dialog's builder still holds the dataset it last showed; let it go.
      if (!dialog.open) queryBuilder.data = undefined;
      syncBuilder();
      publish();
    },
    dispose() {
      queryBuilder.removeEventListener('query-changed', onQueryChanged);
      queryBuilder.removeEventListener('query-apply', onQueryApply);
      queryBuilder.removeEventListener('query-reset', onQueryReset);
      queryBuilder.removeEventListener('query-close', onQueryClose);
      root.removeEventListener('annotation-change', onAnnotationChange);
      plotElement.removeEventListener('data-change', onDataChange);
    },
  };
}
