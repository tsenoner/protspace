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
});
