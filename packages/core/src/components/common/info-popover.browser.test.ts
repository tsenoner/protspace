import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import { ESCAPE_ORDER, onEscapeFallback } from '../kit/layers';
import '../kit/popover';
import type { PsPopover } from '../kit/popover';
import './info-popover';

type InfoPopoverElement = HTMLElement & {
  description: string;
  detail: string;
  docsUrl: string;
  label: string;
  align: 'left' | 'right';
  placement: 'bottom' | 'side';
  updateComplete: Promise<boolean>;
};

beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 720);
});
const cleanups: Array<() => void> = [];
beforeEach(() => {
  document.body.innerHTML = `
    <div id="stage" style="padding: 40px"></div>
    <button id="outside" style="margin: 200px 0 0 600px">Outside</button>`;
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const outside = () => document.getElementById('outside') as HTMLButtonElement;
const trigger = (el: InfoPopoverElement) =>
  el.shadowRoot!.querySelector('.info-button') as HTMLButtonElement;
const bubbleHost = (el: InfoPopoverElement) =>
  el.shadowRoot!.querySelector('ps-popover') as PsPopover;
const bubble = (el: InfoPopoverElement) =>
  el.shadowRoot!.querySelector('.popover') as HTMLElement | null;
const isOpen = (el: InfoPopoverElement) =>
  bubbleHost(el).shadowRoot!.querySelector('.panel')!.matches(':popover-open');

async function settle(el: InfoPopoverElement): Promise<void> {
  await el.updateComplete;
  await bubbleHost(el).updateComplete;
  await frame();
  await frame();
}

function escape(): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

async function mount(
  props: Partial<
    Pick<InfoPopoverElement, 'description' | 'detail' | 'docsUrl' | 'label' | 'align' | 'placement'>
  > = {},
  parent: HTMLElement = document.getElementById('stage')!,
): Promise<InfoPopoverElement> {
  const el = document.createElement('protspace-info-popover') as InfoPopoverElement;
  el.description = props.description ?? 'A brief summary.';
  if (props.detail !== undefined) el.detail = props.detail;
  if (props.docsUrl !== undefined) el.docsUrl = props.docsUrl;
  el.label = props.label ?? 'Test annotation';
  if (props.align) el.align = props.align;
  if (props.placement) el.placement = props.placement;
  parent.append(el);
  await el.updateComplete;
  return el;
}

/** The deepest element at a point, looking through every shadow root on the way. */
function deepestAt(x: number, y: number): Element | null {
  let hit: Element | null = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

/** An open ps-popover whose panel is translated and clips its overflow, as the Import panel does. */
async function openOuterPanel(): Promise<{ outer: PsPopover; row: HTMLElement }> {
  document.getElementById('stage')!.innerHTML = `
    <button id="anchor">Open</button>
    <ps-popover id="outer">
      <div id="row" style="display: flex; align-items: center; width: 220px; overflow: hidden">
        <span style="flex: 1">An example</span>
      </div>
    </ps-popover>`;
  const outer = document.getElementById('outer') as PsPopover;
  outer.anchor = document.getElementById('anchor');
  outer.open = true;
  await outer.updateComplete;
  await frame();
  await frame();
  return { outer, row: document.getElementById('row')! };
}

describe('protspace-info-popover on ps-popover', () => {
  it('hover opens it, and leaving closes it after a short grace', async () => {
    const el = await mount();
    await userEvent.hover(trigger(el));
    await settle(el);
    expect(isOpen(el)).toBe(true);
    expect(bubble(el)!.textContent).toContain('A brief summary.');

    await userEvent.hover(outside());
    await vi.waitFor(() => expect(isOpen(el)).toBe(false));
    expect(bubble(el)).toBeNull();
  });

  it('a click pins it until a second click, Escape or a press outside, and Escape reaches no fallback', async () => {
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.connectors, fallback));
    const el = await mount();

    await userEvent.click(trigger(el));
    await userEvent.hover(outside());
    await pause(300);
    await settle(el);
    expect(isOpen(el), 'a pinned bubble survives the pointer leaving').toBe(true);

    await userEvent.click(trigger(el));
    await settle(el);
    expect(isOpen(el), 'a second click unpins it').toBe(false);

    trigger(el).click();
    await settle(el);
    expect(isOpen(el)).toBe(true);
    escape();
    await settle(el);
    expect(isOpen(el), 'Escape closes it').toBe(false);
    expect(fallback).not.toHaveBeenCalled();

    trigger(el).click();
    await settle(el);
    await userEvent.click(outside());
    await settle(el);
    expect(isOpen(el), 'a press outside closes it').toBe(false);
  });

  it('keyboard focus opens it and focus leaving closes it', async () => {
    const el = await mount();
    await userEvent.tab();
    expect(el.shadowRoot!.activeElement).toBe(trigger(el));
    await settle(el);
    expect(isOpen(el)).toBe(true);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true');

    await userEvent.tab();
    expect(document.activeElement).toBe(outside());
    await settle(el);
    expect(isOpen(el)).toBe(false);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('relates the expanded trigger to a named, described dialog', async () => {
    const el = await mount({ label: 'No annotation', detail: 'Look at the three-finger toxins.' });
    trigger(el).click();
    await settle(el);

    const host = bubbleHost(el);
    const panel = host.shadowRoot!.querySelector('.panel')!;
    expect(trigger(el).getAttribute('aria-controls')).toBe(host.id);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('No annotation information');
    // The description targets are the paragraphs, never the dialog: describing the dialog would
    // announce its label instead of its text.
    const description = bubble(el)!.querySelector('.popover-description')!;
    const detail = bubble(el)!.querySelector('.popover-detail')!;
    expect(trigger(el).getAttribute('aria-describedby')).toBe(`${description.id} ${detail.id}`);
    expect(detail.textContent!.trim()).toBe('Look at the three-finger toxins.');
  });

  it('renders the docs link in a new tab', async () => {
    const el = await mount({ docsUrl: '/docs/guide/annotations#ec' });
    trigger(el).click();
    await settle(el);
    const link = bubble(el)!.querySelector('.popover-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/docs/guide/annotations#ec');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    // A Lucide icon, not a text glyph (design 8), and the new tab said in words.
    expect(link.textContent!.replace(/\s+/g, ' ').trim()).toBe('Learn more (opens in a new tab)');
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('side placement sits beside the row and stays open while the pointer crosses to it', async () => {
    const stage = document.getElementById('stage')!;
    stage.innerHTML = `<div id="row" style="display: flex; align-items: center; width: 240px">
      <span style="flex: 1">Pfam</span></div>`;
    const el = await mount({ placement: 'side' }, document.getElementById('row')!);

    await userEvent.hover(trigger(el));
    await settle(el);
    expect(isOpen(el)).toBe(true);
    const icon = trigger(el).getBoundingClientRect();
    const box = bubble(el)!.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(icon.right);

    await userEvent.hover(bubble(el)!.querySelector('.popover-description')!);
    await pause(300);
    await settle(el);
    expect(isOpen(el), 'crossing to the bubble keeps it open').toBe(true);

    await userEvent.hover(outside());
    await vi.waitFor(() => expect(isOpen(el)).toBe(false));
  });

  it('inside a translated, overflow-hidden ps-popover panel the bubble is fully on screen and topmost at its centre', async () => {
    const { row } = await openOuterPanel();
    const el = await mount({ placement: 'side', detail: 'A second paragraph.' }, row);
    trigger(el).click();
    await settle(el);

    const box = bubble(el)!.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    const hit = deepestAt(box.left + box.width / 2, box.top + box.height / 2);
    expect(hit !== null && bubble(el)!.contains(hit)).toBe(true);
  });

  it('Escape inside an open ps-popover closes the bubble first, then the panel', async () => {
    const { outer, row } = await openOuterPanel();
    const el = await mount({ placement: 'side' }, row);
    const outerClosed = vi.fn();
    outer.addEventListener('ps-close', outerClosed);
    trigger(el).click();
    await settle(el);
    expect(isOpen(el)).toBe(true);

    escape();
    await settle(el);
    expect(isOpen(el)).toBe(false);
    expect(outer.open).toBe(true);
    expect(outerClosed).not.toHaveBeenCalled();

    escape();
    await outer.updateComplete;
    expect(outer.open).toBe(false);
    expect(outerClosed).toHaveBeenCalledOnce();
  });
});
