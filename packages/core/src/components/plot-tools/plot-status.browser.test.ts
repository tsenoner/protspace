import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsIconButton } from '../kit/button';
import { deepActiveElement } from '../kit/focus';
import type { ProtspacePlotStatus, StatusChipKind } from './plot-status';
import './plot-status';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

async function mount(
  props: Partial<
    Pick<
      ProtspacePlotStatus,
      'count' | 'zoomedIn' | 'filterConditions' | 'isolation' | 'hiddenCategories' | 'eatDim'
    >
  > = {},
  parent: HTMLElement = document.body,
): Promise<ProtspacePlotStatus> {
  const el = document.createElement('protspace-plot-status');
  Object.assign(el, { count: 7831, ...props });
  parent.append(el);
  await el.updateComplete;
  await Promise.all(
    [...el.shadowRoot!.querySelectorAll<PsIconButton>('ps-icon-button')].map(
      (b) => b.updateComplete,
    ),
  );
  return el;
}
const countText = (el: ProtspacePlotStatus) =>
  el.shadowRoot!.querySelector('.status-count')?.textContent?.trim() ?? null;
const chips = (el: ProtspacePlotStatus) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>('.status-chip'),
];
const chipText = (chip: Element) =>
  chip.querySelector('.status-chip-open, .status-chip-text')!.textContent!.trim();
const clearButton = (el: ProtspacePlotStatus, kind: StatusChipKind) =>
  el.shadowRoot!.querySelector<PsIconButton>(`.status-chip[data-kind="${kind}"] ps-icon-button`)!;
const openButton = (el: ProtspacePlotStatus, kind: StatusChipKind) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    `.status-chip[data-kind="${kind}"] .status-chip-open`,
  );
const inner = (b: Element) => b.shadowRoot!.querySelector('button')!;
/** Every chip set, then cleared by its own ✕ as the host would. */
function clearsItself(el: ProtspacePlotStatus): void {
  el.addEventListener('status-clear', (event) => {
    const { kind } = (event as CustomEvent<{ kind: StatusChipKind }>).detail;
    if (kind === 'filter') el.filterConditions = 0;
    if (kind === 'isolation') el.isolation = null;
    if (kind === 'hidden') el.hiddenCategories = 0;
  });
}

describe('protspace-plot-status', () => {
  it('count text groups and pluralises; Zoomed in appended', async () => {
    const el = await mount({ count: 7831 });
    expect(countText(el)).toBe('7,831 proteins');
    el.zoomedIn = true;
    await el.updateComplete;
    expect(countText(el)).toBe('7,831 proteins · Zoomed in');
    el.count = 1;
    await el.updateComplete;
    expect(countText(el)).toBe('1 protein · Zoomed in');
  });

  it('null count hides it', async () => {
    const el = await mount({ count: null });
    expect(countText(el)).toBeNull();
  });

  it("each chip's text per the copy table, plural-aware (1 condition, 1 step, 1 category)", async () => {
    const el = await mount({
      filterConditions: 1,
      isolation: { steps: 1, size: 1 },
      hiddenCategories: 1,
    });
    expect(chips(el).map(chipText)).toEqual([
      'Filtered · 1 condition',
      'Showing only 1 protein · 1 step',
      '1 category hidden',
    ]);
    Object.assign(el, {
      filterConditions: 2,
      isolation: { steps: 2, size: 1204 },
      hiddenCategories: 4,
    });
    await el.updateComplete;
    expect(chips(el).map(chipText)).toEqual([
      'Filtered · 2 conditions',
      'Showing only 1,204 proteins · 2 steps',
      '4 categories hidden',
    ]);
  });

  it('the EAT dim chip names what it fades, sits after the filter, opens and clears', async () => {
    const el = await mount({
      filterConditions: 1,
      hiddenCategories: 1,
      eatDim: { min: 0.5, max: 1 },
    });
    expect(chips(el).map((chip) => chip.dataset.kind)).toEqual(['filter', 'eat-dim', 'hidden']);
    expect(chipText(chips(el)[1])).toBe('EAT: outside 50–100\u202f% faded');
    el.eatDim = { min: 0.4, max: 0.6 };
    await el.updateComplete;
    expect(chipText(chips(el)[1])).toBe('EAT: outside 40–60\u202f% faded');
    const events: string[] = [];
    el.addEventListener('status-open', (e) =>
      events.push(`open ${(e as CustomEvent).detail.kind}`),
    );
    el.addEventListener('status-clear', (e) =>
      events.push(`clear ${(e as CustomEvent).detail.kind}`),
    );
    openButton(el, 'eat-dim')!.click();
    inner(clearButton(el, 'eat-dim')).click();
    expect(events).toEqual(['open eat-dim', 'clear eat-dim']);
    // A dim that fades nothing shows no chip.
    el.eatDim = { min: 0, max: 1 };
    await el.updateComplete;
    expect(chips(el).map((chip) => chip.dataset.kind)).toEqual(['filter', 'hidden']);
  });

  it('chips render in the order filter, isolation, hidden', async () => {
    const el = await mount({ hiddenCategories: 3, filterConditions: 1 });
    expect(chips(el).map((chip) => chip.dataset.kind)).toEqual(['filter', 'hidden']);
    el.isolation = { steps: 1, size: 9 };
    await el.updateComplete;
    expect(chips(el).map((chip) => chip.dataset.kind)).toEqual(['filter', 'isolation', 'hidden']);
  });

  it('each ✕ has its own accessible name and fires status-clear with its kind', async () => {
    const el = await mount({
      filterConditions: 1,
      isolation: { steps: 1, size: 5 },
      hiddenCategories: 2,
    });
    for (const name of ['Remove filter', 'Show all proteins', 'Show hidden categories']) {
      await expect.element(page.getByRole('button', { name, exact: true })).toBeInTheDocument();
    }
    const kinds: string[] = [];
    // On the element, not document.body: the body's listeners would outlive this test.
    el.addEventListener('status-clear', (event) =>
      kinds.push((event as CustomEvent<{ kind: string }>).detail.kind),
    );
    for (const kind of ['filter', 'isolation', 'hidden'] as const) {
      inner(clearButton(el, kind)).click();
    }
    expect(kinds).toEqual(['filter', 'isolation', 'hidden']);
  });

  it('the filter and hidden chip bodies fire status-open; the isolation chip has no open control', async () => {
    const el = await mount({
      filterConditions: 1,
      isolation: { steps: 1, size: 5 },
      hiddenCategories: 2,
    });
    const kinds: string[] = [];
    el.addEventListener('status-open', (event) =>
      kinds.push((event as CustomEvent<{ kind: string }>).detail.kind),
    );
    openButton(el, 'filter')!.click();
    openButton(el, 'hidden')!.click();
    expect(kinds).toEqual(['filter', 'hidden']);
    expect(openButton(el, 'isolation')).toBeNull();
  });

  it('removing a focused chip moves focus to the next chip, else the count', async () => {
    const el = await mount({
      filterConditions: 1,
      isolation: { steps: 1, size: 5 },
      hiddenCategories: 2,
    });
    clearsItself(el);

    inner(clearButton(el, 'filter')).focus();
    await userEvent.keyboard('{Enter}');
    // The isolation chip's first control is its ✕.
    await vi.waitFor(() => expect(deepActiveElement()).toBe(inner(clearButton(el, 'isolation'))));

    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(deepActiveElement()).toBe(openButton(el, 'hidden')));

    inner(clearButton(el, 'hidden')).focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() =>
      expect(deepActiveElement()).toBe(el.shadowRoot!.querySelector('.status-count')),
    );
  });

  it('an ✕ press that leaves its chip never pulls focus later', async () => {
    const el = await mount({ hiddenCategories: 1 });
    // The host ignores status-clear: the chip stays.
    inner(clearButton(el, 'hidden')).focus();
    await userEvent.keyboard('{Enter}');
    await el.updateComplete;
    expect(chips(el)).toHaveLength(1);

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    el.hiddenCategories = 0;
    await el.updateComplete;
    expect(document.activeElement).toBe(outside);
  });

  it('the count is role=status', async () => {
    await mount({ count: 42 });
    await expect.element(page.getByRole('status')).toHaveTextContent('42 proteins');
  });

  it('focusChip focuses a chip set in the same task, after its update', async () => {
    const el = await mount();
    expect(el.focusChip('isolation')).toBe(false);
    el.isolation = { steps: 1, size: 3 };
    expect(el.focusChip('isolation')).toBe(true);
    await vi.waitFor(() => expect(deepActiveElement()).toBe(inner(clearButton(el, 'isolation'))));
  });

  it('sits in the bottom-left corner; chips are 24 px tall', async () => {
    const parent = document.createElement('div');
    parent.style.cssText = 'position: relative; width: 800px; height: 400px';
    document.body.append(parent);
    const el = await mount({ filterConditions: 1 }, parent);
    const box = parent.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    expect(Math.abs(host.left - box.left - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.bottom - host.bottom - 12)).toBeLessThanOrEqual(1);
    expect(Math.round(chips(el)[0].getBoundingClientRect().height)).toBe(24);
  });
});
