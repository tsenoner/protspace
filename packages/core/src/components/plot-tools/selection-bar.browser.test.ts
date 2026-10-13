import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsButton } from '../kit/button';
import { deepActiveElement } from '../kit/focus';
import type { ProtspaceSelectionBar } from './selection-bar';
import './selection-bar';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

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
    expect(el.hidden).toBe(true);
    expect(getComputedStyle(el).display).toBe('none');

    el.selectedCount = 2;
    await el.updateComplete;
    expect(el.hidden).toBe(false);
    expect(getComputedStyle(el).display).not.toBe('none');
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
    expect(el.shadowRoot!.querySelector('.selection-count')!.getAttribute('aria-live')).toBe(
      'polite',
    );
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
