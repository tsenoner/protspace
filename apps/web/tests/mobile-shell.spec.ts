import { expect, test, type Page } from '@playwright/test';
import { openExplorePhone } from './helpers/mobile';

/**
 * The workbench shell across its four layouts (design decision 17): crossing a breakpoint or
 * turning a phone is CSS on one tree, so the runtime elements stay the same instances.
 */

const RUNTIME_ELEMENTS = [
  'myPlot',
  'myLegend',
  'myStructureViewer',
  'myImportMenu',
  'myExportMenu',
  'myProteinSearch',
  'myQueryBuilder',
];

type Remembered = { __runtimeElements: Array<Element | null> };

async function rememberRuntimeElements(page: Page): Promise<void> {
  await page.evaluate((ids) => {
    (window as unknown as Remembered).__runtimeElements = ids.map((id) =>
      document.getElementById(id),
    );
  }, RUNTIME_ELEMENTS);
}

/** The ids whose element is missing or no longer the one remembered. */
function replacedRuntimeElements(page: Page): Promise<string[]> {
  return page.evaluate((ids) => {
    const before = (window as unknown as Remembered).__runtimeElements;
    return ids.filter(
      (id, index) => before[index] === null || document.getElementById(id) !== before[index],
    );
  }, RUNTIME_ELEMENTS);
}

test.describe('the workbench shell on every screen', () => {
  test('the same runtime elements survive 1280, 800, 390 and 740×360', async ({ page }) => {
    await openExplorePhone(page);
    const root = page.locator('.workbench');
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(root).toHaveAttribute('data-layout', 'desktop');
    await rememberRuntimeElements(page);

    for (const [size, mode] of [
      [{ width: 800, height: 1280 }, 'tablet'],
      [{ width: 390, height: 844 }, 'phone'],
      [{ width: 740, height: 360 }, 'landscape'],
      [{ width: 1280, height: 720 }, 'desktop'],
    ] as const) {
      await page.setViewportSize(size);
      await expect(root).toHaveAttribute('data-layout', mode);
      expect(await replacedRuntimeElements(page), `at ${size.width}×${size.height}`).toEqual([]);
    }
  });
});
