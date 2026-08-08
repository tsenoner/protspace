import { expect, test } from '@playwright/test';
import { waitForDataLoad, waitForLegend } from './helpers';

test.describe('Documentation screenshot wait helpers', () => {
  test('waitForDataLoad honors its readiness timeout', async ({ page }) => {
    test.setTimeout(2_000);
    await page.setContent('<button id="myPlot">plot</button>');

    await expect(waitForDataLoad(page, 100)).rejects.toThrow(/Timeout 100ms exceeded/);
  });

  test('waitForDataLoad honors its loading-overlay timeout', async ({ page }) => {
    test.setTimeout(2_000);
    await page.setContent(
      '<button id="myPlot">plot</button><div id="progressive-loading">loading</div>',
    );
    await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as HTMLElement & {
        data?: { protein_ids: string[] };
        _plotData?: { length: number };
        _scales?: object;
      };
      plot.data = { protein_ids: ['P12345'] };
      plot._plotData = { length: 1 };
      plot._scales = {};
    });

    await expect(waitForDataLoad(page, 100)).rejects.toThrow(/Timeout 100ms exceeded/);
  });

  test('waitForLegend honors its item timeout', async ({ page }) => {
    test.setTimeout(2_000);
    await page.setContent('<button id="myLegend">legend</button>');

    await expect(waitForLegend(page, 100)).rejects.toThrow(/Timeout 100ms exceeded/);
  });
});
