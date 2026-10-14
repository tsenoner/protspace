/**
 * Accessibility checks for the e2e specs: axe over the WCAG 2.0 and 2.1 A/AA rules, and a check
 * that the page really renders in the colour scheme a test asked for.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Resolves once no finite animation or transition is running (a popover's or a toast's fade), so
 * axe measures colours at their final opacity. Infinite ones (a spinner) are ignored.
 */
async function animationsSettled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === 'running' &&
                animation.effect?.getComputedTiming().endTime !== Infinity,
            ).length,
      ),
    )
    .toBe(0);
}

/**
 * Runs axe on the page (or on `include`) and fails with one `rule: targets` line per violation.
 * `disableRules` and `exclude` are for a known, commented exception in one state only. `tags`
 * defaults to the four WCAG A/AA sets; `tags: null` runs every axe rule (best practices too), as
 * the annotation picker's test always ran.
 */
export async function expectNoAxeViolations(
  page: Page,
  options: {
    include?: string;
    exclude?: string[];
    disableRules?: string[];
    tags?: readonly string[] | null;
  } = {},
): Promise<void> {
  await animationsSettled(page);
  let builder = new AxeBuilder({ page });
  const tags = options.tags === undefined ? WCAG_TAGS : options.tags;
  if (tags) builder = builder.withTags([...tags]);
  if (options.include) builder = builder.include(options.include);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);
  const { violations } = await builder.analyze();
  expect(
    violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => JSON.stringify(node.target)).join(', ')}`,
    ),
    'axe violations (rule: targets)',
  ).toEqual([]);
}

/** Asserts the page renders in `scheme`: the theme took effect before anything is measured. */
export async function expectColorScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
    .toBe(scheme);
}
