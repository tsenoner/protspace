/**
 * The filter, moved from the control bar (`control-bar.query-apply.test.ts`), driven by fakes.
 *
 * A query is applied through the plot's dedicated, idempotent filter channel
 * (`filteredProteinIds` / `filtersActive`): a filter is neither a selection nor an isolation.
 * Matched indices are positions in the materialized snapshot the builder evaluated; translating
 * them through the isolated subset shrank the result on every re-apply (#257).
 *
 * The legend's EAT reliability control and the query mirror each other per eat-confidence column
 * (#6b, #380). The column is found by its runtime role, not its `__eat_confidence` suffix, so the
 * collision-renamed `__runtime_N` variant works too.
 */
import type {
  ProtspaceLegend,
  ProtspaceQueryBuilder,
  ProtspaceScatterplot,
  PsDialog,
} from '@protspace/core';
import { NA_VALUE, NEUTRAL_BOUND, type VisualizationData } from '@protspace/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findConditionsForAnnotation } from '../../../../packages/core/src/components/query-builder/query-annotation-conditions';
import {
  createCondition,
  type FilterQuery,
  type NumericCondition,
} from '../../../../packages/core/src/components/query-builder/query-types';
import { createFilterController, type FilterController } from './filter-controller';
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
  return {
    createCondition: types.createCondition,
    evaluateQuery: evaluate.evaluateQuery,
    hasConfiguredCondition: evaluate.hasConfiguredCondition,
    findConditionsForAnnotation: conditions.findConditionsForAnnotation,
    replaceConditionsForAnnotation: conditions.replaceConditionsForAnnotation,
    conditionsForReliability: reliability.conditionsForReliability,
    reliabilityFromConditions: reliability.reliabilityFromConditions,
    sameConditions: reliability.sameConditions,
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
 * subset on purpose: matched indices must never be translated through it (#257).
 */
function mount(makeData: () => VisualizationData, selectedAnnotation?: string) {
  const plot = Object.assign(new EventTarget(), {
    filteredProteinIds: [] as string[],
    filtersActive: false,
    // A sentinel selection: a filter must leave it untouched.
    selectedProteinIds: ['sentinel'],
    isolateSelection: vi.fn(),
    getCurrentData: vi.fn(() => asData({ protein_ids: ['p0', 'p1'], annotations: {} })),
    getMaterializedData: vi.fn((): VisualizationData | null => makeData()),
  });
  const legend = { setReliabilityState: vi.fn() };
  const queryBuilder = Object.assign(new EventTarget(), {
    annotations: [] as string[],
    data: undefined as VisualizationData | undefined,
    query: [] as FilterQuery,
  });
  const dialog = { open: false };
  const root = new EventTarget();
  const controller = createFilterController({
    plotElement: plot as unknown as ProtspaceScatterplot,
    legendElement: legend as unknown as ProtspaceLegend,
    queryBuilder: queryBuilder as unknown as ProtspaceQueryBuilder,
    dialog: dialog as unknown as PsDialog,
    root: root as unknown as Document,
  });
  if (selectedAnnotation !== undefined) controller.setSelectedAnnotation(selectedAnnotation);
  // Mounting with an annotation mirrors once; the tests count only what they cause.
  legend.setReliabilityState.mockClear();
  return { controller, plot, legend, queryBuilder, dialog, root };
}

const fire = (target: EventTarget, type: string, detail?: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail }));
const apply = (queryBuilder: EventTarget, indices: Iterable<number>) =>
  fire(queryBuilder, 'query-apply', { matchedIndices: new Set(indices) });
const editQuery = (queryBuilder: EventTarget, query: FilterQuery) =>
  fire(queryBuilder, 'query-changed', { query });
/** The legend slider's scalar form: "hide below `x`". */
const threshold = (controller: FilterController, base: string, x: number) =>
  controller.setEatReliability(base, { mode: 'atLeast', min: x, max: NEUTRAL_BOUND.max });
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

beforeEach(() => {
  resetWorkbenchStatusForTests();
});

describe('filter controller: the Filter dialog', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(() => makeFullData(100));
    m.controller.open();
  });

  it('open seeds one empty condition, hands the builder the materialized snapshot and opens the dialog', () => {
    expect(m.dialog.open).toBe(true);
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.data?.protein_ids).toHaveLength(100);
    expect(m.plot.getMaterializedData).toHaveBeenCalled();
  });

  it('the builder lists every annotation except the tooltip-only ones', () => {
    const eat = mount(makeEatData);
    eat.controller.open();
    expect(eat.queryBuilder.annotations).toEqual(['family', EAT_KEY]);
  });

  it('applies a query via the filter channel without selecting or isolating', () => {
    apply(m.queryBuilder, range(30));

    expect(m.plot.filteredProteinIds).toEqual(ids(30));
    expect(m.plot.filtersActive).toBe(true);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
    expect(m.plot.selectedProteinIds).toEqual(['sentinel']);
  });

  it('apply closes the dialog and reports the condition count', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));

    expect(m.dialog.open).toBe(false);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);
  });

  it('the count is the applied filter’s: a row added after Apply does not change it', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));
    m.controller.open();

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

  it('dispose clears the applied count', () => {
    editQuery(m.queryBuilder, [configured('a')]);
    apply(m.queryBuilder, range(30));
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);

    m.controller.dispose();

    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('is idempotent: re-applying the same query yields the same matches', () => {
    apply(m.queryBuilder, range(30));
    apply(m.queryBuilder, range(30));
    apply(m.queryBuilder, range(30));

    // Was 30 → 19 → a fade before #257.
    expect(m.plot.filteredProteinIds).toEqual(ids(30));
    expect(m.plot.filtersActive).toBe(true);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
  });

  it('replaces (does not stack) when a narrower query is applied next', () => {
    apply(m.queryBuilder, range(30));
    apply(m.queryBuilder, range(12));

    expect(m.plot.filteredProteinIds).toEqual(ids(12));
  });

  it('does not blank the plot when the query matches nothing', () => {
    apply(m.queryBuilder, [5, 6, 7]);
    expect(m.plot.filtersActive).toBe(true);

    // An active-but-empty channel reads as "hide everything", with no way back (#380).
    apply(m.queryBuilder, []);

    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toHaveLength(0);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('reset clears only the filter channel, re-seeds an empty condition and keeps the dialog open', () => {
    apply(m.queryBuilder, [0, 1, 2]);
    m.controller.open();

    fire(m.queryBuilder, 'query-reset');

    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.isolateSelection).not.toHaveBeenCalled();
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.dialog.open).toBe(true);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('Cancel in the builder closes the dialog and keeps the edits', () => {
    const edited: FilterQuery = [
      { id: 'a', kind: 'categorical', annotation: 'family', values: ['A'] },
    ];
    editQuery(m.queryBuilder, edited);

    fire(m.queryBuilder, 'query-close');
    expect(m.dialog.open).toBe(false);

    m.controller.open();
    expect(m.queryBuilder.query).toEqual(edited);
  });

  it('a closed dialog’s builder gets no new data', () => {
    fire(m.queryBuilder, 'query-close');
    const before = m.queryBuilder.data;
    m.plot.getMaterializedData.mockImplementation(() => makeFullData(50));

    fire(m.plot, 'data-change', { data: makeFullData(50) });
    expect(m.queryBuilder.data).toBe(before);

    m.controller.open();
    expect(m.queryBuilder.data?.protein_ids).toHaveLength(50);
  });

  it('a dataset reset clears the query and the applied count', () => {
    editQuery(m.queryBuilder, [{ id: 'a', kind: 'categorical', annotation: 'x', values: ['y'] }]);
    apply(m.queryBuilder, range(3));
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);

    m.controller.resetForNewDataset();

    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    m.controller.open();
    expect(m.queryBuilder.query).toHaveLength(1);
    expect(m.queryBuilder.query[0]).not.toMatchObject({ annotation: 'x' });
  });

  it('a dataset reset lets a closed dialog’s builder drop the previous dataset', () => {
    fire(m.queryBuilder, 'query-close');
    expect(m.queryBuilder.data).toBeDefined();

    m.controller.resetForNewDataset();

    expect(m.queryBuilder.data).toBeUndefined();
  });

  it('dispose stops listening', () => {
    m.controller.dispose();
    apply(m.queryBuilder, range(3));
    expect(m.plot.filtersActive).toBe(false);
  });
});

describe('filter controller: EAT reliability slider <-> query mirror', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeEatData, 'family');
    // An open dialog mirrors the controller's query onto the builder, which is how these tests
    // read it.
    m.dialog.open = true;
  });

  it('forward: upserts a single "EAT_confidence >= x or N/A" condition and applies it', () => {
    threshold(m.controller, 'family', 0.5);

    expect(eatCondition(m.queryBuilder.query)).toMatchObject({
      kind: 'numeric',
      annotation: EAT_KEY,
      operator: 'gte',
      min: 0.5,
      presence: [NA_VALUE],
    });
    // Un-negated: the N/A chip is what retains curated points now, not NOT.
    expect(eatCondition(m.queryBuilder.query)?.logicalOp).not.toBe('NOT');
    expect(m.queryBuilder.query).toHaveLength(1);
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
  });

  it('forward: re-applying with a new threshold replaces (does not stack) the condition', () => {
    threshold(m.controller, 'family', 0.5);
    threshold(m.controller, 'family', 0.8);

    expect(numericCount(m.queryBuilder.query)).toBe(1);
    expect(eatCondition(m.queryBuilder.query)).toMatchObject({ min: 0.8 });
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

  it('forward: dragging to 0 removes the eat condition and clears the filter channel', () => {
    threshold(m.controller, 'family', 0.5);
    expect(m.plot.filtersActive).toBe(true);

    threshold(m.controller, 'family', 0);

    expect(eatCondition(m.queryBuilder.query)).toBeUndefined();
    expect(m.queryBuilder.query).toHaveLength(0);
    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
  });

  it('reverse: a query change that adds or drops the condition moves the legend control', () => {
    editQuery(m.queryBuilder, [
      {
        id: 'x',
        kind: 'numeric',
        annotation: EAT_KEY,
        operator: 'gte',
        min: 0.6,
        max: null,
        presence: [NA_VALUE],
      },
    ]);
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.6 }),
    );

    editQuery(m.queryBuilder, []);
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0 }),
    );
  });

  it('guards the loop: a query change echoing the forward value does not move the legend again', () => {
    threshold(m.controller, 'family', 0.5);
    m.legend.setReliabilityState.mockClear();

    // The builder re-broadcasts the current query (same 0.5): no new value.
    editQuery(m.queryBuilder, m.queryBuilder.query);

    expect(m.legend.setReliabilityState).not.toHaveBeenCalled();
  });

  it('keeps a mode that constrains nothing, across an unrelated query edit', () => {
    // A freshly loaded dataset: the reset empties the per-column record, and the colour-by
    // annotation is unchanged, so nothing repopulates it.
    m.controller.resetForNewDataset();

    // "Hide above" picked before its bound moves constrains nothing, so the forward mirror
    // emits no condition and returns early. It must still record the position, or the next
    // unrelated edit pushes the `atLeast` default back onto the legend's mode select.
    m.controller.setEatReliability('family', { mode: 'atMost', min: 0, max: 1 });
    m.legend.setReliabilityState.mockClear();

    editQuery(m.queryBuilder, [
      { id: 'other', kind: 'numeric', annotation: 'length', operator: 'gt', min: 10 },
    ] as FilterQuery);

    expect(m.legend.setReliabilityState).not.toHaveBeenCalled();
  });

  it('guards the loop for a condition that is not first in the query', () => {
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
    m.controller.setEatReliability('family', { mode: 'atLeast', min: 0.5, max: 1 });

    // Identity, not equality: the guard must skip the rewrite entirely.
    expect(m.queryBuilder.query).toBe(before);
  });

  it('clear releases the channel, publishes 0 and mirrors the reliability control back', () => {
    threshold(m.controller, 'family', 0.5);
    expect(m.plot.filtersActive).toBe(true);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(1);
    m.legend.setReliabilityState.mockClear();

    m.controller.clear();

    expect(m.plot.filtersActive).toBe(false);
    expect(m.plot.filteredProteinIds).toEqual([]);
    expect(getWorkbenchStatus().appliedFilterConditions).toBe(0);
    expect(m.queryBuilder.query).toEqual([]);
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0 }),
    );
    // The next opening seeds one empty row.
    m.controller.open();
    expect(m.queryBuilder.query).toHaveLength(1);
  });
});

describe('filter controller: per-base EAT reliability (multi-EAT)', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeMultiEatData);
    m.dialog.open = true;
  });

  it('scopes the condition to the base: setting GO does not clobber EC', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);

    expect(numericCount(m.queryBuilder.query)).toBe(2);
    expect(eatCondition(m.queryBuilder.query, EC_KEY)).toMatchObject({
      operator: 'gte',
      presence: [NA_VALUE],
      min: 0.5,
    });
    expect(eatCondition(m.queryBuilder.query, GO_KEY)).toMatchObject({
      operator: 'gte',
      presence: [NA_VALUE],
      min: 0.8,
    });
  });

  it('retuning one base rewrites only its own condition, preserving the other', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);
    threshold(m.controller, 'ec', 0.3);

    expect(eatCondition(m.queryBuilder.query, EC_KEY)).toMatchObject({ min: 0.3 });
    expect(eatCondition(m.queryBuilder.query, GO_KEY)).toMatchObject({ min: 0.8 });
    expect(numericCount(m.queryBuilder.query)).toBe(2);
  });

  it('dragging one base to 0 removes only its condition, leaving the other', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);
    threshold(m.controller, 'ec', 0);

    expect(eatCondition(m.queryBuilder.query, EC_KEY)).toBeUndefined();
    expect(eatCondition(m.queryBuilder.query, GO_KEY)).toMatchObject({ min: 0.8 });
  });

  it('an annotation change forces the mirror to the newly selected base', () => {
    threshold(m.controller, 'ec', 0.5);
    threshold(m.controller, 'go', 0.8);

    m.controller.setSelectedAnnotation('ec');
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.5 }),
    );

    // The pickers' annotation-change, heard on the root (the document in the app).
    fire(m.root, 'annotation-change', { annotation: 'go' });
    expect(m.legend.setReliabilityState).toHaveBeenLastCalledWith(
      expect.objectContaining({ min: 0.8 }),
    );
  });
});

describe('filter controller: every reliability mode (#380)', () => {
  let m: ReturnType<typeof mount>;

  beforeEach(() => {
    m = mount(makeEatData, 'family');
    m.dialog.open = true;
  });

  // A hand-built condition on the eat-confidence column IS the reliability filter, whatever its
  // operator, so the slider must replace it rather than AND a contradictory one beside it.
  it.each([
    ['greater than', { operator: 'gt' as const, min: 0.5, max: null }],
    ['between', { operator: 'between' as const, min: 0.4, max: 0.9 }],
    ['non-negated less than', { operator: 'lt' as const, min: null, max: 0.5 }],
  ])('replaces a hand-built "%s" rather than appending beside it', (_name, seed) => {
    editQuery(m.queryBuilder, [{ id: 'x', kind: 'numeric', annotation: EAT_KEY, ...seed }]);

    threshold(m.controller, 'family', 0.5);

    expect(findConditionsForAnnotation(m.queryBuilder.query, EAT_KEY)).toHaveLength(1);
    // One coherent condition, not an unsatisfiable pair: the plot keeps points.
    expect(m.plot.filteredProteinIds.length).toBeGreaterThan(0);
  });

  it('never hides the curated points, in any mode', () => {
    const curated = ['p0', 'p1', 'p2', 'p3', 'p4'];
    for (const state of [
      { mode: 'atLeast' as const, min: 0.5, max: 1 },
      { mode: 'atMost' as const, min: 0, max: 0.5 },
      { mode: 'between' as const, min: 0.4, max: 0.8 },
    ]) {
      m.controller.setEatReliability('family', state);
      for (const id of curated) expect(m.plot.filteredProteinIds).toContain(id);
    }
  });

  it('applies an upper bound that actually removes the high-confidence points', () => {
    m.controller.setEatReliability('family', { mode: 'atMost', min: 0, max: 0.5 });
    expect(m.plot.filteredProteinIds).not.toContain('p19'); // 0.95
    expect(m.plot.filteredProteinIds).toContain('p5'); // 0.25
  });

  it('applies a band from both sides', () => {
    m.controller.setEatReliability('family', { mode: 'between', min: 0.4, max: 0.6 });
    expect(m.plot.filteredProteinIds).not.toContain('p5'); // 0.25, below the band
    expect(m.plot.filteredProteinIds).not.toContain('p19'); // 0.95, above the band
    expect(m.plot.filteredProteinIds).toContain('p10'); // 0.50, inside
  });

  it('finds and replaces a reliability condition nested in a group', () => {
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
    expect(conditions[0]).toMatchObject({ operator: 'gte', min: 0.7 });
  });
});
