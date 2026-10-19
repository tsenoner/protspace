// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from 'lit';
import type { CategoryScore } from '@protspace/utils';
import {
  deriveStripPoints,
  EMPTY_STRIP_POINTS,
  renderScoreStrips,
  type ScoreStripsView,
} from './legend-score-strips';
import type { LegendItem } from './types';

const item = (value: string, color: string): LegendItem => ({
  value,
  color,
  shape: 'circle',
  count: 1,
  isVisible: true,
  zOrder: 0,
});

const score = (
  category: string,
  silhouette: number | null,
  daviesBouldin: number | null,
  silhouetteEmbedding: number | null = null,
): CategoryScore => ({ category, silhouette, daviesBouldin, silhouetteEmbedding });

describe('deriveStripPoints', () => {
  it("derives one point per scored category in the row's colour, grey for a category in Other", () => {
    const points = deriveStripPoints(
      [item('A', '#ff0000'), item('Other', '#888888')],
      [score('A', 0.5, 1.2, 0.4), score('Z', -0.2, 2)],
    );

    expect(points.silhouette).toEqual([
      { category: 'A', value: 0.5, color: '#ff0000', embedding: 0.4 },
      { category: 'Z', value: -0.2, color: '#888', embedding: null, other: true },
    ]);
    // Davies-Bouldin has no embedding-space counterpart.
    expect(points.daviesBouldin).toEqual([
      { category: 'A', value: 1.2, color: '#ff0000', embedding: null },
      { category: 'Z', value: 2, color: '#888', embedding: null, other: true },
    ]);
  });

  it("spans Davies-Bouldin's domain over its points, [0, 1] with none", () => {
    expect(
      deriveStripPoints([], [score('A', 0.1, 3), score('B', 0.2, 0.5)]).daviesBouldinDomain,
    ).toEqual([0.5, 3]);
    expect(deriveStripPoints([], [score('A', 0.1, null)]).daviesBouldinDomain).toEqual([0, 1]);
    expect(EMPTY_STRIP_POINTS).toEqual({
      silhouette: [],
      daviesBouldin: [],
      daviesBouldinDomain: [0, 1],
    });
  });

  it('skips null scores', () => {
    const points = deriveStripPoints(
      [item('A', '#ff0000')],
      [score('A', null, 1), score('B', 0.3, null)],
    );
    expect(points.silhouette.map((point) => point.category)).toEqual(['B']);
    expect(points.daviesBouldin.map((point) => point.category)).toEqual(['A']);
  });
});

describe('renderScoreStrips', () => {
  it("keeps the silhouette strip's domain across renders, so a hover does not re-render it", () => {
    const view: ScoreStripsView = {
      hasScores: true,
      filtered: false,
      points: deriveStripPoints([item('A', '#ff0000')], [score('A', 0.2, null)]),
      highlighted: null,
      clusterCaveat: null,
    };
    const handlers = { onHover: () => {}, onToggle: () => {} };
    const host = document.createElement('div');
    render(renderScoreStrips(view, handlers), host);
    const strip = host.querySelector('protspace-score-strip') as unknown as {
      domain: [number, number];
    };
    const firstDomain = strip.domain;

    render(renderScoreStrips({ ...view, highlighted: 'A' }, handlers), host);
    expect(firstDomain).toEqual([-1, 1]);
    expect(strip.domain).toBe(firstDomain);
  });
});
