import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsButton } from '../kit/button';
import { deepActiveElement } from '../kit/focus';
import type { ProtspaceSelectionBar } from './selection-bar';
import './selection-bar';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());
// Vitest's default page is 414 px wide, a phone; the tests below the phone block are desktop's.
beforeEach(async () => {
  await page.viewport(1024, 768);
});

async function mount(count = 3, parent: HTMLElement = document.body) {
  const el = document.createElement('protspace-selection-bar');
  el.selectedCount = count;
  parent.append(el);
  await el.updateComplete;
  return el;
}
const buttons = (el: ProtspaceSelectionBar) => [
  ...el.shadowRoot!.querySelectorAll<PsButton>('ps-button'),
];
const button = (el: ProtspaceSelectionBar, name: string) =>
  buttons(el).find((b) => b.textContent!.trim() === name)!;
const inner = (b: Element) => b.shadowRoot!.querySelector('button')!;
const countText = (el: ProtspaceSelectionBar) =>
  el.shadowRoot!.querySelector('.selection-count')!.textContent!.trim();

describe('protspace-selection-bar', () => {
  it('hidden at 0, shown with a count', async () => {
    const el = await mount(0);
    const bar = () => el.shadowRoot!.querySelector('.bar')!;
    expect(el.hidden).toBe(true);
    expect(getComputedStyle(bar()).display).toBe('none');

    el.selectedCount = 2;
    await el.updateComplete;
    expect(el.hidden).toBe(false);
    expect(getComputedStyle(bar()).display).not.toBe('none');
  });

  it('the count is announced from a live region that stays rendered while hidden', async () => {
    const el = await mount(0);
    const status = () => el.shadowRoot!.querySelector('[role="status"]');
    expect(status()).not.toBeNull();
    expect(status()!.textContent!.trim()).toBe('');

    el.selectedCount = 2;
    await el.updateComplete;
    expect(status()!.textContent!.trim()).toBe('2 proteins selected');
    // The visible count is not read a second time.
    expect(el.shadowRoot!.querySelector('.selection-count')!.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('toolbar named Selection with the four buttons', async () => {
    const el = await mount();
    await expect.element(page.getByRole('toolbar', { name: 'Selection' })).toBeInTheDocument();
    expect(buttons(el).map((b) => b.textContent!.trim())).toEqual([
      'Show only these',
      'Zoom to them',
      'Copy IDs',
      'Clear',
    ]);
    for (const b of buttons(el)) {
      expect(b.size).toBe('sm');
      expect(b.variant).toBe('ghost');
    }
  });

  it('count text is plural-aware: 1 protein selected, 1,234 proteins selected', async () => {
    const el = await mount(1);
    expect(countText(el)).toBe('1 protein selected');
    el.selectedCount = 1234;
    await el.updateComplete;
    expect(countText(el)).toBe('1,234 proteins selected');
  });

  it('each button dispatches its event', async () => {
    const el = await mount();
    const heard: string[] = [];
    for (const type of [
      'isolate-data',
      'zoom-to-selection',
      'copy-selection',
      'clear-selections',
    ]) {
      // On the element, not document.body: the body's listeners would outlive this test.
      el.addEventListener(type, (event) => {
        expect((event as CustomEvent).detail).toEqual({});
        expect(event.composed).toBe(true);
        heard.push(type);
      });
    }
    for (const name of ['Show only these', 'Zoom to them', 'Copy IDs', 'Clear']) {
      inner(button(el, name)).click();
    }
    expect(heard).toEqual([
      'isolate-data',
      'zoom-to-selection',
      'copy-selection',
      'clear-selections',
    ]);
  });

  it('Show only these is disabled when canIsolate is false', async () => {
    const el = await mount();
    el.canIsolate = false;
    await el.updateComplete;
    const showOnly = button(el, 'Show only these');
    await showOnly.updateComplete;
    expect(showOnly.disabled).toBe(true);
    const onIsolate = vi.fn();
    el.addEventListener('isolate-data', onIsolate);
    inner(showOnly).click();
    expect(onIsolate).not.toHaveBeenCalled();
  });

  it('Arrow keys move between the buttons; one Tab stop', async () => {
    const el = await mount();
    const before = document.createElement('button');
    const after = document.createElement('button');
    document.body.prepend(before);
    document.body.append(after);

    before.focus();
    await userEvent.keyboard('{Tab}');
    expect(deepActiveElement()).toBe(inner(button(el, 'Show only these')));
    await userEvent.keyboard('{Tab}');
    expect(deepActiveElement()).toBe(after);

    inner(button(el, 'Show only these')).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(deepActiveElement()).toBe(inner(button(el, 'Zoom to them')));
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{ArrowLeft}');
    expect(deepActiveElement()).toBe(inner(button(el, 'Clear')));

    // The stop follows focus: Tab comes back to Clear.
    before.focus();
    await el.updateComplete;
    await userEvent.keyboard('{Tab}');
    expect(deepActiveElement()).toBe(inner(button(el, 'Clear')));

    // A disabled Show only these is skipped.
    el.canIsolate = false;
    await el.updateComplete;
    inner(button(el, 'Zoom to them')).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(deepActiveElement()).toBe(inner(button(el, 'Clear')));
  });

  it('Clear while focused calls returnFocus("clear") and focus does not fall to body', async () => {
    const el = await mount(2);
    const outside = document.createElement('button');
    document.body.append(outside);
    const calls: string[] = [];
    el.returnFocus = (action) => {
      calls.push(action);
      outside.focus();
    };
    el.addEventListener('clear-selections', () => (el.selectedCount = 0));

    // A press that leaves the bar shown keeps focus where it is.
    inner(button(el, 'Zoom to them')).focus();
    await userEvent.keyboard('{Enter}');
    await el.updateComplete;
    expect(calls).toEqual([]);

    inner(button(el, 'Clear')).focus();
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(calls).toEqual(['clear']));
    expect(deepActiveElement()).toBe(outside);
  });

  it('focus in the bar moves on when the selection empties without a press (Escape)', async () => {
    const el = await mount(3);
    const calls: string[] = [];
    el.returnFocus = (action) => calls.push(action);
    inner(button(el, 'Zoom to them')).focus();
    el.selectedCount = 0;
    await el.updateComplete;
    expect(calls).toEqual(['clear']);
  });

  it('Show only these while focused calls returnFocus("isolate") once', async () => {
    const el = await mount(3);
    const calls: string[] = [];
    el.returnFocus = (action) => calls.push(action);
    el.addEventListener('isolate-data', () => (el.selectedCount = 0));
    inner(button(el, 'Show only these')).focus();
    await userEvent.keyboard('{Enter}');
    await el.updateComplete;
    expect(calls).toEqual(['isolate']);
  });

  it('an emptied selection without focus in the bar leaves focus alone', async () => {
    const el = await mount(3);
    const calls: string[] = [];
    el.returnFocus = (action) => calls.push(action);
    el.selectedCount = 0;
    await el.updateComplete;
    expect(calls).toEqual([]);
  });

  it('sits bottom-centre of its positioned parent, 38 px tall', async () => {
    const parent = document.createElement('div');
    parent.style.cssText = 'position: relative; width: 900px; height: 400px';
    document.body.append(parent);
    const el = await mount(3, parent);
    await Promise.all(buttons(el).map((b) => b.updateComplete));
    const box = parent.getBoundingClientRect();
    const bar = el.shadowRoot!.querySelector('.bar')!.getBoundingClientRect();
    expect(Math.abs(bar.left + bar.width / 2 - (box.left + box.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.bottom - bar.bottom - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(bar.height - 38)).toBeLessThanOrEqual(1);
  });
});

describe('protspace-selection-bar on a phone', () => {
  const NAMES = ['Show only these', 'Zoom to them', 'Copy IDs', 'Clear'];

  it('at 360 px wide the bar fits inside a 336 px host and every action keeps its accessible name', async () => {
    await page.viewport(360, 740);
    // The plot area: 360 px wide, so 336 px between the bar's 12 px margins.
    const parent = document.createElement('div');
    parent.style.cssText = 'position: relative; width: 360px; height: 400px';
    document.body.append(parent);
    const el = await mount(12345, parent);
    await Promise.all(buttons(el).map((b) => b.updateComplete));

    const box = parent.getBoundingClientRect();
    const bar = el.shadowRoot!.querySelector('.bar')!.getBoundingClientRect();
    expect(bar.left).toBeGreaterThanOrEqual(box.left + 12 - 1);
    expect(bar.right).toBeLessThanOrEqual(box.right - 12 + 1);
    expect(Math.abs(bar.left + bar.width / 2 - (box.left + box.width / 2))).toBeLessThanOrEqual(1);

    const short = el.shadowRoot!.querySelector('.selection-count-short')!;
    expect(short.textContent!.trim()).toBe('12,345 selected');
    expect(getComputedStyle(el.shadowRoot!.querySelector('.selection-count')!).display).toBe(
      'none',
    );
    // The live region still says it in full.
    expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim()).toBe(
      '12,345 proteins selected',
    );

    for (const name of NAMES) {
      await expect.element(page.getByRole('button', { name, exact: true })).toBeInTheDocument();
      const b = button(el, name);
      expect(b.querySelector('.action-icon svg')).not.toBeNull();
      expect(b.querySelector('.action-label')!.getBoundingClientRect().width).toBeLessThanOrEqual(
        1,
      );
      expect(inner(b).getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
    }
  });

  it('above 640 px labels are visible', async () => {
    await page.viewport(1024, 768);
    const el = await mount(3);
    await Promise.all(buttons(el).map((b) => b.updateComplete));
    expect(countText(el)).toBe('3 proteins selected');
    expect(getComputedStyle(el.shadowRoot!.querySelector('.selection-count-short')!).display).toBe(
      'none',
    );
    for (const name of NAMES) {
      const b = button(el, name);
      expect(b.querySelector('.action-label')!.getBoundingClientRect().width).toBeGreaterThan(1);
      expect(getComputedStyle(b.querySelector('.action-icon')!).display).toBe('none');
    }
  });
});
