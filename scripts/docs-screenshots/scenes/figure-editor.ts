/**
 * Captures for docs/explore/figure-editor.md: the editor whole (light and dark: its chrome follows
 * the theme, its preview stays light), the presets grid, and the preview with overlays and with a
 * zoom inset, drawn with the editor's own tools.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  figureEditor,
  figureEditorContent,
  figurePreviewCanvas,
  openFigureEditor,
} from '../../../apps/web/tests/helpers/figure';
import { plotSettled } from '../../../apps/web/tests/helpers/plot';
import type { CaptureApi, CaptureEntry } from '../capture-plan';

type Spot = { x: number; y: number };

/**
 * Where the overlays go, as fractions of the preview canvas (0,0 its top-left corner). The legend
 * takes the right of the figure, so every spot stays in the left two thirds. Chosen against the
 * demo's curated view; if a capture frames empty space, move these and capture again.
 */
const SPOTS = {
  // A circle around the orange cluster below the centre, labelled to its right (a label is
  // centred on its spot).
  circle: { centre: { x: 0.467, y: 0.535 }, edge: { x: 0.503, y: 0.535 } },
  circleLabel: { x: 0.6, y: 0.535 },
  // An arrow into the purple cluster on the left, labelled at its tail.
  arrow: { from: { x: 0.17, y: 0.34 }, to: { x: 0.27, y: 0.53 } },
  arrowLabel: { x: 0.16, y: 0.3 },
  insetSource: { from: { x: 0.38, y: 0.48 }, to: { x: 0.45, y: 0.54 } },
  insetTarget: { from: { x: 0.06, y: 0.66 }, to: { x: 0.3, y: 0.66 } },
  empty: { x: 0.01, y: 0.01 },
};

const tool = (page: Page, name: 'Select' | 'Circle' | 'Arrow' | 'Label' | 'Zoom Inset'): Locator =>
  figureEditorContent(page).getByRole('button', { name, exact: true });

/** A spot on the preview canvas in page coordinates. */
async function onCanvas(page: Page, spot: Spot): Promise<Spot> {
  const box = await figurePreviewCanvas(page).boundingBox();
  if (!box) throw new Error('The figure preview canvas has no box');
  return { x: box.x + box.width * spot.x, y: box.y + box.height * spot.y };
}

/**
 * A label's size in figure pixels. The default 16 px is about 3 px tall in the docs column, which
 * shows the 2048 px figure at roughly a sixth of its size.
 */
const LABEL_SIZE_PX = '56';

/**
 * Places a label at `spot` and gives it `text` and LABEL_SIZE_PX through the sidebar's "Label
 * text" and "Label size" fields.
 */
async function addLabel(page: Page, cap: CaptureApi, spot: Spot, text: string): Promise<void> {
  await tool(page, 'Label').click();
  await cap.click(await onCanvas(page, spot));
  const field = figureEditorContent(page).getByRole('textbox', { name: 'Label text' }).last();
  await field.fill(text);
  await field.press('Enter');
  await expect(field).toHaveValue(text);
  const size = figureEditorContent(page).getByRole('spinbutton', { name: 'Label size' }).last();
  await size.fill(LABEL_SIZE_PX);
  await size.press('Enter');
  await expect(size).toHaveValue(LABEL_SIZE_PX);
}

/** The space left above a heading scrolled to the sidebar's top. */
const SIDEBAR_HEADING_GAP_PX = 12;

/**
 * Scrolls the sidebar so `heading` sits at its top, or as near as the sidebar's end allows, and
 * waits for the scroll to land.
 */
async function scrollSidebarTo(page: Page, cap: CaptureApi, heading: Locator): Promise<void> {
  const sidebar = figureEditorContent(page).locator('.publish-sidebar-content');
  const offset = async (): Promise<number> => {
    const [outer, inner] = await Promise.all([sidebar.boundingBox(), heading.boundingBox()]);
    if (!outer || !inner) throw new Error('The figure editor sidebar or its heading has no box');
    return Math.round(inner.y - outer.y);
  };
  const box = await sidebar.boundingBox();
  if (!box) throw new Error('The figure editor sidebar has no box');
  await cap.moveTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { steps: 1 });
  await page.mouse.wheel(0, (await offset()) - SIDEBAR_HEADING_GAP_PX);
  // Settled once two reads agree.
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const now = await offset();
      const settled = now === last;
      last = now;
      return settled;
    })
    .toBe(true);
}

/** Back to the Select tool, and a click on the canvas corner clears the selection's handles. */
async function deselect(page: Page, cap: CaptureApi): Promise<void> {
  await tool(page, 'Select').click();
  await cap.click(await onCanvas(page, SPOTS.empty));
  await expect(figureEditorContent(page).locator('.publish-overlay-item.selected')).toHaveCount(0);
}

export const FIGURE_EDITOR_CAPTURES: CaptureEntry[] = [
  {
    name: 'figure-editor-overview',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    docs: ['explore/figure-editor.md'],
    setup: async (page) => {
      await openFigureEditor(page);
    },
    target: figureEditor,
  },
  {
    name: 'figure-editor-presets',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/figure-editor.md'],
    setup: async (page) => {
      await openFigureEditor(page);
    },
    target: (page) =>
      figureEditorContent(page)
        .locator('.publish-section')
        .filter({ has: page.getByText('Presets', { exact: true }) }),
  },
  {
    name: 'figure-editor-overlays',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/figure-editor.md'],
    setup: async (page) => {
      await openFigureEditor(page);
    },
    steps: async (page, cap) => {
      await tool(page, 'Circle').click();
      await cap.drag(
        await onCanvas(page, SPOTS.circle.centre),
        await onCanvas(page, SPOTS.circle.edge),
      );
      await addLabel(page, cap, SPOTS.circleLabel, 'Cluster 1');
      await tool(page, 'Arrow').click();
      await cap.drag(await onCanvas(page, SPOTS.arrow.from), await onCanvas(page, SPOTS.arrow.to));
      await addLabel(page, cap, SPOTS.arrowLabel, 'Cluster 2');
      const overlays = figureEditorContent(page).getByText('Overlays (4)', { exact: true });
      await expect(overlays).toBeVisible();
      await deselect(page, cap);
      // The overlays' rows scroll the sidebar. Its end stops the Overlays heading short of the
      // top, cutting a row above it; the Legend heading fits, with every overlay below it.
      await scrollSidebarTo(
        page,
        cap,
        figureEditorContent(page).locator('.publish-section-title', { hasText: /^Legend$/ }),
      );
    },
    target: figureEditor,
  },
  {
    name: 'figure-editor-zoom-inset',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/figure-editor.md'],
    setup: async (page) => {
      await openFigureEditor(page);
    },
    steps: async (page, cap) => {
      // Two drags: the source rectangle, then the target (its height follows the source's shape).
      await tool(page, 'Zoom Inset').click();
      await cap.drag(
        await onCanvas(page, SPOTS.insetSource.from),
        await onCanvas(page, SPOTS.insetSource.to),
      );
      await cap.drag(
        await onCanvas(page, SPOTS.insetTarget.from),
        await onCanvas(page, SPOTS.insetTarget.to),
      );
      await expect(
        figureEditorContent(page).getByText('Zoom Insets (1)', { exact: true }),
      ).toBeVisible();
      await deselect(page, cap);
      // The inset renders from the plot in a separate pass; the perf counters settle after it.
      await plotSettled(page);
    },
    target: figureEditor,
  },
];
