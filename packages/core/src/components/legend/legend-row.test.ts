// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from 'lit';
import { SHAPE_PATH_GENERATORS } from './config';
import { renderLegendSymbol } from './legend-row';

function draw(...args: Parameters<typeof renderLegendSymbol>): SVGPathElement {
  const host = document.createElement('div');
  render(renderLegendSymbol(...args), host);
  return host.querySelector<SVGPathElement>('svg.legend-symbol path')!;
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
