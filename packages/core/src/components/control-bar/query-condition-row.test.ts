/**
 * @vitest-environment jsdom
 *
 * Picking an annotation must produce a condition whose kind matches the
 * annotation's type. The tricky case is a numeric annotation that has been
 * materialized for the legend: it becomes kind:'categorical' but keeps
 * sourceKind:'numeric', and must still be filtered with the numeric range input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * The annotation picker is a bespoke dropdown, so it has to carry the same
 * keyboard and ARIA contract as the canonical `<protspace-annotation-select>`:
 * arrow keys walk the *filtered* list, Enter picks, Escape closes, and the
 * whole thing is announced as a listbox.
 */
describe('query-condition-row annotation picker accessibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom has no layout engine, so scrollIntoView is undefined on Element.
    Element.prototype.scrollIntoView = vi.fn();
  });

  const trigger = (el: ConditionRowEl) =>
    el.shadowRoot!.querySelector('.annotation-select-trigger') as HTMLButtonElement;
  const searchInput = (el: ConditionRowEl) =>
    el.shadowRoot!.querySelector('.annotation-picker-input') as HTMLInputElement;
  const items = (el: ConditionRowEl) =>
    Array.from(el.shadowRoot!.querySelectorAll('.annotation-picker-item')) as HTMLElement[];
  const labels = (el: ConditionRowEl) => items(el).map((i) => i.textContent!.trim());
  const highlighted = (el: ConditionRowEl) =>
    el.shadowRoot!.querySelector('.annotation-picker-item.highlighted')?.textContent?.trim();

  async function open(el: ConditionRowEl): Promise<void> {
    trigger(el).click();
    await el.updateComplete;
  }

  async function press(el: ConditionRowEl, key: string, target?: HTMLElement): Promise<void> {
    (target ?? searchInput(el)).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }),
    );
    await el.updateComplete;
  }

  async function search(el: ConditionRowEl, value: string): Promise<void> {
    const input = searchInput(el);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await el.updateComplete;
  }

  /** Resolve to the annotation of the condition emitted by `condition-changed`. */
  function nextAnnotation(el: ConditionRowEl): { get: () => string | undefined } {
    let annotation: string | undefined;
    el.addEventListener(
      'condition-changed',
      (e) => {
        annotation = (e as CustomEvent<{ condition: FilterCondition }>).detail.condition.annotation;
      },
      { once: true },
    );
    return { get: () => annotation };
  }

  it('exposes the trigger as a listbox popup and tracks its expanded state', async () => {
    const el = await mount();
    expect(trigger(el).getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');

    await open(el);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens from the keyboard with Enter and with Space', async () => {
    const el = await mount();
    await press(el, 'Enter', trigger(el));
    expect(el.shadowRoot!.querySelector('.annotation-picker')).not.toBeNull();

    await press(el, 'Escape');
    expect(el.shadowRoot!.querySelector('.annotation-picker')).toBeNull();

    await press(el, ' ', trigger(el));
    expect(el.shadowRoot!.querySelector('.annotation-picker')).not.toBeNull();
  });

  it('marks the option list as a listbox with labelled options', async () => {
    const el = await mount();
    el.condition = { id: 'c1', kind: 'categorical', annotation: 'organism', values: [] };
    await el.updateComplete;
    await open(el);

    const list = el.shadowRoot!.querySelector('.value-picker-list')!;
    expect(list.getAttribute('role')).toBe('listbox');

    const options = items(el);
    expect(options.length).toBe(3);
    expect(options.every((o) => o.getAttribute('role') === 'option')).toBe(true);

    const selected = options.filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.map((o) => o.textContent!.trim())).toEqual(['organism']);

    expect(searchInput(el).getAttribute('aria-label')).toBe('Search annotations');
  });

  it('moves the highlight with ArrowDown and ArrowUp, clamped at both ends', async () => {
    const el = await mount();
    await open(el);
    const order = labels(el);
    expect(highlighted(el)).toBeUndefined();

    await press(el, 'ArrowDown');
    expect(highlighted(el)).toBe(order[0]);

    await press(el, 'ArrowDown');
    expect(highlighted(el)).toBe(order[1]);

    await press(el, 'ArrowUp');
    expect(highlighted(el)).toBe(order[0]);

    // Already at the top — stays put rather than wrapping.
    await press(el, 'ArrowUp');
    expect(highlighted(el)).toBe(order[0]);

    await press(el, 'ArrowDown');
    await press(el, 'ArrowDown');
    await press(el, 'ArrowDown');
    expect(highlighted(el)).toBe(order[order.length - 1]);
  });

  it('points aria-activedescendant at the highlighted option', async () => {
    const el = await mount();
    await open(el);
    expect(searchInput(el).getAttribute('aria-activedescendant')).toBeNull();

    await press(el, 'ArrowDown');
    const active = searchInput(el).getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    expect(el.shadowRoot!.querySelector(`#${active}`)!.classList.contains('highlighted')).toBe(
      true,
    );
  });

  it('scrolls the highlighted option into view', async () => {
    const el = await mount();
    await open(el);
    await press(el, 'ArrowDown');
    await el.updateComplete;
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('selects the highlighted annotation with Enter and closes the picker', async () => {
    const el = await mount();
    await open(el);
    const order = labels(el);
    const captured = nextAnnotation(el);

    await press(el, 'ArrowDown');
    await press(el, 'Enter');

    expect(captured.get()).toBe(order[0]);
    expect(el.shadowRoot!.querySelector('.annotation-picker')).toBeNull();
  });

  it('ignores Enter while nothing is highlighted', async () => {
    const el = await mount();
    await open(el);
    const captured = nextAnnotation(el);

    await press(el, 'Enter');

    expect(captured.get()).toBeUndefined();
    expect(el.shadowRoot!.querySelector('.annotation-picker')).not.toBeNull();
  });

  it('navigates only the annotations that survive the search box', async () => {
    const el = await mount();
    await open(el);
    await search(el, 'mas');
    expect(labels(el)).toEqual(['mass']);

    const captured = nextAnnotation(el);
    await press(el, 'ArrowDown');
    expect(highlighted(el)).toBe('mass');

    // Clamped to the single filtered entry.
    await press(el, 'ArrowDown');
    expect(highlighted(el)).toBe('mass');

    await press(el, 'Enter');
    expect(captured.get()).toBe('mass');
  });

  it('resets the highlight when the search query changes', async () => {
    const el = await mount();
    await open(el);
    await press(el, 'ArrowDown');
    expect(highlighted(el)).toBeDefined();

    await search(el, 'a');
    expect(highlighted(el)).toBeUndefined();
  });

  it('resets the highlight when the picker is reopened', async () => {
    const el = await mount();
    await open(el);
    await press(el, 'ArrowDown');
    await press(el, 'Escape');
    await open(el);

    expect(highlighted(el)).toBeUndefined();
    expect(searchInput(el).value).toBe('');
  });

  it('closes on Escape and clears the search box', async () => {
    const el = await mount();
    await open(el);
    await search(el, 'mas');

    await press(el, 'Escape');

    expect(el.shadowRoot!.querySelector('.annotation-picker')).toBeNull();
    await open(el);
    expect(labels(el).length).toBe(3);
  });
});
