/**
 * @vitest-environment jsdom
 *
 * Apply-gating contract for the query builder.
 *
 * Regression coverage: the builder seeds one unconfigured condition when the
 * filter popover opens, and unconfigured conditions intentionally evaluate as
 * match-all no-ops (so partial queries show live counts). Apply used to be
 * gated only on `matchedIndices.size === 0`, so the seeded no-op query — which
 * matches every protein — could be applied, lighting up the control bar's
 * filter-active badge without any actual filter. Apply must stay disabled
 * until at least one condition is configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './query-builder';
import { createCondition } from './query-types';
import type { FilterQuery } from './query-types';
import type { ProtspaceData } from './types';

interface QueryBuilderInternals extends HTMLElement {
  annotations: string[];
  data: ProtspaceData | undefined;
  query: FilterQuery;
  _handleApply(): void;
  _handleConditionRemoved(e: CustomEvent<{ id: string }>, groupId: string | null): void;
  updateComplete: Promise<unknown>;
}

function makeData(): ProtspaceData {
  return {
    protein_ids: ['P1', 'P2', 'P3', 'P4', 'P5'],
    annotations: { organism: { values: ['Human', 'Mouse'] } },
    // P1,P3 = Human; P2,P4,P5 = Mouse
    annotation_data: { organism: [[0], [1], [0], [1], [1]] },
  };
}

describe('query-builder Apply gating', () => {
  let builder: QueryBuilderInternals;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    builder = document.createElement('protspace-query-builder') as QueryBuilderInternals;
    builder.annotations = ['organism'];
    builder.data = makeData();
    document.body.appendChild(builder);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Flush the debounced match-count evaluation, then re-render. */
  async function settle() {
    await builder.updateComplete;
    vi.advanceTimersByTime(300);
    await builder.updateComplete;
  }

  function applyButton(): HTMLButtonElement {
    const btn = builder.shadowRoot?.querySelector<HTMLButtonElement>('.btn-primary');
    if (!btn) throw new Error('Apply button not found');
    return btn;
  }

  it('keeps Apply disabled for the seeded unconfigured condition, even though it matches all proteins', async () => {
    builder.query = [createCondition()];
    await settle();

    expect(applyButton().disabled).toBe(true);
  });

  it('enables Apply once a condition is configured', async () => {
    builder.query = [createCondition({ annotation: 'organism', values: ['Human'] })];
    await settle();

    expect(applyButton().disabled).toBe(false);
  });

  it('does not dispatch query-apply for an unconfigured query (defense for non-click paths)', async () => {
    builder.query = [createCondition()];
    await settle();

    const onApply = vi.fn();
    builder.addEventListener('query-apply', onApply);
    builder._handleApply();

    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps Apply disabled for a configured condition OR a match-all empty condition (result is all proteins)', async () => {
    builder.query = [
      createCondition({ annotation: 'organism', values: ['Human'] }),
      createCondition({ logicalOp: 'OR' }),
    ];
    await settle();

    // Human{2} OR empty{all} = all 5 → filters nothing → Apply disabled.
    expect(applyButton().disabled).toBe(true);
  });

  it('does not dispatch query-apply when the result matches every protein (defense for non-click paths)', async () => {
    builder.query = [
      createCondition({ annotation: 'organism', values: ['Human'] }),
      createCondition({ logicalOp: 'OR' }),
    ];
    await settle();

    const onApply = vi.fn();
    builder.addEventListener('query-apply', onApply);
    builder._handleApply();

    expect(onApply).not.toHaveBeenCalled();
  });

  it('dispatches query-apply for a genuine partial filter (match-all gate is not over-broad)', async () => {
    builder.query = [createCondition({ annotation: 'organism', values: ['Human'] })];
    await settle();

    // Human → 2 of 5 → a real filter.
    expect(applyButton().disabled).toBe(false);

    const onApply = vi.fn();
    builder.addEventListener('query-apply', onApply);
    builder._handleApply();

    expect(onApply).toHaveBeenCalledTimes(1);
  });
});

describe('query-builder removal normalizes the new first item operator', () => {
  let builder: QueryBuilderInternals;

  beforeEach(() => {
    document.body.innerHTML = '';
    builder = document.createElement('protspace-query-builder') as QueryBuilderInternals;
    builder.annotations = ['organism'];
    builder.data = makeData();
    document.body.appendChild(builder);
  });

  function removeAndCaptureQuery(removeId: string): FilterQuery {
    let captured: FilterQuery | undefined;
    builder.addEventListener('query-changed', (e: Event) => {
      captured = (e as CustomEvent<{ query: FilterQuery }>).detail.query;
    });
    builder._handleConditionRemoved(
      new CustomEvent('condition-removed', { detail: { id: removeId } }),
      null,
    );
    if (!captured) throw new Error('query-changed not dispatched');
    return captured;
  }

  it("clears a leftover 'OR' on the new first item after removing the original first", () => {
    const a = createCondition();
    const b = createCondition({ logicalOp: 'OR' });
    builder.query = [a, b];

    const result = removeAndCaptureQuery(a.id);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(b.id);
    expect(result[0].logicalOp).toBeUndefined();
  });

  it("clears a leftover 'AND' on the new first item after removing the original first", () => {
    const a = createCondition();
    const b = createCondition({ logicalOp: 'AND' });
    builder.query = [a, b];

    const result = removeAndCaptureQuery(a.id);

    expect(result[0].id).toBe(b.id);
    expect(result[0].logicalOp).toBeUndefined();
  });

  it("preserves a leftover 'NOT' on the new first item (displayable and meaningful)", () => {
    const a = createCondition();
    const b = createCondition({ logicalOp: 'NOT' });
    builder.query = [a, b];

    const result = removeAndCaptureQuery(a.id);

    expect(result[0].id).toBe(b.id);
    expect(result[0].logicalOp).toBe('NOT');
  });
});
