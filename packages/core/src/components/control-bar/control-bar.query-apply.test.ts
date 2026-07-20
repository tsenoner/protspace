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
import type { FilterQuery } from './query-types';
import type { ProtspaceData } from './types';

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
  filterActive: boolean;
  filterQuery: FilterQuery;
  _lastEmittedThreshold: number;
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
 * Forward: `setEatConfidenceThreshold(base, x)` upserts `NOT(EAT_confidence < x)`
 * for x>0 and removes it for x<=0, running the same apply path as a real query.
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

function eatCondition(query: FilterQuery) {
  return query.find(
    (item) => 'kind' in item && item.kind === 'numeric' && item.annotation === EAT_KEY,
  );
}

describe('control-bar EAT reliability slider <-> query mirror', () => {
  let controlBar: ControlBarInternals;
  let scatter: StubScatterplot;

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as ControlBarInternals;
    controlBar.autoSync = false;
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;

    scatter = {
      selectedProteinIds: ['sentinel'],
      isolateSelection: vi.fn(),
      resetIsolation: vi.fn(),
      getCurrentData: vi.fn(() => makeEatData()),
      getMaterializedData: vi.fn(() => makeEatData()),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    controlBar._scatterplotElement = scatter;
    controlBar._currentData = makeEatData();
  });

  it('forward: upserts a single NOT(EAT_confidence < x) condition and applies it', () => {
    controlBar.setEatConfidenceThreshold('family', 0.5);

    const eat = eatCondition(controlBar.filterQuery);
    expect(eat).toMatchObject({
      kind: 'numeric',
      annotation: EAT_KEY,
      operator: 'lt',
      max: 0.5,
      logicalOp: 'NOT',
    });
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
    expect(eatCondition(controlBar.filterQuery)).toMatchObject({ max: 0.8 });
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
              operator: 'lt',
              min: null,
              max: 0.6,
              logicalOp: 'NOT',
            },
          ],
        },
      }),
    );
    expect(mirror).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { value: 0.6 } }));

    controlBar._handleQueryChanged(new CustomEvent('query-changed', { detail: { query: [] } }));
    expect(mirror).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { value: 0 } }));
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
});
