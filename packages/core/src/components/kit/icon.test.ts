/** @vitest-environment jsdom */
import { render } from 'lit';
import { describe, expect, it, vi } from 'vitest';
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

  it('defaults to 16px', () => {
    expect(iconMarkup('x')).toBe(iconMarkup('x', 16));
    expect(iconMarkup('x')).toContain('width="16"');
  });

  it('parses each icon template once, however many places render it', () => {
    const createElement = vi.spyOn(document, 'createElement');
    const templates = () => createElement.mock.calls.filter(([tag]) => tag === 'template').length;
    render(icon('check'), document.createElement('div'));
    const afterFirst = templates();
    render(icon('check'), document.createElement('div'));
    expect(templates()).toBe(afterFirst);
    createElement.mockRestore();
  });
});
