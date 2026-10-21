/**
 * @vitest-environment jsdom
 *
 * Behavioural contract for the numeric range input used by a query condition.
 * The condition object is owned by the control bar; this component is controlled,
 * so each test feeds an emitted condition back in as the prop (as the real parent
 * does) before asserting the next render.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NA_VALUE } from '@protspace/utils';
import './query-numeric-input';
import type { NumericCondition } from './query-types';

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
    inputs: Array.from(root.querySelectorAll('input.numeric-field')) as HTMLInputElement[],
  };
}

/** Toggle the N/A checkbox and return the condition emitted by numeric-changed. */
async function toggleNa(el: NumericInputEl): Promise<NumericCondition | undefined> {
  let emitted: NumericCondition | undefined;
  el.addEventListener(
    'numeric-changed',
    (e) => {
      emitted = (e as CustomEvent<{ condition: NumericCondition }>).detail.condition;
    },
    { once: true },
  );
  const box = el.shadowRoot!.querySelector('ps-checkbox.numeric-na') as HTMLElement & {
    checked: boolean;
  };
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  // Feed the emitted condition back in, mirroring the controlled parent.
  if (emitted) el.condition = emitted;
  await el.updateComplete;
  return emitted;
}

describe('query-numeric-input', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders accessible names for the bound controls', async () => {
    const el = await mount(makeCondition({ operator: 'between', min: 1, max: 2 }));
    const { inputs } = fields(el);
    expect(inputs.map((i) => i.getAttribute('aria-label'))).toEqual([
      'Minimum value',
      'Maximum value',
    ]);
  });

  it('counts the matching proteins in plural-aware words', async () => {
    vi.useFakeTimers();
    try {
      const el = await mount(makeCondition({ operator: 'gt', min: 150 }));
      el.data = {
        protein_ids: ['P1', 'P2', 'P3'],
        annotations: { length: { kind: 'numeric', values: [] } },
        numeric_annotation_data: { length: new Float64Array([100, 200, 300]) },
      };
      await el.updateComplete;
      vi.advanceTimersByTime(750);
      await el.updateComplete;
      const count = () =>
        el
          .shadowRoot!.querySelector('.numeric-match-count')!
          .textContent!.trim()
          .replace(/\s+/g, ' ');
      expect(count()).toBe('2 proteins match');

      el.condition = makeCondition({ operator: 'gt', min: 250 });
      await el.updateComplete;
      vi.advanceTimersByTime(750);
      await el.updateComplete;
      expect(count()).toBe('1 protein matches');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows only the fields the operator needs', async () => {
    const gt = await mount(makeCondition({ operator: 'gt', min: 5 }));
    expect(fields(gt).inputs).toHaveLength(1);

    const between = await mount(makeCondition({ operator: 'between', min: 1, max: 9 }));
    expect(fields(between).inputs).toHaveLength(2);
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

  it('ticks and unticks N/A alongside the comparison', async () => {
    const el = await mount(makeCondition({ operator: 'gte', min: 0.5 }));

    const added = await toggleNa(el);
    expect(added?.presence).toEqual([NA_VALUE]);
    // The comparison survives — "at least 0.5, or no value at all".
    expect(added?.min).toBe(0.5);
    expect(fields(el).inputs[0].disabled).toBe(false);

    const removed = await toggleNa(el);
    expect(removed?.presence).toEqual([]);
  });
});
