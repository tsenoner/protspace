import { expect, test } from '@playwright/test';
import { openExplore } from './helpers/explore';

test.describe('design foundation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('explore keeps a 16px root, adopts the tokens and self-hosts Inter', async ({ page }) => {
    const fontHosts: string[] = [];
    page.on('request', (request) => {
      const host = new URL(request.url()).host;
      if (/fonts\.(googleapis|gstatic)\.com/.test(host)) fontHosts.push(host);
    });
    await openExplore(page);
    const result = await page.evaluate(async () => {
      const faces = await document.fonts.load('13px "Inter Variable"');
      const root = getComputedStyle(document.documentElement);
      return {
        rootSize: root.fontSize,
        accent: root.getPropertyValue('--ps-accent').trim(),
        interFaces: faces.length,
      };
    });
    expect(result.rootSize).toBe('16px');
    expect(result.accent).toBe('#007ab5');
    expect(result.interFaces).toBeGreaterThan(0);
    expect(fontHosts).toEqual([]);
  });
});
