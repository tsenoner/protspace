/**
 * @vitest-environment jsdom
 *
 * Apply-gating contract for the query builder.
 *
 * Unconfigured conditions evaluate as match-all no-ops (so partial queries show live counts), so
 * Apply must stay disabled until a condition is configured, and a query that keeps every protein
 * filters nothing either. Apply now also says why it is disabled (design decision 14), and it is
 * enabled only while the host marks the query `dirty`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './query-builder';
import { createCondition, createGroup } from './query-types';
import type { FilterQuery } from './query-types';
import type { ProtspaceData } from './types';

interface QueryBuilderInternals extends HTMLElement {
  annotations: string[];
  data: ProtspaceData | undefined;
  query: FilterQuery;
  dirty: boolean | null;
  embedded: boolean;
  _handleApply(): void;
  _handleConditionRemoved(e: CustomEvent<{ id: string }>, groupId: string | null): void;
  updateComplete: Promise<unknown>;
}

type KitButton = HTMLElement & { disabled: boolean };

function makeData(): ProtspaceData {
  return {
    protein_ids: ['P1', 'P2', 'P3', 'P4', 'P5'],
    annotations: { organism: { values: ['Human', 'Mouse'] } },
    // P1,P3 = Human; P2,P4,P5 = Mouse
    annotation_data: { organism: [[0], [1], [0], [1], [1]] },
  };
}

/** `count` proteins, every one Human. */
function makeHumanData(count: number): ProtspaceData {
  return {
    protein_ids: Array.from({ length: count }, (_, i) => `P${i}`),
    annotations: { organism: { values: ['Human', 'Mouse'] } },
    annotation_data: { organism: Array.from({ length: count }, () => [0]) },
  };
}

const human = () => createCondition({ annotation: 'organism', values: ['Human'] });
const mouseOr = () =>
  createCondition({ annotation: 'organism', values: ['Mouse'], logicalOp: 'OR' });

describe('query-builder Apply gating', () => {
  let builder: QueryBuilderInternals;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    builder = document.createElement('protspace-query-builder') as QueryBuilderInternals;
    builder.annotations = ['organism'];
    builder.data = makeData();
    builder.dirty = true;
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

  const shadow = () => builder.shadowRoot!;
  const applyButton = () => shadow().querySelector('.query-footer-apply') as KitButton;
  const cancelButton = () => shadow().querySelector('.query-footer-cancel') as KitButton;
  const reason = () => shadow().querySelector('#apply-reason')!.textContent!.trim();
  const countLine = () => shadow().querySelector('.match-count')!;

  it('keeps Apply disabled for the seeded unconfigured condition and asks for an annotation', async () => {
    builder.query = [createCondition()];
    await settle();

    expect(applyButton().disabled).toBe(true);
    expect(reason()).toBe('Choose an annotation to filter by');
  });

  it('enables Apply once a condition is configured, with no reason shown', async () => {
    builder.query = [human()];
    await settle();

    expect(applyButton().disabled).toBe(false);
    expect(reason()).toBe('');
  });

  it('announces the reason when it changes (a polite live region)', async () => {
    builder.query = [createCondition()];
    await settle();
    expect(shadow().querySelector('#apply-reason')!.getAttribute('aria-live')).toBe('polite');
  });

  it('names the condition that still needs a value', async () => {
    builder.query = [human(), createCondition({ annotation: 'organism', logicalOp: 'AND' })];
    await settle();

    expect(applyButton().disabled).toBe(true);
    expect(reason()).toBe('Choose a value for condition 2');
  });

  it('keeps Apply disabled, with no reason, while the count is pending', async () => {
    builder.query = [human()];
    await builder.updateComplete;

    expect(applyButton().disabled).toBe(true);
    expect(reason()).toBe('');
  });

  it('does not dispatch query-apply for an unconfigured query (defense for non-click paths)', async () => {
    builder.query = [createCondition()];
    await settle();

    const onApply = vi.fn();
    builder.addEventListener('query-apply', onApply);
    builder._handleApply();

    expect(onApply).not.toHaveBeenCalled();
  });

  it('leaves an empty condition joined with "or" out of the count', async () => {
    builder.query = [human(), createCondition({ logicalOp: 'OR' })];
    await settle();

    // The empty row waits for an annotation and matches nothing yet: Human alone, 2 of 5.
    expect(countLine().textContent!.trim()).toBe('2 of 5 proteins match');
    expect(applyButton().disabled).toBe(false);
  });

  it('keeps Apply disabled when the conditions together keep every protein', async () => {
    builder.query = [human(), mouseOr()];
    await settle();

    // Human{2} OR Mouse{3} = all 5 → filters nothing → Apply disabled.
    expect(applyButton().disabled).toBe(true);
    expect(reason()).toBe('Every protein matches; nothing to filter');
  });

  it('does not dispatch query-apply when the result matches every protein (defense for non-click paths)', async () => {
    builder.query = [human(), mouseOr()];
    await settle();

    const onApply = vi.fn();
    builder.addEventListener('query-apply', onApply);
    builder._handleApply();

    expect(onApply).not.toHaveBeenCalled();
  });

  it('dispatches query-apply for a genuine partial filter (match-all gate is not over-broad)', async () => {
    builder.query = [human()];
    await settle();

    // Human → 2 of 5 → a real filter.
    expect(applyButton().disabled).toBe(false);

    const onApply = vi.fn();
    builder.addEventListener('query-apply', onApply);
    builder._handleApply();

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('query-apply is not dispatched while blocked: a clean query says there is nothing to apply', async () => {
    builder.dirty = false;
    builder.query = [human()];
    await settle();

    expect(applyButton().disabled).toBe(true);
    expect(reason()).toBe('No changes to apply');
    const onApply = vi.fn();
    builder.addEventListener('query-apply', onApply);
    builder._handleApply();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('without a host-set dirty, Apply follows the count alone', async () => {
    builder.dirty = null;
    builder.query = [human()];
    await settle();

    expect(applyButton().disabled).toBe(false);
    expect(cancelButton().disabled).toBe(false);
  });

  it('Cancel dispatches query-cancel and is disabled when not dirty', async () => {
    builder.query = [human()];
    await settle();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    builder.addEventListener('query-cancel', onCancel);
    builder.addEventListener('query-close', onClose);

    expect(cancelButton().disabled).toBe(false);
    cancelButton().click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    builder.dirty = false;
    await builder.updateComplete;
    expect(cancelButton().disabled).toBe(true);
  });

  it('the count line is role=status with grouped, plural-aware text', async () => {
    builder.query = [human()];
    await settle();
    expect(countLine().getAttribute('role')).toBe('status');
    expect(countLine().getAttribute('aria-live')).toBe('polite');
    expect(countLine().textContent!.trim()).toBe('2 of 5 proteins match');

    builder.data = makeHumanData(1234);
    await settle();
    expect(countLine().textContent!.trim()).toBe('1,234 of 1,234 proteins match');

    builder.data = makeHumanData(1);
    await settle();
    expect(countLine().textContent!.trim()).toBe('1 of 1 protein match');
  });

  it('names the footer buttons Reset, Cancel and Apply', async () => {
    builder.query = [human()];
    await settle();
    expect(
      ['.query-footer-reset', '.query-footer-cancel', '.query-footer-apply'].map((selector) =>
        shadow().querySelector(selector)!.textContent!.trim(),
      ),
    ).toEqual(['Reset', 'Cancel', 'Apply']);
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

describe('query-builder embedded in a host', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  async function mountEmbedded(): Promise<QueryBuilderInternals> {
    const builder = document.createElement('protspace-query-builder') as QueryBuilderInternals;
    builder.embedded = true;
    builder.annotations = ['organism'];
    builder.data = makeData();
    builder.query = [createCondition()];
    document.body.appendChild(builder);
    await builder.updateComplete;
    return builder;
  }

  it('embedded hides the title and close button and keeps the match count and the footer', async () => {
    const builder = await mountEmbedded();
    const root = builder.shadowRoot!;

    expect(builder.hasAttribute('embedded')).toBe(true);
    expect(root.querySelector('.query-header')).toBeNull();
    expect(root.querySelector('.btn-close')).toBeNull();
    expect(root.querySelector('.match-count')).not.toBeNull();
    expect(root.querySelector('.query-footer-reset')).not.toBeNull();
  });

  it('embedded leaves Escape to the host', async () => {
    const builder = await mountEmbedded();
    const onClose = vi.fn();
    builder.addEventListener('query-close', onClose);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('standalone, the close button and Escape dispatch query-close', async () => {
    const builder = document.createElement('protspace-query-builder') as QueryBuilderInternals;
    builder.query = [createCondition()];
    document.body.appendChild(builder);
    await builder.updateComplete;
    const onClose = vi.fn();
    builder.addEventListener('query-close', onClose);

    (builder.shadowRoot!.querySelector('.btn-close') as HTMLElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('query-builder value count bases', () => {
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

  /** Each card's count base, in card order: sorted indices, or null for the whole dataset. */
  async function bases(query: FilterQuery) {
    builder.query = query;
    await builder.updateComplete;
    vi.advanceTimersByTime(300);
    await builder.updateComplete;
    return [...builder.shadowRoot!.querySelectorAll('protspace-query-condition-row')].map((row) => {
      const set = (row as HTMLElement & { matchedIndices: Set<number> | null }).matchedIndices;
      return set === null ? null : [...set].sort();
    });
  }

  const mouse = (logicalOp?: 'AND' | 'OR') =>
    createCondition({ annotation: 'organism', values: ['Mouse'], logicalOp });

  /** Each card's count base before the debounced count lands. */
  async function basesBeforeCount(query: FilterQuery) {
    builder.query = query;
    await builder.updateComplete;
    return [...builder.shadowRoot!.querySelectorAll('protspace-query-condition-row')].map(
      (row) =>
        (row as HTMLElement & { matchedIndices: Set<number> | null | undefined }).matchedIndices,
    );
  }

  it('before the first count, a card is pending unless nothing else filters', async () => {
    // Never an empty set: that read as a count of 0 for every value until the count landed.
    expect(await basesBeforeCount([human()])).toEqual([null]);
    expect(await basesBeforeCount([human(), createCondition({ logicalOp: 'AND' })])).toEqual([
      null,
      undefined,
    ]);
    vi.advanceTimersByTime(300);
    await builder.updateComplete;
    const added = [human(), mouse('AND')];
    // The first card's id is new too: both wait for the count.
    expect(await basesBeforeCount(added)).toEqual([undefined, undefined]);
  });

  it('a lone card counts over the whole dataset', async () => {
    expect(await bases([human()])).toEqual([null]);
  });

  it('an "and" card counts inside what the other cards keep', async () => {
    // Human = P1,P3 (0, 2); Mouse = P2,P4,P5 (1, 3, 4).
    expect(await bases([human(), mouse('AND')])).toEqual([
      [1, 3, 4],
      [0, 2],
    ]);
  });

  it('both cards of an "or" list count over the whole dataset', async () => {
    expect(await bases([human(), mouseOr()])).toEqual([null, null]);
  });

  it('the first card of an "or" group counts over the whole dataset too', async () => {
    const group = createGroup({ conditions: [human(), mouseOr()] });
    expect(await bases([group])).toEqual([null, null]);
  });

  it('the cards of an "or" group joined with "and" count inside the rest of the query', async () => {
    const group = createGroup({ logicalOp: 'AND', conditions: [human(), mouseOr()] });
    expect(await bases([human(), group])).toEqual([
      [0, 1, 2, 3, 4],
      [0, 2],
      [0, 2],
    ]);
  });

  it('a group joined with "and" counts inside the rest of the query, not its own picks', async () => {
    const group = createGroup({ logicalOp: 'AND', conditions: [human()] });
    // Mouse = 1, 3, 4: the group's card counts there, so Human reads 0 rather than vanishing.
    expect(await bases([mouse(), group])).toEqual([
      [0, 2],
      [1, 3, 4],
    ]);
  });

  it('"is none of" under "or" counts over the whole dataset', async () => {
    const negated = { ...mouse(), logicalOp: 'NOT' as const };
    const noneOf = createGroup({
      id: `${negated.id}:none-of`,
      logicalOp: 'OR',
      conditions: [negated],
    });
    expect(await bases([human(), noneOf])).toEqual([null, null]);
  });
});
