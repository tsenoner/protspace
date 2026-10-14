import { expect, test, type Page } from '@playwright/test';
import { expectColorScheme, expectNoAxeViolations } from './helpers/a11y';
import {
  annotationSelect,
  appBar,
  applyFirstCategoryFilter,
  clearStatusChip,
  closeFilterPanel,
  colorByTrigger,
  exportAction,
  openExplore,
  openImportMenu,
  selectAnnotation,
} from './helpers/explore';
import { openLegendOther, openLegendSettings } from './helpers/legend';
import { seedTheme, themeButton } from './helpers/theme';
import { clickProteinNearPlotCentre, stubStructureRequests } from './helpers/workbench';

/**
 * Design decision 20: axe on the workbench's main states in both themes. The theme stays on
 * System and Playwright emulates the OS scheme, so one spec covers light and dark without
 * touching the switch; the rest of the suite runs light only.
 */

type AxeOptions = NonNullable<Parameters<typeof expectNoAxeViolations>[1]>;

interface State {
  name: string;
  /** Brings the workbench, loaded and idle, into the state. */
  open(page: Page): Promise<void>;
  /** A commented exception for this state only. */
  axe?: AxeOptions;
}

const help = (page: Page) => appBar(page).getByRole('button', { name: 'Help', exact: true });

const STATES: State[] = [
  { name: 'the idle workbench', open: async () => {} },
  {
    name: 'the theme menu',
    open: async (page) => {
      await themeButton(page).click();
      await expect(page.getByRole('menu', { name: 'Theme' })).toBeVisible();
    },
  },
  {
    name: 'the Color by picker',
    open: async (page) => {
      await colorByTrigger(page).click();
      await expect(annotationSelect(page).locator('.dropdown-item').first()).toBeVisible();
    },
    // As in multi-annotation-tooltip.spec.ts: each listbox row keeps its eye toggle and ⓘ beside
    // the option in a role="none" wrapper (Task 4.16, ruling R5 Q5), which this rule counts as
    // listbox children. The idle state runs the rule on the rest of the page.
    axe: { disableRules: ['aria-required-children'] },
  },
  {
    name: 'the legend settings popover',
    open: async (page) => {
      await openLegendSettings(page);
    },
  },
  {
    name: 'the legend Other popover',
    open: async (page) => {
      // 'order' has 18 values, so the default 10 rows leave eight under Other.
      await selectAnnotation(page, 'order');
      await openLegendOther(page);
    },
  },
  {
    name: 'the filter panel with one condition',
    open: async (page) => {
      await applyFirstCategoryFilter(page);
    },
  },
  {
    name: 'the Import menu',
    open: async (page) => {
      await openImportMenu(page);
    },
  },
  {
    name: 'the Help menu',
    open: async (page) => {
      await help(page).click();
      await expect(page.getByRole('menu', { name: 'Help' })).toBeVisible();
    },
  },
  {
    name: 'the figure editor',
    open: async (page) => {
      await exportAction(page, 'Figure editor…');
      await expect(page.getByRole('dialog', { name: 'Figure editor' })).toBeVisible();
    },
  },
  {
    name: 'a toast',
    open: async (page) => {
      await applyFirstCategoryFilter(page);
      await closeFilterPanel(page);
      await clearStatusChip(page, 'filter');
      const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Filter removed' });
      await expect(toast).toBeVisible();
      // A hovered toast does not time out while axe runs.
      await toast.hover();
    },
  },
  {
    name: 'the docked structure',
    open: async (page) => {
      await clickProteinNearPlotCentre(page);
      await expect(page.locator('.workbench')).toHaveAttribute('data-structure', 'docked');
      await expect(page.locator('#myStructureViewer')).toBeVisible();
      await expect(page.locator('#myStructureViewer .loading-overlay')).toHaveCount(0);
    },
  },
  {
    name: 'the first tour step',
    open: async (page) => {
      await help(page).click();
      await page.getByRole('menuitem', { name: 'Take the tour' }).click();
      await expect(page.locator('.driver-popover .driver-popover-title')).toHaveText(
        'Welcome to ProtSpace',
      );
    },
    // driver.js 1.4 anchors a step without an element to its own invisible 0×0
    // #driver-dummy-element and sets aria-expanded/aria-haspopup on it, a plain <div> (axe
    // aria-allowed-attr). Follow-up: fix upstream or drop the dummy anchor in the tour rewrite (7.4).
    axe: { exclude: ['#driver-dummy-element'] },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe with the OS in ${colorScheme}`, () => {
    test.use({ colorScheme });

    test.beforeEach(async ({ page }) => {
      // Task 6.13 deletes this line: System becomes the default.
      await seedTheme(page, 'system');
      await stubStructureRequests(page);
      await openExplore(page);
    });

    for (const state of STATES) {
      test(`${state.name} has no violations`, async ({ page }) => {
        await expectColorScheme(page, colorScheme);
        await state.open(page);
        await expectNoAxeViolations(page, state.axe);
      });
    }
  });
}
