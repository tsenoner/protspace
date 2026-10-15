import { plotArea } from '../../../apps/web/tests/helpers/explore';
import { clusterScreenPoints } from '../../../apps/web/tests/helpers/plot';
import type { Page } from '@playwright/test';
import type { CaptureApi, CaptureEntry } from '../capture-plan';

/** Where the zoom GIF zooms: the centre of the demo's three-finger toxins, else the plot's upper right. */
async function zoomTarget(page: Page): Promise<{ x: number; y: number }> {
  const points = await clusterScreenPoints(page, 'three-finger toxin');
  if (points.length > 0) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  const box = await plotArea(page).boundingBox();
  if (!box) throw new Error('The plot area is not shown');
  return { x: box.x + box.width * 0.75, y: box.y + box.height * 0.25 };
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
    steps: async (page, cap) => {
      const target = await zoomTarget(page);
      await cap.moveTo(target, { steps: 15 });
      await cap.hold(800);
      await cap.label('Scroll to zoom');
      await wheel(page, cap, -50);
      await cap.hold(1000);
      await cap.label('Drag to pan');
      const panned = { x: target.x - 160, y: target.y + 90 };
      await cap.drag(target, panned, { steps: 30 });
      await cap.hold(1000);
      await wheel(page, cap, 50);
      await cap.hold(1000);
    },
    docs: ['explore/scatterplot.md'],
  },
];
