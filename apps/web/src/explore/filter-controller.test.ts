/**
 * The filter as the sidebar's Filter panel builds it (design decision 14), driven by fakes.
 *
 * A query is applied through the plot's dedicated, idempotent filter channel
 * (`filteredProteinIds` / `filtersActive`): a filter is neither a selection nor an isolation.
 * Matched indices are positions in the materialized snapshot the builder evaluated; translating
 * them through the isolated subset shrank the result on every re-apply (#257).
 *
 * Edits are a draft until Apply. The EAT panel's reliability filter writes the applied filter at
 * once and mirrors into the draft; the applied query moves the control back (#6b, #380). The
 * column is found by its runtime role, not its `__eat_confidence` suffix, so the collision-renamed
 * `__runtime_N` variant works too.
 */
import {
  evaluateQuery,
  type ProtspaceQueryBuilder,
  type ProtspaceScatterplot,
} from '@protspace/core';
import {
  DEFAULT_EAT_RELIABILITY,
  NA_VALUE,
  NEUTRAL_BOUND,
  type VisualizationData,
} from '@protspace/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findConditionsForAnnotation } from '../../../../packages/core/src/components/query-builder/query-annotation-conditions';
import {
  createCondition,
  type FilterQuery,
  type NumericCondition,
} from '../../../../packages/core/src/components/query-builder/query-types';
import {
  createFilterController,
  type FilterCommit,
  type FilterController,
  type FilterSnapshot,
} from './filter-controller';
import { getWorkbenchStatus, resetWorkbenchStatusForTests } from './workbench-status';

// Lit cannot load in node: stand in for @protspace/core with its pure query helpers, read from
// core's source.
vi.mock('@protspace/core', async () => {
  const types = await import('../../../../packages/core/src/components/query-builder/query-types');
  const evaluate =
    await import('../../../../packages/core/src/components/query-builder/query-evaluate');
  const conditions =
    await import('../../../../packages/core/src/components/query-builder/query-annotation-conditions');
  const reliability =
    await import('../../../../packages/core/src/components/query-builder/eat-reliability');
  const equal = await import('../../../../packages/core/src/components/query-builder/query-equal');
  return {
    createCondition: types.createCondition,
    evaluateQuery: vi.fn(evaluate.evaluateQuery),
    hasConfiguredCondition: evaluate.hasConfiguredCondition,
    findConditionsForAnnotation: conditions.findConditionsForAnnotation,
    replaceConditionsForAnnotation: conditions.replaceConditionsForAnnotation,
    conditionsForReliability: reliability.conditionsForReliability,
    reliabilityFromConditions: reliability.reliabilityFromConditions,
    sameConditions: reliability.sameConditions,
    queryChanges: equal.queryChanges,
    sameQuery: equal.sameQuery,
  };
});

/** Fixtures carry only what the filter reads, so they go through `unknown`. */
const asData = (data: unknown) => data as VisualizationData;
const range = (count: number) => Array.from({ length: count }, (_, i) => i);
const ids = (count: number) => range(count).map((i) => `p${i}`);

/** A full dataset of `count` proteins: p0, p1, … p{count-1}. */
const makeFullData = (count: number) => asData({ protein_ids: ids(count), annotations: {} });

const EAT_KEY = 'family__eat_confidence__runtime_2';

/**
 * 20 proteins: p0–p4 curated (null confidence), p5–p19 predicted with confidence i/20
 * (0.25 … 0.95). The eat-confidence column carries an explicit runtime role and base.
 */
function makeEatData(): VisualizationData {
  return asData({
    protein_ids: ids(20),
    annotations: {
      family: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
      gene_name: { kind: 'categorical', values: ['g'], colors: ['#000'], shapes: ['circle'] },
      [EAT_KEY]: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'family' },
      },
    },
    numeric_annotation_data: {
      [EAT_KEY]: Float64Array.from({ length: 20 }, (_, i) => (i < 5 ? NaN : i / 20)),
    },
  });
}

const EC_KEY = 'ec__eat_confidence__runtime_1';
const GO_KEY = 'go__eat_confidence__runtime_2';

/** Two EAT bases, each with its own eat-confidence column. */
function makeMultiEatData(): VisualizationData {
  const confidence = () => Float64Array.from({ length: 20 }, (_, i) => (i < 5 ? NaN : i / 20));
  return asData({
    protein_ids: ids(20),
    annotations: {
      ec: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
      go: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
      [EC_KEY]: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'ec' },
      },
      [GO_KEY]: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'go' },
      },
    },
    numeric_annotation_data: { [EC_KEY]: confidence(), [GO_KEY]: confidence() },
  });
}

/**
 * The controller with fakes for everything it touches. `getCurrentData` returns an isolated
 * subset on purpose: matched indices must never be translated through it (#257). `panel.show()`
 * and `panel.hide()` stand in for the layout store.
 */
function mount(
  makeData: () => VisualizationData,
  { selectedAnnotation, shown = true }: { selectedAnnotation?: string; shown?: boolean } = {},
) {
  const plot = Object.assign(new EventTarget(), {
    filteredProteinIds: [] as string[],
    filtersActive: false,
    // A sentinel selection: a filter must leave it untouched.
    selectedProteinIds: ['sentinel'],
    isolateSelection: vi.fn(),
    getCurrentData: vi.fn(() => asData({ protein_ids: ['p0', 'p1'], annotations: {} })),
    getMaterializedData: vi.fn((): VisualizationData | null => makeData()),
  });
  const eatPanel = { setReliabilityState: vi.fn() };
  const queryBuilder = Object.assign(new EventTarget(), {
    annotations: [] as string[],
    data: undefined as VisualizationData | undefined,
    query: [] as FilterQuery,
    dirty: false,
    closePopups: vi.fn(),
  });
  const listeners = new Set<() => void>();
  const panel = {
    shown,
    show() {
      panel.shown = true;
      for (const listener of [...listeners]) listener();
    },
    hide() {
      panel.shown = false;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
  const commits: FilterCommit[] = [];
  const root = new EventTarget();
  const controller = createFilterController({
    plotElement: plot as unknown as ProtspaceScatterplot,
    eatPanel,
    queryBuilder: queryBuilder as unknown as ProtspaceQueryBuilder,
    root: root as unknown as Document,
    isPanelShown: () => panel.shown,
    subscribePanel(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFilterCommitted: (commit) => commits.push(commit),
  });
  // The plot's data-change hands the controller its first snapshot, as the runtime's load does.
  fire(plot, 'data-change', { data: makeData() });
  if (selectedAnnotation !== undefined) controller.setSelectedAnnotation(selectedAnnotation);
  // Mounting with an annotation mirrors once; the tests count only what they cause.
  eatPanel.setReliabilityState.mockClear();
  return { controller, plot, eatPanel, queryBuilder, panel, root, commits };
}

const fire = (target: EventTarget, type: string, detail?: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail }));
const apply = (queryBuilder: EventTarget, indices: Iterable<number>) =>
  fire(queryBuilder, 'query-apply', { matchedIndices: new Set(indices) });
const editQuery = (queryBuilder: EventTarget, query: FilterQuery) =>
  fire(queryBuilder, 'query-changed', { query });
/** The range with only its low end moved: `x..100 %`. */
const threshold = (controller: FilterController, base: string, x: number) =>
  controller.setEatReliability(base, { min: x, max: NEUTRAL_BOUND.max });
/** A categorical condition with a value picked, so it constrains the query. */
const configured = (id: string): FilterQuery[number] => ({
  id,
  kind: 'categorical',
  annotation: 'family',
  values: ['A'],
});
const numericCount = (query: FilterQuery) =>
  query.filter((item) => 'kind' in item && item.kind === 'numeric').length;
/** The column's live reliability condition, which is always the first (and only) one. */
const eatCondition = (query: FilterQuery, key: string = EAT_KEY): NumericCondition | undefined =>
  findConditionsForAnnotation(query, key)[0];
const applied = (controller: FilterController): FilterQuery => controller.getApplied().query;

beforeEach(() => {
  resetWorkbenchStatusForTests();
});

describe('filter controller: the Filter panel and its draft', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(() => makeFullData(100));
  });

  it('a shown panel gets one empty condition, the materialized snapshot and a clean state', () => {
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.query[0]).toMatchObject({ annotation: '', values: [] });
    expect(m.queryBuilder.data?.protein_ids).toHaveLength(100);
    expect(m.queryBuilder.dirty).toBe(false);
    expect(m.plot.getMaterializedData).toHaveBeenCalled();
  });

  it('the builder lists every annotation except the tooltip-only and EAT confidence ones', () => {
    const eat = mount(makeEatData);
    expect(eat.queryBuilder.annotations).toEqual(['family']);
  });

  it('a draft edit does not touch the plot until Apply', () => {
    editQuery(m.queryBuilder, [configured('a')]);

    expect(m.queryBuilder.query).toEqual([configured('a')]);
    expect(m.queryBuilder.dirty).toBe(true);
    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    expect(m.commits).toEqual([]);
  });

  it('applies a query via the filter channel without selecting or isolating', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));

    expect(m.plot.filteredProteinIds).toEqual(ids(30));
    expect(m.plot.filtersActive).toBe(true);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
    expect(m.plot.selectedProteinIds).toEqual(['sentinel']);
  });

  it('Apply applies, keeps the draft clean and fires apply with before and after snapshots', () => {
    const draft = [configured('a')];
    editQuery(m.queryBuilder, draft);
    apply(m.queryBuilder, range(30));

    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);
    expect(m.queryBuilder.dirty).toBe(false);
    expect(m.queryBuilder.query).toBe(draft);
    expect(m.commits).toHaveLength(1);
    const [commit] = m.commits;
    expect(commit.cause).toBe('apply');
    expect(commit.before).toEqual({ query: [], matchedIds: null });
    expect(commit.after.query).toBe(draft);
    expect(commit.after.matchedIds).toEqual(ids(30));
    // The plot holds the very array the snapshot records: undo writes it back, never a copy.
    expect(m.plot.filteredProteinIds).toBe(commit.after.matchedIds);
    expect(m.controller.getApplied()).toBe(commit.after);
  });

  it('the count is the applied filter’s: a row added after Apply does not change it', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));

    editQuery(m.queryBuilder, [configured('a'), createCondition()]);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);

    editQuery(m.queryBuilder, [configured('a'), configured('b')]);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);
  });

  it('counts configured leaf conditions: empty rows and groups add nothing, a group adds its conditions', () => {
    editQuery(m.queryBuilder, [
      configured('a'),
      createCondition(),
      { id: 'g1', conditions: [configured('b'), configured('c'), createCondition()] },
      { id: 'g2', conditions: [createCondition()] },
    ]);
    apply(m.queryBuilder, range(30));

    expect(getWorkbenchStatus().appliedFilterConditions).toBe(3);
  });

  it('is idempotent: re-applying the same query yields the same matches', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));
    apply(m.queryBuilder, range(30));
    apply(m.queryBuilder, range(30));

    // Was 30 → 19 → a fade before #257.
    expect(m.plot.filteredProteinIds).toEqual(ids(30));
    expect(m.plot.filtersActive).toBe(true);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
  });

  it('replaces (does not stack) when a narrower query is applied next', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));
    editQuery(m.queryBuilder, [configured('b')]);
    apply(m.queryBuilder, range(12));

    expect(m.plot.filteredProteinIds).toEqual(ids(12));
  });

  it('does not blank the plot when the query matches nothing', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, [5, 6, 7]);
    expect(m.plot.filtersActive).toBe(true);

    // An active-but-empty channel reads as "hide everything", with no way back (#380).
    editQuery(m.queryBuilder, [configured('b')]);
    apply(m.queryBuilder, []);

    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toHaveLength(0);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    expect(m.controller.getApplied()).toEqual({ query: [configured('b')], matchedIds: null });
  });

  it('Cancel restores the applied query, or the seed when nothing is applied', () => {
    const seed = m.queryBuilder.query;
    editQuery(m.queryBuilder, [configured('a')]);
    fire(m.queryBuilder, 'query-cancel');
    expect(m.queryBuilder.query).toBe(seed);
    expect(m.queryBuilder.dirty).toBe(false);

    const draft = [configured('a')];
    editQuery(m.queryBuilder, draft);
    apply(m.queryBuilder, range(30));
    editQuery(m.queryBuilder, [configured('a'), configured('b')]);
    fire(m.queryBuilder, 'query-cancel');

    expect(m.queryBuilder.query).toBe(draft);
    expect(m.queryBuilder.dirty).toBe(false);
    expect(m.plot.filteredProteinIds).toEqual(ids(30));
  });

  it('Reset empties both and fires reset; a Reset with nothing applied records nothing', () => {
    fire(m.queryBuilder, 'query-reset');
    expect(m.commits).toEqual([]);

    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, [0, 1, 2]);
    editQuery(m.queryBuilder, [configured('a'), configured('b')]);

    fire(m.queryBuilder, 'query-reset');

    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.query[0]).toMatchObject({ annotation: '' });
    expect(m.queryBuilder.dirty).toBe(false);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    expect(m.commits[m.commits.length - 1]).toMatchObject({
      cause: 'reset',
      before: { query: [configured('a')], matchedIds: ids(3) },
      after: { query: [], matchedIds: null },
    });
  });

  it('clear() removes the filter and rebases a clean draft to the seed', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));

    m.controller.clear();

    expect(m.plot.filtersActive).toBe(false);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.query[0]).toMatchObject({ annotation: '' });
    expect(m.commits[m.commits.length - 1]).toMatchObject({ cause: 'clear', after: { query: [] } });
  });

  it('clear() with a dirty draft keeps the draft', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));
    const dirty = [configured('a'), configured('b')];
    editQuery(m.queryBuilder, dirty);

    m.controller.clear();

    expect(m.queryBuilder.query).toBe(dirty);
    expect(m.queryBuilder.dirty).toBe(true);
    expect(m.plot.filtersActive).toBe(false);
  });

  it('clear() with nothing applied does nothing', () => {
    m.controller.clear();
    expect(m.commits).toEqual([]);
  });

  it('restore() writes the stored ids without evaluating and publishes the count', () => {
    const snapshot: FilterSnapshot = {
      query: [configured('a'), configured('b')],
      matchedIds: ['p7', 'p9'],
    };

    m.controller.restore(snapshot);

    expect(m.plot.filteredProteinIds).toBe(snapshot.matchedIds);
    expect(m.plot.filtersActive).toBe(true);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(2);
    expect(m.controller.getApplied()).toBe(snapshot);
    // A clean draft follows the restored filter; restore records nothing.
    expect(m.queryBuilder.query).toBe(snapshot.query);
    expect(m.commits).toEqual([]);

    m.controller.restore({ query: [], matchedIds: null });
    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('restore() keeps a dirty draft', () => {
    const dirty = [configured('x')];
    editQuery(m.queryBuilder, dirty);
    m.controller.restore({ query: [configured('a')], matchedIds: ['p1'] });
    expect(m.queryBuilder.query).toBe(dirty);
  });

  it('the builder gets data only while the panel shows, and the latest when it shows', () => {
    m.panel.hide();
    const before = m.queryBuilder.data;
    m.plot.getMaterializedData.mockImplementation(() => makeFullData(50));

    fire(m.plot, 'data-change', { data: makeFullData(50) });
    editQuery(m.queryBuilder, [configured('a')]);
    expect(m.queryBuilder.data).toBe(before);

    m.panel.show();
    expect(m.queryBuilder.data?.protein_ids).toHaveLength(50);
    expect(m.queryBuilder.query).toEqual([configured('a')]);
  });

  it('a dataset reset clears the filter and the draft', () => {
    editQuery(m.queryBuilder, [{ id: 'a', kind: 'categorical', annotation: 'x', values: ['y'] }]);
    apply(m.queryBuilder, range(3));
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);

    m.controller.resetForNewDataset();

    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    expect(m.controller.getApplied()).toEqual({ query: [], matchedIds: null });
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.query[0]).not.toMatchObject({ annotation: 'x' });
  });

  it('hiding the panel closes an open picker', () => {
    expect(m.queryBuilder.closePopups).not.toHaveBeenCalled();
    m.panel.hide();
    expect(m.queryBuilder.closePopups).toHaveBeenCalledTimes(1);
    m.panel.show();
    expect(m.queryBuilder.closePopups).toHaveBeenCalledTimes(1);
  });

  it('a dataset reset lets a hidden panel’s builder drop the previous dataset', () => {
    m.panel.hide();
    expect(m.queryBuilder.data).toBeDefined();

    m.controller.resetForNewDataset();

    expect(m.queryBuilder.data).toBeUndefined();
  });

  it('dispose stops listening and clears the applied count', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);

    m.controller.dispose();

    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    expect(m.panel.listenerCount()).toBe(0);
    m.plot.filtersActive = false;
    apply(m.queryBuilder, range(3));
    expect(m.plot.filtersActive).toBe(false);
  });
});

describe('filter controller: EAT reliability slider <-> query mirror', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeEatData, { selectedAnnotation: 'family' });
  });

  it('forward: upserts a single "EAT_confidence >= x or N/A" condition and applies it', () => {
    threshold(m.controller, 'family', 0.5);

    expect(eatCondition(applied(m.controller))).toMatchObject({
      kind: 'numeric',
      annotation: EAT_KEY,
      max: null,
      min: 0.5,
      presence: [NA_VALUE],
    });
    // Un-negated: the N/A chip is what retains curated points now, not NOT.
    expect(eatCondition(applied(m.controller))?.logicalOp).not.toBe('NOT');
    expect(applied(m.controller)).toHaveLength(1);
    expect(m.plot.filtersActive).toBe(true);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);

    // Kept = curated (p0–p4) + predictions >= 0.5 (p10–p19); hidden = p5–p9.
    const kept = m.plot.filteredProteinIds;
    expect(kept).toContain('p0');
    expect(kept).toContain('p4');
    expect(kept).not.toContain('p5');
    expect(kept).not.toContain('p9');
    expect(kept).toContain('p10');
    expect(kept).toContain('p19');
    expect(kept).toHaveLength(15);
    expect(m.plot.selectedProteinIds).toEqual(['sentinel']);
    // The slider is not an undo step.
    expect(m.commits).toEqual([]);
  });

  it('slider with a clean draft → the draft equals the new applied query', () => {
    threshold(m.controller, 'family', 0.5);
    expect(m.queryBuilder.query).toBe(applied(m.controller));
    expect(m.queryBuilder.dirty).toBe(false);
  });

  it('slider with a dirty draft → only the reliability condition changes in the draft, the draft’s condition id is kept', () => {
    threshold(m.controller, 'family', 0.5);
    const draftCondition = { ...eatCondition(applied(m.controller))!, id: 'draft-eat' };
    editQuery(m.queryBuilder, [configured('a'), { ...draftCondition, logicalOp: 'AND' }]);

    threshold(m.controller, 'family', 0.8);

    expect(eatCondition(applied(m.controller))).toMatchObject({ min: 0.8 });
    const draft = m.queryBuilder.query;
    expect(draft).toHaveLength(2);
    expect(draft[0]).toEqual(configured('a'));
    expect(eatCondition(draft)).toMatchObject({ id: 'draft-eat', min: 0.8, logicalOp: 'AND' });
    expect(m.queryBuilder.dirty).toBe(true);
  });

  it('slider with a dirty draft that has no reliability row → the row joins the draft', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    threshold(m.controller, 'family', 0.5);
    expect(m.queryBuilder.query).toHaveLength(2);
    expect(m.queryBuilder.query[0]).toEqual(configured('a'));
    expect(eatCondition(m.queryBuilder.query)).toMatchObject({ min: 0.5 });
  });
  it('a reliability row new to a dirty draft has the applied condition’s id: one unapplied change', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    threshold(m.controller, 'family', 0.5);
    expect(eatCondition(m.queryBuilder.query)?.id).toBe(eatCondition(applied(m.controller))?.id);
    expect(getWorkbenchStatus().unappliedFilterChanges).toBe(1);
  });

  it('clear() drops the reliability row from a dirty draft, so Apply does not bring it back', () => {
    threshold(m.controller, 'family', 0.5);
    editQuery(m.queryBuilder, [...applied(m.controller), configured('a')]);

    m.controller.clear();

    expect(applied(m.controller)).toEqual([]);
    expect(eatCondition(m.queryBuilder.query)).toBeUndefined();
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.query[0]).toMatchObject({ id: 'a' });
    expect(m.queryBuilder.dirty).toBe(true);
  });

  it('undo and redo of a filter step keep the reliability condition set after it', () => {
    const before = m.controller.getApplied();
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(20));
    const after = m.controller.getApplied();
    threshold(m.controller, 'family', 0.5);

    m.controller.restore(before);
    expect(applied(m.controller)).toHaveLength(1);
    expect(eatCondition(applied(m.controller))).toMatchObject({ min: 0.5 });
    expect(m.plot.filteredProteinIds).toHaveLength(15);

    m.controller.restore(after);
    expect(applied(m.controller)).toHaveLength(2);
    expect(eatCondition(applied(m.controller))).toMatchObject({ min: 0.5 });
    // Re-evaluated, not the ids recorded without the reliability condition.
    expect(m.controller.getApplied().matchedIds).not.toBe(after.matchedIds);
    // The panel's base kept its state, so nothing moves the panel.
    expect(m.eatPanel.setReliabilityState).not.toHaveBeenCalled();
  });

  it('forward: re-applying with a new threshold replaces (does not stack) the condition', () => {
    threshold(m.controller, 'family', 0.5);
    threshold(m.controller, 'family', 0.8);

    expect(numericCount(applied(m.controller))).toBe(1);
    expect(eatCondition(applied(m.controller))).toMatchObject({ min: 0.8 });
    // Kept = curated (5) + predictions >= 0.8 (p16–p19 = 4) = 9.
    expect(m.plot.filteredProteinIds).toHaveLength(9);
  });

  it('forward: seeds against the current dataset, not a stale snapshot (dataset switch)', () => {
    // The snapshot from the last data-change is the PREVIOUS dataset (all curated), while the
    // plot already materializes the new one: the seed must read the plot.
    const staleData = asData({
      protein_ids: range(20).map((i) => `old${i}`),
      annotations: {
        family: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
        [EAT_KEY]: {
          kind: 'numeric',
          values: [],
          runtime: { role: 'eat-confidence', baseAnnotation: 'family' },
        },
      },
      numeric_annotation_data: { [EAT_KEY]: new Float64Array(20).fill(NaN) },
    });
    let current = staleData;
    m.plot.getMaterializedData.mockImplementation(() => current);
    fire(m.plot, 'data-change', { data: staleData });
    current = makeEatData();

    threshold(m.controller, 'family', 0.5);

    const kept = m.plot.filteredProteinIds;
    expect(kept.every((id) => id.startsWith('p'))).toBe(true);
    expect(kept).toHaveLength(15);
  });

  it('forward: dragging to 0 removes the eat condition, clears the filter channel and rebases a clean draft', () => {
    threshold(m.controller, 'family', 0.5);
    expect(m.plot.filtersActive).toBe(true);

    threshold(m.controller, 'family', 0);

    expect(applied(m.controller)).toHaveLength(0);
    expect(eatCondition(m.queryBuilder.query)).toBeUndefined();
    // The clean draft returns to the seeded empty row.
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('a draft edit of the reliability condition moves the slider only on Apply', () => {
    const edited: FilterQuery = [
      {
        id: 'x',
        kind: 'numeric',
        annotation: EAT_KEY,
        operator: 'gte',
        min: 0.6,
        max: null,
        presence: [NA_VALUE],
      },
    ];
    editQuery(m.queryBuilder, edited);
    expect(m.eatPanel.setReliabilityState).not.toHaveBeenCalled();

    apply(m.queryBuilder, range(15));
    expect(m.eatPanel.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.6 }),
    );

    fire(m.queryBuilder, 'query-reset');
    expect(m.eatPanel.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0 }),
    );
  });

  it('guards the loop: an Apply echoing the forward value does not move the panel again', () => {
    threshold(m.controller, 'family', 0.5);
    m.eatPanel.setReliabilityState.mockClear();

    // The draft is the applied query; applying it again changes nothing on the panel.
    apply(m.queryBuilder, range(15));

    expect(m.eatPanel.setReliabilityState).not.toHaveBeenCalled();
  });

  it('keeps a range that constrains nothing, across an unrelated Apply', () => {
    // A freshly loaded dataset: the reset empties the per-column record, and the colour-by
    // annotation is unchanged, so nothing repopulates it.
    m.controller.resetForNewDataset();

    // The full range constrains nothing, so the forward mirror emits no condition and returns
    // early. It must still record the position, or the next unrelated Apply re-mirrors the panel.
    m.controller.setEatReliability('family', { min: 0, max: 1 });
    m.eatPanel.setReliabilityState.mockClear();

    editQuery(m.queryBuilder, [
      { id: 'other', kind: 'numeric', annotation: 'length', operator: 'gt', min: 10 },
    ] as FilterQuery);
    apply(m.queryBuilder, range(4));

    expect(m.eatPanel.setReliabilityState).not.toHaveBeenCalled();
  });

  it('guards the loop for a condition that is not first in the draft', () => {
    // Every row after the first carries an `AND`, and the reliability condition is emitted
    // bare, so comparing the raw logicalOp made the guard miss.
    editQuery(m.queryBuilder, [
      { id: 'a', kind: 'categorical', annotation: 'family', values: ['A'] },
      {
        id: 'x',
        kind: 'numeric',
        annotation: EAT_KEY,
        operator: 'gte',
        min: 0.5,
        max: null,
        presence: [NA_VALUE],
        logicalOp: 'AND',
      },
    ]);

    const before = m.queryBuilder.query;
    m.controller.setEatReliability('family', { min: 0.5, max: 1 });

    // Identity, not equality: the draft already says this, so it is not rewritten.
    expect(m.queryBuilder.query).toBe(before);
  });
});

describe('filter controller: per-base EAT reliability (multi-EAT)', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeMultiEatData);
  });

  it('scopes the condition to the base: setting GO does not clobber EC', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);

    expect(numericCount(applied(m.controller))).toBe(2);
    expect(eatCondition(applied(m.controller), EC_KEY)).toMatchObject({
      max: null,
      presence: [NA_VALUE],
      min: 0.5,
    });
    expect(eatCondition(applied(m.controller), GO_KEY)).toMatchObject({
      max: null,
      presence: [NA_VALUE],
      min: 0.8,
    });
  });

  it('retuning one base rewrites only its own condition, preserving the other', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);
    threshold(m.controller, 'ec', 0.3);

    expect(eatCondition(applied(m.controller), EC_KEY)).toMatchObject({ min: 0.3 });
    expect(eatCondition(applied(m.controller), GO_KEY)).toMatchObject({ min: 0.8 });
    expect(numericCount(applied(m.controller))).toBe(2);
  });

  it('dragging one base to 0 removes only its condition, leaving the other', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);
    threshold(m.controller, 'ec', 0);

    expect(eatCondition(applied(m.controller), EC_KEY)).toBeUndefined();
    expect(eatCondition(applied(m.controller), GO_KEY)).toMatchObject({ min: 0.8 });
  });

  it('an annotation change forces the mirror to the newly selected base', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);

    m.controller.setSelectedAnnotation('ec');
    expect(m.eatPanel.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.5 }),
    );

    // The pickers' annotation-change, heard on the root (the document in the app).
    fire(m.root, 'annotation-change', { annotation: 'go' });
    expect(m.eatPanel.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.8 }),
    );
  });

  it('an annotation without EAT moves the panel to its resting position', () => {
    threshold(m.controller, 'go', 0.8);

    m.controller.setSelectedAnnotation('length');
    expect(m.eatPanel.setReliabilityState).toHaveBeenLastCalledWith(DEFAULT_EAT_RELIABILITY);

    m.controller.setSelectedAnnotation('go');
    expect(m.eatPanel.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.8 }),
    );
  });
});

describe('filter controller: every reliability range (#380)', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeEatData, { selectedAnnotation: 'family' });
  });

  // A hand-built condition on the eat-confidence column IS the reliability filter, whatever its
  // operator, so the slider must replace it rather than AND a contradictory one beside it.
  it.each([
    ['greater than', { operator: 'gt' as const, min: 0.5, max: null }],
    ['between', { operator: 'between' as const, min: 0.4, max: 0.9 }],
    ['non-negated less than', { operator: 'lt' as const, min: null, max: 0.5 }],
  ])('replaces an applied hand-built "%s" rather than appending beside it', (_name, seed) => {
    editQuery(m.queryBuilder, [{ id: 'x', kind: 'numeric', annotation: EAT_KEY, ...seed }]);
    apply(m.queryBuilder, range(10));

    threshold(m.controller, 'family', 0.5);

    expect(findConditionsForAnnotation(applied(m.controller), EAT_KEY)).toHaveLength(1);
    expect(findConditionsForAnnotation(m.queryBuilder.query, EAT_KEY)).toHaveLength(1);
    // One coherent condition, not an unsatisfiable pair: the plot keeps points.
    expect(m.plot.filteredProteinIds.length).toBeGreaterThan(0);
  });

  it('never hides the curated points, for any range', () => {
    const curated = ['p0', 'p1', 'p2', 'p3', 'p4'];
    for (const state of [
      { min: 0.5, max: 1 },
      { min: 0, max: 0.5 },
      { min: 0.4, max: 0.8 },
    ]) {
      m.controller.setEatReliability('family', state);
      for (const id of curated) expect(m.plot.filteredProteinIds).toContain(id);
    }
  });

  it('applies an upper bound that actually removes the high-confidence points', () => {
    m.controller.setEatReliability('family', { min: 0, max: 0.5 });
    expect(m.plot.filteredProteinIds).not.toContain('p19'); // 0.95
    expect(m.plot.filteredProteinIds).toContain('p5'); // 0.25
  });

  it('applies a band from both sides', () => {
    m.controller.setEatReliability('family', { min: 0.4, max: 0.6 });
    expect(m.plot.filteredProteinIds).not.toContain('p5'); // 0.25, below the band
    expect(m.plot.filteredProteinIds).not.toContain('p19'); // 0.95, above the band
    expect(m.plot.filteredProteinIds).toContain('p10'); // 0.50, inside
  });

  it('finds and replaces a reliability condition nested in a group of the draft', () => {
    editQuery(m.queryBuilder, [
      {
        id: 'g',
        conditions: [
          {
            id: 'x',
            kind: 'numeric',
            annotation: EAT_KEY,
            operator: 'lt',
            min: null,
            max: 0.2,
            logicalOp: 'NOT',
          },
        ],
      },
    ] as FilterQuery);

    threshold(m.controller, 'family', 0.7);

    const conditions = findConditionsForAnnotation(m.queryBuilder.query, EAT_KEY);
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toMatchObject({ id: 'x', min: 0.7, max: null });
  });
});

describe('filter controller: the EAT panel’s context mask (Decision 9)', () => {
  /** makeEatData plus a numeric `length` column (p_i has length i), one stable snapshot. */
  const data = (() => {
    const base = makeEatData();
    return asData({
      ...base,
      annotations: { ...base.annotations, length: { kind: 'numeric', values: [] } },
      numeric_annotation_data: {
        ...base.numeric_annotation_data,
        length: Float64Array.from(range(20)),
      },
    });
  })();
  const atLeastTen: FilterQuery = [
    { id: 'len', kind: 'numeric', annotation: 'length', min: 10, max: null },
  ];

  it('getContextMask is null with only the reliability condition', () => {
    const m = mount(() => data, { selectedAnnotation: 'family' });
    expect(m.controller.getContextMask()).toBeNull();
    threshold(m.controller, 'family', 0.5);
    expect(m.controller.getContextMask()).toBeNull();
  });

  it('getContextMask holds the other conditions’ matches and is not recomputed by a reliability change', () => {
    const m = mount(() => data, { selectedAnnotation: 'family' });
    editQuery(m.queryBuilder, atLeastTen);
    apply(m.queryBuilder, range(20).slice(10));
    const mask = m.controller.getContextMask();
    expect(Array.from(mask ?? [])).toEqual(range(20).map((i) => (i >= 10 ? 1 : 0)));

    vi.mocked(evaluateQuery).mockClear();
    threshold(m.controller, 'family', 0.6);
    // The reliability condition joined the applied query; the context ignores it.
    expect(eatCondition(applied(m.controller))).toBeDefined();
    const calls = vi.mocked(evaluateQuery).mock.calls.length;
    expect(m.controller.getContextMask()).toBe(mask);
    expect(vi.mocked(evaluateQuery).mock.calls.length).toBe(calls);
  });
});
