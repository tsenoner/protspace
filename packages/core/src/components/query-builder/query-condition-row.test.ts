/**
 * @vitest-environment jsdom
 *
 * Picking an annotation must produce a condition whose kind matches the
 * annotation's type. The tricky case is a numeric annotation that has been
 * materialized for the legend: it becomes kind:'categorical' but keeps
 * sourceKind:'numeric', and must still be filtered with the numeric range input.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushLayer, topLayer } from '../kit/layers';
import { stubPopoverApi } from '../legend/test-support/popover-stub';
import './query-condition-row';
import type { FilterCondition, NumericCondition } from './query-types';
import { evaluateQuery } from './query-evaluate';
import { NA_VALUE } from '@protspace/utils';
import { ANY_VALUE } from './query-types';
import type { ProtspaceData } from './types';

stubPopoverApi();

interface ConditionRowEl extends HTMLElement {
  condition: FilterCondition;
  annotations: string[];
  number: number;
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
  numeric_annotation_data: {
    length: new Float64Array([100, 200]),
    mass: new Float64Array([5, 15]),
  },
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

  it('re-picking the current annotation keeps the condition: no condition-changed', async () => {
    const el = await mount();
    el.condition = { id: 'c1', kind: 'categorical', annotation: 'organism', values: ['Human'] };
    await el.updateComplete;
    let fired = false;
    el.addEventListener('condition-changed', () => (fired = true));
    el._selectAnnotation('organism');
    await el.updateComplete;
    expect(fired).toBe(false);
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

  it('offers no value to add while Any value ("has any value") is selected', async () => {
    const el = await withValues([ANY_VALUE]);
    expect(el.shadowRoot!.querySelector('protspace-query-value-picker')).toBeNull();
  });
});

/**
 * The annotation picker is a bespoke dropdown, so it has to carry the same
 * keyboard and ARIA contract as the canonical `<protspace-annotation-select>`:
 * arrow keys walk the *filtered* list, Enter picks, Escape closes, and the
 * whole thing is announced as a listbox.
 */
describe('query-condition-row annotation picker accessibility', () => {
  // jsdom has no layout engine, so scrollIntoView is assigned rather than spied on.
  const hadScrollIntoView = 'scrollIntoView' in Element.prototype;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    // Restoring by assignment would leave an own `scrollIntoView: undefined` on
    // Element.prototype, so `'scrollIntoView' in el` would answer true for the rest
    // of the file. Delete it instead when jsdom never had one. Same dance as
    // search.component.test.ts.
    if (hadScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView;
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  const trigger = (el: ConditionRowEl) =>
    el.shadowRoot!.querySelector('.annotation-select-trigger') as HTMLButtonElement;
  const searchInput = (el: ConditionRowEl) =>
    el.shadowRoot!.querySelector('.annotation-picker-input') as HTMLInputElement;
  const items = (el: ConditionRowEl) =>
    Array.from(el.shadowRoot!.querySelectorAll('.annotation-picker-item')) as HTMLElement[];
  /** Column names, in list order — what keyboard navigation and selection work in. */
  const keys = (el: ConditionRowEl) => items(el).map((i) => i.dataset.annotation!);
  const labels = (el: ConditionRowEl) =>
    items(el).map((i) => i.querySelector('.dropdown-item-label')!.textContent!.trim());
  const highlighted = (el: ConditionRowEl) =>
    (el.shadowRoot!.querySelector('.annotation-picker-item.highlighted') as HTMLElement | null)
      ?.dataset.annotation;

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

    const list = el.shadowRoot!.querySelector('.annotation-picker-list')!;
    expect(list.getAttribute('role')).toBe('listbox');

    const options = items(el);
    expect(options.length).toBe(3);
    expect(options.every((o) => o.getAttribute('role') === 'option')).toBe(true);

    const selected = options.filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.map((o) => o.dataset.annotation)).toEqual(['organism']);

    expect(searchInput(el).getAttribute('aria-label')).toBe('Search annotations');
  });

  it('moves the highlight with ArrowDown and ArrowUp, clamped at both ends', async () => {
    const el = await mount();
    await open(el);
    const order = keys(el);
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
    const order = keys(el);
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
    expect(labels(el)).toEqual(['Mass']);

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

/**
 * The picker and the condition button name an annotation the way the control
 * bar's dropdown does (#293): by label, with the predicted badge — while the
 * condition itself keeps the column name.
 */
describe('query-condition-row annotation names', () => {
  const namedData: ProtspaceData = {
    protein_ids: ['P1'],
    annotations: {
      cath: { kind: 'categorical', values: [] },
      ec: { kind: 'categorical', values: [] },
      cc_subcellular_location: { kind: 'categorical', values: [] },
      predicted_subcellular_location: { kind: 'categorical', values: [] },
    },
    annotation_data: {},
  };

  async function mountNamed(annotation = ''): Promise<ConditionRowEl> {
    document.body.innerHTML = '';
    const el = document.createElement('protspace-query-condition-row') as ConditionRowEl;
    el.condition = { id: 'c1', kind: 'categorical', annotation, values: [] };
    el.annotations = Object.keys(namedData.annotations);
    el.data = namedData;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  const trigger = (el: ConditionRowEl) =>
    el.shadowRoot!.querySelector('.annotation-select-trigger') as HTMLButtonElement;

  /** Each picker row as [column, label, has predicted badge]. */
  async function rows(el: ConditionRowEl): Promise<[string, string, boolean][]> {
    trigger(el).click();
    await el.updateComplete;
    return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>('.annotation-picker-item')).map(
      (item) => [
        item.dataset.annotation!,
        item.querySelector('.dropdown-item-label')!.textContent!.trim(),
        item.querySelector('.predicted-mark') !== null,
      ],
    );
  }

  it('lists annotations by label, badging the predicted one', async () => {
    const el = await mountNamed();
    expect((await rows(el)).sort()).toEqual(
      [
        ['cath', 'CATH-Gene3D', false],
        ['ec', 'EC number', false],
        ['cc_subcellular_location', 'Subcellular location', false],
        ['predicted_subcellular_location', 'Subcellular location', true],
      ].sort(),
    );
  });

  it('names the chosen annotation by label on the button', async () => {
    const el = await mountNamed('cath');
    expect(trigger(el).textContent!.trim()).toBe('CATH-Gene3D');
    expect(trigger(el).querySelector('.predicted-mark')).toBeNull();

    el.condition = { ...el.condition, annotation: 'predicted_subcellular_location' };
    await el.updateComplete;
    expect(trigger(el).querySelector('.dropdown-trigger-text')!.textContent!.trim()).toBe(
      'Subcellular location',
    );
    expect(trigger(el).querySelector('.predicted-mark')).not.toBeNull();
  });

  it('keeps the placeholder until an annotation is chosen', async () => {
    const el = await mountNamed();
    expect(trigger(el).textContent!.trim()).toBe('Choose annotation');
  });

  it('stores the column name when a label is picked', async () => {
    const el = await mountNamed();
    await rows(el);
    let stored: string | undefined;
    el.addEventListener('condition-changed', (e) => {
      stored = (e as CustomEvent<{ condition: FilterCondition }>).detail.condition.annotation;
    });

    const cathRow = Array.from(
      el.shadowRoot!.querySelectorAll<HTMLElement>('.annotation-picker-item'),
    ).find((item) => item.textContent!.trim() === 'CATH-Gene3D')!;
    cathRow.click();

    expect(stored).toBe('cath');
  });

  it('marks the predicted annotation with the sparkles icon, named Predicted annotation', async () => {
    const el = await mountNamed('predicted_subcellular_location');
    const mark = trigger(el).querySelector('.predicted-mark')!;
    expect(mark.getAttribute('role')).toBe('img');
    expect(mark.getAttribute('aria-label')).toBe('Predicted annotation');
    expect(mark.hasAttribute('title')).toBe(false);
    expect(mark.querySelector('svg.ps-icon')).not.toBeNull();
    expect(mark.textContent!.trim()).toBe('');
  });
});

describe('query-condition-row inside a dialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('the open annotation picker is a layer, so Escape closes it before the dialog around it', async () => {
    const dialogClose = vi.fn();
    const releaseDialog = pushLayer({ close: dialogClose, elements: [] });
    const el = await mount();

    (el.shadowRoot!.querySelector('.annotation-select-trigger') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.annotation-picker')).not.toBeNull();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.annotation-picker')).toBeNull();
    expect(dialogClose).not.toHaveBeenCalled();
    expect(topLayer()?.close).toBe(dialogClose);
    releaseDialog();
  });
});

describe('query-condition-row names', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('labels the row and its operator by number and shows a remove button', async () => {
    const el = await mount();
    el.number = 2;
    await el.updateComplete;
    const root = el.shadowRoot!;

    expect(root.querySelector('.condition-row')!.getAttribute('aria-label')).toMatch(
      /^Condition 2: /,
    );
    const menu = root.querySelector('ps-icon-button.condition-menu-trigger') as HTMLElement & {
      label: string;
    };
    expect(menu.label).toBe('Actions for condition 2');
    expect(root.querySelector('ps-menu-item[value="remove"]')).toBeNull();
    const remove = root.querySelector('ps-icon-button.condition-remove') as HTMLElement & {
      label: string;
    };
    expect(remove.label).toBe('Remove condition');
    expect(root.querySelector('.value-add')!.textContent!.replace(/\s+/g, '')).toBe('Addvalue');
  });
});

describe('query-condition-row first operator', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('draws no joiner of its own: the builder puts one between cards', async () => {
    const el = await mount();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.logical-op-select, .joiner-pill')).toBeNull();
  });
});

/**
 * A condition on an EAT confidence column is the EAT panel's reliability filter (Task 9.5): the
 * row shows it locked, one line with a link to the panel and a ✕ that resets the reliability.
 */
describe('query-condition-row locked EAT reliability', () => {
  const EAT_KEY = 'ec__eat_confidence__runtime_2';
  const eatData: ProtspaceData = {
    protein_ids: ['P1', 'P2', 'P3', 'P4'],
    annotations: {
      ec: { kind: 'categorical', values: ['1.1.1.1'] },
      [EAT_KEY]: {
        kind: 'numeric',
        values: [],
        runtime: { role: 'eat-confidence', baseAnnotation: 'ec' },
      },
    },
    annotation_data: { ec: [[0], [0], [0], [0]] },
    numeric_annotation_data: { [EAT_KEY]: new Float64Array([NaN, 0.3, 0.55, 0.9]) },
  };

  const reliabilityCondition = (overrides: Partial<NumericCondition>): NumericCondition => ({
    id: 'r1',
    kind: 'numeric',
    annotation: EAT_KEY,
    min: null,
    max: null,
    presence: [NA_VALUE],
    ...overrides,
  });

  async function mountLocked(condition: NumericCondition, number = 2): Promise<ConditionRowEl> {
    document.body.innerHTML = '';
    const el = document.createElement('protspace-query-condition-row') as ConditionRowEl;
    el.condition = condition;
    el.annotations = ['ec'];
    el.data = eatData;
    el.number = number;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  const lockedText = (el: ConditionRowEl) =>
    el
      .shadowRoot!.querySelector('.locked-text')!
      .textContent!.replace(/[ \n\t]+/g, ' ')
      .trim();

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one locked line: the base label, the reliability, Edit in EAT and a reset ✕', async () => {
    const el = await mountLocked(reliabilityCondition({ min: 0.5 }));
    const root = el.shadowRoot!;
    expect(lockedText(el)).toBe('EC number — reliability ≥ 50 %');
    expect(root.querySelector('.locked-edit')!.textContent!.trim()).toBe('Edit in EAT ›');
    const reset = root.querySelector('ps-icon-button.condition-remove') as HTMLElement & {
      label: string;
    };
    expect(reset.label).toBe('Reset EAT reliability');
    expect(root.querySelector('.annotation-select-trigger')).toBeNull();
    expect(root.querySelector('.condition-menu-trigger')).toBeNull();
    expect(root.querySelector('protspace-query-numeric-input')).toBeNull();
    expect(root.querySelector('.condition-row')!.getAttribute('aria-label')).toBe(
      'Condition 2: EC number reliability at least 50 %, set in the EAT panel',
    );
  });

  it('words an upper bound and a band', async () => {
    expect(lockedText(await mountLocked(reliabilityCondition({ max: 0.4 })))).toBe(
      'EC number — reliability ≤ 40 %',
    );
    expect(lockedText(await mountLocked(reliabilityCondition({ min: 0.4, max: 0.6 })))).toBe(
      'EC number — reliability 40–60 %',
    );
  });

  it('the ✕ dispatches eat-reliability-reset for its base, not condition-removed', async () => {
    const el = await mountLocked(reliabilityCondition({ min: 0.5 }));
    const reset = vi.fn();
    const removed = vi.fn();
    document.addEventListener('eat-reliability-reset', reset);
    el.addEventListener('condition-removed', removed);
    (el.shadowRoot!.querySelector('ps-icon-button.condition-remove') as HTMLElement).click();
    document.removeEventListener('eat-reliability-reset', reset);
    expect(removed).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledTimes(1);
    expect((reset.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'ec' });
  });

  it('Edit in EAT dispatches eat-panel-open for its base', async () => {
    const el = await mountLocked(reliabilityCondition({ min: 0.5 }));
    const open = vi.fn();
    document.addEventListener('eat-panel-open', open);
    (el.shadowRoot!.querySelector('.locked-edit') as HTMLElement).click();
    document.removeEventListener('eat-panel-open', open);
    expect(open).toHaveBeenCalledTimes(1);
    expect((open.mock.calls[0][0] as CustomEvent).detail).toEqual({ annotation: 'ec' });
  });

  it('a negated band reads "any" and evaluates as before', async () => {
    const condition = reliabilityCondition({ min: 0.4, max: 0.6, logicalOp: 'NOT' });
    const before = [...evaluateQuery([condition], eatData)];
    const changed = vi.fn();
    document.addEventListener('condition-changed', changed);
    const el = await mountLocked(condition);
    document.removeEventListener('condition-changed', changed);
    expect(lockedText(el)).toBe('EC number — reliability any');
    expect(el.condition).toBe(condition);
    expect(changed).not.toHaveBeenCalled();
    expect([...evaluateQuery([el.condition], eatData)]).toEqual(before);
  });

  it('a numeric condition on an ordinary column keeps its editor', async () => {
    const el = await mountLocked({ ...reliabilityCondition({ min: 0.5 }), annotation: 'length' });
    expect(el.shadowRoot!.querySelector('.locked-text')).toBeNull();
    expect(el.shadowRoot!.querySelector('.annotation-select-trigger')).not.toBeNull();
  });
});
