/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import './category-score-strip';
import type { ScoreStripPoint } from './category-score-strip';

type ScoreStripElement = HTMLElement & {
  points: ScoreStripPoint[];
  highlighted: string | null;
  label: string;
  description: string;
  domain: [number, number];
  higherIsBetter: boolean;
  updateComplete: Promise<unknown>;
};

const POINTS: ScoreStripPoint[] = [
  { category: 'Elapidae', value: 0.81, color: '#ff0000' },
  { category: 'Viperidae', value: -0.15, color: '#00ff00' },
];

async function setup(points: ScoreStripPoint[] = POINTS): Promise<ScoreStripElement> {
  const el = document.createElement('protspace-score-strip') as ScoreStripElement;
  el.points = points;
  el.label = 'Silhouette';
  el.domain = [-1, 1];
  el.higherIsBetter = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('protspace-score-strip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('puts an info popover beside the header only when it has an explanation', async () => {
    // The strips are where these numbers are actually read; a user scanning the legend may
    // never open the projection-metadata panel, which explains the very same metrics.
    const bare = await setup();
    expect(bare.shadowRoot!.querySelector('protspace-info-popover')).toBeNull();

    bare.description = 'Runs from -1 to 1.';
    await bare.updateComplete;

    const popover = bare.shadowRoot!.querySelector('protspace-info-popover') as HTMLElement & {
      description: string;
    };
    expect(popover).not.toBeNull();
    expect(popover.description).toBe('Runs from -1 to 1.');
    // Inside the label, so it tracks the header rather than the axis.
    expect(popover.closest('.strip-label')).not.toBeNull();
  });

  it('draws one dot per category, in that category colour', async () => {
    const el = await setup();

    const dots = Array.from(el.shadowRoot!.querySelectorAll('circle'));
    expect(dots).toHaveLength(2);
    expect(dots.map((dot) => dot.getAttribute('fill'))).toEqual(['#ff0000', '#00ff00']);
  });

  it('positions dots along the fixed domain, not the data range', async () => {
    // A [-1, 1] silhouette axis must not rescale to the data, or two datasets
    // would not be comparable. These are the exact percentages that domain produces
    // for 0.81 and -0.15 (10% padding either side of a [-1, 1] span): if the domain
    // were data-derived instead, both points would sit at the strip's outer edges
    // regardless of their actual magnitude, and this would not catch it.
    const el = await setup();

    const dots = Array.from(el.shadowRoot!.querySelectorAll('circle'));
    const [first, second] = dots.map((dot) => parseFloat(dot.getAttribute('cx')!));
    expect(first).toBeCloseTo(82.4);
    expect(second).toBeCloseTo(44);
  });

  it('renders the strip at a fixed height, not scaled by the panel width', async () => {
    // No viewBox: an explicit `height` attribute is what keeps the strip ~44px tall
    // regardless of how wide the (100%-width) panel is. A viewBox-driven height here
    // would silently reintroduce the 3x oversized-strip regression.
    const el = await setup();

    const svg = el.shadowRoot!.querySelector('svg')!;
    expect(svg.getAttribute('height')).toBe('44');
    expect(svg.hasAttribute('viewBox')).toBe(false);
  });

  it('emits strip-hover with the category on pointer enter, and null on leave', async () => {
    const el = await setup();
    const seen: Array<string | null> = [];
    el.addEventListener('strip-hover', (event) =>
      seen.push((event as CustomEvent<{ category: string | null }>).detail.category),
    );

    const dot = el.shadowRoot!.querySelector('circle')!;
    dot.dispatchEvent(new Event('mouseenter', { bubbles: false }));
    dot.dispatchEvent(new Event('mouseleave', { bubbles: false }));

    expect(seen).toEqual(['Elapidae', null]);
  });

  it('emits strip-click with the category on dot click', async () => {
    const el = await setup();
    const seen: Array<string> = [];
    el.addEventListener('strip-click', (event) =>
      seen.push((event as CustomEvent<{ category: string }>).detail.category),
    );

    const dot = el.shadowRoot!.querySelector('circle')!;
    dot.dispatchEvent(new Event('click', { bubbles: false }));

    expect(seen).toEqual(['Elapidae']);
  });

  it('marks the highlighted dot so the legend can drive it', async () => {
    const el = await setup();
    el.highlighted = 'Viperidae';
    await el.updateComplete;

    const highlighted = el.shadowRoot!.querySelectorAll('circle.is-highlighted');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].getAttribute('data-category')).toBe('Viperidae');
  });

  it('renders nothing when there are no points', async () => {
    const el = await setup([]);

    expect(el.shadowRoot!.querySelector('svg')).toBeNull();
  });

  it('centres every dot when the domain is degenerate', async () => {
    // All categories scoring identically would otherwise divide by a zero span.
    const el = await setup([
      { category: 'A', value: 2, color: '#111111' },
      { category: 'B', value: 2, color: '#222222' },
    ]);
    el.domain = [2, 2];
    await el.updateComplete;

    const cx = Array.from(el.shadowRoot!.querySelectorAll('circle')).map((dot) =>
      parseFloat(dot.getAttribute('cx')!),
    );
    expect(cx).toEqual([50, 50]);
  });

  it('shows "lower is better" when higherIsBetter is false', async () => {
    const el = await setup();
    el.higherIsBetter = false;
    await el.updateComplete;

    expect(el.shadowRoot!.textContent).toContain('lower is better');
  });

  it('leaves the value gutter empty until a category is highlighted', async () => {
    const el = await setup();

    expect(el.shadowRoot!.querySelector('.strip-value')!.textContent!.trim()).toBe('—');
  });

  it('shows the highlighted category’s own value in the gutter', async () => {
    const el = await setup();
    el.highlighted = 'Viperidae';
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector('.strip-value')!.textContent!.trim()).toBe('-0.15');

    el.highlighted = 'Elapidae';
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.strip-value')!.textContent!.trim()).toBe('0.81');
  });

  it('keeps the gutter empty for a category this metric could not score', async () => {
    // Davies-Bouldin has no value for a singleton category, so the legend can
    // highlight a category that has no dot on this strip. Showing a neighbour's
    // number, or the last one hovered, would be worse than showing none.
    const el = await setup();
    el.highlighted = 'Colubridae';
    await el.updateComplete;

    const gutter = el.shadowRoot!.querySelector('.strip-value')!;
    expect(gutter.textContent!.trim()).toBe('—');
    expect(gutter.classList.contains('is-empty')).toBe(true);
  });

  it('appends the embedding ceiling to the tooltip when the dot carries one', async () => {
    const el = await setup([
      { category: 'Elapidae', value: 0.81, color: '#ff0000', ceiling: 0.95 },
      { category: 'Viperidae', value: -0.15, color: '#00ff00' },
    ]);

    const titles = Array.from(el.shadowRoot!.querySelectorAll('circle title')).map(
      (title) => title.textContent,
    );
    expect(titles).toEqual(['Elapidae: 0.81 (embedding ceiling 0.95)', 'Viperidae: -0.15']);
  });
});
