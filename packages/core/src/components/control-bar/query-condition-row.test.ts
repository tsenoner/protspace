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
