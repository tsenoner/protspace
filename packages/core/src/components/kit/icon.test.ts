/** @vitest-environment jsdom */
import { render } from 'lit';
import { describe, expect, it } from 'vitest';
import { icon, iconMarkup } from './icon';

describe('icon', () => {
  it('renders a Lucide icon as an inline, decorative SVG at the requested size', () => {
    const host = document.createElement('div');
    render(icon('search', 20), host);
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.children.length).toBeGreaterThan(0);
  });

  it('defaults to 16px and reuses the same markup', () => {
    expect(iconMarkup('x')).toBe(iconMarkup('x', 16));
    expect(iconMarkup('x')).toContain('width="16"');
  });
});
