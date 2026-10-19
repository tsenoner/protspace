/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushLayer, topLayer } from '../kit/layers';
import './protein-search';

type ProteinSearchElement = HTMLElement & {
  availableProteinIds: string[];
  selectedProteinIds: string[];
  reportNotInView(proteinId: string): void;
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

/**
 * Paste `text` into the real input and return the event. jsdom has no DataTransfer, so
 * the event carries a stub exposing only the `getData('text/plain')` the handler reads.
 */
const paste = (element: ProteinSearchElement, text: string): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  inputOf(element).dispatchEvent(event);
  return event;
};

/** Record the `proteinIds` of every `add-selection-multiple` the element emits. */
const captureBulk = (element: ProteinSearchElement): string[][] => {
  const seen: string[][] = [];
  element.addEventListener('add-selection-multiple', (event) => {
    seen.push((event as CustomEvent<{ proteinIds: string[] }>).detail.proteinIds);
  });
  return seen;
};

const rowsOf = (element: ProteinSearchElement): HTMLElement[] =>
  Array.from(element.shadowRoot!.querySelectorAll('.search-suggestion'));

const rowText = (row: HTMLElement): string => row.textContent!.trim();

const reportOf = (element: ProteinSearchElement): HTMLElement | null =>
  element.shadowRoot!.querySelector('.search-report');

/** The search's one live region, rendered whether or not a report shows. */
const liveOf = (element: ProteinSearchElement): HTMLElement | null =>
  element.shadowRoot!.querySelector('.search-live');

const copyOf = (element: ProteinSearchElement): HTMLElement =>
  reportOf(element)!.querySelector('.search-report-copy') as HTMLElement;

/** Record the detail of every `type` event the element emits, in order. */
const captureDetails = <T>(element: ProteinSearchElement, type: string): T[] => {
  const seen: T[] = [];
  element.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
};

describe('protspace-protein-search feedback', () => {
  // jsdom does not implement scrollIntoView, so it is assigned rather than spied on.
  const hadScrollIntoView = 'scrollIntoView' in Element.prototype;
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    // Restoring by assignment would leave an own `scrollIntoView: undefined` on
    // Element.prototype, so `'scrollIntoView' in el` would answer true for the rest of
    // the file. Delete it instead when jsdom never had one.
    if (hadScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView;
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
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

  it('reports the combobox as expanded while the no-match message is on screen', async () => {
    const element = await setupSearch();
    await typeQuery(element, 'zzz');

    const input = inputOf(element);
    const popup = element.shadowRoot!.querySelector('.search-suggestions')!;
    // The message is a rendered popup. A combobox reporting itself collapsed while the
    // popup is visible tells a screen-reader user the opposite of what sighted users see.
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(popup.id);
    // `aria-controls` has to name an actual popup, so the empty state is still a listbox.
    expect(popup.getAttribute('role')).toBe('listbox');
    // The always-rendered live region says it; the visible copy is not a second live region.
    expect(liveOf(element)!.textContent!.trim()).toBe('No matching protein IDs found');
    expect(element.shadowRoot!.querySelector('.no-results')!.hasAttribute('role')).toBe(false);
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

  it('does not seed a keyboard cursor on a bare focus, so Enter cannot remove a selection', async () => {
    const element = await setupSearch();
    const input = inputOf(element);
    input.focus();
    input.dispatchEvent(new Event('focus', { bubbles: true, composed: true }));
    await element.updateComplete;

    // Row 0 is the current selection; a seeded highlight there would make a reflexive
    // Enter silently drop a protein the user never pointed at.
    expect(rowsOf(element).some((row) => row.classList.contains('active'))).toBe(false);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);

    const removed = captureIds(element, 'remove-selection');
    const added = captureIds(element, 'add-selection');
    press(element, 'Enter');
    expect(removed).toEqual([]);
    expect(added).toEqual([]);

    // Arrow keys still start at row 0 from the unseeded state.
    press(element, 'ArrowDown');
    await element.updateComplete;
    expect(rowsOf(element)[0].classList.contains('active')).toBe(true);
  });

  it('names the combobox, hides the shortcut hint and keeps the list out of the Tab order', async () => {
    const element = await setupSearch();
    const input = inputOf(element);
    expect(input.getAttribute('aria-label')).toBe('Search proteins');
    expect(input.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K');
    const hint = element.shadowRoot!.querySelector('.search-keyboard-shortcut-hint')!;
    expect(hint.getAttribute('aria-hidden')).toBe('true');

    await typeQuery(element, 'P');
    expect(element.shadowRoot!.querySelector('[role="listbox"]')!.getAttribute('tabindex')).toBe(
      '-1',
    );
    await typeQuery(element, 'ZZZ');
    expect(element.shadowRoot!.querySelector('.no-results')).not.toBeNull();
    expect(element.shadowRoot!.querySelector('[role="listbox"]')!.getAttribute('tabindex')).toBe(
      '-1',
    );
  });

  it('marks rows with aria-selected for assistive technology', async () => {
    const element = await setupSearch(['GT4', 'GT40'], ['GT4']);
    await typeQuery(element, 'GT4');

    const rows = rowsOf(element);
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(rows[0].getAttribute('aria-label')).toBe('GT4, remove from selection');
    expect(rows[1].getAttribute('aria-label')).toBe('GT40');
    // No row carries a native title tooltip.
    expect(rows.some((row) => row.hasAttribute('title'))).toBe(false);
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

    // Landing on row 2 also pins that the highlight advances past the first row.
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

  it('resolves a typed ID case-insensitively when Enter has no highlighted row', async () => {
    const element = await setupSearch(['OLD1'], []);
    await typeQuery(element, 'new1');
    expect(inputOf(element).hasAttribute('aria-activedescendant')).toBe(false);

    // A dataset change brings the protein in, and the absent cursor is preserved — so
    // Enter falls through to resolving the raw query rather than activating a row.
    element.availableProteinIds = ['NEW1'];
    await element.updateComplete;
    expect(rowsOf(element).some((row) => row.classList.contains('active'))).toBe(false);

    const added = captureIds(element, 'add-selection');
    press(element, 'Enter');

    // Dispatched with the dataset's spelling, not the user's.
    expect(added).toEqual(['NEW1']);
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

  /**
   * A 20-row dropdown — more than the ~8 the container shows — arrowed down to row 15.
   * Typing the query seeds the highlight at row 0, so 15 presses land on row 15.
   */
  async function listArrowedToRow15(): Promise<ProteinSearchElement> {
    const ids = Array.from({ length: 20 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`);
    const element = await setupSearch(ids, []);
    await typeQuery(element, 'B');
    expect(rowsOf(element)).toHaveLength(20);

    press(element, 'ArrowDown', 15);
    await element.updateComplete;
    expect(rowsOf(element)[15].classList.contains('active')).toBe(true);
    return element;
  }

  it('scrolls the highlighted row into view when ArrowDown moves past the visible area', async () => {
    const element = await listArrowedToRow15();

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(scrollIntoViewMock.mock.contexts.at(-1)).toBe(rowsOf(element)[15]);
  });

  it('scrolls the highlighted row into view when ArrowUp travels back up', async () => {
    const element = await listArrowedToRow15();

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

    press(element, 'Escape');
    await element.updateComplete;
    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();

    element.availableProteinIds = ['NEW2'];
    await element.updateComplete;

    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();
  });
});

describe('protspace-protein-search and the layer stack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('the open suggestion list closes on Escape before anything else and on a press outside', async () => {
    const dialogClose = vi.fn();
    const releaseDialog = pushLayer({ close: dialogClose, elements: [] });
    const element = await setupSearch(FIVE, []);
    await typeQuery(element, 'P0059');
    expect(rowsOf(element).length).toBeGreaterThan(0);

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await element.updateComplete;

    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();
    expect(inputOf(element).value).toBe('');
    expect(dialogClose).not.toHaveBeenCalled();
    expect(topLayer()?.close).toBe(dialogClose);

    // A press outside blurs the input: the list closes 200 ms later and keeps the query.
    await typeQuery(element, 'P0059');
    expect(rowsOf(element).length).toBeGreaterThan(0);
    inputOf(element).dispatchEvent(new FocusEvent('blur'));
    vi.advanceTimersByTime(200);
    await element.updateComplete;

    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();
    expect(inputOf(element).value).toBe('P0059');
    expect(topLayer()?.close).toBe(dialogClose);
    releaseDialog();
  });

  it('Escape with nothing to close passes on to the page', async () => {
    const element = await setupSearch(FIVE, ['P00595']);
    const pageEscape = vi.fn();
    document.addEventListener('keydown', pageEscape);

    inputOf(element).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );

    // The page's selection controller hears it and clears the selection.
    expect(pageEscape).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', pageEscape);
  });

  it('no search-opened event is dispatched', async () => {
    const element = await setupSearch();
    const opened = vi.fn();
    element.addEventListener('search-opened', opened);

    inputOf(element).focus();
    await element.updateComplete;

    expect(opened).not.toHaveBeenCalled();
  });
});

describe('protspace-protein-search reports what happened', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    // jsdom has no clipboard; the copy test defines one on the navigator for itself.
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it("an unknown ID shows 'No protein X in this dataset', keeps the input and dispatches nothing", async () => {
    const element = await setupSearch(FIVE, []);
    const added = captureIds(element, 'add-selection');
    await typeQuery(element, 'ZZZ1');

    press(element, 'Enter');
    await element.updateComplete;

    expect(reportOf(element)?.textContent?.trim()).toBe('No protein ZZZ1 in this dataset');
    expect(liveOf(element)?.textContent?.trim()).toBe('No protein ZZZ1 in this dataset');
    expect(inputOf(element).value).toBe('ZZZ1');
    expect(added).toEqual([]);
    // A combobox may only control a listbox: the report describes the field instead.
    expect(element.shadowRoot!.querySelector('#protein-search-report')).not.toBeNull();
    expect(inputOf(element).getAttribute('aria-expanded')).toBe('false');
    expect(inputOf(element).hasAttribute('aria-controls')).toBe(false);
    expect(inputOf(element).getAttribute('aria-describedby')).toBe('protein-search-report');
  });

  it('one live region is always rendered and carries only the summary sentence', async () => {
    const element = await setupSearch(FIVE, []);
    const live = liveOf(element)!;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent!.trim()).toBe('');
    // The visible report is not a live region itself, or its whole list would be read out.
    expect(element.shadowRoot!.querySelectorAll('[role="status"]')).toHaveLength(1);

    paste(element, 'P00595, p00596\nX1;X2 X3');
    await element.updateComplete;
    expect(liveOf(element)).toBe(live);
    expect(live.textContent!.trim()).toBe('2 of 5 found, 3 not found');
    expect(live.querySelector('li')).toBeNull();
    expect(element.shadowRoot!.querySelectorAll('[role="status"]')).toHaveLength(1);

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await element.updateComplete;
    expect(reportOf(element)).toBeNull();
    expect(liveOf(element)).toBe(live);
    expect(live.textContent!.trim()).toBe('');
    expect(inputOf(element).hasAttribute('aria-describedby')).toBe(false);
  });

  it('an already-selected ID reports it', async () => {
    const element = await setupSearch(['OLD1'], []);
    await typeQuery(element, 'new1');
    // The protein arrives, already selected; the absent cursor is preserved, so Enter resolves
    // the typed text instead of activating (and removing) a row.
    element.availableProteinIds = ['NEW1'];
    element.selectedProteinIds = ['NEW1'];
    await element.updateComplete;
    const removed = captureIds(element, 'remove-selection');

    press(element, 'Enter');
    await element.updateComplete;

    expect(reportOf(element)?.textContent?.trim()).toBe('NEW1 is already selected');
    expect(removed).toEqual([]);
    expect(inputOf(element).value).toBe('new1');
  });

  it("a paste with 3 missing of 5 shows '2 of 5 found', lists the 3 and dispatches add-selection-multiple with 2", async () => {
    const element = await setupSearch(FIVE, []);
    const added = captureDetails<{ proteinIds: string[]; missing: string[] }>(
      element,
      'add-selection-multiple',
    );

    const event = paste(element, 'P00595, p00596\nX1;X2 X3');
    await element.updateComplete;

    expect(event.defaultPrevented).toBe(true);
    expect(added).toEqual([{ proteinIds: ['P00595', 'P00596'], missing: ['X1', 'X2', 'X3'] }]);
    const report = reportOf(element)!;
    expect(report.querySelector('.search-report-line')!.textContent!.trim()).toBe('2 of 5 found');
    expect([...report.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'X1',
      'X2',
      'X3',
    ]);
    expect(report.querySelector('.search-report-copy')!.textContent!.trim()).toBe(
      'Copy missing IDs',
    );
  });

  it('a paste where everything is found shows no report', async () => {
    const element = await setupSearch(FIVE, []);
    paste(element, 'P00595 P00596');
    await element.updateComplete;
    expect(reportOf(element)).toBeNull();
  });

  it("more than 50 missing shows 50 and 'and N more'", async () => {
    const element = await setupSearch(FIVE, []);
    const missing = Array.from({ length: 1_234 }, (_, i) => `M${i}`);

    paste(element, ['P00595', ...missing].join('\n'));
    await element.updateComplete;

    const report = reportOf(element)!;
    expect(report.querySelector('.search-report-line')!.textContent!.trim()).toBe(
      '1 of 1,235 found',
    );
    expect(report.querySelectorAll('li')).toHaveLength(50);
    expect(report.querySelector('.search-report-more')!.textContent!.trim()).toBe('and 1,184 more');
  });

  it('Copy missing IDs writes all of them, one per line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const element = await setupSearch(FIVE, []);
    const missing = Array.from({ length: 60 }, (_, i) => `M${i}`);
    paste(element, missing.join(' '));
    await element.updateComplete;

    copyOf(element).click();

    expect(writeText).toHaveBeenCalledWith(missing.join('\n'));
  });

  it("Copy missing IDs confirms with 'Copied' for 2 s", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const element = await setupSearch(FIVE, []);
    paste(element, 'X1 X2');
    await element.updateComplete;

    copyOf(element).click();
    await vi.advanceTimersByTimeAsync(0);
    await element.updateComplete;
    expect(copyOf(element).textContent!.trim()).toBe('Copied');
    expect(liveOf(element)!.textContent!.trim()).toBe('Copied');

    await vi.advanceTimersByTimeAsync(2000);
    await element.updateComplete;
    expect(copyOf(element).textContent!.trim()).toBe('Copy missing IDs');
  });

  it("a refused clipboard says 'Could not copy'", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const element = await setupSearch(FIVE, []);
    paste(element, 'X1 X2');
    await element.updateComplete;

    copyOf(element).click();
    await vi.advanceTimersByTimeAsync(0);
    await element.updateComplete;
    expect(copyOf(element).textContent!.trim()).toBe('Could not copy');
    expect(liveOf(element)!.textContent!.trim()).toBe('Could not copy');
  });

  it('the report closes on Escape, keeping the text, and on typing', async () => {
    const element = await setupSearch(FIVE, []);
    await typeQuery(element, 'ZZZ1');
    press(element, 'Enter');
    await element.updateComplete;
    expect(reportOf(element)).not.toBeNull();

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    await element.updateComplete;
    expect(reportOf(element)).toBeNull();
    expect(inputOf(element).value).toBe('ZZZ1');

    press(element, 'Enter');
    await element.updateComplete;
    expect(reportOf(element)).not.toBeNull();
    await typeQuery(element, 'ZZZ12');
    expect(reportOf(element)).toBeNull();
  });

  it('reportNotInView shows its line', async () => {
    const element = await setupSearch(FIVE, ['P00595']);
    element.reportNotInView('P00595');
    await element.updateComplete;
    expect(reportOf(element)?.textContent?.trim()).toBe(
      'P00595 is selected but hidden in this view',
    );
  });

  it('add-selection carries its source', async () => {
    // A highlighted suggestion: Enter activates the row.
    const listed = await setupSearch(['GT4', 'GT40'], []);
    const fromList = captureDetails<{ proteinId: string; source: string }>(listed, 'add-selection');
    await typeQuery(listed, 'GT40');
    press(listed, 'Enter');
    expect(fromList).toEqual([{ proteinId: 'GT40', source: 'suggestion' }]);

    // No row highlighted: Enter resolves the typed text (the sequence of
    // 'resolves a typed ID case-insensitively when Enter has no highlighted row').
    const typed = await setupSearch(['OLD1'], []);
    const fromText = captureDetails<{ proteinId: string; source: string }>(typed, 'add-selection');
    await typeQuery(typed, 'new1');
    typed.availableProteinIds = ['NEW1'];
    await typed.updateComplete;
    press(typed, 'Enter');
    expect(fromText).toEqual([{ proteinId: 'NEW1', source: 'typed' }]);
  });
});

describe('protspace-protein-search focusInput', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('focusInput focuses the text input', async () => {
    const element = await setupSearch();
    expect(element.shadowRoot!.activeElement).toBeNull();

    (element as ProteinSearchElement & { focusInput(): void }).focusInput();

    expect(element.shadowRoot!.activeElement).toBe(inputOf(element));
  });
});

describe('protspace-protein-search paste', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('bulk-adds a pasted list split on any whitespace, in the dataset spelling', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], []);
    const bulk = captureBulk(element);

    const event = paste(element, '  p00596\tQ12345\r\n\nP00597   p00599\n');

    expect(event.defaultPrevented).toBe(true);
    expect(bulk).toEqual([['P00596', 'Q12345', 'P00597', 'P00599']]);
  });

  it('drops repeated, already-selected and unknown IDs from the bulk add', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], ['P00595']);
    const bulk = captureBulk(element);

    // P00596 twice in different casings, P00595 already selected, NOPE not in the dataset.
    paste(element, 'P00595 p00596 NOPE P00596 q12345');

    expect(bulk).toEqual([['P00596', 'Q12345']]);
  });

  it('emits nothing when no new valid ID was pasted, but still clears the search', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], ['P00595']);
    await typeQuery(element, 'P0059');
    expect(rowsOf(element)).not.toHaveLength(0);
    const bulk = captureBulk(element);

    const event = paste(element, 'P00595 NOPE');
    await element.updateComplete;

    // Still a bulk paste, so the raw text must not land in the box either.
    expect(event.defaultPrevented).toBe(true);
    expect(bulk).toEqual([]);
    expect(inputOf(element).value).toBe('');
    expect(element.shadowRoot!.querySelector('.search-suggestions')).toBeNull();
  });

  it('leaves a single-token paste to the browser as ordinary typing', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], []);
    const bulk = captureBulk(element);
    const added = captureIds(element, 'add-selection');

    const event = paste(element, ' P00596 ');

    expect(event.defaultPrevented).toBe(false);
    expect(bulk).toEqual([]);
    expect(added).toEqual([]);
  });

  it('takes the bulk path for a single ID copied with its line break', async () => {
    const element = await setupSearch([...FIVE, 'Q12345'], []);
    const bulk = captureBulk(element);

    // A row copied out of a spreadsheet or FASTA header list ends in a newline.
    const event = paste(element, 'P00596\n');

    expect(event.defaultPrevented).toBe(true);
    expect(bulk).toEqual([['P00596']]);
  });
});
