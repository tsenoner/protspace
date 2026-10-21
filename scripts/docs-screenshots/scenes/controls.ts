/**
 * Captures for docs/explore/controls.md (Bars and Tools) and docs/explore/filter.md: each view-bar
 * menu open beside its trigger, the search report, the Export menu, the Filter panel holding a
 * two-condition draft, the plot with contours, and the EAT badge in Color by.
 */
import { expect, type Page } from '@playwright/test';
import { DEFAULT_EXAMPLE_DATASET } from '../../../apps/web/src/explore/example-datasets';
import {
  annotationSelect,
  colorByMenu,
  colorByTrigger,
  contoursMenu,
  contoursTrigger,
  draftFilterCondition,
  exportList,
  exportTrigger,
  filterPanel,
  openExportMenu,
  pasteIntoSearch,
  plotArea,
  projectionMenu,
  projectionTrigger,
  queryBuilder,
  searchInput,
  proteinSearch,
  searchReport,
  setContours,
} from '../../../apps/web/tests/helpers/explore';
import { legendRowValues } from '../../../apps/web/tests/helpers/legend';
import { plotSettled } from '../../../apps/web/tests/helpers/plot';
import type { CaptureEntry } from '../capture-plan';
import { around } from './clip';

/** The EAT example's curated colouring, the column its transfers fill. */
const EAT_ANNOTATION = 'toxin_class';
/** Ids no dataset holds, for the search report's "Not found" list. */
const UNKNOWN_IDS = ['X00001', 'X00002'];

/**
 * Builds a draft in the Filter panel and leaves it unapplied: the colouring annotation is one of
 * the two largest legend categories, AND length is between 60 and 120. The live count shows; Apply
 * is enabled.
 */
async function draftTwoConditions(page: Page): Promise<void> {
  const annotation = DEFAULT_EXAMPLE_DATASET.defaultView.annotation;
  const values = (await legendRowValues(page)).slice(0, 2);
  await draftFilterCondition(page, 0, annotation, values);
  const second = await draftFilterCondition(page, 1, 'length');
  await second.getByRole('button', { name: /^Operator for condition 2/ }).click();
  await second.getByRole('menuitemradio', { name: /^is between/ }).click();
  await second.getByLabel('Minimum value').fill('60');
  await second.getByLabel('Maximum value').fill('120');
  // No focus ring on the last field in the picture.
  await second.getByLabel('Maximum value').blur();
  await expect(queryBuilder(page).locator('.match-count')).toHaveText(
    // The element's text keeps its template whitespace around the sentence.
    /^\s*[1-9][\d,]* of [\d,]+ proteins? match\s*$/,
  );
  // The length condition's own count lands after a 750 ms debounce.
  await expect(second.locator('.numeric-match-count')).toHaveText(
    /[1-9][\d,]* (proteins match|protein matches)/,
  );
}

export const CONTROLS_CAPTURES: CaptureEntry[] = [
  {
    name: 'projection-menu',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    steps: async (page) => {
      await projectionTrigger(page).click();
      await expect(projectionMenu(page)).toBeVisible();
    },
    target: (page) => around([projectionTrigger(page), projectionMenu(page)]),
  },
  {
    name: 'color-by-menu',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    steps: async (page) => {
      await colorByTrigger(page).click();
      await expect(colorByMenu(page)).toBeVisible();
    },
    target: (page) => around([colorByTrigger(page), colorByMenu(page)]),
  },
  {
    name: 'contours-menu',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    setup: async (page) => {
      await setContours(page, 'on');
      await plotSettled(page);
    },
    steps: async (page) => {
      await contoursTrigger(page).click();
      await expect(contoursMenu(page)).toBeVisible();
    },
    target: (page) => around([contoursTrigger(page), contoursMenu(page)]),
  },
  {
    name: 'export-menu',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md', 'explore/exporting.md'],
    steps: async (page) => {
      await openExportMenu(page);
    },
    target: (page) => around([exportTrigger(page), exportList(page)]),
  },
  {
    name: 'search-messages',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    steps: async (page) => {
      // Focusing the empty box lists the dataset's first ids: three real ones to paste.
      await searchInput(page).click();
      const suggestions = proteinSearch(page).getByRole('option');
      await expect(suggestions.first()).toBeVisible();
      const found = (await suggestions.allTextContents())
        .map((text) => text.trim())
        .filter(Boolean)
        .slice(0, 3);
      await searchInput(page).press('Escape');
      await expect(suggestions).toHaveCount(0);
      await pasteIntoSearch(page, [...found, ...UNKNOWN_IDS].join('\n'));
      const total = found.length + UNKNOWN_IDS.length;
      await expect(searchReport(page)).toContainText(`${found.length} of ${total} found`);
      await expect(searchReport(page)).toContainText('Not found');
    },
    target: (page) => around([proteinSearch(page), searchReport(page)]),
  },
  {
    name: 'filter-panel',
    kind: 'png',
    viewport: 'desktop',
    themes: ['light', 'dark'],
    docs: ['explore/filter.md'],
    steps: draftTwoConditions,
    target: (page) => filterPanel(page),
  },
  {
    name: 'scatterplot-contours',
    kind: 'png',
    viewport: 'desktop',
    docs: ['explore/controls.md'],
    setup: async (page) => {
      await setContours(page, 'on');
      await plotSettled(page);
    },
    target: (page) => plotArea(page),
  },
  {
    name: 'eat-annotation-badge',
    kind: 'png',
    viewport: 'desktop',
    dataset: 'three-finger-toxins',
    docs: ['explore/controls.md', 'explore/eat.md'],
    steps: async (page) => {
      await colorByTrigger(page).click();
      const row = annotationSelect(page)
        .locator(`.dropdown-item[data-annotation="${EAT_ANNOTATION}"]`)
        .first();
      await expect(row.locator('.eat-badge')).toBeVisible();
      // The list scrolls and the row sits below the fold.
      await row.scrollIntoViewIfNeeded();
    },
    target: (page) => colorByMenu(page),
  },
];
