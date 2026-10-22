/**
 * @vitest-environment jsdom
 *
 * Characterization of the value picker's live per-value counts.
 *
 * The count shown next to each value is how many proteins carry it among the
 * proteins the condition picks from, so its bar can be its share of them: the
 * matched set the query builder hands down (`matchedIndices`), or the whole
 * dataset when that is null (the builder works out which from the card's place).
 *
 * Counts are multi-label aware: a protein carrying two labels contributes once
 * to each, mirroring resolveAnnotationInternalValues() in query-evaluate.ts.
 * The ANY_VALUE entry is the exception: it is a per-protein predicate ("carries
 * any real label"), so a multi-label protein contributes 1, not one per label.
 *
 * These tests lock in current behaviour, including quirks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pushLayer, topLayer } from '../kit/layers';
import { stubPopoverApi } from '../legend/test-support/popover-stub';
import './query-value-picker';
import type { FilterQuery } from './query-types';
import { ANY_VALUE } from './query-types';
import { evaluateQuery } from './query-evaluate';
import type { ProtspaceData } from './types';

interface ValuePickerEl extends HTMLElement {
  annotation: string;
  data: ProtspaceData | undefined;
  matchedIndices: Set<number> | null;
  selectedValues: string[];
  open: boolean;
  anchor: Element | null;
  updateComplete: Promise<unknown>;
}

/**
 * 6 proteins, one multi-label protein (P3 = Human + Mouse), one protein with no
 * labels at all (P4) and one pointing at a null value (P5) — both resolve to N/A.
 * 'Yeast' is declared in the legend but carried by nobody.
 *
 * full-dataset counts: Human 3 (P0,P1,P3) · Mouse 2 (P2,P3) · Yeast 0 · N/A 2 (P4,P5)
 */
const data: ProtspaceData = {
  protein_ids: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'],
  annotations: {
    organism: { kind: 'categorical', values: ['Human', 'Mouse', 'Yeast', null] },
  },
  annotation_data: {
    organism: [[0], [0], [1], [0, 1], [], [3]],
  },
};

/** matchedIndices used by most tests: {P0, P2, P3, P4}, size 4. */
const MATCHED = new Set([0, 2, 3, 4]);
// within MATCHED: Human 2 (P0,P3) · Mouse 2 (P2,P3) · Yeast 0 · N/A 1 (P4)
// and 3 of them carry a real label (P0, P2, P3) — the scope every NOT count uses.

interface MountOptions {
  annotation?: string;
  data?: ProtspaceData | undefined;
  /** null counts over the whole dataset. */
  matchedIndices?: Set<number> | null;
  selectedValues?: string[];
  open?: boolean;
}

async function mount(options: MountOptions = {}): Promise<ValuePickerEl> {
  document.body.innerHTML = '';
  const el = document.createElement('protspace-query-value-picker') as ValuePickerEl;
  el.annotation = options.annotation ?? 'organism';
  el.data = 'data' in options ? options.data : data;
  el.matchedIndices = 'matchedIndices' in options ? options.matchedIndices! : MATCHED;
  el.selectedValues = options.selectedValues ?? [];
  el.open = options.open ?? true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function items(el: ValuePickerEl): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.value-picker-item'));
}

/** Displayed label → displayed count, in render order. */
function counts(el: ValuePickerEl): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items(el)) {
    const label = item.querySelector('span:not(.value-picker-count)')!.textContent!.trim();
    const count = item.querySelector('.value-picker-count')!.textContent!.trim();
    out[label] = Number(count);
  }
  return out;
}

function labels(el: ValuePickerEl): string[] {
  return items(el).map((i) =>
    i.querySelector('span:not(.value-picker-count)')!.textContent!.trim(),
  );
}

function footer(el: ValuePickerEl): string {
  return el
    .shadowRoot!.querySelector('.value-picker-summary')!
    .textContent!.trim()
    .replace(/\s+/g, ' ');
}

async function search(el: ValuePickerEl, text: string): Promise<ValuePickerEl> {
  const input = el.shadowRoot!.querySelector('.value-picker-input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await el.updateComplete;
  return el;
}

/** Mounted with an anchor, so its popover opens and takes a layer (jsdom needs the popover stub). */
async function mountAnchored(options: MountOptions = {}): Promise<ValuePickerEl> {
  stubPopoverApi();
  const el = await mount(options);
  const anchor = document.createElement('button');
  document.body.prepend(anchor);
  el.anchor = anchor;
  await el.updateComplete;
  return el;
}

describe('query-value-picker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('rendering', () => {
    it('renders nothing while closed', async () => {
      const el = await mount({ open: false });
      expect(el.shadowRoot!.querySelector('.value-picker')).toBeNull();
    });

    it('lists every declared value once, led by Any value and N/A, then by count', async () => {
      const el = await mount();
      // Exact equality also pins that the `__NA__` sentinel is shown as its N/A label.
      expect(labels(el)).toEqual(['Any value', 'N/A', 'Human', 'Mouse', 'Yeast']);
      expect(footer(el)).toBe('0 selected');
    });

    it('lists the selected values first, ticked', async () => {
      const el = await mount({ selectedValues: ['Human', '__NA__'] });
      expect(labels(el)).toEqual(['N/A', 'Human', 'Any value', 'Mouse', 'Yeast']);
      const checked = items(el).filter((i) => i.getAttribute('aria-checked') === 'true');
      expect(checked.map((i) => i.dataset.value)).toEqual(['__NA__', 'Human']);
      expect(footer(el)).toBe('2 selected · 3 proteins');
    });

    it('de-duplicates repeated raw values', async () => {
      const el = await mount({
        data: {
          protein_ids: ['P0'],
          annotations: { organism: { kind: 'categorical', values: ['Human', 'Human', 'Mouse'] } },
          annotation_data: { organism: [[0]] },
        },
      });
      expect(labels(el)).toEqual(['Any value', 'Human', 'Mouse']);
    });
  });

  describe('count base', () => {
    it('counts proteins inside the matched set carrying the value', async () => {
      const el = await mount();
      expect(counts(el)).toEqual({ 'Any value': 3, Human: 2, Mouse: 2, Yeast: 0, 'N/A': 1 });
    });

    it('counts the carriers dataset-wide when the base is the whole dataset (null)', async () => {
      const el = await mount({ matchedIndices: null });
      // Rows for single-label proteins add up to the dataset, not to more than it.
      expect(counts(el)).toEqual({ 'Any value': 4, Human: 3, Mouse: 2, Yeast: 0, 'N/A': 2 });
    });

    it('recomputes counts when the base switches to and from the whole dataset', async () => {
      const el = await mount();
      expect(counts(el).Human).toBe(2);
      el.matchedIndices = null;
      await el.updateComplete;
      expect(counts(el).Human).toBe(3);
      el.matchedIndices = MATCHED;
      await el.updateComplete;
      expect(counts(el).Human).toBe(2);
    });

    it('recomputes counts when the matched set changes', async () => {
      const el = await mount();
      expect(counts(el).Human).toBe(2);
      el.matchedIndices = new Set([0, 1, 2, 3, 4, 5]);
      await el.updateComplete;
      expect(counts(el)).toEqual({ 'Any value': 4, Human: 3, Mouse: 2, Yeast: 0, 'N/A': 2 });
    });

    it('agrees with evaluateQuery for every value under NOT', async () => {
      // A row is the matched proteins that "is <value>" keeps, which NOT drops;
      // this pins the tally to the evaluator so the two cannot drift.
      const el = await mount();
      const shown = counts(el);
      for (const [label, value] of [
        ['Any value', ANY_VALUE],
        ['Human', 'Human'],
        ['Mouse', 'Mouse'],
        ['Yeast', 'Yeast'],
        ['N/A', '__NA__'],
      ] as const) {
        const query: FilterQuery = [
          {
            id: 'c1',
            kind: 'categorical',
            annotation: 'organism',
            values: [value],
          },
        ];
        const evaluated = evaluateQuery(query, data);
        const expected = [...MATCHED].filter((i) => evaluated.has(i)).length;
        expect(shown[label], `NOT ${label}`).toBe(expected);
      }
    });
  });

  describe('multi-label proteins', () => {
    it('counts a multi-label protein once toward each of its labels', async () => {
      // Only the multi-label protein P3 (Human + Mouse) is matched.
      const el = await mount({ matchedIndices: new Set([3]) });
      // ...but only once toward "Any value", which is a per-protein predicate.
      expect(counts(el)).toEqual({ 'Any value': 1, Human: 1, Mouse: 1, Yeast: 0, 'N/A': 0 });
    });

    it('de-duplicates repeated label indices resolving to the same value', async () => {
      const el = await mount({
        matchedIndices: new Set([0]),
        data: {
          protein_ids: ['P0'],
          annotations: { organism: { kind: 'categorical', values: ['Human', 'Human'] } },
          // Both indices resolve to 'Human'; the protein must count once.
          annotation_data: { organism: [[0, 1]] },
        },
      });
      expect(counts(el)).toEqual({ 'Any value': 1, Human: 1 });
    });
  });

  describe('the N/A entry', () => {
    it('counts both label-less proteins and proteins pointing at a null value', async () => {
      const el = await mount({ matchedIndices: new Set([0, 1, 2, 3, 4, 5]) });
      expect(counts(el)['N/A']).toBe(2); // P4 (no labels) + P5 (null value)
    });

    it('omits N/A from the list when the annotation declares no null value', async () => {
      const el = await mount({
        matchedIndices: new Set([0, 1]),
        data: {
          protein_ids: ['P0', 'P1'],
          annotations: { organism: { kind: 'categorical', values: ['Human'] } },
          // P1 has no label, so it resolves to N/A when counting — but N/A is not
          // offered because it is absent from the declared values list.
          annotation_data: { organism: [[0], []] },
        },
      });
      expect(labels(el)).toEqual(['Any value', 'Human']);
    });

    it('is selectable and emits the internal sentinel, not the display label', async () => {
      const el = await mount();
      let emitted: string | undefined;
      el.addEventListener(
        'value-selected',
        (e) => {
          emitted = (e as CustomEvent<{ value: string }>).detail.value;
        },
        { once: true },
      );
      const naItem = items(el).find(
        (i) => i.querySelector('span:not(.value-picker-count)')!.textContent!.trim() === 'N/A',
      )!;
      naItem.click();
      expect(emitted).toBe('__NA__');
    });

    it('stays open after a selection so several values can be added', async () => {
      const el = await mount();
      items(el)[0].click();
      await el.updateComplete;
      expect(el.open).toBe(true);
      expect(el.shadowRoot!.querySelector('.value-picker')).not.toBeNull();
    });
  });

  describe('the Any value entry', () => {
    /** The item whose displayed label is `label`. */
    function itemFor(el: ValuePickerEl, label: string): HTMLElement {
      return items(el).find(
        (i) => i.querySelector('span:not(.value-picker-count)')!.textContent!.trim() === label,
      )!;
    }

    it('emits the ANY_VALUE sentinel, not the display label', async () => {
      const el = await mount();
      let emitted: string | undefined;
      el.addEventListener(
        'value-selected',
        (e) => {
          emitted = (e as CustomEvent<{ value: string }>).detail.value;
        },
        { once: true },
      );
      itemFor(el, 'Any value').click();
      expect(emitted).toBe(ANY_VALUE);
    });

    it('is matched by a search on its display label', async () => {
      const el = await search(await mount(), 'any');
      expect(labels(el)).toEqual(['Any value']);
    });

    it('stays listed, ticked, once selected', async () => {
      const el = await mount({ selectedValues: [ANY_VALUE] });
      expect(itemFor(el, 'Any value').getAttribute('aria-checked')).toBe('true');
    });

    it('locks out every other entry while it is selected', async () => {
      const el = await mount({ selectedValues: [ANY_VALUE] });
      const others = items(el).filter((i) => i.dataset.value !== ANY_VALUE);
      expect(others.length).toBeGreaterThan(0);
      for (const item of others) {
        expect(item.classList.contains('is-disabled')).toBe(true);
        expect(item.getAttribute('aria-disabled')).toBe('true');
      }
    });

    it('swallows clicks on the locked-out entries', async () => {
      const el = await mount({ selectedValues: [ANY_VALUE] });
      let emitted = false;
      el.addEventListener('value-selected', () => {
        emitted = true;
      });
      itemFor(el, 'Human').click();
      expect(emitted).toBe(false);
    });

    it('leaves the other entries selectable when it is not selected', async () => {
      const el = await mount({ selectedValues: ['Human'] });
      expect(items(el).length).toBeGreaterThan(0);
      for (const item of items(el)) {
        expect(item.classList.contains('is-disabled')).toBe(false);
        expect(item.getAttribute('aria-disabled')).toBe('false');
      }
    });
  });

  describe('search', () => {
    it('filters case-insensitively on a substring and updates the footer', async () => {
      const el = await search(await mount(), 'ou');
      expect(labels(el)).toEqual(['Mouse']);
    });

    it('matches the N/A entry by its display label', async () => {
      const el = await search(await mount(), 'n/a');
      expect(labels(el)).toEqual(['N/A']);
    });

    it('does not match the N/A entry by its internal sentinel', async () => {
      const el = await search(await mount(), '__na__');
      expect(labels(el)).toEqual([]);
    });

    it('ignores surrounding whitespace in the query', async () => {
      const el = await search(await mount(), '  human  ');
      expect(labels(el)).toEqual(['Human']);
    });

    it('highlights the matched substring', async () => {
      const el = await search(await mount(), 'ou');
      const highlight = el.shadowRoot!.querySelector('.value-picker-highlight')!;
      expect(highlight.textContent).toBe('ou');
      expect(items(el)[0].textContent!.replace(/\s+/g, '')).toBe('Mouse2');
    });

    it('keeps counts unchanged while filtering', async () => {
      const el = await search(await mount({ matchedIndices: null }), 'mouse');
      expect(counts(el)).toEqual({ Mouse: 2 });
    });
  });

  describe('edge cases', () => {
    it('renders an empty list when the annotation is missing from the data', async () => {
      const el = await mount({ annotation: 'missing_annotation' });
      expect(labels(el)).toEqual([]);
    });

    it('renders an empty list when there is no data at all', async () => {
      const el = await mount({ data: undefined });
      expect(labels(el)).toEqual([]);
    });

    it('shows zero counts for an empty dataset', async () => {
      const empty: ProtspaceData = {
        protein_ids: [],
        annotations: { organism: { kind: 'categorical', values: ['Human', null] } },
        annotation_data: { organism: [] },
      };
      for (const matchedIndices of [new Set<number>(), null]) {
        const el = await mount({ data: empty, matchedIndices });
        expect(counts(el)).toEqual({ 'Any value': 0, Human: 0, 'N/A': 0 });
      }
    });

    it('shows zero counts when nothing is matched yet', async () => {
      const el = await mount({ matchedIndices: new Set() });
      expect(counts(el)).toEqual({ 'Any value': 0, Human: 0, Mouse: 0, Yeast: 0, 'N/A': 0 });
    });

    it('treats every protein as N/A when the annotation column is absent from annotation_data', async () => {
      const noColumn: ProtspaceData = {
        protein_ids: ['P0', 'P1', 'P2'],
        annotations: { organism: { kind: 'categorical', values: ['Human', null] } },
        annotation_data: {},
      };
      const some = await mount({ data: noColumn, matchedIndices: new Set([0, 1]) });
      expect(counts(some)).toEqual({ 'Any value': 0, Human: 0, 'N/A': 2 });

      const all = await mount({ data: noColumn, matchedIndices: null });
      expect(counts(all)).toEqual({ 'Any value': 0, Human: 0, 'N/A': 3 });
    });

    it('counts an out-of-range label index as N/A', async () => {
      const el = await mount({
        matchedIndices: new Set([0, 1]),
        data: {
          protein_ids: ['P0', 'P1'],
          annotations: { organism: { kind: 'categorical', values: ['Human', null] } },
          annotation_data: { organism: [[0], [99]] },
        },
      });
      expect(counts(el)).toEqual({ 'Any value': 1, Human: 1, 'N/A': 1 });
    });

    it('supports Int32Array annotation data', async () => {
      const el = await mount({
        matchedIndices: new Set([0, 1, 2]),
        data: {
          protein_ids: ['P0', 'P1', 'P2'],
          annotations: { organism: { kind: 'categorical', values: ['Human', 'Mouse', null] } },
          // -1 means "no label" and resolves to N/A.
          annotation_data: { organism: Int32Array.from([0, 1, -1]) },
        },
      });
      expect(counts(el)).toEqual({ 'Any value': 2, Human: 1, Mouse: 1, 'N/A': 1 });
    });

    it('ignores matched indices that are out of range for the dataset', async () => {
      const el = await mount({ matchedIndices: new Set([0, 42]) });
      // The bogus index is skipped: it is no protein, so it counts toward nothing.
      expect(counts(el)).toEqual({ 'Any value': 1, Human: 1, Mouse: 0, Yeast: 0, 'N/A': 0 });
    });
  });

  describe('keyboard navigation', () => {
    /** The labels of the items currently carrying the `highlighted` class. */
    function highlighted(el: ValuePickerEl): string[] {
      return items(el)
        .filter((i) => i.classList.contains('highlighted'))
        .map((i) => i.querySelector('span:not(.value-picker-count)')!.textContent!.trim());
    }

    async function press(el: ValuePickerEl, key: string): Promise<ValuePickerEl> {
      const input = el.shadowRoot!.querySelector('.value-picker-input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await el.updateComplete;
      return el;
    }

    it('highlights nothing until an arrow key is pressed', async () => {
      const el = await mount();
      expect(highlighted(el)).toEqual([]);
    });

    it('ArrowDown walks forward through the list', async () => {
      const el = await mount();
      await press(el, 'ArrowDown');
      expect(highlighted(el)).toEqual(['Any value']);
      await press(el, 'ArrowDown');
      expect(highlighted(el)).toEqual(['N/A']);
    });

    it('ArrowUp walks back and stops at the first item', async () => {
      const el = await mount();
      await press(el, 'ArrowDown');
      await press(el, 'ArrowDown');
      await press(el, 'ArrowUp');
      expect(highlighted(el)).toEqual(['Any value']);
      await press(el, 'ArrowUp');
      expect(highlighted(el)).toEqual(['Any value']);
    });

    it('ArrowDown stops at the last item', async () => {
      const el = await mount();
      for (let i = 0; i < 10; i++) await press(el, 'ArrowDown');
      expect(highlighted(el)).toEqual(['Yeast']);
    });

    it('Enter selects the highlighted value and emits the internal sentinel', async () => {
      const el = await mount();
      let emitted: string | undefined;
      el.addEventListener('value-selected', (e) => {
        emitted = (e as CustomEvent<{ value: string }>).detail.value;
      });
      await press(el, 'ArrowDown');
      await press(el, 'Enter');
      expect(emitted).toBe(ANY_VALUE);
    });

    it('Enter does nothing while nothing is highlighted', async () => {
      const el = await mount();
      let emitted = false;
      el.addEventListener('value-selected', () => {
        emitted = true;
      });
      await press(el, 'Enter');
      expect(emitted).toBe(false);
    });

    it('navigates the filtered list, not the full one', async () => {
      const el = await search(await mount(), 'ou');
      let emitted: string | undefined;
      el.addEventListener('value-selected', (e) => {
        emitted = (e as CustomEvent<{ value: string }>).detail.value;
      });
      await press(el, 'ArrowDown');
      expect(highlighted(el)).toEqual(['Mouse']);
      await press(el, 'Enter');
      expect(emitted).toBe('Mouse');
    });

    it('resets the highlight when the search query changes', async () => {
      const el = await mount();
      await press(el, 'ArrowDown');
      expect(highlighted(el)).toEqual(['Any value']);
      await search(el, 'u');
      expect(highlighted(el)).toEqual([]);
    });

    it('resets the highlight when the picker is reopened', async () => {
      const el = await mount();
      await press(el, 'ArrowDown');
      el.open = false;
      await el.updateComplete;
      el.open = true;
      await el.updateComplete;
      expect(highlighted(el)).toEqual([]);
    });

    it('arrows do nothing on an empty filtered list', async () => {
      const el = await search(await mount(), 'nothing matches this');
      await press(el, 'ArrowDown');
      expect(highlighted(el)).toEqual([]);
    });

    it('refuses to highlight or select locked-out entries', async () => {
      const el = await mount({ selectedValues: [ANY_VALUE] });
      let emitted = false;
      el.addEventListener('value-selected', () => {
        emitted = true;
      });
      // Only Any value itself stays reachable, to be unticked.
      await press(el, 'ArrowDown');
      await press(el, 'ArrowDown');
      expect(highlighted(el)).toEqual(['Any value']);
      await press(el, 'Enter');
      expect(emitted).toBe(false);
    });

    it('does not select a locked-out entry left highlighted by an earlier navigation', async () => {
      const el = await mount();
      await press(el, 'ArrowDown');
      await press(el, 'ArrowDown');
      await press(el, 'ArrowDown');
      expect(highlighted(el)).toEqual(['Human']);
      // The lock arrives while Human is still highlighted.
      el.selectedValues = [ANY_VALUE];
      await el.updateComplete;
      let emitted = false;
      el.addEventListener('value-selected', () => {
        emitted = true;
      });
      await press(el, 'Enter');
      expect(emitted).toBe(false);
    });
  });

  describe('ARIA', () => {
    it('marks the list as a listbox and its entries as options', async () => {
      const el = await mount();
      const list = el.shadowRoot!.querySelector('.value-picker-list')!;
      expect(list.getAttribute('role')).toBe('listbox');
      expect(items(el)).toHaveLength(5);
      for (const item of items(el)) {
        expect(item.getAttribute('role')).toBe('option');
      }
    });

    it('labels the search input', async () => {
      const el = await mount();
      const input = el.shadowRoot!.querySelector('.value-picker-input')!;
      expect(input.getAttribute('aria-label')).toBe('Search values');
      expect(input.getAttribute('aria-haspopup')).toBe('listbox');
      expect(input.getAttribute('aria-expanded')).toBe('true');
    });

    it('points aria-activedescendant at the highlighted option', async () => {
      const el = await mount();
      const input = el.shadowRoot!.querySelector('.value-picker-input')!;
      // Absent rather than empty while nothing is highlighted: an empty
      // aria-activedescendant is an a11y-lint finding, and it matches how the
      // annotation picker spells the same idle state.
      expect(input.getAttribute('aria-activedescendant')).toBeNull();

      const keydown = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      input.dispatchEvent(keydown);
      await el.updateComplete;

      const active = input.getAttribute('aria-activedescendant')!;
      expect(active).not.toBe('');
      const target = el.shadowRoot!.getElementById(active)!;
      expect(target.classList.contains('highlighted')).toBe(true);
    });

    it('reports aria-checked false on the entries that are not selected', async () => {
      const el = await mount();
      for (const item of items(el)) {
        expect(item.getAttribute('aria-checked')).toBe('false');
      }
    });
  });

  describe('close behaviour', () => {
    it('emits picker-close on Escape', async () => {
      const el = await mount();
      let closed = false;
      el.addEventListener('picker-close', () => {
        closed = true;
      });
      const input = el.shadowRoot!.querySelector('.value-picker-input') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(closed).toBe(true);
    });

    it('emits picker-close on an outside press', async () => {
      const el = await mountAnchored();
      let closed = false;
      el.addEventListener('picker-close', () => {
        closed = true;
      });
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
      document.body.dispatchEvent(new Event('pointerup', { bubbles: true, composed: true }));
      expect(closed).toBe(true);
      el.open = false;
      await el.updateComplete;
    });

    it('does not emit picker-close when clicking inside the panel', async () => {
      const el = await mount();
      let closed = false;
      el.addEventListener('picker-close', () => {
        closed = true;
      });
      (el.shadowRoot!.querySelector('.value-picker-input') as HTMLElement).click();
      expect(closed).toBe(false);
    });
  });
});

describe('query-value-picker inside a dialog', () => {
  it('an open picker is a layer, so Escape closes it before the dialog around it', async () => {
    const dialogClose = vi.fn();
    const releaseDialog = pushLayer({ close: dialogClose, elements: [] });
    const el = await mountAnchored({ open: false });
    const onClose = vi.fn();
    el.addEventListener('picker-close', onClose);

    el.open = true;
    await el.updateComplete;
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );

    expect(onClose).toHaveBeenCalledOnce();
    expect(dialogClose).not.toHaveBeenCalled();

    // The owner closes it on picker-close; the dialog is the top layer again.
    el.open = false;
    await el.updateComplete;
    expect(topLayer()?.close).toBe(dialogClose);
    releaseDialog();
  });
});
