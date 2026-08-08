/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './search';

type ProteinSearchElement = HTMLElement & {
  availableProteinIds: string[];
  selectedProteinIds: string[];
  updateComplete: Promise<unknown>;
};

const FIVE = ['P00595', 'P00596', 'P00597', 'P00598', 'P00599'];

async function setupSearch(
  available: string[] = ['P00595', 'Q12345'],
  selected: string[] = ['P00595'],
): Promise<ProteinSearchElement> {
  const element = document.createElement('protspace-protein-search') as ProteinSearchElement;
  element.availableProteinIds = available;
  element.selectedProteinIds = selected;
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

const inputOf = (element: ProteinSearchElement): HTMLInputElement =>
  element.shadowRoot!.querySelector('#protein-search-input') as HTMLInputElement;

/** Type a query into the real input and flush the 120ms suggestion debounce. */
async function typeQuery(element: ProteinSearchElement, query: string): Promise<void> {
  const input = inputOf(element);
  input.focus();
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  vi.advanceTimersByTime(120);
  await element.updateComplete;
}

const press = (element: ProteinSearchElement, key: string, times = 1): void => {
  const input = inputOf(element);
  for (let i = 0; i < times; i++) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }
};

/** Record the `proteinId` of every `type` event the element emits, in order. */
const captureIds = (element: ProteinSearchElement, type: string): string[] => {
  const seen: string[] = [];
  element.addEventListener(type, (event) => {
    seen.push((event as CustomEvent<{ proteinId: string }>).detail.proteinId);
  });
  return seen;
};

const rowsOf = (element: ProteinSearchElement): HTMLElement[] =>
  Array.from(element.shadowRoot!.querySelectorAll('.search-suggestion'));

const rowText = (row: HTMLElement): string => row.textContent!.trim();

describe('protspace-protein-search feedback', () => {
  // jsdom does not implement scrollIntoView, so it is assigned rather than spied on.
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('marks an exact already-selected protein instead of reporting no matches', async () => {
    const element = await setupSearch();
    await typeQuery(element, 'p00595');

    const rows = rowsOf(element);
    expect(rows).toHaveLength(1);
    expect(rowText(rows[0])).toBe('P00595');
    expect(rows[0].classList.contains('selected')).toBe(true);
    expect(element.shadowRoot!.querySelector('.no-results')).toBeNull();
  });

  it('lists every already-selected protein for a partial query', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], FIVE);
    await typeQuery(element, 'P0059');

    const rows = rowsOf(element);
    expect(rows.map(rowText)).toEqual(FIVE);
    expect(rows.every((row) => row.classList.contains('selected'))).toBe(true);
    expect(element.shadowRoot!.querySelector('.no-results')).toBeNull();
  });

  it('shows a selected ID that is a strict prefix of unselected IDs', async () => {
    const element = await setupSearch(['GT4', 'GT40', 'GT41'], ['GT4']);
    await typeQuery(element, 'GT4');

    const rows = rowsOf(element);
    expect(rows.map(rowText)).toEqual(['GT4', 'GT40', 'GT41']);
    expect(rows.map((row) => row.classList.contains('selected'))).toEqual([true, false, false]);
  });

  it('still reports no matches when nothing prefix-matches', async () => {
    const element = await setupSearch();
    await typeQuery(element, 'zzz');

    expect(rowsOf(element)).toHaveLength(0);
    expect(element.shadowRoot!.querySelector('.no-results')?.textContent).toBe(
      'No matching protein IDs found',
    );
  });

  it('surfaces current selections when the empty input is focused', async () => {
    const element = await setupSearch();
    const input = inputOf(element);
    input.focus();
    input.dispatchEvent(new Event('focus', { bubbles: true, composed: true }));
    await element.updateComplete;

    const rows = rowsOf(element);
    expect(rows.map(rowText)).toEqual(['P00595', 'Q12345']);
    expect(rows.map((row) => row.classList.contains('selected'))).toEqual([true, false]);
  });

  it('marks rows with aria-selected for assistive technology', async () => {
    const element = await setupSearch(['GT4', 'GT40'], ['GT4']);
    await typeQuery(element, 'GT4');

    const rows = rowsOf(element);
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(rows[0].getAttribute('title')).toBe('Remove from selection');
    expect(rows[0].getAttribute('aria-label')).toBe('GT4, remove from selection');
    expect(rows[1].getAttribute('aria-label')).toBe('GT40');
    // Selectable rows carry no tooltip rather than an empty one.
    expect(rows[1].hasAttribute('title')).toBe(false);
  });

  it('points aria-activedescendant at the keyboard-highlighted row', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], []);
    await typeQuery(element, 'P0059');

    const input = inputOf(element);
    const listbox = element.shadowRoot!.querySelector('[role="listbox"]')!;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    // Multi-selectable, so aria-selected marks selection state, not the cursor.
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');

    press(element, 'ArrowDown', 2);
    await element.updateComplete;

    const rows = rowsOf(element);
    expect(rows[2].classList.contains('active')).toBe(true);
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[2].id);
  });

  it('drops aria-activedescendant and collapses aria-expanded once the dropdown closes', async () => {
    const element = await setupSearch(['GT4', 'GT40'], []);
    await typeQuery(element, 'GT40');
    expect(inputOf(element).getAttribute('aria-activedescendant')).not.toBeNull();

    press(element, 'Escape');
    await element.updateComplete;

    const input = inputOf(element);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    // aria-controls must not name an element that is no longer in the shadow root.
    expect(input.hasAttribute('aria-controls')).toBe(false);
  });

  it('does not flash the no-match message while the first keystroke is still debounced', async () => {
    const element = await setupSearch(['GT4', 'GT40'], []);
    await typeQuery(element, 'GT4');

    press(element, 'Escape');
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();

    const input = inputOf(element);
    input.value = 'GT4';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await element.updateComplete;

    // Mid-debounce the suggestions are stale-empty; claiming "no matches" here would be
    // false for the full debounce window.
    expect(element.shadowRoot!.querySelector('.no-results')).toBeNull();

    vi.advanceTimersByTime(120);
    await element.updateComplete;
    expect(rowsOf(element).map(rowText)).toEqual(['GT4', 'GT40']);
  });

  it('does not invent a highlight when a dataset change refreshes an empty result', async () => {
    const element = await setupSearch(['OLD1'], []);
    await typeQuery(element, 'NEW');
    expect(inputOf(element).hasAttribute('aria-activedescendant')).toBe(false);

    element.availableProteinIds = ['NEW1', 'NEW2'];
    await element.updateComplete;

    expect(rowsOf(element).map(rowText)).toEqual(['NEW1', 'NEW2']);
    // The user never moved the cursor, so Enter must not activate NEW1.
    expect(rowsOf(element).some((row) => row.classList.contains('active'))).toBe(false);
    expect(inputOf(element).hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('emits remove-selection when a marked row is clicked', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], FIVE);
    await typeQuery(element, 'P0059');

    const removed = captureIds(element, 'remove-selection');

    rowsOf(element)[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(removed).toEqual(['P00595']);
  });

  it('removes the highlighted marked row on Enter', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], FIVE);
    await typeQuery(element, 'P0059');

    const removed = captureIds(element, 'remove-selection');

    press(element, 'Enter');
    expect(removed).toEqual(['P00595']);
  });

  it('adds, not removes, when an unselected row is activated', async () => {
    const element = await setupSearch(['GT4', 'GT40'], ['GT4']);
    await typeQuery(element, 'GT4');

    const added = captureIds(element, 'add-selection');
    const removed = captureIds(element, 'remove-selection');

    rowsOf(element)[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(added).toEqual(['GT40']);
    expect(removed).toEqual([]);
  });

  it('keeps the query and flips the row to selectable after a removal', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], FIVE);
    await typeQuery(element, 'P0059');

    // Simulate the parent echoing the new selection back down.
    element.selectedProteinIds = FIVE.slice(1);
    await element.updateComplete;

    const rows = rowsOf(element);
    expect(rows.map(rowText)).toEqual(FIVE);
    expect(rows[0].classList.contains('selected')).toBe(false);
    expect(element.shadowRoot!.querySelector('.no-results')).toBeNull();
  });

  it('advances the highlight past the first row on repeated ArrowDown', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], []);
    await typeQuery(element, 'P0059');

    press(element, 'ArrowDown', 2);
    await element.updateComplete;

    const rows = rowsOf(element);
    expect(rows[2].classList.contains('active')).toBe(true);
  });

  it('activates the arrow-highlighted row on Enter, not the first row', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], []);
    await typeQuery(element, 'P0059');

    const added = captureIds(element, 'add-selection');

    press(element, 'ArrowDown', 2);
    press(element, 'Enter');

    expect(added).toEqual(['P00597']);
  });

  it('still activates the first row when Enter interrupts a pending debounce', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], []);
    const input = inputOf(element);
    input.focus();
    input.value = 'P0059';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    // Deliberately do NOT advance timers — the debounce is still pending.

    const added = captureIds(element, 'add-selection');

    press(element, 'Enter');
    expect(added).toEqual(['P00595']);
  });

  it('clamps the highlight when a selection change shortens the list', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`);
    // 11 selected: 10 fit the selected budget, A12 remains selectable => 11 rows.
    const element = await setupSearch(ids, ids.slice(0, 11));
    await typeQuery(element, 'A');
    expect(rowsOf(element)).toHaveLength(11);

    press(element, 'ArrowDown', 10);
    await element.updateComplete;
    expect(rowsOf(element)[10].classList.contains('active')).toBe(true);

    // Selecting A12 too: 10 marked rows, nothing selectable => 10 rows.
    element.selectedProteinIds = ids;
    await element.updateComplete;

    const rows = rowsOf(element);
    expect(rows).toHaveLength(10);
    expect(rows[9].classList.contains('active')).toBe(true);
  });

  it('scrolls the highlighted row into view when ArrowDown moves past the visible area', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`);
    const element = await setupSearch(ids, []);
    await typeQuery(element, 'B');
    expect(rowsOf(element)).toHaveLength(20);

    press(element, 'ArrowDown', 15);
    await element.updateComplete;

    // Typing the query seeds the highlight at row 0, so 15 ArrowDown presses land on row 15.
    const rows = rowsOf(element);
    expect(rows[15].classList.contains('active')).toBe(true);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(scrollIntoViewMock.mock.contexts.at(-1)).toBe(rows[15]);
  });

  it('scrolls the highlighted row into view when ArrowUp travels back up', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`);
    const element = await setupSearch(ids, []);
    await typeQuery(element, 'B');

    press(element, 'ArrowDown', 15);
    await element.updateComplete;
    expect(rowsOf(element)[15].classList.contains('active')).toBe(true);

    scrollIntoViewMock.mockClear();
    press(element, 'ArrowUp', 10);
    await element.updateComplete;

    // 10 ArrowUp presses from row 15 land on row 5.
    const rows = rowsOf(element);
    expect(rows[5].classList.contains('active')).toBe(true);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(scrollIntoViewMock.mock.contexts.at(-1)).toBe(rows[5]);
  });

  it('does not reopen the dropdown after an add echoes back a selection change', async () => {
    const element = await setupSearch(['GT4', 'GT40'], []);
    await typeQuery(element, 'GT40');
    expect(rowsOf(element)).toHaveLength(1);

    press(element, 'Enter');
    await element.updateComplete;

    // The add cleared the query and closed the dropdown synchronously.
    expect(rowsOf(element)).toHaveLength(0);
    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();

    // Simulate the parent echoing the new selection back down — this must NOT
    // reopen the dropdown even though the input is still focused with an empty query.
    element.selectedProteinIds = ['GT40'];
    await element.updateComplete;

    expect(rowsOf(element)).toHaveLength(0);
    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();
  });

  it('refreshes dataset results only while the dropdown is open', async () => {
    const element = await setupSearch(['OLD1'], []);
    await typeQuery(element, 'NEW');

    expect(rowsOf(element)).toHaveLength(0);
    expect(element.shadowRoot!.querySelector('.no-results')?.textContent).toBe(
      'No matching protein IDs found',
    );

    element.availableProteinIds = ['NEW1'];
    await element.updateComplete;

    expect(rowsOf(element).map(rowText)).toEqual(['NEW1']);
    expect(element.shadowRoot!.querySelector('.no-results')).toBeNull();

    const input = element.shadowRoot!.querySelector('#protein-search-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();

    element.availableProteinIds = ['NEW2'];
    await element.updateComplete;

    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();
  });
});
