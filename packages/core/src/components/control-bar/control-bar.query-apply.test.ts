/**
 * @vitest-environment jsdom
 *
 * Behavioural contract for applying a filter query from the control bar.
 *
 * Regression coverage for the "re-apply shrinks the result" bug (issue #257 and
 * the PR #259 report): applying `protein_family = phospholipase A2` matched 546
 * proteins, re-applying the unchanged query matched 19, and a third apply only
 * faded points. Root cause: the query was evaluated against the full materialized
 * dataset but the matched indices were translated back through the *isolated*
 * subset returned by `getCurrentData()`, and every apply stacked another
 * isolation layer.
 *
 * The fix routes a filter query through the dedicated, idempotent
 * `filteredProteinIds` / `filtersActive` channel on the scatter plot — a filter
 * is not a selection and is not an isolation. These tests pin that contract.
 *
 * The control bar is created via document.createElement (no WebGL scatter plot
 * is mounted); a lightweight stub stands in for the scatter plot so we can
 * assert exactly what the apply/reset handlers write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './control-bar';
import type { FilterQuery, NumericCondition } from './query-types';
import type { ProtspaceData } from './types';
import { findConditionsForAnnotation } from './query-annotation-conditions';
import { NA_VALUE } from '@protspace/utils';

interface StubScatterplot {
  filteredProteinIds?: string[];
  filtersActive?: boolean;
  selectedProteinIds?: string[];
  isolateSelection: ReturnType<typeof vi.fn>;
  resetIsolation: ReturnType<typeof vi.fn>;
  getCurrentData: ReturnType<typeof vi.fn>;
  getMaterializedData: ReturnType<typeof vi.fn>;
  // The control bar treats the scatter plot as an Element (it (de)registers DOM
  // listeners on it), so the stub must answer these even though we don't use them.
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

interface ControlBarInternals extends HTMLElement {
  _scatterplotElement: StubScatterplot | null;
  _currentData: ProtspaceData | undefined;
  selectedAnnotation: string;
  filterActive: boolean;
  filterQuery: FilterQuery;
  clearForNewDataset(datasetHash: string, clearPersistedState?: boolean): void;
  setEatConfidenceThreshold(baseKey: string, x: number): void;
  _handleQueryApply(event: CustomEvent<{ matchedIndices: Set<number> }>): void;
  _handleQueryChanged(event: CustomEvent<{ query: FilterQuery }>): void;
  _handleQueryReset(): void;
  updateComplete: Promise<unknown>;
}

/** Build a full dataset of `count` proteins: p0, p1, … p{count-1}. */
function makeFullData(count: number): ProtspaceData {
  return {
    protein_ids: Array.from({ length: count }, (_, i) => `p${i}`),
  };
}

function applyEvent(matchedIndices: Set<number>): CustomEvent<{ matchedIndices: Set<number> }> {
  return new CustomEvent('query-apply', { detail: { matchedIndices } });
}

describe('control-bar filter query apply', () => {
  let controlBar: ControlBarInternals;
  let scatter: StubScatterplot;

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as ControlBarInternals;
    controlBar.autoSync = false;
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;

    scatter = {
      // sentinel selection — must survive a filter apply untouched
      selectedProteinIds: ['sentinel'],
      isolateSelection: vi.fn(),
      resetIsolation: vi.fn(),
      // getCurrentData returns the *isolated subset*. The old buggy code used this
      // to translate matched indices; the fix must never read it for translation.
      getCurrentData: vi.fn(() => ({ protein_ids: ['p0', 'p1'] })),
      getMaterializedData: vi.fn(() => makeFullData(100)),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    controlBar._scatterplotElement = scatter;
    // The query builder evaluates against the full materialized data, exposed as
    // _currentData. Matched indices are positions in THIS array.
    controlBar._currentData = makeFullData(100);
  });

  it('applies a query via the filter channel without selecting or isolating', () => {
    // family "A" = first 30 proteins
    const matched = new Set(Array.from({ length: 30 }, (_, i) => i));

    controlBar._handleQueryApply(applyEvent(matched));

    const expectedIds = Array.from({ length: 30 }, (_, i) => `p${i}`);
    expect(scatter.filteredProteinIds).toEqual(expectedIds);
    expect(scatter.filtersActive).toBe(true);
    expect(controlBar.filterActive).toBe(true);

    // A filter is not an isolation and not a selection.
    expect(scatter.isolateSelection).not.toHaveBeenCalled();
    expect(scatter.selectedProteinIds).toEqual(['sentinel']);
  });

  it('is idempotent: re-applying the same query yields the same matches', () => {
    const matched = new Set(Array.from({ length: 30 }, (_, i) => i));
    const expectedIds = Array.from({ length: 30 }, (_, i) => `p${i}`);

    controlBar._handleQueryApply(applyEvent(matched));
    expect(scatter.filteredProteinIds).toEqual(expectedIds);

    // Second apply with the unchanged query — must NOT shrink (was 30 → 19 → fade).
    controlBar._handleQueryApply(applyEvent(new Set(matched)));
    expect(scatter.filteredProteinIds).toEqual(expectedIds);
    expect(scatter.filtersActive).toBe(true);

    // Third apply — still stable, still no isolation stacking.
    controlBar._handleQueryApply(applyEvent(new Set(matched)));
    expect(scatter.filteredProteinIds).toEqual(expectedIds);
    expect(scatter.isolateSelection).not.toHaveBeenCalled();
  });

  it('replaces (does not stack) when a narrower query is applied next', () => {
    controlBar._handleQueryApply(applyEvent(new Set(Array.from({ length: 30 }, (_, i) => i))));
    expect(scatter.filteredProteinIds).toHaveLength(30);

    controlBar._handleQueryApply(applyEvent(new Set(Array.from({ length: 12 }, (_, i) => i))));
    expect(scatter.filteredProteinIds).toEqual(Array.from({ length: 12 }, (_, i) => `p${i}`));
  });

  it('clears the filter channel on reset, leaving manual isolation alone', () => {
    controlBar._handleQueryApply(applyEvent(new Set([0, 1, 2])));
    expect(scatter.filtersActive).toBe(true);

    controlBar._handleQueryReset();

    expect(scatter.filteredProteinIds).toEqual([]);
    expect(scatter.filtersActive).toBe(false);
    expect(controlBar.filterActive).toBe(false);
    // Reset re-seeds an empty condition row so the builder shows a fresh query.
    expect(controlBar.filterQuery).toHaveLength(1);
  });
});

/**
 * Two-way mirror between the legend reliability slider and the query filter (#6b).
 * Forward: `setEatConfidenceThreshold(base, x)` upserts `EAT_confidence >= x`
 * carrying the N/A presence chip for x>0 and removes it for x<=0, running the
 * same apply path as a real query.
 * Reverse: a query change carrying (or dropping) that condition emits
 * `eat-threshold-mirror` so the slider can follow. The eat-confidence column is
 * resolved by runtime identity, not the `__eat_confidence` string suffix, so the
 * collision-renamed `__runtime_N` variant is handled too.
 */
const EAT_KEY = 'family__eat_confidence__runtime_2';

/**
 * 20 proteins: p0–p4 curated (null confidence), p5–p19 predicted with
 * confidence i/20 (0.25 … 0.95). The eat-confidence column carries an explicit
 * runtime role/base so the control bar can find it without the suffix.
 */
function makeEatData(): ProtspaceData {
  const count = 20;
  return {
    protein_ids: Array.from({ length: count }, (_, i) => `p${i}`),
    annotations: {
      family: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
      [EAT_KEY]: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'family' },
      },
    },
    numeric_annotation_data: {
      [EAT_KEY]: Array.from({ length: count }, (_, i) => (i < 5 ? null : i / 20)),
    },
  };
}

/**
 * Mounts a control bar wired to a stub scatter plot. The stub is a hand-maintained
 * contract with the component — every method the control bar reaches for through
 * `_scatterplotElement` — so it is stated once: a copy per describe block meant a new
 * call surfaced as `TypeError: sp.foo is not a function` inside the component, reading
 * as a component bug rather than a fixture gap.
 *
 * `selectedAnnotation` matters because the reverse mirror is scoped to the SELECTED
 * base's eat-confidence column; it is what makes the derived threshold resolve.
 */
async function mountControlBar(
  makeData: () => ProtspaceData,
  selectedAnnotation?: string,
): Promise<{ controlBar: ControlBarInternals; scatter: StubScatterplot }> {
  document.body.innerHTML = '';
  const controlBar = document.createElement('protspace-control-bar') as ControlBarInternals;
  controlBar.autoSync = false;
  document.body.appendChild(controlBar);
  await controlBar.updateComplete;

  const scatter: StubScatterplot = {
    selectedProteinIds: ['sentinel'],
    isolateSelection: vi.fn(),
    resetIsolation: vi.fn(),
    getCurrentData: vi.fn(() => makeData()),
    getMaterializedData: vi.fn(() => makeData()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  controlBar._scatterplotElement = scatter;
  controlBar._currentData = makeData();
  if (selectedAnnotation !== undefined) controlBar.selectedAnnotation = selectedAnnotation;
  await controlBar.updateComplete;

  return { controlBar, scatter };
}

/** The column's live reliability condition, which is always the first (and only) one. */
function eatCondition(query: FilterQuery, key: string = EAT_KEY): NumericCondition | undefined {
  return findConditionsForAnnotation(query, key)[0];
}

describe('control-bar EAT reliability slider <-> query mirror', () => {
  let controlBar: ControlBarInternals;
  let scatter: StubScatterplot;

  beforeEach(async () => {
    ({ controlBar, scatter } = await mountControlBar(makeEatData, 'family'));
  });

  it('forward: upserts a single "EAT_confidence >= x or N/A" condition and applies it', () => {
    controlBar.setEatConfidenceThreshold('family', 0.5);

    const eat = eatCondition(controlBar.filterQuery);
    expect(eat).toMatchObject({
      kind: 'numeric',
      annotation: EAT_KEY,
      operator: 'gte',
      min: 0.5,
      presence: [NA_VALUE],
    });
    // Un-negated: the N/A chip is what retains curated points now, not NOT.
    expect(eat?.logicalOp).not.toBe('NOT');
    expect(controlBar.filterQuery).toHaveLength(1);
    expect(scatter.filtersActive).toBe(true);
    expect(controlBar.filterActive).toBe(true);

    // Kept = curated (p0–p4, null confidence) + predictions >= 0.5 (p10–p19).
    // Hidden = predictions below 0.5 (p5–p9).
    const kept = scatter.filteredProteinIds ?? [];
    expect(kept).toContain('p0');
    expect(kept).toContain('p4');
    expect(kept).not.toContain('p5');
    expect(kept).not.toContain('p9');
    expect(kept).toContain('p10');
    expect(kept).toContain('p19');
    expect(kept).toHaveLength(15);

    // A filter is not a selection.
    expect(scatter.selectedProteinIds).toEqual(['sentinel']);
  });

  it('forward: re-applying with a new threshold replaces (does not stack) the condition', () => {
    controlBar.setEatConfidenceThreshold('family', 0.5);
    controlBar.setEatConfidenceThreshold('family', 0.8);

    expect(controlBar.filterQuery.filter((i) => 'kind' in i && i.kind === 'numeric')).toHaveLength(
      1,
    );
    expect(eatCondition(controlBar.filterQuery)).toMatchObject({
      min: 0.8,
    });
    // Kept = curated (5) + predictions >= 0.8 (p16–p19 = 4) = 9.
    expect(scatter.filteredProteinIds).toHaveLength(9);
  });

  it('forward: seeds against the current dataset, not a stale _currentData (dataset switch)', () => {
    // Simulate a dataset switch mid-seed: `_currentData` still holds the PREVIOUS
    // dataset (different ids, all-curated), while the scatter plot already exposes
    // the NEW one via getMaterializedData. The seed must derive against the NEW
    // dataset — reading it directly removes any data-change timing dependency.
    const staleData: ProtspaceData = {
      protein_ids: Array.from({ length: 20 }, (_, i) => `old${i}`),
      annotations: {
        family: { kind: 'categorical', values: ['A'], colors: ['#000'], shapes: ['circle'] },
        [EAT_KEY]: {
          kind: 'numeric',
          values: [],
          runtime: { role: 'eat-confidence', baseAnnotation: 'family' },
        },
      },
      // All curated (null): a 0.5 filter against stale data would keep all 20 old ids.
      numeric_annotation_data: { [EAT_KEY]: Array.from({ length: 20 }, () => null) },
    };
    controlBar._currentData = staleData;

    controlBar.setEatConfidenceThreshold('family', 0.5);

    // Derived against the NEW dataset (makeEatData: "p" ids, 5 curated + 15 kept),
    // never the stale "old" ids.
    const kept = scatter.filteredProteinIds ?? [];
    expect(kept.every((id) => id.startsWith('p'))).toBe(true);
    expect(kept).toHaveLength(15);
  });

  it('forward: dragging to 0 removes the eat condition and clears the filter channel', () => {
    controlBar.setEatConfidenceThreshold('family', 0.5);
    expect(scatter.filtersActive).toBe(true);

    controlBar.setEatConfidenceThreshold('family', 0);

    expect(eatCondition(controlBar.filterQuery)).toBeUndefined();
    expect(controlBar.filterQuery).toHaveLength(0);
    expect(scatter.filtersActive).toBe(false);
    expect(scatter.filteredProteinIds).toEqual([]);
    expect(controlBar.filterActive).toBe(false);
  });

  it('reverse: emits eat-threshold-mirror when a query change adds or drops the condition', () => {
    const mirror = vi.fn();
    controlBar.addEventListener('eat-threshold-mirror', mirror as EventListener);

    controlBar._handleQueryChanged(
      new CustomEvent('query-changed', {
        detail: {
          query: [
            {
              id: 'x',
              kind: 'numeric',
              annotation: EAT_KEY,
              operator: 'gte',
              min: 0.6,
              max: null,
              presence: [NA_VALUE],
            },
          ],
        },
      }),
    );
    expect(mirror).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ value: 0.6 }) }),
    );

    controlBar._handleQueryChanged(new CustomEvent('query-changed', { detail: { query: [] } }));
    expect(mirror).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ value: 0 }) }),
    );
  });

  it('guards the loop: a query change echoing the forward value does not re-emit', () => {
    controlBar.setEatConfidenceThreshold('family', 0.5);

    const mirror = vi.fn();
    controlBar.addEventListener('eat-threshold-mirror', mirror as EventListener);

    // The query-builder re-broadcasts the current query (same 0.5) — no new value.
    controlBar._handleQueryChanged(
      new CustomEvent('query-changed', { detail: { query: controlBar.filterQuery } }),
    );
    expect(mirror).not.toHaveBeenCalled();
  });

  it('keeps a mode that constrains nothing, across an unrelated query edit', () => {
    // Start from a freshly loaded dataset: `clearForNewDataset` empties the per-column
    // record, and the colour-by annotation is unchanged so nothing repopulates it.
    controlBar.clearForNewDataset('hash');
    controlBar._currentData = makeEatData();
    controlBar.selectedAnnotation = 'family';

    // "Hide above" picked before its bound is moved constrains nothing, so the forward
    // mirror emits no condition and returns early. It must still record the position:
    // otherwise the next unrelated edit finds no entry, and pushing the `atLeast`
    // default back snaps the legend's mode select off "Hide above".
    controlBar.setEatReliability('family', { mode: 'atMost', min: 0, max: 1 });

    const mirror = vi.fn();
    controlBar.addEventListener('eat-threshold-mirror', mirror as EventListener);

    controlBar._handleQueryChanged(
      new CustomEvent('query-changed', {
        detail: {
          query: [{ id: 'other', kind: 'numeric', annotation: 'length', operator: 'gt', min: 10 }],
        },
      }),
    );

    expect(mirror).not.toHaveBeenCalled();
  });

  it('guards the loop for a condition that is not first in the query', () => {
    // The builder gives every row after the first an `AND`, and the reliability
    // condition is emitted bare — so comparing the raw logicalOp made the guard miss,
    // and every repeat emit rebuilt the query and re-evaluated the whole dataset.
    controlBar._handleQueryChanged(
      new CustomEvent('query-changed', {
        detail: {
          query: [
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
          ],
        },
      }),
    );

    const before = controlBar.filterQuery;
    controlBar.setEatReliability('family', { mode: 'atLeast', min: 0.5, max: 1 });

    // Identity, not equality: the guard must skip the rewrite entirely.
    expect(controlBar.filterQuery).toBe(before);
  });
});

/**
 * Per-annotation (per base) reliability filter. With two EAT base annotations
 * transferred (e.g. EC and GO), each base owns its own `NOT(<base>_eat < x)`
 * condition. Tuning one base's slider must not clobber or misread another's, and
 * the reverse mirror must reflect the SELECTED base's threshold — so switching
 * the color-by annotation moves the slider to that base's value.
 */
const EC_KEY = 'ec__eat_confidence__runtime_1';
const GO_KEY = 'go__eat_confidence__runtime_2';

function makeMultiEatData(): ProtspaceData {
  const count = 20;
  return {
    protein_ids: Array.from({ length: count }, (_, i) => `p${i}`),
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
    numeric_annotation_data: {
      [EC_KEY]: Array.from({ length: count }, (_, i) => (i < 5 ? null : i / 20)),
      [GO_KEY]: Array.from({ length: count }, (_, i) => (i < 5 ? null : i / 20)),
    },
  };
}

describe('control-bar per-base EAT reliability filter (multi-EAT)', () => {
  let controlBar: ControlBarInternals;

  beforeEach(async () => {
    ({ controlBar } = await mountControlBar(makeMultiEatData));
  });

  it('scopes the condition to the base: setting GO does not clobber EC', () => {
    controlBar.setEatConfidenceThreshold('ec', 0.5);
    controlBar.setEatConfidenceThreshold('go', 0.8);

    const numericConditions = controlBar.filterQuery.filter(
      (i) => 'kind' in i && i.kind === 'numeric',
    );
    expect(numericConditions).toHaveLength(2);

    // Both bases' conditions coexist with their own thresholds.
    expect(findConditionsForAnnotation(controlBar.filterQuery, EC_KEY)[0]).toMatchObject({
      operator: 'gte',
      presence: [NA_VALUE],
      min: 0.5,
    });
    expect(findConditionsForAnnotation(controlBar.filterQuery, GO_KEY)[0]).toMatchObject({
      operator: 'gte',
      presence: [NA_VALUE],
      min: 0.8,
    });
  });

  it('retuning one base rewrites only its own condition, preserving the other', () => {
    controlBar.setEatConfidenceThreshold('ec', 0.5);
    controlBar.setEatConfidenceThreshold('go', 0.8);
    controlBar.setEatConfidenceThreshold('ec', 0.3);

    expect(findConditionsForAnnotation(controlBar.filterQuery, EC_KEY)[0]).toMatchObject({
      min: 0.3,
    });
    expect(findConditionsForAnnotation(controlBar.filterQuery, GO_KEY)[0]).toMatchObject({
      min: 0.8,
    });
    expect(controlBar.filterQuery.filter((i) => 'kind' in i && i.kind === 'numeric')).toHaveLength(
      2,
    );
  });

  it('dragging one base to 0 removes only its condition, leaving the other', () => {
    controlBar.setEatConfidenceThreshold('ec', 0.5);
    controlBar.setEatConfidenceThreshold('go', 0.8);
    controlBar.setEatConfidenceThreshold('ec', 0);

    expect(findConditionsForAnnotation(controlBar.filterQuery, EC_KEY)[0]).toBeUndefined();
    expect(findConditionsForAnnotation(controlBar.filterQuery, GO_KEY)[0]).toMatchObject({
      min: 0.8,
    });
  });

  it('reverse mirror follows the SELECTED base when the annotation switches', async () => {
    controlBar.setEatConfidenceThreshold('ec', 0.5);
    controlBar.setEatConfidenceThreshold('go', 0.8);

    const mirror = vi.fn();
    controlBar.addEventListener('eat-threshold-mirror', mirror as EventListener);

    controlBar.selectedAnnotation = 'ec';
    await controlBar.updateComplete;
    expect(mirror).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ value: 0.5 }) }),
    );

    controlBar.selectedAnnotation = 'go';
    await controlBar.updateComplete;
    expect(mirror).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ value: 0.8 }) }),
    );
  });
});

/**
 * #380 — "make the EAT reliability filtering work for all kind of different
 * settings: smaller then, larger then, and between and sync between filter and drag."
 *
 * The mirror used to recognise exactly one condition shape, `NOT(conf < X)` matched on
 * operator AND logical op, at the top level only. Everything else was invisible: a
 * drag appended a second, contradictory condition instead of replacing the first, and
 * the slider read 0% while the plot was heavily filtered.
 */
describe('control-bar EAT reliability filter — all operators (#380)', () => {
  let controlBar: ControlBarInternals;
  let scatter: StubScatterplot;

  beforeEach(async () => {
    ({ controlBar, scatter } = await mountControlBar(makeEatData, 'family'));
  });

  // A hand-built condition on the eat-confidence column IS the reliability filter,
  // whatever operator it carries, so the slider must replace it rather than AND a
  // second, contradictory condition beside it (#380). `gt` is the query builder's
  // default for an eat-confidence column, so it is the likeliest thing on screen;
  // a NON-negated `lt` is the one that used to blank the canvas, because
  // `conf < 0.5 AND NOT(conf < 0.5)` is the empty set and that was pushed as an
  // ACTIVE filter with no way back.
  it.each([
    ['greater than', { operator: 'gt' as const, min: 0.5, max: null }],
    ['between', { operator: 'between' as const, min: 0.4, max: 0.9 }],
    ['non-negated less than', { operator: 'lt' as const, min: null, max: 0.5 }],
  ])('replaces a hand-built "%s" rather than appending beside it', (_name, seed) => {
    controlBar._handleQueryChanged(
      new CustomEvent('query-changed', {
        detail: { query: [{ id: 'x', kind: 'numeric', annotation: EAT_KEY, ...seed }] },
      }),
    );

    controlBar.setEatConfidenceThreshold('family', 0.5);

    expect(findConditionsForAnnotation(controlBar.filterQuery, EAT_KEY)).toHaveLength(1);
    // And the plot keeps points: the replacement is a single coherent condition, not
    // an unsatisfiable pair.
    expect(scatter.filteredProteinIds?.length ?? 0).toBeGreaterThan(0);
  });

  it('never hides the curated points, in any mode', () => {
    // p0-p4 carry a null confidence: they are curated, and the slider's own help text
    // promises they always stay visible. The N/A presence chip is what keeps them:
    // no comparison can match a null, and under #416's NOT ("has a value AND does not
    // match") the old negated spelling would hide them instead.
    const curated = ['p0', 'p1', 'p2', 'p3', 'p4'];
    const modes = [
      { mode: 'atLeast' as const, min: 0.5, max: 1 },
      { mode: 'atMost' as const, min: 0, max: 0.5 },
      { mode: 'between' as const, min: 0.4, max: 0.8 },
    ];

    for (const state of modes) {
      controlBar.setEatReliability('family', state);
      for (const id of curated) {
        expect(scatter.filteredProteinIds).toContain(id);
      }
    }
  });

  it('applies an upper bound that actually removes the high-confidence points', () => {
    controlBar.setEatReliability('family', { mode: 'atMost', min: 0, max: 0.5 });
    // p19 has confidence 0.95 — above the bound, so it must be gone; p5 (0.25) stays.
    expect(scatter.filteredProteinIds).not.toContain('p19');
    expect(scatter.filteredProteinIds).toContain('p5');
  });

  it('applies a band from both sides', () => {
    controlBar.setEatReliability('family', { mode: 'between', min: 0.4, max: 0.6 });
    expect(scatter.filteredProteinIds).not.toContain('p5'); // 0.25, below the band
    expect(scatter.filteredProteinIds).not.toContain('p19'); // 0.95, above the band
    expect(scatter.filteredProteinIds).toContain('p10'); // 0.50, inside
  });

  it('finds and replaces a reliability condition nested in a group', () => {
    controlBar._handleQueryChanged(
      new CustomEvent('query-changed', {
        detail: {
          query: [
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
          ],
        },
      }),
    );

    controlBar.setEatConfidenceThreshold('family', 0.7);

    // Exactly one reliability condition survives, at any depth — the nested one was
    // replaced in place rather than left behind and duplicated at top level.
    const conditions = findConditionsForAnnotation(controlBar.filterQuery, EAT_KEY);
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toMatchObject({ operator: 'gte', min: 0.7 });
  });

  it('does not blank the plot when the query matches nothing', () => {
    // Start from a live filter, so the empty apply has to actively release the channel
    // rather than just decline to touch it.
    controlBar._handleQueryApply(applyEvent(new Set([5, 6, 7])));
    expect(scatter.filtersActive).toBe(true);

    // An active-but-empty filter channel reads as "hide everything" downstream, and
    // there is no way back: Apply is disabled at 0 matches and Cancel does not revert.
    controlBar._handleQueryApply(applyEvent(new Set<number>()));

    expect(scatter.filtersActive).toBe(false);
    expect(scatter.filteredProteinIds ?? []).toHaveLength(0);
    expect(controlBar.filterActive).toBe(false);
  });
});
