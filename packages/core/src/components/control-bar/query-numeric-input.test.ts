/**
 * @vitest-environment jsdom
 *
 * Behavioural contract for the numeric range input used by a query condition.
 * The condition object is owned by the control bar; this component is controlled,
 * so each test feeds an emitted condition back in as the prop (as the real parent
 * does) before asserting the next render.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import './query-numeric-input';
import type { NumericCondition, NumericOperator } from './query-types';

interface NumericInputEl extends HTMLElement {
  condition: NumericCondition;
  data: unknown;
  updateComplete: Promise<unknown>;
}

function makeCondition(overrides: Partial<NumericCondition> = {}): NumericCondition {
  return {
    id: 'n1',
    kind: 'numeric',
    annotation: 'length',
    operator: 'gt',
    min: null,
    max: null,
    ...overrides,
  };
}

async function mount(condition: NumericCondition): Promise<NumericInputEl> {
  document.body.innerHTML = '';
  const el = document.createElement('protspace-query-numeric-input') as NumericInputEl;
  el.condition = condition;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function fields(el: NumericInputEl) {
  const root = el.shadowRoot!;
  return {
    select: root.querySelector('.numeric-operator-select') as HTMLSelectElement | null,
    inputs: Array.from(root.querySelectorAll('input.numeric-field')) as HTMLInputElement[],
  };
}

/** Drive the operator <select> and return the condition emitted by numeric-changed. */
async function changeOperator(
  el: NumericInputEl,
  operator: NumericOperator,
): Promise<NumericCondition> {
  const { select } = fields(el);
  let emitted!: NumericCondition;
  el.addEventListener(
    'numeric-changed',
    (e) => {
      emitted = (e as CustomEvent<{ condition: NumericCondition }>).detail.condition;
    },
    { once: true },
  );
  select!.value = operator;
  select!.dispatchEvent(new Event('change'));
  // Feed the emitted condition back in, mirroring the controlled parent.
  el.condition = emitted;
  await el.updateComplete;
  return emitted;
}

describe('query-numeric-input', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders accessible names for the operator and bound controls', async () => {
    const el = await mount(makeCondition({ operator: 'between', min: 1, max: 2 }));
    const { select, inputs } = fields(el);
    expect(select?.getAttribute('aria-label')).toBe('Comparison operator');
    expect(inputs.map((i) => i.getAttribute('aria-label'))).toEqual([
      'Minimum value',
      'Maximum value',
    ]);
  });

  it('shows only the fields the operator needs', async () => {
    const gt = await mount(makeCondition({ operator: 'gt', min: 5 }));
    expect(fields(gt).inputs).toHaveLength(1);

    const between = await mount(makeCondition({ operator: 'between', min: 1, max: 9 }));
    expect(fields(between).inputs).toHaveLength(2);
  });

  it('nulls the unused bound on operator change so no stale value can reappear', async () => {
    const el = await mount(makeCondition({ operator: 'between', min: 10, max: 20 }));

    // between -> gt drops the now-unused max.
    const afterGt = await changeOperator(el, 'gt');
    expect(afterGt.min).toBe(10);
    expect(afterGt.max).toBeNull();
    expect(fields(el).inputs).toHaveLength(1);
    expect(fields(el).inputs[0].value).toBe('10');

    // Switching back to between must NOT resurrect the old 20 in the max field.
    const afterBetween = await changeOperator(el, 'between');
    expect(afterBetween.max).toBeNull();
    const [minInput, maxInput] = fields(el).inputs;
    expect(minInput.value).toBe('10');
    expect(maxInput.value).toBe('');
  });

  it('keeps the displayed value across a controlled prop round-trip and clears on external reset', async () => {
    const el = await mount(makeCondition({ operator: 'gt', min: null }));
    const input = fields(el).inputs[0];

    let emitted!: NumericCondition;
    el.addEventListener('numeric-changed', (e) => {
      emitted = (e as CustomEvent<{ condition: NumericCondition }>).detail.condition;
    });

    input.value = '150';
    input.dispatchEvent(new Event('input'));
    expect(emitted.min).toBe(150);

    // The parent feeds the same condition back — the field must not be wiped mid-edit.
    el.condition = emitted;
    await el.updateComplete;
    expect(fields(el).inputs[0].value).toBe('150');

    // An external reset (e.g. switching annotation clears the bounds) empties the field.
    el.condition = { ...emitted, min: null };
    await el.updateComplete;
    expect(fields(el).inputs[0].value).toBe('');
  });
});
