import { expect, test, type Page } from '@playwright/test';
import { expectColorScheme, expectNoAxeViolations, type AxeOptions } from './helpers/a11y';
import { filterPanel } from './helpers/explore';
import {
  bottomPanel,
  moreButton,
  moreSheet,
  moreSheetContent,
  openExplorePhone,
  panelFold,
  panelTab,
  proteinNearRightEdge,
  structureSheet,
  tap,
} from './helpers/mobile';

/**
 * Design decision 20 on phones: axe on the phone layout's own states in both themes, as
 * workbench-a11y.spec.ts does on desktop. The theme stays on System and Playwright emulates the
 * OS scheme.
 */

interface State {
  name: string;
  /** Brings the phone screen, loaded and idle, into the state. */
  open(page: Page): Promise<void>;
  /** A commented exception for this state only. */
  axe?: AxeOptions;
}

const workbench = (page: Page) => page.locator('.workbench');

const STATES: State[] = [
  {
    name: 'the idle phone screen',
    open: async (page) => {
      await expect(workbench(page)).toHaveAttribute('data-layout', 'phone');
    },
  },
  {
    name: 'the More sheet with its Theme row',
    open: async (page) => {
      await moreButton(page).tap();
      await expect(moreSheet(page)).toBeVisible();
      await expect(moreSheetContent(page).getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    },
  },
  {
    name: 'the bottom panel on Legend, unfolded',
    open: async (page) => {
      await expect(panelTab(page, 'Legend')).toHaveAttribute('aria-selected', 'true');
      await expect(panelFold(page)).toHaveAccessibleName('Fold panel');
      await expect(bottomPanel(page).locator('#myLegend')).toBeVisible();
    },
  },
  {
    name: 'the bottom panel on Filter',
    open: async (page) => {
      await panelTab(page, 'Filter').tap();
      await expect(panelTab(page, 'Filter')).toHaveAttribute('aria-selected', 'true');
      await expect(filterPanel(page)).toBeVisible();
    },
  },
  {
    name: 'the folded structure sheet after a tap',
    open: async (page) => {
      await tap(page, await proteinNearRightEdge(page));
      await expect(workbench(page)).toHaveAttribute('data-sheet', 'folded');
      await expect(structureSheet(page)).toBeVisible();
      await expect(page.locator('#myStructureViewer .loading-overlay')).toHaveCount(0);
    },
  },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe on a phone with the OS in ${colorScheme}`, () => {
    test.use({ colorScheme });

    test.beforeEach(async ({ page }) => {
      await openExplorePhone(page);
    });

    for (const state of STATES) {
      test(`${state.name} has no violations`, async ({ page }) => {
        await expectColorScheme(page, colorScheme);
        await state.open(page);
        await expectNoAxeViolations(page, state.axe);
      });
    }

    test.describe('landscape', () => {
      test.use({ viewport: { width: 740, height: 360 } });

      test('the idle landscape screen has no violations', async ({ page }) => {
        await expectColorScheme(page, colorScheme);
        await expect(workbench(page)).toHaveAttribute('data-layout', 'landscape');
        await expectNoAxeViolations(page);
      });
    });
  });
}
