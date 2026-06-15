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
  _handleQueryApply(event: CustomEvent<{ matchedIndices: Set<number> }>): void;
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
