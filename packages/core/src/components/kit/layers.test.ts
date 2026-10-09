/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepActiveElement, flatContains } from './focus';
import { ESCAPE_ORDER, onEscapeFallback, pushLayer, topLayer, type Layer } from './layers';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.replaceChildren();
});

function open(elements: Element[] = [], extra: Partial<Layer> = {}) {
  const close = vi.fn();
  const layer: Layer = { close, elements, ...extra };
  const release = pushLayer(layer);
  cleanups.push(release);
  return { layer, close, release };
}
function element(): HTMLElement {
  return document.body.appendChild(document.createElement('div'));
}
function escape(target: EventTarget = document.body): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}
function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, composed: true }));
}

describe('Escape', () => {
  it('closes only the top layer', () => {
    const lower = open();
    const upper = open();
    escape();
    expect(upper.close).toHaveBeenCalledOnce();
    expect(lower.close).not.toHaveBeenCalled();
  });

  it('reaches the next layer once the top one is released', () => {
    const lower = open();
    const upper = open();
    upper.release();
    upper.release();
    expect(topLayer()).toBe(lower.layer);
    escape();
    expect(lower.close).toHaveBeenCalledOnce();
  });

  it('runs the fallbacks in ascending order when no layer is open, stopping at the first that handles it', () => {
    const calls: string[] = [];
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, () => (calls.push('selection'), true)));
    cleanups.push(
      onEscapeFallback(ESCAPE_ORDER.connectors, () => (calls.push('connectors'), false)),
    );
    escape();
    expect(calls).toEqual(['connectors', 'selection']);
  });

  it('does not reach the fallbacks while a layer is open', () => {
    const fallback = vi.fn(() => true);
    cleanups.push(onEscapeFallback(ESCAPE_ORDER.selection, fallback));
    open();
    escape();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('stops the key from reaching the page while it closes a layer', () => {
    const pageHandler = vi.fn();
    document.body.addEventListener('keydown', pageHandler);
    cleanups.push(() => document.body.removeEventListener('keydown', pageHandler));
    open();
    escape();
    expect(pageHandler).not.toHaveBeenCalled();
  });
});

describe('outside press', () => {
  it('closes the top layer when the press starts and ends outside it', () => {
    const inside = element();
    const outside = element();
    const { close } = open([inside]);
    press(outside);
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the layer open for a drag that starts inside and ends outside', () => {
    const inside = element();
    const outside = element();
    const { close } = open([inside]);
    press(inside, outside);
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps the layer open when the press starts outside and ends inside', () => {
    const inside = element();
    const outside = element();
    const { close } = open([inside]);
    press(outside, inside);
    expect(close).not.toHaveBeenCalled();
  });

  it('counts elements inside a shadow root as inside the layer', () => {
    const host = element();
    const button = host
      .attachShadow({ mode: 'open' })
      .appendChild(document.createElement('button'));
    const { close } = open([host]);
    press(button);
    expect(close).not.toHaveBeenCalled();
  });

  it('ignores outside presses for a layer that opts out', () => {
    const { close } = open([element()], { dismissOnOutsidePress: false });
    press(element());
    expect(close).not.toHaveBeenCalled();
  });
});

describe('focus helpers', () => {
  it('find the focused element inside a shadow root', () => {
    const host = element();
    const input = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('input'));
    input.focus();
    expect(deepActiveElement()).toBe(input);
  });

  it('count content slotted through two shadow roots as inside the inner host', () => {
    // outer host renders <inner-host><div><slot></slot></div></inner-host>; inner host slots its child.
    const outer = element();
    const item = outer.appendChild(document.createElement('span'));
    const innerHost = outer
      .attachShadow({ mode: 'open' })
      .appendChild(document.createElement('div'));
    innerHost
      .appendChild(document.createElement('div'))
      .appendChild(document.createElement('slot'));
    innerHost.attachShadow({ mode: 'open' }).appendChild(document.createElement('slot'));
    expect(flatContains(innerHost, item)).toBe(true);
    expect(flatContains(innerHost, element())).toBe(false);
  });
});
