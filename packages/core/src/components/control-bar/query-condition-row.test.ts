/**
 * @vitest-environment jsdom
 *
 * Picking an annotation must produce a condition whose kind matches the
 * annotation's type. The tricky case is a numeric annotation that has been
 * materialized for the legend: it becomes kind:'categorical' but keeps
 * sourceKind:'numeric', and must still be filtered with the numeric range input.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './query-condition-row';
import type { FilterCondition } from './query-types';
import { ANY_VALUE } from './query-types';
import type { ProtspaceData } from './types';

interface ConditionRowEl extends HTMLElement {
  condition: FilterCondition;
  annotations: string[];
  data: ProtspaceData;
  updateComplete: Promise<unknown>;
  _selectAnnotation(annotation: string): void;
}

const data: ProtspaceData = {
  protein_ids: ['P1', 'P2'],
  annotations: {
    organism: { kind: 'categorical', values: ['Human', 'Mouse'] },
    // A genuine, unmaterialized numeric annotation.
    length: { kind: 'numeric', values: [] },
    // A numeric annotation after legend materialization: binned to categorical,
    // but still numeric at heart (sourceKind).
    mass: { kind: 'categorical', sourceKind: 'numeric', values: ['0–10', '10–20'] },
  },
  annotation_data: { organism: [[0], [1]] },
  numeric_annotation_data: { length: [100, 200], mass: [5, 15] },
};

async function mount(): Promise<ConditionRowEl> {
  document.body.innerHTML = '';
  const el = document.createElement('protspace-query-condition-row') as ConditionRowEl;
  el.condition = { id: 'c1', kind: 'categorical', annotation: '', values: [] };
  el.annotations = ['organism', 'length', 'mass'];
  el.data = data;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function kindAfterSelecting(el: ConditionRowEl, annotation: string): Promise<string> {
  let kind = '';
  el.addEventListener(
    'condition-changed',
    (e) => {
      kind = (e as CustomEvent<{ condition: FilterCondition }>).detail.condition.kind;
    },
    { once: true },
  );
  el._selectAnnotation(annotation);
  await el.updateComplete;
  return kind;
}

describe('query-condition-row annotation kind detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('builds a categorical condition for a categorical annotation', async () => {
    const el = await mount();
    expect(await kindAfterSelecting(el, 'organism')).toBe('categorical');
  });

  it('builds a numeric condition for a numeric annotation', async () => {
    const el = await mount();
    expect(await kindAfterSelecting(el, 'length')).toBe('numeric');
  });

  it('builds a numeric condition for a materialized (sourceKind:numeric) annotation', async () => {
    const el = await mount();
    expect(await kindAfterSelecting(el, 'mass')).toBe('numeric');
  });
});

/**
 * The ANY_VALUE sentinel ("carries a label at all") is mutually exclusive with
 * every other value: OR-ing it with a real value is just "any value", and
 * OR-ing it with N/A matches everything. The row owns the condition, so the
 * row is where that exclusivity is enforced.
 */
describe('query-condition-row value chips', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  async function withValues(values: string[]): Promise<ConditionRowEl> {
    const el = await mount();
    el.condition = { id: 'c1', kind: 'categorical', annotation: 'organism', values };
    await el.updateComplete;
    return el;
  }

  function chipLabels(el: ConditionRowEl): string[] {
    return Array.from(el.shadowRoot!.querySelectorAll('.value-chip-text')).map((n) =>
      n.textContent!.trim(),
    );
  }

  /** Emit the picker's `value-selected` and return the resulting values, if any. */
  async function select(el: ConditionRowEl, value: string): Promise<string[] | undefined> {
    let values: string[] | undefined;
    el.addEventListener(
      'condition-changed',
      (e) => {
        const condition = (e as CustomEvent<{ condition: FilterCondition }>).detail.condition;
        if (condition.kind === 'categorical') values = condition.values;
      },
      { once: true },
    );
    el.shadowRoot!.querySelector('protspace-query-value-picker')!.dispatchEvent(
      new CustomEvent('value-selected', { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    return values;
  }

  it('renders the sentinels with their display labels, not their internals', async () => {
    const el = await withValues([ANY_VALUE, '__NA__', 'Human']);
    expect(chipLabels(el)).toEqual(['Any value', 'N/A', 'Human']);
  });

  it('appends ordinary values', async () => {
    const el = await withValues(['Human']);
    expect(await select(el, 'Mouse')).toEqual(['Human', 'Mouse']);
  });

  it('ignores a value that is already selected', async () => {
    const el = await withValues(['Human']);
    expect(await select(el, 'Human')).toBeUndefined();
  });

  it('clears the other values when Any value is selected', async () => {
    const el = await withValues(['Human', '__NA__']);
    expect(await select(el, ANY_VALUE)).toEqual([ANY_VALUE]);
  });

  it('refuses to add another value while Any value is selected', async () => {
    const el = await withValues([ANY_VALUE]);
    expect(await select(el, 'Human')).toBeUndefined();
  });
});
