/**
 * The interface overview (`docs/explore/index.md`): the whole workbench, each bar, the plot, the
 * legend, the docked structure, the Theme menu, and a GIF of the sidebar folding and resizing.
 * Ported from the old static captures (interface-overview 177, scatterplot-example 186,
 * legend-panel 195, structure-viewer 204 at a8cb13ca), on the workbench's helpers.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  appBar,
  contoursTrigger,
  plotArea,
  projectionTrigger,
  proteinSearch,
  viewBar,
} from '../../../apps/web/tests/helpers/explore';
import { legend } from '../../../apps/web/tests/helpers/legend';
import {
  waitForStructureLoaded,
  watchStructureLoads,
} from '../../../apps/web/tests/helpers/structure';
import { themeButton } from '../../../apps/web/tests/helpers/theme';
import {
  clickProteinNearPlotCentre,
  rail,
  structurePanel,
} from '../../../apps/web/tests/helpers/workbench';
import type { CaptureEntry, Clip } from '../capture-plan';
import { around } from './clip';

/** Mol* loads from jsDelivr and the model from AlphaFold: allow for both on a slow network. */
const STRUCTURE_TIMEOUT_MS = 180_000;

/** Selects the protein nearest the plot's centre and waits until Mol* has drawn its structure. */
async function showStructure(page: Page): Promise<void> {
  await watchStructureLoads(page);
  const proteinId = await clickProteinNearPlotCentre(page);
  await waitForStructureLoaded(page, proteinId, 90_000);
}

const themeMenu = (page: Page) => page.getByRole('menu', { name: 'Theme', exact: true });

/**
 * A bar's full height, from `first`'s left edge to `last`'s right edge, grown by `pad`: a full-width
 * bar shown in the ~690 px docs column would shrink its text to a few pixels.
 */
async function barSpan(bar: Locator, first: Locator, last: Locator, pad = 12): Promise<Clip> {
  const [b, l, r] = await Promise.all([around([bar], 0), around([first], 0), around([last], 0)]);
  const x = Math.max(b.x, l.x - pad);
  const right = Math.min(b.x + b.width, r.x + r.width + pad);
  return { x, y: b.y, width: right - x, height: b.height };
}

export const OVERVIEW_CAPTURES: CaptureEntry[] = [
  {
    name: 'interface-overview',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    timeoutMs: STRUCTURE_TIMEOUT_MS,
    steps: showStructure,
    docs: ['explore/index.md'],
  },
  {
    name: 'app-bar-start',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    // The logo, the dataset name and the search.
    target: (page) =>
      barSpan(
        appBar(page),
        appBar(page).locator('[data-workbench="app-bar-start"]'),
        proteinSearch(page),
      ),
    docs: ['explore/index.md'],
  },
  {
    name: 'app-bar-actions',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    // Import and Export, Theme, Help, Feedback and GitHub.
    target: (page) => {
      const actions = appBar(page).locator('[data-workbench="app-bar-actions"]');
      return barSpan(appBar(page), actions, actions);
    },
    docs: ['explore/index.md'],
  },
  {
    name: 'view-bar',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    target: (page) => barSpan(viewBar(page), projectionTrigger(page), contoursTrigger(page)),
    docs: ['explore/index.md'],
  },
  {
    name: 'scatterplot-example',
    kind: 'png',
    viewport: 'desktop',
    target: (page) => plotArea(page),
    docs: ['explore/index.md'],
  },
  {
    name: 'legend-panel',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    target: (page) => legend(page),
    docs: ['explore/index.md'],
  },
  {
    name: 'structure-viewer',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    timeoutMs: STRUCTURE_TIMEOUT_MS,
    steps: showStructure,
    // From the viewer's header down: the panel's box also holds the divider and a sliver of the
    // legend's last row above it.
    target: async (page) => {
      const panel = await around([structurePanel(page)], 0);
      const header = await around([structurePanel(page).locator('.header').first()], 0);
      return { ...panel, y: header.y, height: panel.y + panel.height - header.y };
    },
    docs: ['explore/index.md', 'explore/structures.md'],
  },
  {
    name: 'theme-switch',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    steps: async (page) => {
      await themeButton(page).click();
      await expect(themeMenu(page)).toBeVisible();
    },
    target: (page) => around([themeButton(page), themeMenu(page)]),
    docs: ['explore/index.md'],
  },
  {
    name: 'sidebar-fold-resize',
    kind: 'gif',
    viewport: 'desktop',
    steps: async (page, cap) => {
      const workbench = page.locator('.workbench');
      await cap.hold(800);

      await cap.click(rail(page).getByRole('button', { name: 'Collapse sidebar' }), {
        label: 'Collapse sidebar',
      });
      await expect(workbench).toHaveAttribute('data-sidebar', 'collapsed');
      await cap.hold(1_200);

      await cap.click(rail(page).getByRole('button', { name: 'Expand sidebar' }), {
        label: 'Expand sidebar',
      });
      await expect(workbench).toHaveAttribute('data-sidebar', 'open');
      await cap.hold(1_000);

      const edge = await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox();
      if (!edge) throw new Error('The sidebar edge is not shown');
      const from = { x: edge.x + edge.width / 2, y: edge.y + edge.height / 2 };
      const wider = { x: from.x - 120, y: from.y };
      await cap.moveTo(from, { steps: 15 });
      await cap.hold(300);
      await cap.label('Drag');
      await cap.drag(from, wider, { steps: 30 });
      await cap.hold(800);
      await cap.drag(wider, from, { steps: 30 });
      await cap.hold(1_200);
    },
    docs: ['explore/index.md'],
  },
];
