/**
 * Captures for docs/explore/figure-editor.md: the editor whole (light and dark: its chrome follows
 * the theme, its preview stays light), the presets grid, and the preview with overlays and with a
 * zoom inset, drawn with the editor's own tools.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { figureEditor, openFigureEditor } from '../../../apps/web/tests/helpers/figure';
import { plotSettled } from '../../../apps/web/tests/helpers/plot';
import type { CaptureApi, CaptureEntry } from '../capture-plan';

type Spot = { x: number; y: number };

/**
 * Where the overlays go, as fractions of the preview canvas (0,0 its top-left corner). The legend
 * takes the right of the figure, so every spot stays in the left two thirds. Chosen against the
 * demo's curated view; if a capture frames empty space, move these and capture again.
 */
const SPOTS = {
  // A circle around the orange cluster below the centre, labelled to its right.
  circle: { centre: { x: 0.467, y: 0.535 }, edge: { x: 0.503, y: 0.535 } },
  circleLabel: { x: 0.55, y: 0.535 },
  // An arrow into the purple cluster on the left, labelled at its tail.
  arrow: { from: { x: 0.17, y: 0.34 }, to: { x: 0.27, y: 0.53 } },
  arrowLabel: { x: 0.16, y: 0.3 },
  insetSource: { from: { x: 0.38, y: 0.48 }, to: { x: 0.45, y: 0.54 } },
  insetTarget: { from: { x: 0.06, y: 0.66 }, to: { x: 0.3, y: 0.66 } },
  empty: { x: 0.01, y: 0.01 },
};

/**
 * The editor's content. It is slotted into ps-dialog, so it is not inside the <dialog> that
 * `figureEditor(page)` (role dialog) finds: query it from the modal host instead.
 */
const editor = (page: Page): Locator => page.locator('protspace-publish-modal');

const previewCanvas = (page: Page): Locator =>
  editor(page).locator('canvas.publish-preview-canvas');

const tool = (page: Page, name: 'Select' | 'Circle' | 'Arrow' | 'Label' | 'Zoom Inset'): Locator =>
  editor(page).getByRole('button', { name, exact: true });

/** A spot on the preview canvas in page coordinates. */
async function onCanvas(page: Page, spot: Spot): Promise<Spot> {
  const box = await previewCanvas(page).boundingBox();
  if (!box) throw new Error('The figure preview canvas has no box');
  return { x: box.x + box.width * spot.x, y: box.y + box.height * spot.y };
}

/** Places a label at `spot` and gives it `text` through the sidebar's "Label text" field. */
async function addLabel(page: Page, cap: CaptureApi, spot: Spot, text: string): Promise<void> {
  await tool(page, 'Label').click();
  await cap.click(await onCanvas(page, spot));
  const field = editor(page).getByRole('textbox', { name: 'Label text' }).last();
  await field.fill(text);
  await field.press('Enter');
  await expect(field).toHaveValue(text);
}

/** Back to the Select tool, and a click on the canvas corner clears the selection's handles. */
async function deselect(page: Page, cap: CaptureApi): Promise<void> {
  await tool(page, 'Select').click();
  await cap.click(await onCanvas(page, SPOTS.empty));
  await expect(editor(page).locator('.publish-overlay-item.selected')).toHaveCount(0);
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
      editor(page)
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
      await expect(editor(page).getByText('Overlays (4)', { exact: true })).toBeVisible();
      await deselect(page, cap);
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
      await expect(editor(page).getByText('Zoom Insets (1)', { exact: true })).toBeVisible();
      await deselect(page, cap);
      // The inset renders from the plot in a separate pass; the perf counters settle after it.
      await plotSettled(page);
    },
    target: figureEditor,
  },
];
