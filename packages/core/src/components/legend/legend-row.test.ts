// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'lit';
import { SHAPE_PATH_GENERATORS } from './config';
import {
  renderLegendRow,
  renderLegendSymbol,
  type LegendRowHandlers,
  type LegendRowView,
} from './legend-row';
import type { LegendItem } from './types';

function draw(...args: Parameters<typeof renderLegendSymbol>): SVGPathElement {
  const host = document.createElement('div');
  render(renderLegendSymbol(...args), host);
  return host.querySelector<SVGPathElement>('svg.legend-symbol path')!;
}

/** One row for category A, every handler a spy. */
function drawRow() {
  const host = document.createElement('div');
  const item: LegendItem = {
    value: 'A',
    color: '#123456',
    shape: 'circle',
    count: 3,
    isVisible: true,
    zOrder: 0,
  };
  const view: LegendRowView = {
    classes: 'legend-item',
    symbolSize: 10,
    tabbable: true,
    draggable: true,
    picked: false,
    hasMenu: true,
  };
  const handlers: LegendRowHandlers = {
    onClick: vi.fn(),
    onDoubleClick: vi.fn(),
    onKeyDown: vi.fn(),
    onHandleKeyDown: vi.fn(),
    onHover: vi.fn(),
    onFocus: vi.fn(),
    onToggle: vi.fn(),
    onMenu: vi.fn(),
    onViewOther: vi.fn(),
    onNamePointerEnter: vi.fn(),
    onPointerDown: vi.fn(),
  };
  render(renderLegendRow(item, view, handlers), host);
  return { row: host.querySelector<HTMLElement>('.legend-item')!, handlers };
}

describe('renderLegendSymbol', () => {
  it("draws the item's shape filled with its colour at the size asked for", () => {
    const path = draw('diamond', '#123456', 16);
    expect(path.getAttribute('d')).toBe(SHAPE_PATH_GENERATORS.diamond(16));
    expect(path.getAttribute('fill')).toBe('#123456');
    expect(path.closest('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to a circle and grey for a missing shape and colour', () => {
    const path = draw(null, '', 12);
    expect(path.getAttribute('d')).toBe(SHAPE_PATH_GENERATORS.circle(12));
    expect(path.getAttribute('fill')).toBe('#888888');
  });
});

describe('renderLegendRow pointer handling', () => {
  it('a touch pointerenter does not set the hovered category; a mouse one does', () => {
    const { row, handlers } = drawRow();

    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    expect(handlers.onHover).not.toHaveBeenCalled();

    row.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(handlers.onHover).toHaveBeenLastCalledWith('A');
    row.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(handlers.onHover).toHaveBeenLastCalledWith(null);
  });

  it('a press on the main button reaches onPointerDown', () => {
    const { row, handlers } = drawRow();
    row
      .querySelector('.legend-item-main')!
      .dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    expect(handlers.onPointerDown).toHaveBeenCalledOnce();
  });
});
