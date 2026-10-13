/**
 * @vitest-environment jsdom
 *
 * Behavioural contract for the numeric range input used by a query condition.
 * The condition object is owned by the control bar; this component is controlled,
 * so each test feeds an emitted condition back in as the prop (as the real parent
 * does) before asserting the next render.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { NA_VALUE } from '@protspace/utils';
import './query-numeric-input';
import type { NumericCondition, NumericOperator } from './query-types';
import { ANY_VALUE } from './query-types';

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
    chips: Array.from(root.querySelectorAll('.value-chip')) as HTMLElement[],
    addButtons: Array.from(root.querySelectorAll('.value-chip-add')) as HTMLButtonElement[],
  };
}

/** Click a presence add/remove button and return the condition emitted by numeric-changed. */
async function clickPresence(
  el: NumericInputEl,
  selector: string,
): Promise<NumericCondition | undefined> {
  let emitted: NumericCondition | undefined;
  el.addEventListener(
    'numeric-changed',
    (e) => {
      emitted = (e as CustomEvent<{ condition: NumericCondition }>).detail.condition;
    },
    { once: true },
  );
  (el.shadowRoot!.querySelector(selector) as HTMLButtonElement).click();
  // Feed the emitted condition back in, mirroring the controlled parent.
  if (emitted) el.condition = emitted;
  await el.updateComplete;
  return emitted;
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

  it('offers every comparison operator, inclusive ones included', async () => {
    const el = await mount(makeCondition());
    const options = Array.from(fields(el).select!.options);
    expect(options.map((o) => o.value)).toEqual(['gt', 'gte', 'lt', 'lte', 'between']);
    expect(options.map((o) => o.textContent?.trim())).toEqual(['>', '≥', '<', '≤', 'between']);
  });

  it('emits the inclusive operators and keeps the bound each one uses', async () => {
    const el = await mount(makeCondition({ operator: 'gt', min: 5 }));

    const afterGte = await changeOperator(el, 'gte');
    expect(afterGte.operator).toBe('gte');
    expect(afterGte.min).toBe(5);
    expect(fields(el).inputs).toHaveLength(1);
    expect(fields(el).inputs[0].getAttribute('aria-label')).toBe('Minimum value');

    // gte -> lte swaps which bound is in play, so the stale min must not linger.
    const afterLte = await changeOperator(el, 'lte');
    expect(afterLte.operator).toBe('lte');
    expect(afterLte.min).toBeNull();
    expect(fields(el).inputs[0].getAttribute('aria-label')).toBe('Maximum value');
  });

  it('adds and removes an N/A chip alongside the comparison', async () => {
    const el = await mount(makeCondition({ operator: 'gte', min: 0.5 }));

    const added = await clickPresence(el, `.value-chip-add[data-presence="${NA_VALUE}"]`);
    expect(added?.presence).toEqual([NA_VALUE]);
    // The comparison survives — "at least 0.5, or no value at all".
    expect(added?.min).toBe(0.5);
    expect(fields(el).chips.map((c) => c.textContent?.trim().replace(/\s*×$/, ''))).toEqual([
      'N/A',
    ]);
    expect(fields(el).inputs[0].disabled).toBe(false);

    const removed = await clickPresence(el, `.value-chip-remove[data-presence="${NA_VALUE}"]`);
    expect(removed?.presence).toEqual([]);
    expect(fields(el).chips).toHaveLength(0);
  });

  it('adds and removes an "Any value" chip', async () => {
    const el = await mount(makeCondition());

    const added = await clickPresence(el, `.value-chip-add[data-presence="${ANY_VALUE}"]`);
    expect(added?.presence).toEqual([ANY_VALUE]);
    expect(fields(el).chips[0].textContent).toContain('Any value');

    const removed = await clickPresence(el, `.value-chip-remove[data-presence="${ANY_VALUE}"]`);
    expect(removed?.presence).toEqual([]);
    expect(fields(el).chips).toHaveLength(0);
    expect(fields(el).addButtons).toHaveLength(2);
  });

  it('lets "Any value" subsume the N/A chip and the comparison it makes redundant', async () => {
    const el = await mount(makeCondition({ operator: 'gte', min: 0.5, presence: [NA_VALUE] }));

    const emitted = await clickPresence(el, `.value-chip-add[data-presence="${ANY_VALUE}"]`);
    expect(emitted?.presence).toEqual([ANY_VALUE]);
    expect(emitted?.min).toBeNull();
    expect(emitted?.max).toBeNull();

    const { select, inputs, chips, addButtons } = fields(el);
    expect(chips).toHaveLength(1);
    expect(select?.disabled).toBe(true);
    expect(inputs.every((i) => i.disabled)).toBe(true);
    expect(inputs[0].value).toBe('');
    // No way to re-add the N/A chip it contradicts while it is on.
    expect(addButtons).toHaveLength(0);
  });

  it('restores the comparison and the N/A option once "Any value" is removed', async () => {
    const el = await mount(makeCondition({ presence: [ANY_VALUE] }));

    await clickPresence(el, `.value-chip-remove[data-presence="${ANY_VALUE}"]`);
    const emitted = await clickPresence(el, `.value-chip-add[data-presence="${NA_VALUE}"]`);
    expect(emitted?.presence).toEqual([NA_VALUE]);
    expect(fields(el).select?.disabled).toBe(false);
  });
});
