import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import { ESCAPE_ORDER, onEscapeFallback, topLayer } from './layers';
import type { PsPopover } from './popover';
import './popover';

beforeAll(() => adoptTheme());
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async (pop: PsPopover) => {
  await pop.updateComplete;
  await frame();
  await frame();
  // The entry transition moves the panel by 2px over --ps-duration-fast; measure after it ends.
  await Promise.allSettled(
    panel(pop)
      .getAnimations()
      .map((a) => a.finished),
  );
};
const panel = (pop: PsPopover) => pop.shadowRoot!.querySelector('.panel') as HTMLElement;
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
function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

async function setup() {
  document.body.innerHTML = `
    <div class="clip" style="overflow: hidden; transform: translateX(0); width: 140px; height: 40px">
      <button id="anchor">Open</button>
      <ps-popover><p id="content">Panel content</p><button id="inside">Inside</button></ps-popover>
    </div>
    <button id="outside">Outside</button>`;
  const anchor = document.getElementById('anchor')!;
  const pop = document.querySelector('ps-popover')!;
  pop.anchor = anchor;
  await pop.updateComplete;
  return { anchor, pop };
}

describe('ps-popover', () => {
  it('opens in the top layer, where an ancestor with overflow and a transform cannot clip it', async () => {
    const { pop } = await setup();
    pop.open = true;
    await settle(pop);
    expect(panel(pop).matches(':popover-open')).toBe(true);
    const clip = document.querySelector('.clip')!.getBoundingClientRect();
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.bottom).toBeGreaterThan(clip.bottom);
    const hit = document.elementFromPoint(rect.left + 10, rect.bottom - 10);
    expect(hit?.closest('ps-popover')).toBe(pop);
  });

  it('sits next to its anchor', async () => {
    const { anchor, pop } = await setup();
    pop.open = true;
    await settle(pop);
    expect(panel(pop).getBoundingClientRect().top).toBeCloseTo(
      anchor.getBoundingClientRect().bottom + 6,
      0,
    );
  });

  it('flips and shifts to stay on screen at the bottom-right corner', async () => {
    const { anchor, pop } = await setup();
    // Outside the transformed .clip: a transformed ancestor would make `fixed` relative to itself.
    document.body.append(anchor);
    anchor.style.cssText = 'position: fixed; right: 0; bottom: 0';
    pop.open = true;
    await settle(pop);
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(rect.top).toBeGreaterThanOrEqual(0);
  });

  it('closes on Escape, tells the owner, and returns focus to the anchor', async () => {
    const { anchor, pop } = await setup();
    const onClose = vi.fn();
    pop.addEventListener('ps-close', onClose);
    anchor.focus();
    pop.open = true;
    await settle(pop);
    document.getElementById('inside')!.focus();
    escape();
    await settle(pop);
    expect(pop.open).toBe(false);
    expect(panel(pop).matches(':popover-open')).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(anchor);
  });

  it("keeps a nested overlay's ps-close from its owner", async () => {
    const { anchor, pop } = await setup();
    const inner = document.createElement('ps-popover');
    inner.innerHTML = '<button id="nested">Nested</button>';
    pop.append(inner);
    inner.anchor = document.getElementById('inside');
    const onClose = vi.fn();
    pop.addEventListener('ps-close', onClose);
    pop.addEventListener('ps-close', () => (pop.open = false)); // a controlled owner
    const onInnerClose = vi.fn();
    inner.addEventListener('ps-close', onInnerClose);
    anchor.focus();
    pop.open = true;
    await settle(pop);
    inner.open = true;
    await settle(inner);
    document.getElementById('nested')!.focus();
    escape();
    await settle(pop);
    expect(onInnerClose).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(pop.open).toBe(true);
    escape();
    await settle(pop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a press outside but not on a drag that started inside or a press on the anchor', async () => {
    const { anchor, pop } = await setup();
    pop.open = true;
    await settle(pop);
    press(document.getElementById('inside')!, document.getElementById('outside')!);
    press(anchor);
    expect(pop.open).toBe(true);
    press(document.getElementById('outside')!);
    expect(pop.open).toBe(false);
  });

  it('releases its layer when removed while open', async () => {
    const { pop } = await setup();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    pop.open = true;
    await settle(pop);
    pop.remove();
    escape();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('closes cleanly when its anchor was removed, leaving focus on the body', async () => {
    const { anchor, pop } = await setup();
    anchor.focus();
    pop.open = true;
    await settle(pop);
    document.getElementById('inside')!.focus();
    anchor.remove();
    pop.open = false;
    await settle(pop);
    expect(panel(pop).matches(':popover-open')).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps exactly one layer through rapid open and close', async () => {
    const { pop } = await setup();
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    pop.open = true;
    await pop.updateComplete;
    pop.open = false;
    await pop.updateComplete;
    pop.open = true;
    await settle(pop);
    escape();
    expect(pop.open).toBe(false);
    escape();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('shows again when a keyed re-render moves it while open', async () => {
    const { pop } = await setup();
    const onOpen = vi.fn();
    pop.addEventListener('ps-open', onOpen);
    pop.open = true;
    await settle(pop);
    document.body.append(pop); // a move: disconnect, then connect
    await settle(pop);
    expect(panel(pop).matches(':popover-open')).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce(); // a move is not a new opening
    escape();
    expect(pop.open).toBe(false);
    expect(topLayer()).toBeUndefined();
  });

  it('returns focus to the anchor when nothing had focus at open, as after a click in Safari', async () => {
    const { anchor, pop } = await setup();
    (document.activeElement as HTMLElement | null)?.blur();
    pop.open = true;
    await settle(pop);
    document.getElementById('inside')!.focus();
    escape();
    expect(document.activeElement).toBe(anchor);
  });

  it('follows a new anchor set while open', async () => {
    const { anchor, pop } = await setup();
    pop.open = true;
    await settle(pop);
    const next = document.getElementById('outside')!;
    anchor.remove();
    pop.anchor = next;
    await settle(pop);
    expect(panel(pop).getBoundingClientRect().top).toBeCloseTo(
      next.getBoundingClientRect().bottom + 6,
      0,
    );
    press(next);
    expect(pop.open).toBe(true);
  });

  it('shrinks to fit and scrolls when neither side has room', async () => {
    const { anchor, pop } = await setup();
    document.body.append(anchor);
    anchor.style.cssText = 'position: fixed; top: 50%; left: 20px';
    document.getElementById('content')!.style.height = '2000px';
    pop.open = true;
    await settle(pop);
    const p = panel(pop);
    const r = p.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(innerHeight);
    expect(p.scrollHeight).toBeGreaterThan(p.clientHeight);
    p.scrollTop = p.scrollHeight;
    expect(p.scrollTop).toBeGreaterThan(0);
  });
});

/** A popover beside an anchor; `anchorStyle` places the anchor. */
async function beside(placement: 'right-start' | 'left-start', anchorStyle: string) {
  document.body.innerHTML = `
    <button id="row" style="position: fixed; ${anchorStyle}">Row</button>
    <ps-popover placement="${placement}">
      <p style="width: 300px; height: 120px; margin: 0">Bubble</p>
    </ps-popover>`;
  const anchor = document.getElementById('row')!;
  const pop = document.querySelector('ps-popover')!;
  pop.anchor = anchor;
  pop.open = true;
  await settle(pop);
  return { anchor, pop };
}

/** A full-width row on a 375 px phone: 8 px from each edge. */
const FULL_WIDTH_ROW = 'left: 8px; top: 120px; width: 359px; height: 40px';

describe('ps-popover beside a full-width anchor on a phone', () => {
  beforeAll(async () => {
    await page.viewport(375, 667);
  });
  afterAll(async () => {
    await page.viewport(414, 896);
  });

  it('a right-start panel beside a 359 px wide anchor stays within [8, 367] and falls below it', async () => {
    const { anchor, pop } = await beside('right-start', FULL_WIDTH_ROW);
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(8 - 0.5);
    expect(rect.right).toBeLessThanOrEqual(367 + 0.5);
    expect(rect.top).toBeGreaterThanOrEqual(anchor.getBoundingClientRect().bottom - 0.5);
  });

  it('a left-start panel likewise', async () => {
    const { anchor, pop } = await beside('left-start', FULL_WIDTH_ROW);
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(8 - 0.5);
    expect(rect.right).toBeLessThanOrEqual(367 + 0.5);
    expect(rect.top).toBeGreaterThanOrEqual(anchor.getBoundingClientRect().bottom - 0.5);
  });

  it('publishes the room it has as --available-width', async () => {
    const { pop } = await beside('right-start', FULL_WIDTH_ROW);
    const width = Number.parseFloat(panel(pop).style.getPropertyValue('--available-width'));
    expect(width).toBeCloseTo(375 - 16, 0);
  });

  it('a beside panel with room keeps its side', async () => {
    const { anchor, pop } = await beside(
      'right-start',
      'left: 8px; top: 120px; width: 40px; height: 40px',
    );
    expect(panel(pop).getBoundingClientRect().left).toBeGreaterThanOrEqual(
      anchor.getBoundingClientRect().right,
    );
  });
});

describe('ps-popover placements on a desktop screen', () => {
  beforeAll(async () => {
    await page.viewport(1280, 720);
  });
  afterAll(async () => {
    await page.viewport(414, 896);
  });

  it('a bottom-start panel still opens under its anchor at the anchor’s left', async () => {
    document.body.innerHTML = `
      <button id="row" style="position: fixed; left: 200px; top: 100px">Open</button>
      <ps-popover><p style="width: 300px; margin: 0">Panel</p></ps-popover>`;
    const anchor = document.getElementById('row')!;
    const pop = document.querySelector('ps-popover')!;
    pop.anchor = anchor;
    pop.open = true;
    await settle(pop);
    const rect = panel(pop).getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    expect(rect.left).toBeCloseTo(box.left, 0);
    expect(rect.top).toBeCloseTo(box.bottom + 6, 0);
  });

  it('a left-start panel beside a row with room on its left stays on the left', async () => {
    const { anchor, pop } = await beside(
      'left-start',
      'left: 900px; top: 300px; width: 300px; height: 28px',
    );
    const rect = panel(pop).getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(anchor.getBoundingClientRect().left + 0.5);
    expect(rect.top).toBeCloseTo(anchor.getBoundingClientRect().top, 0);
  });
});
