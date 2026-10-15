/** The figure editor, opened from the Export menu as a person opens it. */
import { expect, type Locator, type Page } from '@playwright/test';
import { exportAction } from './explore';

/** The figure editor's dialog, named by its heading. */
export const figureEditor = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Figure editor' });

/**
 * Export → "Figure editor…", then waits for the dialog and for its preview canvas to have a size,
 * which it gets once the first preview is drawn. Returns the dialog.
 */
export async function openFigureEditor(page: Page): Promise<Locator> {
  await exportAction(page, 'Figure editor…');
  const dialog = figureEditor(page);
  await expect(dialog).toBeVisible();
  // The canvas is slotted into the dialog, so it is found from the modal, not from the dialog.
  const canvas = page.locator('protspace-publish-modal .publish-preview-canvas');
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
