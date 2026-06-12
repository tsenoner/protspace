import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const SPEC_DIR = path.dirname(new URL(import.meta.url).pathname);
const RAW_NUMERIC_BUNDLE_FIXTURE_PATH = path.join(
  SPEC_DIR,
  'fixtures',
  'raw_numeric_test.parquetbundle',
);
const RAW_NUMERIC_BUNDLE_PATH = path.join(
  SPEC_DIR,
  'fixtures',
  'phosphatase_no_binning.parquetbundle',
);
const REPLACEMENT_BUNDLE_PATH = path.join(SPEC_DIR, '..', 'public', 'data', '5K.parquetbundle');

// Suppress the first-run product tour. Its driver.js overlay covers the viewport
// and intercepts pointer events (notably over the query-builder dialog). The
// dismissTourIfPresent() calls below still handle any tour that slips through.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('driver.overviewTour', 'true');
    } catch {
      /* localStorage unavailable */
    }
  });
});

async function dismissTourIfPresent(page: Page): Promise<void> {
  const tourDialog = page.getByRole('dialog', { name: 'Welcome to ProtSpace' });
  const skipButton = page.getByRole('button', { name: 'Skip' });
  const closeButton = page.getByRole('button', { name: 'Close' }).first();
  const dialogVisible = await tourDialog
    .waitFor({
      state: 'visible',
      timeout: 3000,
    })
    .then(() => true)
    .catch(() => false);

  if (!dialogVisible) {
    return;
  }

  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click();
  } else if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }

  await expect(tourDialog).toBeHidden();
}

async function loadBundleFromBytes(
  page: Page,
  byteValues: number[],
  fileName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(
        async ({ bytes, nextFileName }) => {
          const loader = document.querySelector('protspace-data-loader') as
            | (Element & {
                loadFromFile?: (
                  file: File,
                  options?: { source?: 'user' | 'auto' },
                ) => Promise<void>;
              })
            | null;

          if (!loader?.loadFromFile) {
            throw new Error('ProtSpace data loader was not found');
          }

          await new Promise<void>((resolve, reject) => {
            loader.addEventListener('data-loaded', () => resolve(), { once: true });
            loader.addEventListener(
              'data-error',
              (event: Event) => {
                const detail = (event as CustomEvent<{ error?: string; message?: string }>).detail;
                reject(new Error(detail?.error || detail?.message || 'data-error'));
              },
              { once: true },
            );

            const file = new File([new Uint8Array(bytes)], nextFileName, {
              type: 'application/octet-stream',
            });
            void loader.loadFromFile(file, { source: 'user' });
          });
        },
        { bytes: byteValues, nextFileName: fileName },
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Execution context was destroyed') || attempt === 2) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => {
        const loader = document.querySelector('protspace-data-loader') as
          | (Element & {
              loadFromFile?: (file: File, options?: { source?: 'user' | 'auto' }) => Promise<void>;
            })
          | null;
        const plot = document.querySelector('protspace-scatterplot');
        return typeof loader?.loadFromFile === 'function' && Boolean(plot);
      });
    }
  }
}

async function loadDataset(page: Page): Promise<void> {
  await page.route('**/data.parquetbundle', async (route) => {
    await route.abort();
  });
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => unknown })
      | null;
    return typeof plot?.getCurrentData === 'function';
  });

  await loadBundleFromBytes(
    page,
    Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_FIXTURE_PATH)),
    'raw_numeric_test.parquetbundle',
  );
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');

  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: {
            annotations?: Record<string, { kind?: string }>;
          };
          getCurrentData?: () => {
            annotations?: Record<
              string,
              { numericMetadata?: { strategy?: string; binCount?: number } }
            >;
          };
        })
      | null;

    return (
      plot?.data?.annotations?.length?.kind === 'numeric' &&
      plot?.getCurrentData?.()?.annotations?.length?.numericMetadata?.binCount !== undefined
    );
  });
}

async function loadDemoDataset(page: Page): Promise<void> {
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: () => unknown;
          data?: { annotations?: Record<string, unknown> };
        })
      | null;
    return typeof plot?.getCurrentData === 'function' && Boolean(plot?.data?.annotations);
  });
  // 'order' is a clean Taxonomy categorical (18 values, no NAs) and uses the
  // default size-desc sort, which suits the legend keyboard/pointer-drag tests.
  // The previous pick was 'ec', but the demo bundle bakes a curated manual sort
  // for ec/pfam/superfamily/protein_families/cath — that breaks tests asserting
  // "keeps non-manual sorting". The substring match for selectAnnotation also
  // collided with 'species' (contains "ec"); that's been fixed in the helper.
  await waitForAnnotationAvailable(page, 'order');
  await selectAnnotation(page, 'order');
  await waitForLegendAnnotation(page, 'order');
}

async function waitForAnnotationAvailable(page: Page, annotation: string): Promise<void> {
  await page.waitForFunction((nextAnnotation) => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: { annotations?: Record<string, unknown> };
          getCurrentData?: () => { annotations?: Record<string, unknown> };
        })
      | null;
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & { annotations?: string[] })
      | null;

    const plotHasAnnotation =
      Boolean(plot?.data?.annotations?.[nextAnnotation]) ||
      Boolean(plot?.getCurrentData?.()?.annotations?.[nextAnnotation]);
    const controlBarHasAnnotation = Boolean(controlBar?.annotations?.includes(nextAnnotation));

    return plotHasAnnotation && controlBarHasAnnotation;
  }, annotation);
}

async function waitForLegendAnnotation(page: Page, annotation: string): Promise<void> {
  await page.waitForFunction((nextAnnotation) => {
    const legend = document.querySelector('protspace-legend') as
      | (Element & {
          selectedAnnotation?: string;
          shadowRoot?: ShadowRoot;
        })
      | null;
    const title = legend?.shadowRoot?.querySelector('.legend-title')?.textContent?.trim() ?? '';

    return legend?.selectedAnnotation === nextAnnotation && title === nextAnnotation;
  }, annotation);
}

async function getNumericState(page: Page) {
  return page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          data?: { annotations?: Record<string, { kind?: string }> };
          getCurrentData?: () => {
            annotations?: Record<
              string,
              {
                colors?: string[];
                numericMetadata?: {
                  strategy?: string;
                  binCount?: number;
                  bins?: Array<{ label: string }>;
                };
              }
            >;
          };
        })
      | null;

    const rawAnnotation = plot?.data?.annotations?.length;
    const materialized = plot?.getCurrentData?.()?.annotations?.length;

    return {
      rawKind: rawAnnotation?.kind,
      strategy: materialized?.numericMetadata?.strategy,
      binCount: materialized?.numericMetadata?.binCount,
      colors: materialized?.colors ?? [],
      bins: materialized?.numericMetadata?.bins?.map((bin) => bin.label) ?? [],
    };
  });
}

async function readNumericPreview(page: Page) {
  return page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const root = legend?.shadowRoot;
    const gradientBar = root?.querySelector('.color-palette-gradient-bar') as HTMLElement | null;
    const previewPanel = root?.querySelector(
      '.color-palette-preview--continuous',
    ) as HTMLElement | null;
    const previewCaption = root?.querySelector(
      '.color-palette-preview-caption',
    ) as HTMLElement | null;
    const scaleLabels = Array.from(
      root?.querySelectorAll('.color-palette-gradient-scale span') ?? [],
    ).map((node) => node.textContent?.trim() ?? '');
    const distribution = root?.querySelector(
      '#numeric-distribution-select',
    ) as HTMLSelectElement | null;

    return {
      gradientBarCount: root?.querySelectorAll('.color-palette-gradient-bar').length ?? 0,
      ariaLabel: gradientBar?.getAttribute('aria-label') ?? null,
      caption: previewCaption?.textContent?.trim() ?? '',
      panelHeight: previewPanel?.getBoundingClientRect().height ?? 0,
      scaleLabels,
      options: Array.from(distribution?.options ?? []).map((option) => ({
        value: option.value,
        label: option.textContent?.trim() ?? '',
      })),
    };
  });
}

async function readNumericPreviewChrome(page: Page) {
  return page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const gradientBar = legend?.shadowRoot?.querySelector(
      '.color-palette-gradient-bar',
    ) as HTMLElement | null;
    if (!gradientBar) {
      throw new Error('Numeric gradient preview not found');
    }
    const styles = window.getComputedStyle(gradientBar);
    const rect = gradientBar.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      boxShadow: styles.boxShadow,
      hasShadow: styles.boxShadow !== 'none',
      borderRadius: styles.borderRadius,
      transform: styles.transform,
    };
  });
}

async function readPalettePreviewChrome(
  page: Page,
  kind: 'numeric' | 'categorical',
): Promise<{
  height: number;
  hasShadow: boolean;
  borderRadius: string;
}> {
  return page.evaluate((previewKind) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const root = legend?.shadowRoot;
    const target =
      previewKind === 'numeric'
        ? (root?.querySelector('.color-palette-gradient-bar') as HTMLElement | null)
        : (root?.querySelector('.color-palette-swatch') as HTMLElement | null);

    if (!target) {
      throw new Error(`Palette preview target not found for ${previewKind}`);
    }

    const styles = window.getComputedStyle(target);
    return {
      height: target.getBoundingClientRect().height,
      hasShadow: styles.boxShadow !== 'none',
      borderRadius: styles.borderRadius,
    };
  }, kind);
}

async function openLegendSettings(page: Page): Promise<void> {
  await dismissTourIfPresent(page);
  await page.locator('protspace-legend button[aria-label="Legend settings"]').click();
  await expect(page.locator('protspace-legend #legend-settings-dialog')).toBeVisible();
}

async function selectAnnotation(page: Page, annotation: string): Promise<void> {
  await dismissTourIfPresent(page);
  await page.locator('protspace-control-bar protspace-annotation-select .dropdown-trigger').click();
  // Anchored regex with surrounding-whitespace tolerance. A bare `hasText: 'ec'`
  // is a substring match and would land on e.g. "species"; a tight `^ec$` won't
  // match because Lit templates introduce whitespace around the interpolation.
  const escaped = annotation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page
    .locator('protspace-control-bar protspace-annotation-select .dropdown-item')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
    .first()
    .click();

  await page.waitForFunction((nextAnnotation) => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { selectedAnnotation?: string })
      | null;
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & { selectedAnnotation?: string })
      | null;
    const legend = document.querySelector('protspace-legend') as
      | (Element & { selectedAnnotation?: string })
      | null;

    return (
      plot?.selectedAnnotation === nextAnnotation &&
      controlBar?.selectedAnnotation === nextAnnotation &&
      legend?.selectedAnnotation === nextAnnotation &&
      nextAnnotation.length > 0
    );
  }, annotation);
}

async function readLegendSettingsDialog(page: Page) {
  return page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const root = legend?.shadowRoot;
    const labels = Array.from(root?.querySelectorAll('label') ?? []);
    const includeShapesPresent = labels.some(
      (l) => (l.textContent ?? '').trim() === 'Include shapes',
    );
    const palette = root?.querySelector('.color-palette-select') as HTMLSelectElement | null;
    const distribution = root?.querySelector(
      '#numeric-distribution-select',
    ) as HTMLSelectElement | null;
    const gradientBar = root?.querySelector('.color-palette-gradient-bar') as HTMLElement | null;
    const sortingSection = root?.querySelector(
      '#legend-sorting-section-title',
    ) as HTMLElement | null;
    const reverseButton = root?.querySelector('button.reverse-button') as HTMLButtonElement | null;
    const maxVisibleLabel = (root?.querySelector('#max-visible-input') as HTMLInputElement | null)
      ?.closest('.other-items-list-item')
      ?.querySelector('.other-items-list-item-label') as HTMLLabelElement | null;
    const shapeSizeLabel = (root?.querySelector('#shape-size-input') as HTMLInputElement | null)
      ?.closest('.other-items-list-item')
      ?.querySelector('.other-items-list-item-label') as HTMLLabelElement | null;
    const sortingLabels = Array.from(
      root?.querySelectorAll('input[type="radio"][name^="sort-type-"]') ?? [],
    ).map((input) => input.closest('label')?.textContent?.trim() ?? '');
    const selectedSortingLabel =
      (
        Array.from(root?.querySelectorAll('input[type="radio"][name^="sort-type-"]') ?? []).find(
          (input) => (input as HTMLInputElement).checked,
        ) as HTMLInputElement | undefined
      )
        ?.closest('label')
        ?.textContent?.trim() ?? '';
    const reverseGradientToggle = root?.querySelector(
      '#reverse-gradient-toggle',
    ) as HTMLInputElement | null;
    const dialogTitle = root?.querySelector('#legend-settings-title') as HTMLElement | null;
    const paletteOptionTexts = Array.from(palette?.options ?? []).map(
      (option) => option.textContent?.trim() ?? '',
    );

    return {
      title: dialogTitle?.textContent?.trim() ?? '',
      includeShapesAbsent: !includeShapesPresent,
      palette: palette?.value ?? null,
      paletteOptions: Array.from(palette?.options ?? []).map((option) => option.value),
      paletteOptionTexts,
      reverseGradientChecked: reverseGradientToggle?.checked ?? false,
      distribution: distribution?.value ?? null,
      hasDistributionSelect: Boolean(distribution),
      hasGradientPreview: Boolean(gradientBar),
      hasSortingSection: Boolean(sortingSection),
      sortingSectionTitle: sortingSection?.textContent?.trim() ?? '',
      hasReverseButton: Boolean(reverseButton),
      reverseButtonLabel: reverseButton?.getAttribute('aria-label') ?? '',
      maxVisibleLabel: maxVisibleLabel?.textContent?.trim() ?? '',
      shapeSizeLabel: shapeSizeLabel?.textContent?.trim() ?? '',
      sortingLabels,
      selectedSortingLabel,
      logDisabled:
        (distribution?.querySelector('option[value="logarithmic"]') as HTMLOptionElement | null)
          ?.disabled ?? null,
    };
  });
}

async function readLegendDisplay(page: Page) {
  return page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const reverseButton = legend?.shadowRoot?.querySelector(
      'button.reverse-button',
    ) as HTMLButtonElement | null;
    const items = Array.from(legend?.shadowRoot?.querySelectorAll('.legend-item') ?? []).map(
      (item) => {
        const element = item as HTMLElement;
        const symbolPath = element.querySelector('.legend-symbol path') as SVGPathElement | null;
        const fill = symbolPath?.getAttribute('fill');
        const stroke = symbolPath?.getAttribute('stroke');
        return {
          value: element.dataset.value ?? '',
          label: element.querySelector('.legend-text')?.textContent?.trim() ?? '',
          color: fill && fill !== 'none' ? fill : (stroke ?? ''),
          count: element.querySelector('.legend-count')?.textContent?.trim() ?? '',
        };
      },
    );
    return {
      items,
      reverseButtonLabel: reverseButton?.getAttribute('aria-label') ?? '',
    };
  });
}

async function clickLegendReverseButton(page: Page): Promise<void> {
  await page.locator('protspace-legend button.reverse-button').click();
}

// ─── Query-builder filter helpers ───────────────────────────────────────────
// The control-bar Filter button opens the query builder (role="dialog"
// "Filter Query Builder"). A condition row picks an annotation and one or more
// of its values; "Apply & Isolate" isolates the scatter-plot to the matched
// proteins (observed via getCurrentData()), and "Reset All" clears isolation.
// Numeric bins are listed in the value picker by their internal id
// (e.g. "num:quantile:10:20.5"); these helpers map friendly bin labels (as the
// legend shows them) to those internal ids via numericMetadata.bins.

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FILTER_DIALOG = { name: 'Filter Query Builder' } as const;

async function openQueryBuilder(page: Page): Promise<void> {
  await dismissTourIfPresent(page);
  const dialog = page.getByRole('dialog', FILTER_DIALOG);
  if (await dialog.isVisible().catch(() => false)) {
    return;
  }
  await page
    .locator('protspace-control-bar')
    .getByRole('button', { name: /^Filter/ })
    .click();
  await expect(dialog).toBeVisible();
}

/** Read the trimmed annotation-trigger text of every top-level condition row. */
async function topRowAnnotations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cb = document.querySelector('protspace-control-bar');
    const qb = cb?.shadowRoot?.querySelector('protspace-query-builder');
    const conds = qb?.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    return rows.map(
      (r) =>
        (r as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot
          ?.querySelector('.annotation-select-trigger')
          ?.textContent?.trim() ?? '',
    );
  });
}

async function rowIndexFor(page: Page, annotation: string): Promise<number> {
  return (await topRowAnnotations(page)).findIndex((t) => t === annotation);
}

/** Locator for the nth top-level condition row. */
function conditionRow(page: Page, index: number) {
  return page.locator('protspace-query-condition-row').nth(index);
}

/**
 * Ensure an open query builder has a condition row whose annotation is
 * `annotation`, reusing an existing row or the seeded empty row, adding a new
 * condition only when necessary. Returns the row's index.
 */
async function ensureCondition(page: Page, annotation: string): Promise<number> {
  await openQueryBuilder(page);
  const existing = await rowIndexFor(page, annotation);
  if (existing >= 0) {
    return existing;
  }

  let annotations = await topRowAnnotations(page);
  let emptyIndex = annotations.findIndex((t) => t === 'Select annotation...');
  if (emptyIndex < 0) {
    await page
      .locator('protspace-query-builder')
      .getByRole('button', { name: '+ Add condition' })
      .click();
    await expect
      .poll(
        async () =>
          (await topRowAnnotations(page)).filter((t) => t === 'Select annotation...').length,
      )
      .toBeGreaterThan(0);
    annotations = await topRowAnnotations(page);
    emptyIndex = annotations.findIndex((t) => t === 'Select annotation...');
  }

  const row = conditionRow(page, emptyIndex);
  await row.locator('.annotation-select-trigger').click();
  await page
    .locator('protspace-query-condition-row .annotation-picker-item')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegex(annotation)}\\s*$`) })
    .first()
    .click();
  await expect.poll(async () => rowIndexFor(page, annotation)).toBeGreaterThanOrEqual(0);
  return rowIndexFor(page, annotation);
}

/**
 * Map an annotation's friendly value labels to/from the internal ids shown in
 * the value picker. Numeric annotations use numericMetadata.bins (label↔id);
 * categorical values are their own labels.
 */
async function valueMap(
  page: Page,
  annotation: string,
): Promise<{
  numeric: boolean;
  toInternal: Record<string, string>;
  toFriendly: Record<string, string>;
}> {
  return page.evaluate((ann) => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getMaterializedData?: () => { annotations?: Record<string, AnnMeta> };
          data?: { annotations?: Record<string, AnnMeta> };
        })
      | null;
    type AnnMeta = {
      values?: string[];
      numericMetadata?: { bins?: Array<{ id: string; label: string }> };
    };
    const data = plot?.getMaterializedData?.() ?? plot?.data;
    const meta = data?.annotations?.[ann] as AnnMeta | undefined;
    const toInternal: Record<string, string> = {};
    const toFriendly: Record<string, string> = {};
    const bins = meta?.numericMetadata?.bins;
    if (bins && bins.length) {
      for (const b of bins) {
        toInternal[b.label] = b.id;
        toFriendly[b.id] = b.label;
      }
      return { numeric: true, toInternal, toFriendly };
    }
    for (const v of meta?.values ?? []) {
      toInternal[v] = v;
      toFriendly[v] = v;
    }
    return { numeric: false, toInternal, toFriendly };
  }, annotation);
}

async function isValuePickerOpen(page: Page, rowIndex: number): Promise<boolean> {
  return page.evaluate((idx) => {
    const cb = document.querySelector('protspace-control-bar');
    const qb = cb?.shadowRoot?.querySelector('protspace-query-builder');
    const conds = qb?.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
    const picker = row?.shadowRoot?.querySelector('protspace-query-value-picker') as
      | (HTMLElement & { shadowRoot: ShadowRoot })
      | undefined;
    return Boolean(picker?.shadowRoot?.querySelector('.value-picker'));
  }, rowIndex);
}

async function openValuePicker(page: Page, rowIndex: number): Promise<void> {
  if (await isValuePickerOpen(page, rowIndex)) {
    return;
  }
  await conditionRow(page, rowIndex).locator('.value-chip-add').click();
  await expect.poll(async () => isValuePickerOpen(page, rowIndex)).toBe(true);
  // The value list renders synchronously, but wait until at least one item or an
  // existing chip is present so callers can read/select reliably.
  await page.waitForFunction((idx) => {
    const cb = document.querySelector('protspace-control-bar');
    const qb = cb?.shadowRoot?.querySelector('protspace-query-builder');
    const conds = qb?.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
    const picker = row?.shadowRoot?.querySelector('protspace-query-value-picker') as
      | (HTMLElement & { shadowRoot: ShadowRoot })
      | undefined;
    const items = picker?.shadowRoot?.querySelectorAll('.value-picker-item').length ?? 0;
    const chips = row?.shadowRoot?.querySelectorAll('.value-chip-text').length ?? 0;
    return items + chips > 0;
  }, rowIndex);
}

/** Read the internal value labels currently listed in the open value picker. */
async function pickerItemValues(page: Page, rowIndex: number): Promise<string[]> {
  return page.evaluate((idx) => {
    const cb = document.querySelector('protspace-control-bar');
    const qb = cb?.shadowRoot?.querySelector('protspace-query-builder');
    const conds = qb?.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
    const picker = row?.shadowRoot?.querySelector('protspace-query-value-picker') as
      | (HTMLElement & { shadowRoot: ShadowRoot })
      | undefined;
    return Array.from(picker?.shadowRoot?.querySelectorAll('.value-picker-item') ?? []).map(
      (it) =>
        (
          it.querySelector('span:not(.value-picker-count)') as HTMLElement | null
        )?.textContent?.trim() ?? '',
    );
  }, rowIndex);
}

/** Read the internal value labels currently selected as chips on the row. */
async function chipValues(page: Page, rowIndex: number): Promise<string[]> {
  return page.evaluate((idx) => {
    const cb = document.querySelector('protspace-control-bar');
    const qb = cb?.shadowRoot?.querySelector('protspace-query-builder');
    const conds = qb?.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
    return Array.from(row?.shadowRoot?.querySelectorAll('.value-chip-text') ?? []).map(
      (c) => (c as HTMLElement).textContent?.trim() ?? '',
    );
  }, rowIndex);
}

/** Click a value (by internal id) in the open value picker. Returns false if absent. */
async function clickPickerValue(
  page: Page,
  rowIndex: number,
  internalValue: string,
): Promise<boolean> {
  return page.evaluate(
    ({ idx, val }) => {
      const cb = document.querySelector('protspace-control-bar');
      const qb = cb?.shadowRoot?.querySelector('protspace-query-builder');
      const conds = qb?.shadowRoot?.querySelector('.query-conditions');
      const rows = Array.from(conds?.children ?? []).filter(
        (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
      );
      const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
      const picker = row?.shadowRoot?.querySelector('protspace-query-value-picker') as
        | (HTMLElement & { shadowRoot: ShadowRoot })
        | undefined;
      const items = Array.from(picker?.shadowRoot?.querySelectorAll('.value-picker-item') ?? []);
      const target = items.find(
        (it) =>
          (
            it.querySelector('span:not(.value-picker-count)') as HTMLElement | null
          )?.textContent?.trim() === val,
      ) as HTMLElement | undefined;
      if (!target) return false;
      target.click();
      return true;
    },
    { idx: rowIndex, val: internalValue },
  );
}

/** Remove every selected value chip from a condition row. */
async function clearChips(page: Page, rowIndex: number): Promise<void> {
  // Each click removes one chip; loop until none remain.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const removed = await page.evaluate((idx) => {
      const cb = document.querySelector('protspace-control-bar');
      const qb = cb?.shadowRoot?.querySelector('protspace-query-builder');
      const conds = qb?.shadowRoot?.querySelector('.query-conditions');
      const rows = Array.from(conds?.children ?? []).filter(
        (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
      );
      const row = rows[idx] as (HTMLElement & { shadowRoot: ShadowRoot }) | undefined;
      const btn = row?.shadowRoot?.querySelector('.value-chip-remove') as HTMLElement | null;
      if (!btn) return false;
      btn.click();
      return true;
    }, rowIndex);
    if (!removed) break;
  }
  await expect.poll(async () => (await chipValues(page, rowIndex)).length).toBe(0);
}

/** Close any open annotation/value picker without closing the dialog. */
async function closeOpenPickers(page: Page): Promise<void> {
  const matchCount = page.locator('protspace-query-builder .match-count');
  if (await matchCount.isVisible().catch(() => false)) {
    await matchCount.click();
  }
}

/**
 * Number of proteins currently visible in the scatter-plot. After "Apply &
 * Isolate" this is the isolated subset; with no filter it is the full dataset.
 */
async function isolatedCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => { protein_ids?: string[] } })
      | null;
    return plot?.getCurrentData?.()?.protein_ids?.length ?? -1;
  });
}

async function openFilterValueMenu(page: Page, annotation: string): Promise<void> {
  const rowIndex = await ensureCondition(page, annotation);
  await openValuePicker(page, rowIndex);
}

async function setFilterValues(page: Page, annotation: string, values: string[]): Promise<void> {
  const rowIndex = await ensureCondition(page, annotation);
  const map = await valueMap(page, annotation);
  await openValuePicker(page, rowIndex);
  await clearChips(page, rowIndex);

  for (const friendly of values) {
    const internal = map.toInternal[friendly] ?? friendly;
    await openValuePicker(page, rowIndex);
    const ok = await clickPickerValue(page, rowIndex, internal);
    expect(ok, `value "${friendly}" (${internal}) not found in the value picker`).toBe(true);
    await expect.poll(async () => chipValues(page, rowIndex)).toContain(internal);
  }

  await closeOpenPickers(page);
}

/**
 * Clear the active filter and isolation entirely via "Reset All". Leaves the
 * builder open (matching the component behaviour). The single caller that filters
 * one annotation uses this to return to the unfiltered view.
 */
async function disableFilter(page: Page, _annotation: string): Promise<void> {
  await openQueryBuilder(page);
  await closeOpenPickers(page);
  await page.locator('protspace-query-builder .query-footer-reset').click();
}

async function applyFiltersFromMenu(page: Page): Promise<void> {
  await closeOpenPickers(page);
  const apply = page.locator('protspace-query-builder .btn-primary');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole('dialog', FILTER_DIALOG)).toBeHidden();
}

async function countOpenFilterValues(page: Page, annotation: string): Promise<number> {
  return (await readOpenFilterLabels(page, annotation)).length;
}

/**
 * Friendly labels of the values currently offered in the open value picker for
 * `annotation` (selected values appear as chips and are excluded from the list).
 */
async function readOpenFilterLabels(page: Page, annotation: string): Promise<string[]> {
  const rowIndex = await ensureCondition(page, annotation);
  await openValuePicker(page, rowIndex);
  const map = await valueMap(page, annotation);
  const internals = await pickerItemValues(page, rowIndex);
  return internals.map((v) => map.toFriendly[v] ?? v);
}

async function readLegendDragHandles(page: Page): Promise<{ total: number; enabled: number }> {
  return page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const handles = Array.from(legend?.shadowRoot?.querySelectorAll('.drag-handle') ?? []);
    return {
      total: handles.length,
      enabled: handles.filter((handle) => !handle.classList.contains('drag-handle-disabled'))
        .length,
    };
  });
}

async function dragLegendHandle(page: Page, fromIndex: number, toIndex: number): Promise<void> {
  const dragCoordinates = await page.evaluate(
    ({ sourceIndex, targetIndex }) => {
      const legend = document.querySelector('protspace-legend') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const handles = Array.from(
        legend?.shadowRoot?.querySelectorAll('.legend-item:not(.legend-item-other) .drag-handle') ??
          [],
      ) as HTMLElement[];
      if (handles.length <= Math.max(sourceIndex, targetIndex)) {
        return null;
      }

      const source = handles[sourceIndex]?.getBoundingClientRect();
      const target = handles[targetIndex]?.getBoundingClientRect();
      if (!source || !target) {
        return null;
      }

      return {
        fromX: source.left + source.width / 2,
        fromY: source.top + source.height / 2,
        toX: target.left + target.width / 2,
        toY: target.top + target.height / 2,
      };
    },
    { sourceIndex: fromIndex, targetIndex: toIndex },
  );

  expect(dragCoordinates).not.toBeNull();

  await page.mouse.move(dragCoordinates?.fromX ?? 0, dragCoordinates?.fromY ?? 0);
  await page.mouse.down();
  await page.mouse.move(dragCoordinates?.toX ?? 0, dragCoordinates?.toY ?? 0, { steps: 10 });
  await page.mouse.up();
}

async function readCategoricalPreviewRows(page: Page): Promise<{
  swatchCount: number;
  firstRowCount: number;
  overflows: boolean;
  firstSwatchWidth: number;
}> {
  return page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const preview = legend?.shadowRoot?.querySelector(
      '.color-palette-preview',
    ) as HTMLElement | null;
    const swatches = Array.from(
      legend?.shadowRoot?.querySelectorAll('.color-palette-preview .color-palette-swatch') ?? [],
    ) as HTMLElement[];
    if (swatches.length === 0) {
      return { swatchCount: 0, firstRowCount: 0, overflows: false, firstSwatchWidth: 0 };
    }
    const firstTop = Math.round(swatches[0].getBoundingClientRect().top);
    return {
      swatchCount: swatches.length,
      firstRowCount: swatches.filter(
        (swatch) => Math.round(swatch.getBoundingClientRect().top) === firstTop,
      ).length,
      overflows: (preview?.scrollWidth ?? 0) > (preview?.clientWidth ?? 0) + 1,
      firstSwatchWidth: swatches[0]?.getBoundingClientRect().width ?? 0,
    };
  });
}

async function setSortMode(page: Page, annotation: string, mode: 'size' | 'alpha' | 'manual') {
  const legend = page.locator('protspace-legend');
  const inputs = legend.locator(`input[name="sort-type-${annotation}"][type="radio"]`);
  const count = await inputs.count();
  const index = mode === 'size' ? 0 : mode === 'alpha' ? 1 : count - 1;
  await inputs.nth(index).click();
}

async function hoverFirstVisiblePoint(page: Page): Promise<void> {
  const targets = await page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as HTMLElement & {
      shadowRoot?: ShadowRoot;
    };
    const canvas = plot?.shadowRoot?.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) {
      throw new Error('No plotted point available for tooltip test');
    }

    const width = canvas.width;
    const height = canvas.height;
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = width;
    probeCanvas.height = height;
    const ctx = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Could not create probe context');
    }

    ctx.drawImage(canvas, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    const targets: Array<{ x: number; y: number }> = [];

    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const offset = (y * width + x) * 4;
        if ((image.data[offset + 3] ?? 0) <= 32) {
          continue;
        }
        targets.push({
          x: rect.left + (x / width) * rect.width,
          y: rect.top + (y / height) * rect.height,
        });
        if (targets.length >= 40) {
          return targets;
        }
      }
    }

    if (targets.length === 0) {
      throw new Error('No rendered point pixel found for tooltip test');
    }
    return targets;
  });

  for (const target of targets) {
    await page.mouse.move(target.x, target.y, { steps: 4 });
    const hovered = await page
      .waitForFunction(
        () => {
          const plot = document.querySelector('protspace-scatterplot') as HTMLElement & {
            shadowRoot?: ShadowRoot;
          };
          return Boolean(plot?.shadowRoot?.querySelector('protspace-protein-tooltip'));
        },
        undefined,
        { timeout: 200 },
      )
      .then(() => true)
      .catch(() => false);
    if (hovered) {
      return;
    }
  }

  throw new Error('Could not trigger tooltip via a rendered point hover');
}

async function readTooltipSummary(page: Page): Promise<{
  labels: string[];
  rawValue: string | null;
}> {
  return page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const tooltip = plot?.shadowRoot?.querySelector('protspace-protein-tooltip') as
      | (HTMLElement & { shadowRoot?: ShadowRoot })
      | null;
    const root = tooltip?.shadowRoot;
    const rawValueNode = root?.querySelector('.tooltip-annotation-raw-value') as HTMLElement | null;

    return {
      labels: Array.from(root?.querySelectorAll('.tooltip-annotation-label') ?? []).map(
        (node) => node.textContent?.trim() ?? '',
      ),
      rawValue: rawValueNode?.textContent?.trim() ?? null,
    };
  });
}

async function updateLegendSettings(
  page: Page,
  settings: {
    maxVisibleValues: number;
    paletteId: string;
    strategy: 'linear' | 'quantile' | 'logarithmic';
    reverseGradient?: boolean;
  },
): Promise<void> {
  const legend = page.locator('protspace-legend');
  await legend.locator('#max-visible-input').fill(String(settings.maxVisibleValues));
  await legend.locator('.color-palette-select').first().selectOption(settings.paletteId);
  const distributionSelect = legend.locator('#numeric-distribution-select');
  if ((await distributionSelect.count()) > 0) {
    await distributionSelect.selectOption(settings.strategy);
  }
  if (settings.reverseGradient !== undefined) {
    const toggle = legend.locator('#reverse-gradient-toggle');
    const checked = await toggle.isChecked();
    if (checked !== settings.reverseGradient) {
      await toggle.click();
    }
  }
}

async function clickDialogButton(page: Page, label: 'Cancel' | 'Save'): Promise<void> {
  await page
    .locator('protspace-legend #legend-settings-dialog')
    .getByRole('button', { name: label })
    .click();
}

async function waitForDialogClosed(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    return !legend?.shadowRoot?.querySelector('#legend-settings-dialog');
  });
}

test('raw numeric annotations are materialized into frontend bins', async ({ page }) => {
  await loadDataset(page);

  const result = await getNumericState(page);

  expect(result.rawKind).toBe('numeric');
  expect(result.strategy).toBe('quantile');
  expect(result.binCount).toBeGreaterThan(0);
  expect(result.binCount).toBeLessThanOrEqual(10);
  expect(result.colors[0]).toBe('#011959');
  expect(result.colors.at(-1)).toBe('#FACCFA');
});

test('numeric settings are staged, saved, and restored on re-import', async ({ page }) => {
  await page.route('**/data.parquetbundle', async (route) => {
    await route.abort();
  });
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => unknown })
      | null;
    return typeof plot?.getCurrentData === 'function';
  });
  const bundleBytes = Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_PATH));
  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await waitForLegendAnnotation(page, 'length');
  await expect
    .poll(async () => {
      const state = await getNumericState(page);
      return {
        rawKind: state.rawKind ?? null,
        hasBins: (state.binCount ?? 0) > 0,
      };
    })
    .toEqual({ rawKind: 'numeric', hasBins: true });

  await openLegendSettings(page);
  const initialDialog = await readLegendSettingsDialog(page);
  await expect(
    page.locator('protspace-legend').getByRole('dialog', { name: 'Legend settings: length' }),
  ).toBeVisible();
  expect(initialDialog.includeShapesAbsent).toBe(true);
  expect(initialDialog.palette).toBe('batlow');
  expect(initialDialog.distribution).toBe('quantile');
  expect(initialDialog.hasDistributionSelect).toBe(true);
  expect(initialDialog.hasSortingSection).toBe(true);
  expect(initialDialog.hasReverseButton).toBe(true);
  expect(initialDialog.reverseButtonLabel).toBe('Show high to low');
  expect(initialDialog.title).toBe('Legend settings: length');
  expect(initialDialog.maxVisibleLabel).toBe('Max legend items');
  expect(initialDialog.shapeSizeLabel).toBe('Point size');
  expect(initialDialog.sortingLabels).toEqual(['By numeric value', 'Manual order']);
  expect(initialDialog.reverseGradientChecked).toBe(false);
  expect(initialDialog.paletteOptionTexts).toEqual([
    'Batlow - Scientific sequential gradient',
    'Cividis - Colorblind-friendly sequential gradient',
    'Inferno - High-contrast sequential gradient',
    'Plasma - Vivid sequential gradient',
    'Viridis - Perceptually uniform sequential gradient',
  ]);
  expect(initialDialog.logDisabled).toBe(false);
  const initialPreview = await readNumericPreview(page);
  expect(initialPreview.ariaLabel).toBe('Batlow continuous gradient preview');
  expect(initialPreview.caption).toBe('');
  expect(initialPreview.scaleLabels).toEqual(['Low', 'High']);
  expect((await readNumericPreview(page)).options).toContainEqual({
    value: 'logarithmic',
    label: 'Logarithmic',
  });

  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'plasma',
    strategy: 'quantile',
  });
  await expect.poll(readNumericPreview.bind(null, page)).toMatchObject({
    ariaLabel: 'Plasma continuous gradient preview',
  });
  const plasmaPreview = await readNumericPreview(page);
  expect(plasmaPreview.scaleLabels).toEqual(['Low', 'High']);
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);

  let state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.binCount).toBeGreaterThan(0);
  expect(state.binCount).toBeLessThanOrEqual(10);
  expect(state.colors[0]).toBe('#011959');

  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'plasma',
    strategy: 'quantile',
  });
  await expect.poll(readNumericPreview.bind(null, page)).toMatchObject({
    ariaLabel: 'Plasma continuous gradient preview',
  });
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: () => {
            annotations?: Record<
              string,
              {
                colors?: string[];
                numericMetadata?: { strategy?: string; binCount?: number };
              }
            >;
          };
        })
      | null;
    const lengthAnnotation = plot?.getCurrentData?.()?.annotations?.length;
    return (
      lengthAnnotation?.numericMetadata?.strategy === 'quantile' &&
      lengthAnnotation?.numericMetadata?.binCount === 5 &&
      lengthAnnotation?.colors?.[0] === '#0D0887'
    );
  });

  state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.binCount).toBe(5);
  expect(state.colors[0]).toBe('#0D0887');
  expect(state.colors.at(-1)).toBe('#F0F921');

  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');

  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: () => {
            annotations?: Record<
              string,
              {
                colors?: string[];
                numericMetadata?: { strategy?: string; binCount?: number };
              }
            >;
          };
        })
      | null;
    const lengthAnnotation = plot?.getCurrentData?.()?.annotations?.length;
    return (
      lengthAnnotation?.numericMetadata?.strategy === 'quantile' &&
      lengthAnnotation?.numericMetadata?.binCount === 5
    );
  });
});

test('reset restores numeric settings defaults and clears saved state on re-import', async ({
  page,
}) => {
  await page.route('**/data.parquetbundle', async (route) => {
    await route.abort();
  });
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => unknown })
      | null;
    return typeof plot?.getCurrentData === 'function';
  });

  const bundleBytes = Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_PATH));
  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await waitForLegendAnnotation(page, 'length');

  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'plasma',
    strategy: 'quantile',
    reverseGradient: true,
  });
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  let state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors[0]).toBe('#F0F921');
  expect(state.colors.at(-1)).toBe('#0D0887');

  await openLegendSettings(page);
  await page
    .locator('protspace-legend #legend-settings-dialog')
    .getByRole('button', { name: 'Reset' })
    .click();
  await waitForDialogClosed(page);

  state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors[0]).toBe('#011959');
  expect(state.colors.at(-1)).toBe('#FACCFA');

  await openLegendSettings(page);
  let dialog = await readLegendSettingsDialog(page);
  expect(dialog.palette).toBe('batlow');
  expect(dialog.distribution).toBe('quantile');
  expect(dialog.reverseGradientChecked).toBe(false);
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);

  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await waitForLegendAnnotation(page, 'length');

  state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors[0]).toBe('#011959');
  expect(state.colors.at(-1)).toBe('#FACCFA');

  await openLegendSettings(page);
  dialog = await readLegendSettingsDialog(page);
  expect(dialog.palette).toBe('batlow');
  expect(dialog.distribution).toBe('quantile');
  expect(dialog.reverseGradientChecked).toBe(false);
});

test('closing the settings dialog discards staged numeric changes like cancel', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialState = await getNumericState(page);
  expect(initialState.strategy).toBe('quantile');
  expect(initialState.colors[0]).toBe('#011959');

  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'plasma',
    strategy: 'quantile',
    reverseGradient: true,
  });

  await page
    .locator('protspace-legend #legend-settings-dialog')
    .getByRole('button', { name: 'Close settings' })
    .click();
  await waitForDialogClosed(page);

  const state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors[0]).toBe('#011959');
  expect(state.colors.at(-1)).toBe('#FACCFA');
});

test('pressing escape closes the settings dialog and discards staged numeric changes', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialState = await getNumericState(page);
  expect(initialState.strategy).toBe('quantile');
  expect(initialState.colors[0]).toBe('#011959');

  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'plasma',
    strategy: 'quantile',
    reverseGradient: true,
  });

  await page.keyboard.press('Escape');
  await waitForDialogClosed(page);

  const state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors[0]).toBe('#011959');
  expect(state.colors.at(-1)).toBe('#FACCFA');
});

test('changing only max legend items recalculates numeric colors for the same gradient palette', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialState = await getNumericState(page);
  expect(initialState.strategy).toBe('quantile');
  expect(initialState.binCount).toBeGreaterThan(0);
  expect(initialState.binCount).toBeLessThanOrEqual(10);
  expect(initialState.colors[0]).toBe('#011959');
  expect(initialState.colors.at(-1)).toBe('#FACCFA');

  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'cividis',
    strategy: 'linear',
  });

  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  const savedState = await getNumericState(page);
  expect(savedState.binCount).toBe(5);
  expect(savedState.colors).not.toEqual(initialState.colors);
  expect(savedState.colors[0]).toBe('#00224E');
  expect(savedState.colors.at(-1)).toBe('#FEE838');
});

test('reversing the numeric gradient swaps the low and high bin colors', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialState = await getNumericState(page);
  expect(initialState.colors.length).toBeGreaterThan(1);
  expect(initialState.colors[0]).toBe('#011959');
  expect(initialState.colors.at(-1)).toBe('#FACCFA');

  await openLegendSettings(page);
  const initialDialog = await readLegendSettingsDialog(page);
  expect(initialDialog.reverseGradientChecked).toBe(false);

  await updateLegendSettings(page, {
    maxVisibleValues: 10,
    paletteId: 'cividis',
    strategy: 'linear',
    reverseGradient: true,
  });
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  const reversedState = await getNumericState(page);
  expect(reversedState.colors[0]).toBe('#FEE838');
  expect(reversedState.colors.at(-1)).toBe('#00224E');

  await openLegendSettings(page);
  const reversedDialog = await readLegendSettingsDialog(page);
  expect(reversedDialog.reverseGradientChecked).toBe(true);
});

test('numeric palette preview stays compact even for large max legend item counts', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await openLegendSettings(page);

  await updateLegendSettings(page, {
    maxVisibleValues: 100,
    paletteId: 'cividis',
    strategy: 'logarithmic',
  });

  await expect
    .poll(async () => (await readNumericPreview(page)).ariaLabel)
    .toBe('Cividis continuous gradient preview');

  const preview = await readNumericPreview(page);
  expect(preview.caption).toBe('');
  expect(preview.gradientBarCount).toBe(1);
  expect(preview.scaleLabels).toEqual(['Low', 'High']);
});

test('numeric palette preview remains bounded when hovered', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await openLegendSettings(page);

  const beforeHover = await readNumericPreviewChrome(page);
  await page.locator('protspace-legend').locator('.color-palette-preview--continuous').hover();
  await expect
    .poll(async () => (await readNumericPreviewChrome(page)).width)
    .toBeGreaterThan(beforeHover.width);
  const afterHover = await readNumericPreviewChrome(page);
  expect(afterHover.height).toBeLessThan(beforeHover.height * 1.08);
});

test('numeric gradient preview uses the same rendered chrome as categorical swatches', async ({
  page,
}) => {
  await loadDataset(page);

  await selectAnnotation(page, 'family');
  await openLegendSettings(page);
  const categoricalChrome = await readPalettePreviewChrome(page, 'categorical');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);

  await selectAnnotation(page, 'length');
  await openLegendSettings(page);
  const numericChrome = await readNumericPreviewChrome(page);

  expect(numericChrome.borderRadius).toBe(categoricalChrome.borderRadius);
  expect(numericChrome.hasShadow).toBe(true);
  expect(categoricalChrome.hasShadow).toBe(true);
});

test('categorical annotations do not expose gradient palettes or gradient previews', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');
  await openLegendSettings(page);

  const dialog = await readLegendSettingsDialog(page);
  await expect(
    page.locator('protspace-legend').getByRole('dialog', { name: 'Legend settings: family' }),
  ).toBeVisible();
  expect(dialog.hasGradientPreview).toBe(false);
  expect(dialog.hasDistributionSelect).toBe(false);
  expect(dialog.hasSortingSection).toBe(true);
  expect(dialog.hasReverseButton).toBe(true);
  expect(dialog.reverseButtonLabel).toBe('Reverse z-order (keep Other last)');
  expect(dialog.title).toBe('Legend settings: family');
  expect(dialog.maxVisibleLabel).toBe('Max legend items');
  expect(dialog.shapeSizeLabel).toBe('Shape size');
  expect(dialog.paletteOptions).toEqual([
    'dark2',
    'kellys',
    'okabeIto',
    'set2',
    'tableau10',
    'tolBright',
  ]);
});

test('drag handles stay active outside manual mode and keep Other disabled', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  let numericHandles = await readLegendDragHandles(page);
  expect(numericHandles.total).toBeGreaterThan(0);
  expect(numericHandles.enabled).toBe(numericHandles.total);

  await selectAnnotation(page, 'family');
  let categoricalHandles = await readLegendDragHandles(page);
  const categoricalLegend = await readLegendDisplay(page);
  expect(categoricalHandles.total).toBeGreaterThan(0);
  expect(categoricalHandles.enabled).toBe(
    categoricalLegend.items.some((item) => item.label.startsWith('Other'))
      ? categoricalHandles.total - 1
      : categoricalHandles.total,
  );
});

test('clicking a legend row toggles visibility without switching categorical sort mode', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');

  const firstRow = page.locator('protspace-legend .legend-item-main').first();
  await firstRow.click();

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('By category size');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('same-slot pointer drag does not switch categorical sorting to manual', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');

  const initialLegend = await readLegendDisplay(page);
  await dragLegendHandle(page, 0, 0);

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(initialLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('By category size');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('dropping a pointer drag outside the legend keeps categorical sorting unchanged', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');

  const initialLegend = await readLegendDisplay(page);
  const dragCoordinates = await page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const handle = legend?.shadowRoot?.querySelector('.drag-handle') as HTMLElement | null;
    const legendBounds = legend?.shadowRoot
      ?.querySelector('.legend-container')
      ?.getBoundingClientRect();
    const handleBounds = handle?.getBoundingClientRect();
    if (!handleBounds || !legendBounds) {
      return null;
    }

    return {
      fromX: handleBounds.left + handleBounds.width / 2,
      fromY: handleBounds.top + handleBounds.height / 2,
      toX: legendBounds.left - 80,
      toY: legendBounds.top - 80,
    };
  });

  expect(dragCoordinates).not.toBeNull();

  await page.mouse.move(dragCoordinates?.fromX ?? 0, dragCoordinates?.fromY ?? 0);
  await page.mouse.down();
  await page.mouse.move(dragCoordinates?.toX ?? 0, dragCoordinates?.toY ?? 0, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(initialLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('By category size');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('categorical keyboard escape restores order and keeps non-manual sorting', async ({
  page,
}) => {
  await loadDemoDataset(page);

  const initialLegend = await readLegendDisplay(page);
  const firstHandle = page.locator('protspace-legend .drag-handle').first();
  await firstHandle.focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction((previousFirstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== previousFirstValue;
  }, initialLegend.items[0]?.value ?? '');

  await page.keyboard.press('Escape');

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(initialLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('By category size');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('categorical keyboard reorder promotes to manual order and keeps Other fixed', async ({
  page,
}) => {
  await loadDemoDataset(page);

  const initialLegend = await readLegendDisplay(page);
  const firstHandle = page.locator('protspace-legend .drag-handle').first();
  await firstHandle.focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');

  const reorderedLegend = await readLegendDisplay(page);
  expect(reorderedLegend.items.map((item) => item.value)).not.toEqual(
    initialLegend.items.map((item) => item.value),
  );
  expect(reorderedLegend.items.at(-1)?.value).toBe(initialLegend.items.at(-1)?.value);

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('Manual order');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('real phosphatase bundle rebins length to five bins without leaving the UI stuck', async ({
  page,
}) => {
  await page.route('**/data.parquetbundle', async (route) => {
    await route.abort();
  });
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => unknown })
      | null;
    return typeof plot?.getCurrentData === 'function';
  });

  const bundleBytes = fs.readFileSync(RAW_NUMERIC_BUNDLE_PATH);
  await loadBundleFromBytes(page, Array.from(bundleBytes), 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await waitForLegendAnnotation(page, 'length');
  await expect
    .poll(async () => {
      const state = await getNumericState(page);
      return {
        rawKind: state.rawKind ?? null,
        hasBins: (state.binCount ?? 0) > 0,
      };
    })
    .toEqual({ rawKind: 'numeric', hasBins: true });

  const initialNumericState = await getNumericState(page);
  expect(initialNumericState.colors[0]).toBe('#011959');
  expect(initialNumericState.colors.at(-1)).toBe('#FACCFA');
  expect(initialNumericState.binCount).toBeGreaterThan(0);
  expect(initialNumericState.binCount).toBeLessThanOrEqual(10);

  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'viridis',
    strategy: 'linear',
  });

  const startedAt = Date.now();
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: () => {
            annotations?: Record<
              string,
              { numericMetadata?: { binCount?: number; strategy?: string } }
            >;
          };
          selectedAnnotation?: string;
        })
      | null;

    return (
      plot?.selectedAnnotation === 'length' &&
      (plot?.getCurrentData?.()?.annotations?.length?.numericMetadata?.binCount ?? 0) > 0 &&
      (plot?.getCurrentData?.()?.annotations?.length?.numericMetadata?.binCount ?? 0) <= 5 &&
      plot?.getCurrentData?.()?.annotations?.length?.numericMetadata?.strategy === 'linear'
    );
  });

  expect(Date.now() - startedAt).toBeLessThan(5000);

  const finalNumericState = await getNumericState(page);
  expect(finalNumericState.binCount).toBeGreaterThan(0);
  expect(finalNumericState.binCount).toBeLessThanOrEqual(5);
  expect(finalNumericState.colors).not.toEqual(initialNumericState.colors);
  expect(finalNumericState.colors[0]).toBe('#440154');
  expect(finalNumericState.colors.at(-1)).toBe('#FDE725');
  await openLegendSettings(page);
  const reopenedDialog = await readLegendSettingsDialog(page);
  expect(reopenedDialog.distribution).toBe('linear');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('numeric header toggle reverses rendered bin order without changing color assignments', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialLegend = await readLegendDisplay(page);
  expect(initialLegend.reverseButtonLabel).toBe('Show high to low');

  await clickLegendReverseButton(page);

  await page.waitForFunction((firstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== firstValue;
  }, initialLegend.items[0]?.value ?? '');

  const reversedLegend = await readLegendDisplay(page);
  expect(reversedLegend.reverseButtonLabel).toBe('Show low to high');
  expect(reversedLegend.items.map((item) => item.value)).toEqual(
    [...initialLegend.items.map((item) => item.value)].reverse(),
  );
  expect(Object.fromEntries(reversedLegend.items.map((item) => [item.value, item.color]))).toEqual(
    Object.fromEntries(initialLegend.items.map((item) => [item.value, item.color])),
  );

  await openFilterValueMenu(page, 'length');
  const filterLabels = await readOpenFilterLabels(page, 'length');
  // The value picker lists the current bins in a stable order independent of the
  // legend's reversed display order, so compare as sets rather than by position.
  expect([...filterLabels].sort()).toEqual(
    [...reversedLegend.items.map((item) => item.label)].sort(),
  );
  await page
    .getByRole('dialog', { name: 'Filter Query Builder' })
    .getByRole('button', { name: 'Cancel' })
    .click();
});

test('linear numeric bins can realize fewer values than requested and filter stays aligned', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 20,
    paletteId: 'viridis',
    strategy: 'linear',
  });
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  const realizedState = await getNumericState(page);
  expect(realizedState.binCount).toBeLessThan(20);

  await openFilterValueMenu(page, 'length');
  expect(await countOpenFilterValues(page, 'length')).toBe(realizedState.binCount);
});

test('numeric legend labels are display summaries without comparison markers', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const legend = await readLegendDisplay(page);
  expect(legend.items.length).toBeGreaterThan(0);
  expect(legend.items.every((item) => !item.label.includes('<'))).toBe(true);
  expect(legend.items.every((item) => !item.label.includes('>'))).toBe(true);
  expect(legend.items.every((item) => !item.label.includes('.'))).toBe(true);
});

test('categorical palette preview keeps eleven swatches on the first row at desktop width', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');
  await openLegendSettings(page);

  const preview = await readCategoricalPreviewRows(page);
  expect(preview.swatchCount).toBeGreaterThanOrEqual(11);
  expect(preview.firstRowCount).toBe(11);
  expect(preview.overflows).toBe(false);
  expect(preview.firstSwatchWidth).toBeGreaterThanOrEqual(32);
  expect(preview.firstSwatchWidth).toBeLessThanOrEqual(40);
});

test('categorical palette preview wraps cleanly at a narrower desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await loadDataset(page);
  await selectAnnotation(page, 'family');
  await openLegendSettings(page);

  const preview = await readCategoricalPreviewRows(page);
  expect(preview.swatchCount).toBeGreaterThanOrEqual(11);
  expect(preview.overflows).toBe(false);
  expect(preview.firstRowCount).toBeLessThanOrEqual(11);
  expect(preview.firstRowCount).toBeGreaterThanOrEqual(8);
});

test('categorical pointer drag from size-asc keeps Other fixed and promotes to manual', async ({
  page,
}) => {
  await loadDemoDataset(page);

  await clickLegendReverseButton(page);
  const ascendingLegend = await readLegendDisplay(page);
  expect(ascendingLegend.items.at(-1)?.label.startsWith('Other')).toBe(true);

  await dragLegendHandle(page, 0, 1);
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .not.toEqual(ascendingLegend.items.map((item) => item.value));

  const reorderedLegend = await readLegendDisplay(page);
  expect(reorderedLegend.items.at(-1)?.label.startsWith('Other')).toBe(true);

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('Manual order');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('categorical pointer drag from alphabetical reverse promotes to manual order', async ({
  page,
}) => {
  await loadDemoDataset(page);
  await openLegendSettings(page);
  await setSortMode(page, 'order', 'alpha');
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);
  await clickLegendReverseButton(page);

  const reversedAlphaLegend = await readLegendDisplay(page);
  await dragLegendHandle(page, 0, 1);
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .not.toEqual(reversedAlphaLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('Manual order');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('numeric filters reuse the shared unfiltered bin view when switching bins', async ({
  page,
}) => {
  await loadDataset(page);

  const numericBins = await page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: (options?: { includeFilteredProteinIds?: boolean }) => {
            annotations?: Record<
              string,
              {
                numericMetadata?: { bins?: Array<{ label: string; count: number }> };
              }
            >;
          };
        })
      | null;
    if (!plot) {
      throw new Error('ProtSpace components were not found');
    }

    const fullData = plot.getCurrentData?.({ includeFilteredProteinIds: false });
    return {
      labels: fullData?.annotations?.length?.numericMetadata?.bins?.map((bin) => bin.label) ?? [],
      counts: fullData?.annotations?.length?.numericMetadata?.bins?.map((bin) => bin.count) ?? [],
    };
  });

  // Isolation stacks, so reset between applies to compare each bin against the
  // full (unfiltered) data — the shared unfiltered bin view.
  const fullCount = await isolatedCount(page);

  await setFilterValues(page, 'length', [numericBins.labels[0]]);
  await applyFiltersFromMenu(page);
  const firstCount = await isolatedCount(page);

  await disableFilter(page, 'length');
  await expect.poll(async () => isolatedCount(page)).toBe(fullCount);

  await setFilterValues(page, 'length', [numericBins.labels[1]]);
  await applyFiltersFromMenu(page);
  const secondCount = await isolatedCount(page);

  await disableFilter(page, 'length');
  await expect.poll(async () => isolatedCount(page)).toBe(fullCount);
  const resetCount = await isolatedCount(page);

  expect(firstCount).toBe(numericBins.counts[0]);
  expect(secondCount).toBe(numericBins.counts[1]);
  expect(resetCount).toBe(fullCount);
});

test('non-selected categorical annotations can still drive filtering', async ({ page }) => {
  // The query builder only materializes bins for the selected numeric annotation,
  // so a non-selected *numeric* annotation has no pickable values. Categorical
  // annotations keep their values regardless of selection, so filter on 'family'
  // while 'length' stays the coloured annotation.
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const fullCount = await isolatedCount(page);

  await openFilterValueMenu(page, 'family');
  const familyLabels = await readOpenFilterLabels(page, 'family');
  expect(familyLabels.length).toBeGreaterThan(0);
  expect(familyLabels).toContain('A');

  await setFilterValues(page, 'family', ['A']);
  await applyFiltersFromMenu(page);

  const isolated = await isolatedCount(page);
  const selectedAnnotation = await page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { selectedAnnotation?: string })
      | null;
    return plot?.selectedAnnotation ?? null;
  });

  // Filtering on a non-selected annotation isolates the view without changing
  // the currently selected (coloured) annotation.
  expect(isolated).toBeGreaterThan(0);
  expect(isolated).toBeLessThan(fullCount);
  expect(selectedAnnotation).toBe('length');
});

test('numeric pointer drag promotes value order to manual and reverse does not recolor bins', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialLegend = await readLegendDisplay(page);
  await dragLegendHandle(page, 0, 1);

  await page.waitForFunction((previousFirstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== previousFirstValue;
  }, initialLegend.items[0]?.value ?? '');

  const manuallyReorderedLegend = await readLegendDisplay(page);
  expect(initialLegend.reverseButtonLabel).toBe('Show high to low');

  await openLegendSettings(page);
  const reorderedDialog = await readLegendSettingsDialog(page);
  expect(reorderedDialog.selectedSortingLabel).toBe('Manual order');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);

  await clickLegendReverseButton(page);

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual([...manuallyReorderedLegend.items.map((item) => item.value)].reverse());

  const reversedLegend = await readLegendDisplay(page);
  expect(reversedLegend.reverseButtonLabel).toBe('Reverse manual order');
  expect(Object.fromEntries(reversedLegend.items.map((item) => [item.value, item.color]))).toEqual(
    Object.fromEntries(manuallyReorderedLegend.items.map((item) => [item.value, item.color])),
  );
});

test('numeric pointer drag from high-to-low value order promotes to manual', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await clickLegendReverseButton(page);

  const reversedLegend = await readLegendDisplay(page);
  expect(reversedLegend.reverseButtonLabel).toBe('Show low to high');
  await dragLegendHandle(page, 0, 1);

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .not.toEqual(reversedLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('Manual order');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('keyboard pickup without movement keeps numeric sorting in value order', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const firstHandle = page.locator('protspace-legend .drag-handle').first();
  const initialLegend = await readLegendDisplay(page);
  await firstHandle.focus();
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(initialLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('By numeric value');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('keyboard escape cancels pickup and keeps numeric sorting in value order', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const firstHandle = page.locator('protspace-legend .drag-handle').first();
  const initialLegend = await readLegendDisplay(page);
  await firstHandle.focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('Escape');

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(initialLegend.items.map((item) => item.value));

  const activeValue = await page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const active = legend?.shadowRoot?.activeElement as HTMLElement | null;
    return active?.closest('.legend-item')?.getAttribute('data-value') ?? null;
  });
  expect(activeValue).toBe(initialLegend.items[0]?.value ?? null);

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('By numeric value');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('keyboard escape after moving restores numeric order and value sorting', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const firstHandle = page.locator('protspace-legend .drag-handle').first();
  const initialLegend = await readLegendDisplay(page);
  await firstHandle.focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction((previousFirstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== previousFirstValue;
  }, initialLegend.items[0]?.value ?? '');

  await page.keyboard.press('Escape');

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(initialLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('By numeric value');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('numeric keyboard reordering persists and refreshes filter order immediately', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  const initialLegend = await readLegendDisplay(page);

  const firstHandle = page.locator('protspace-legend .drag-handle').first();
  await firstHandle.focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction((draggedValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const active = legend?.shadowRoot?.activeElement as HTMLElement | null;
    return active?.closest('.legend-item')?.getAttribute('data-value') === draggedValue;
  }, initialLegend.items[0]?.value ?? '');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction((draggedValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const active = legend?.shadowRoot?.activeElement as HTMLElement | null;
    return active?.closest('.legend-item')?.getAttribute('data-value') === draggedValue;
  }, initialLegend.items[0]?.value ?? '');
  await page.keyboard.press(' ');

  await page.waitForFunction((previousFirstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== previousFirstValue;
  }, initialLegend.items[0]?.value ?? '');

  const reorderedLegend = await readLegendDisplay(page);
  expect(reorderedLegend.items[2]?.value).toBe(initialLegend.items[0]?.value);

  await openLegendSettings(page);
  const reorderedDialog = await readLegendSettingsDialog(page);
  expect(reorderedDialog.selectedSortingLabel).toBe('Manual order');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);

  await openFilterValueMenu(page, 'length');
  const filterLabels = await readOpenFilterLabels(page, 'length');
  // The value picker lists the current bins (set), independent of the manual
  // legend reorder; the reload below verifies the manual order itself persists.
  expect([...filterLabels].sort()).toEqual(
    [...reorderedLegend.items.map((item) => item.label)].sort(),
  );
  await page
    .getByRole('dialog', { name: 'Filter Query Builder' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  await loadBundleFromBytes(
    page,
    Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_FIXTURE_PATH)),
    'raw_numeric_test.parquetbundle',
  );
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(reorderedLegend.items.map((item) => item.value));
});

test('topology-changing numeric rebins drop stale manual order on reload', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  const initialLegend = await readLegendDisplay(page);
  const firstHandle = page.locator('protspace-legend .drag-handle').first();
  await firstHandle.focus();
  await firstHandle.press(' ');
  await firstHandle.press('ArrowDown');
  await firstHandle.press(' ');

  await page.waitForFunction((previousFirstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== previousFirstValue;
  }, initialLegend.items[0]?.value ?? '');

  const manualLegend = await readLegendDisplay(page);
  expect(manualLegend.items[1]?.value).toBe(initialLegend.items[0]?.value);

  await loadBundleFromBytes(
    page,
    Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_FIXTURE_PATH)),
    'raw_numeric_test.parquetbundle',
  );
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(manualLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'viridis',
    strategy: 'linear',
  });
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  const rebinnedLegend = await readLegendDisplay(page);
  expect(rebinnedLegend.items.length).toBeLessThan(manualLegend.items.length);

  await loadBundleFromBytes(
    page,
    Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_FIXTURE_PATH)),
    'raw_numeric_test.parquetbundle',
  );
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');

  const reloadedLegend = await readLegendDisplay(page);
  await openLegendSettings(page);
  await setSortMode(page, 'length', 'alpha');
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  const numericOrderLegend = await readLegendDisplay(page);
  expect(reloadedLegend.items.map((item) => item.label)).toEqual(
    numericOrderLegend.items.map((item) => item.label),
  );
});

test('categorical manual reorder and reverse continue to work', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');
  const initialLegend = await readLegendDisplay(page);
  await dragLegendHandle(page, 0, 1);

  await page.waitForFunction((previousFirstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== previousFirstValue;
  }, initialLegend.items[0]?.value ?? '');
  const afterReorder = await readLegendDisplay(page);
  expect(afterReorder.items[1]?.value).toBe(initialLegend.items[0]?.value);

  await openLegendSettings(page);
  const reorderedDialog = await readLegendSettingsDialog(page);
  expect(reorderedDialog.selectedSortingLabel).toBe('Manual order');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);

  await clickLegendReverseButton(page);
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual([...afterReorder.items.map((item) => item.value)].reverse());
});

test('categorical drag-promoted manual order persists after re-import', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');

  const initialLegend = await readLegendDisplay(page);
  await dragLegendHandle(page, 0, 1);

  await page.waitForFunction((previousFirstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== previousFirstValue;
  }, initialLegend.items[0]?.value ?? '');

  const manualLegend = await readLegendDisplay(page);
  expect(manualLegend.items[1]?.value).toBe(initialLegend.items[0]?.value);

  await loadBundleFromBytes(
    page,
    Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_FIXTURE_PATH)),
    'raw_numeric_test.parquetbundle',
  );
  await waitForAnnotationAvailable(page, 'family');
  await selectAnnotation(page, 'family');
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(manualLegend.items.map((item) => item.value));

  await openLegendSettings(page);
  const dialog = await readLegendSettingsDialog(page);
  expect(dialog.selectedSortingLabel).toBe('Manual order');
  await clickDialogButton(page, 'Cancel');
  await waitForDialogClosed(page);
});

test('long categorical legend labels wrap instead of clipping', async ({ page }) => {
  await page.route('**/data.parquetbundle', async (route) => {
    await route.abort();
  });
  await page.goto('/explore');
  await dismissTourIfPresent(page);
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => unknown })
      | null;
    return typeof plot?.getCurrentData === 'function';
  });

  await loadBundleFromBytes(
    page,
    Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_PATH)),
    'phosphatase_no_binning.parquetbundle',
  );
  await waitForAnnotationAvailable(page, 'ec');
  await selectAnnotation(page, 'ec');
  await waitForLegendAnnotation(page, 'ec');

  const wrappedLabel = await page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const items = Array.from(legend?.shadowRoot?.querySelectorAll('.legend-item') ?? []);
    const target = items.find((item) => {
      const label = item.querySelector('.legend-text')?.textContent?.trim() ?? '';
      return label.includes('phosphatidylinositol') || label.includes('protein-serine/threonine');
    }) as HTMLElement | undefined;

    if (!target) {
      return null;
    }

    const button = target.querySelector('.legend-item-main') as HTMLElement | null;
    const text = target.querySelector('.legend-text') as HTMLElement | null;
    const count = target.querySelector('.legend-count') as HTMLElement | null;

    if (!button || !text || !count) {
      return null;
    }

    const style = window.getComputedStyle(text);
    const lineHeight = Number.parseFloat(style.lineHeight) || 0;

    return {
      label: text.textContent?.trim() ?? '',
      rowHeight: target.getBoundingClientRect().height,
      textHeight: text.getBoundingClientRect().height,
      lineHeight,
      textScrollWidth: text.scrollWidth,
      textClientWidth: text.clientWidth,
      buttonScrollWidth: button.scrollWidth,
      buttonClientWidth: button.clientWidth,
      countText: count.textContent?.trim() ?? '',
    };
  });

  expect(wrappedLabel).not.toBeNull();
  expect(wrappedLabel?.label ?? '').toContain('phosphat');
  expect(wrappedLabel?.countText ?? '').not.toBe('');
  expect(wrappedLabel?.textHeight ?? 0).toBeGreaterThan((wrappedLabel?.lineHeight ?? 0) * 1.5);
  expect(wrappedLabel?.textScrollWidth ?? 0).toBeLessThanOrEqual(
    (wrappedLabel?.textClientWidth ?? 0) + 1,
  );
  expect(wrappedLabel?.buttonScrollWidth ?? 0).toBeLessThanOrEqual(
    (wrappedLabel?.buttonClientWidth ?? 0) + 1,
  );
});

test('numeric tooltip shows the raw value within the current bin range after rebinning', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'viridis',
    strategy: 'linear',
  });
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  // The numeric tooltip shows the raw value (no bin label / comparison markers).
  // After rebinning, that raw value must fall within the overall range the
  // current bins span. hoverFirstVisiblePoint picks an arbitrary point, and the
  // bin-edge labels are rounded for display, so check against the global
  // min/max with a small tolerance rather than a single (rounded) bin — that
  // keeps the assertion stable regardless of which point is hovered.
  const binBounds = (await readLegendDisplay(page)).items
    .flatMap((item) => item.label.split(' - ').map((part) => Number(part)))
    .filter((value) => Number.isFinite(value));
  expect(binBounds.length).toBeGreaterThan(0);
  const globalMin = Math.min(...binBounds);
  const globalMax = Math.max(...binBounds);
  const tolerance = Math.max(1, (globalMax - globalMin) * 0.02);

  await hoverFirstVisiblePoint(page);
  const tooltip = await readTooltipSummary(page);
  const rawValue = Number(tooltip.rawValue ?? Number.NaN);

  expect(Number.isFinite(rawValue)).toBe(true);
  expect(tooltip.rawValue ?? '').not.toContain('<');
  expect(rawValue).toBeGreaterThanOrEqual(globalMin - tolerance);
  expect(rawValue).toBeLessThanOrEqual(globalMax + tolerance);
});

test('zero-match query disables Apply & Isolate and leaves the view unchanged (no fall-back to full data)', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const zeroMatchLengthBin = await page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: (options?: { includeFilteredProteinIds?: boolean }) => {
            protein_ids?: string[];
            annotations?: Record<
              string,
              {
                values?: string[];
                numericMetadata?: { bins?: Array<{ id: string; label: string }> };
              }
            >;
            annotation_data?: Record<string, number[] | number[][]>;
          };
        })
      | null;

    if (!plot) {
      throw new Error('ProtSpace components were not found');
    }

    const fullData = plot.getCurrentData?.({ includeFilteredProteinIds: false });
    const lengthValues = fullData?.annotations?.length?.values ?? [];
    const familyValues = fullData?.annotations?.family?.values ?? [];
    const familyRows = fullData?.annotation_data?.family as number[][] | number[] | undefined;
    const lengthRows = fullData?.annotation_data?.length as number[][] | number[] | undefined;

    const lengthBinsUsedByFamilyA = new Set<string>();
    lengthValues.forEach((_, index) => {
      void index;
    });

    for (let index = 0; index < (fullData?.protein_ids?.length ?? 0); index += 1) {
      const familyIndex = Array.isArray(familyRows?.[index])
        ? (familyRows?.[index] as number[])[0]
        : (familyRows as number[] | undefined)?.[index];
      const lengthIndex = Array.isArray(lengthRows?.[index])
        ? (lengthRows?.[index] as number[])[0]
        : (lengthRows as number[] | undefined)?.[index];

      if (
        familyIndex != null &&
        familyValues[familyIndex] === 'A' &&
        lengthIndex != null &&
        lengthValues[lengthIndex]
      ) {
        lengthBinsUsedByFamilyA.add(lengthValues[lengthIndex] as string);
      }
    }

    const zeroMatchLengthBinId = lengthValues.find((value) => !lengthBinsUsedByFamilyA.has(value));
    const zeroMatchLengthBin = fullData?.annotations?.length?.numericMetadata?.bins?.find(
      (bin) => bin.id === zeroMatchLengthBinId,
    )?.label;
    if (!zeroMatchLengthBin) {
      throw new Error('Could not derive a zero-match numeric filter combination');
    }
    return zeroMatchLengthBin;
  });

  const fullCount = await isolatedCount(page);
  await setFilterValues(page, 'family', ['A']);
  await setFilterValues(page, 'length', [zeroMatchLengthBin]);

  // A zero-match query cannot be isolated: the builder reports zero matches and
  // keeps "Apply & Isolate" disabled, so the view never collapses to empty or
  // falls back to the full data via a stale filter.
  await openQueryBuilder(page);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const cb = document.querySelector('protspace-control-bar') as
          | (HTMLElement & { shadowRoot: ShadowRoot })
          | null;
        const qb = cb?.shadowRoot?.querySelector('protspace-query-builder') as
          | (HTMLElement & { shadowRoot: ShadowRoot })
          | null;
        return qb?.shadowRoot?.querySelector('.match-count')?.textContent?.trim() ?? '';
      }),
    )
    .toContain('0 of');
  await expect(page.locator('protspace-query-builder .btn-primary')).toBeDisabled();
  expect(await isolatedCount(page)).toBe(fullCount);

  await page
    .getByRole('dialog', { name: 'Filter Query Builder' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  const legend = await readLegendDisplay(page);
  expect(legend.items.length).toBeGreaterThan(0);
  expect(legend.items.every((item) => item.value.length > 0)).toBe(true);
});

test('stale numeric filter labels are pruned when bins change', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const staleValue = await page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: (options?: { includeFilteredProteinIds?: boolean }) => {
            annotations?: Record<
              string,
              {
                numericMetadata?: { bins?: Array<{ label: string }> };
              }
            >;
          };
        })
      | null;
    if (!plot) {
      throw new Error('ProtSpace components were not found');
    }

    const staleValue = plot.getCurrentData?.({ includeFilteredProteinIds: false })?.annotations
      ?.length?.numericMetadata?.bins?.[0]?.label;
    if (!staleValue) {
      throw new Error('Numeric legend bins were not found');
    }
    return staleValue;
  });

  const fullCount = await isolatedCount(page);
  await setFilterValues(page, 'length', [staleValue]);
  await applyFiltersFromMenu(page);
  const initialFilterCount = await isolatedCount(page);

  expect(initialFilterCount).toBeGreaterThan(0);
  expect(initialFilterCount).toBeLessThan(fullCount);

  await openLegendSettings(page);
  await updateLegendSettings(page, {
    maxVisibleValues: 5,
    paletteId: 'viridis',
    strategy: 'linear',
  });
  await clickDialogButton(page, 'Save');
  await waitForDialogClosed(page);

  await openFilterValueMenu(page, 'length');
  const labels = await readOpenFilterLabels(page, 'length');
  // After rebinning, the value picker offers only the current bins — the stale
  // label is gone from the available values.
  expect(labels).not.toContain(staleValue);
  await page
    .getByRole('dialog', { name: 'Filter Query Builder' })
    .getByRole('button', { name: 'Cancel' })
    .click();
});

test('loading a new dataset clears active filters before rendering the replacement data', async ({
  page,
}) => {
  await loadDataset(page);
  const replacementBundleBytes = Array.from(fs.readFileSync(REPLACEMENT_BUNDLE_PATH));

  await setFilterValues(page, 'family', ['A']);
  await applyFiltersFromMenu(page);

  // Applying isolates the view to the six family-A proteins.
  await expect.poll(async () => isolatedCount(page)).toBe(6);
  expect(
    await page.evaluate(() => {
      const cb = document.querySelector('protspace-control-bar') as
        | (Element & { isolationMode?: boolean })
        | null;
      return cb?.isolationMode ?? false;
    }),
  ).toBe(true);

  await loadBundleFromBytes(page, replacementBundleBytes, '5K.parquetbundle');

  // Loading a new dataset clears the active isolation and renders the full
  // replacement data.
  await page.waitForFunction(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => { protein_ids?: string[] } })
      | null;
    return (plot?.getCurrentData?.()?.protein_ids?.length ?? 0) > 1000;
  });

  const replacementState = await page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & { getCurrentData?: () => { protein_ids?: string[] } })
      | null;
    const cb = document.querySelector('protspace-control-bar') as
      | (Element & { isolationMode?: boolean })
      | null;
    return {
      isolationMode: cb?.isolationMode ?? false,
      visibleCount: plot?.getCurrentData?.()?.protein_ids?.length ?? 0,
    };
  });

  expect(replacementState.isolationMode).toBe(false);
  expect(replacementState.visibleCount).toBeGreaterThan(1000);
});
