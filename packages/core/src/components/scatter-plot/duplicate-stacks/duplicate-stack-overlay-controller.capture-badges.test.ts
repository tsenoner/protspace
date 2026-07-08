/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { zoomIdentity } from 'd3';
import { DuplicateStackOverlayController } from './duplicate-stack-overlay-controller';

/**
 * #294: captureBadges renders the duplicate-stack badges at a caller-supplied
 * transform (the figure editor passes identity) into a fresh off-screen canvas.
 * When the overlay is disabled or no stacks are in view it returns null, so the
 * caller (scatter-plot.captureAtResolution) skips compositing rather than
 * pasting a blank or stale canvas onto the unzoomed render.
 */
function makeController(opts: { isEnabled?: boolean } = {}) {
  const config = {
    width: 800,
    height: 600,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
  };
  const deps = {
    getOverlayGroup: () => null,
    getBadgesCanvas: () => undefined,
    getTransform: () => zoomIdentity,
    getConfig: () => config,
    getScales: () => null,
    getPlotData: () => ({}),
    getQuadtree: () => ({}),
    isEnabled: () => opts.isEnabled ?? true,
    isSelectionMode: () => false,
    getColor: () => '#000000',
    onPointActivate: () => {},
    onHover: () => {},
    onHoverEnd: () => {},
  };
  return new DuplicateStackOverlayController(
    deps as unknown as ConstructorParameters<typeof DuplicateStackOverlayController>[0],
  );
}

describe('DuplicateStackOverlayController.captureBadges (#294)', () => {
  it('returns null when the overlay is disabled', () => {
    expect(makeController({ isEnabled: false }).captureBadges(zoomIdentity)).toBeNull();
  });

  it('returns null when there are no duplicate stacks in view', () => {
    // Fresh controller: no viewport compute has run, so there is nothing to draw.
    expect(makeController({ isEnabled: true }).captureBadges(zoomIdentity)).toBeNull();
  });
});
