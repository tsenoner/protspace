/** The figure editor, opened from the Export menu as a person opens it. */
import { expect, type Locator, type Page } from '@playwright/test';
import { exportAction } from './explore';

/** The figure editor's dialog, named by its heading. */
export const figureEditor = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Figure editor' });

/**
 * The editor's content. It is slotted into ps-dialog, so it is not inside the <dialog> that
 * `figureEditor(page)` (role dialog) finds: query it from the modal host instead.
 */
export const figureEditorContent = (page: Page): Locator => page.locator('protspace-publish-modal');

/** The editor's preview canvas. */
export const figurePreviewCanvas = (page: Page): Locator =>
  figureEditorContent(page).locator('canvas.publish-preview-canvas');

/**
 * Export → "Figure editor…", then waits for the dialog and for its preview canvas to have a size,
 * which it gets once the first preview is drawn. Returns the dialog.
 */
export async function openFigureEditor(page: Page): Promise<Locator> {
  await exportAction(page, 'Figure editor…');
  const dialog = figureEditor(page);
  await expect(dialog).toBeVisible();
  const canvas = figurePreviewCanvas(page);
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const preview = element as HTMLCanvasElement;
        return preview.width > 0 && preview.height > 0;
      }),
    )
    .toBe(true);
  return dialog;
}
