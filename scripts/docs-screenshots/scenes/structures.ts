/**
 * Captures for docs/explore/structures.md. The docked viewer (`structure-viewer`) belongs to the
 * overview's scenes; this is the floating card. It loads a real AlphaFold model in the real Mol*,
 * so it needs network.
 */
import type { Page } from '@playwright/test';
import { plotArea } from '../../../apps/web/tests/helpers/explore';
import { plotSettled } from '../../../apps/web/tests/helpers/plot';
import {
  waitForStructureLoaded,
  watchStructureLoads,
} from '../../../apps/web/tests/helpers/structure';
import {
  clickProteinNearPlotCentre,
  structurePanel,
} from '../../../apps/web/tests/helpers/workbench';
import type { CaptureEntry, Clip } from '../capture-plan';
import { around } from './clip';

/** How much of the plot left of the card the crop keeps, in CSS px: the clusters and the selection bar. */
const PLOT_BESIDE_CARD = 390;
/** The sidebar's resize handle overlaps the plot's right edge by a few px; leave it out. */
const RIGHT_EDGE = 6;

/**
 * The card and the plot beside it, the plot's full height: the whole plot area would
 * shrink the card's text to a few pixels in the ~690 px docs column.
 */
async function cardOverPlot(page: Page): Promise<Clip> {
  const [plot, card] = await Promise.all([
    around([plotArea(page)], 0),
    around([structurePanel(page)], 0),
  ]);
  const x = Math.max(plot.x, card.x - PLOT_BESIDE_CARD);
  return { x, y: plot.y, width: plot.x + plot.width - RIGHT_EDGE - x, height: plot.height };
}

export const STRUCTURE_CAPTURES: CaptureEntry[] = [
  {
    name: 'structure-floating',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    // Floating from the start, so Mol* draws its one model in the card's own box: popping out
    // after the load would resize a drawn canvas, with no signal for its redraw.
    layout: { structurePlacement: 'floating' },
    timeoutMs: 120_000,
    docs: ['explore/structures.md'],
    setup: async (page) => {
      await watchStructureLoads(page);
      const id = await clickProteinNearPlotCentre(page);
      await waitForStructureLoaded(page, id, 60_000);
      await plotSettled(page);
    },
    target: cardOverPlot,
  },
];
