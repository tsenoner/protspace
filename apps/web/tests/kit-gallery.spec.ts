import { expect, test } from '@playwright/test';

const KIT = [
  'ps-button',
  'ps-icon-button',
  'ps-tooltip',
  'ps-popover',
  'ps-menu',
  'ps-menu-group',
  'ps-menu-item',
  'ps-menu-label',
  'ps-dialog',
  'ps-input',
  'ps-select',
  'ps-checkbox',
  'ps-switch',
  'ps-segmented',
];

test('the kit gallery shows every control in light and dark without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  // index.html loads Cloudflare's analytics beacon, whose reports fail CORS on localhost.
  await page.route('https://static.cloudflareinsights.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.goto('/dev/kit');
  await expect(page.getByRole('heading', { name: 'Kit' })).toBeVisible();
  const defined = await page.evaluate(
    (tags) => tags.filter((tag) => !customElements.get(tag)),
    KIT,
  );
  expect(defined).toEqual([]);

  await expect(
    page.getByRole('checkbox', { name: 'Select all categories, named by its label property' }),
  ).toBeVisible();

  // Check each Escape, so a failure names it instead of timing out on the next click.
  const species = page.getByRole('menuitemradio', { name: 'Species' });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(species).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Protein family' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(species).toBeHidden();

  const dialog = page.getByRole('dialog', { name: 'Legend settings' });
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Dark' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(errors).toEqual([]);
});
