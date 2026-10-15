import { clusterScreenPoints, emptyScreenPointNear } from '../../../apps/web/tests/helpers/plot';
import type { Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';

/**
 * Where the zoom GIF zooms: empty plot next to the centre of the demo's three-finger toxins, so
 * the wheel anchors on the cluster and the pointer opens no protein tooltip over it.
 */
async function zoomTarget(page: Page): Promise<{ x: number; y: number }> {
  const points = await clusterScreenPoints(page, 'three-finger toxin');
  if (points.length === 0) throw new Error('No three-finger toxin points on the demo plot');
  const centre = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  return emptyScreenPointNear(page, centre);
}

/** Wheel steps of a smooth zoom, 50 ms apart; negative `delta` zooms in. */
async function wheel(page: Page, cap: CaptureApi, delta: number): Promise<void> {
  for (let step = 0; step < 20; step++) {
    await page.mouse.wheel(0, delta);
    await cap.hold(50);
  }
}

/** The scatterplot page's captures (docs/explore/scatterplot.md). */
export const SCATTERPLOT_CAPTURES: CaptureEntry[] = [
  {
    // Zoom in on a cluster with the wheel, drag to pan, and zoom back out.
    name: 'zoom',
    kind: 'gif',
    viewport: 'desktop',
    // The pointer starts on the target, before the trim: it never flies in from the corner.
    setup: async (page, cap) => {
      await cap.moveTo(await zoomTarget(page));
    },
    steps: async (page, cap) => {
      const target = await zoomTarget(page);
      await cap.hold(800);
      await cap.label('Scroll to zoom');
      await wheel(page, cap, -50);
      await cap.hold(1000);
      await cap.label('Drag to pan');
      // Right and down, towards the plot centre: the cluster sits on the plot's left.
      const panned = { x: target.x + 160, y: target.y + 90 };
      await cap.drag(target, panned, { steps: 30 });
      await cap.hold(1000);
      await wheel(page, cap, 50);
      await cap.hold(1000);
    },
    docs: ['explore/scatterplot.md'],
  },
];
