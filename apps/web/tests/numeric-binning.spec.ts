import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  dismissTourIfPresent,
  filterApplyButton,
  filterDialog,
  filterResetButton,
  getColorByOptions,
  openFilter,
  queryBuilder,
  selectAnnotation,
  waitForExploreDataLoad,
} from './helpers/explore';
import { STARTUP_URL_GLOB, TOXPROT_5181_FIXTURE } from './helpers/fixtures';
import {
  closeLegendSettings,
  escapeRegex,
  legendSettingsDialog,
  legendSortButton,
  legendSortLabel,
  openLegendSettings,
  pickLegendPalette,
  readLegendSettings,
  resetLegendSettings,
  setBinDistribution,
  setLegendSetting,
  setLegendSort,
  toggleLegendReverse,
  toggleLegendSetting,
} from './helpers/legend';

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
const REPLACEMENT_BUNDLE_PATH = TOXPROT_5181_FIXTURE;

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
      // `data-loaded` fires before the app's post-load work (view restore); wait for the
      // load to settle so a test's next step cannot race it.
      await waitForExploreDataLoad(page);
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
  await page.route(STARTUP_URL_GLOB, async (route) => {
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
  await waitForExploreDataLoad(page);
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

    return (
      Boolean(plot?.data?.annotations?.[nextAnnotation]) ||
      Boolean(plot?.getCurrentData?.()?.annotations?.[nextAnnotation])
    );
  }, annotation);
  // And Color by offers it.
  await expect.poll(() => getColorByOptions(page)).toContain(annotation);
}

async function waitForLegendAnnotation(page: Page, annotation: string): Promise<void> {
  await page.waitForFunction((nextAnnotation) => {
    const legend = document.querySelector('protspace-legend') as
      | (Element & {
          selectedAnnotation?: string;
          shadowRoot?: ShadowRoot;
        })
      | null;
    // The legend title now renders the friendly display label (e.g. "Sequence
    // length"), not the raw key, so gate on the selectedAnnotation property
    // (the key) and only require the title to have rendered.
    const title = legend?.shadowRoot?.querySelector('.legend-title')?.textContent?.trim() ?? '';

    return legend?.selectedAnnotation === nextAnnotation && title.length > 0;
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

/** Viridis, linear bins and `bins` of them, applied live; then the popover closes. */
async function rebinLength(page: Page, bins: string): Promise<void> {
  await pickLegendPalette(page, 'Viridis');
  await setBinDistribution(page, 'Linear');
  await setLegendSetting(page, 'Bins', bins);
  await closeLegendSettings(page);
}

async function readLegendDisplay(page: Page) {
  return page.evaluate(() => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
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
    return { items };
  });
}

// ─── Query-builder filter helpers ───────────────────────────────────────────
// The Filter button opens the query builder in the filter dialog. A condition row picks an
// annotation and one or more of its values; "Apply & Isolate" isolates the scatter-plot to the
// matched proteins (observed via getCurrentData()), and "Reset" clears isolation.
// Numeric bins are listed in the value picker by their internal id
// (e.g. "num:quantile:10:20.5"); these helpers map friendly bin labels (as the
// legend shows them) to those internal ids via numericMetadata.bins.

/**
 * The annotation column of every top-level condition row, '' for a row with no
 * annotation chosen yet. Read from the condition, not the trigger text: the
 * trigger shows the annotation's label, not its column name.
 */
async function topRowAnnotations(page: Page): Promise<string[]> {
  return queryBuilder(page).evaluate((qb) => {
    const conds = qb.shadowRoot?.querySelector('.query-conditions');
    const rows = Array.from(conds?.children ?? []).filter(
      (c) => c.tagName?.toLowerCase() === 'protspace-query-condition-row',
    );
    return rows.map(
      (r) =>
        (r as HTMLElement & { condition?: { annotation: string } }).condition?.annotation ?? '',
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
  await openFilter(page);
  const existing = await rowIndexFor(page, annotation);
  if (existing >= 0) {
    return existing;
  }

  let annotations = await topRowAnnotations(page);
  let emptyIndex = annotations.indexOf('');
  if (emptyIndex < 0) {
    await queryBuilder(page).getByRole('button', { name: '+ Add condition' }).click();
    await expect
      .poll(async () => (await topRowAnnotations(page)).filter((t) => t === '').length)
      .toBeGreaterThan(0);
    annotations = await topRowAnnotations(page);
    emptyIndex = annotations.indexOf('');
  }

  const row = conditionRow(page, emptyIndex);
  await row.locator('.annotation-select-trigger').click();
  await page
    .locator(
      `protspace-query-condition-row .annotation-picker-item[data-annotation="${annotation}"]`,
    )
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
  return queryBuilder(page).evaluate((qb, idx) => {
    const conds = qb.shadowRoot?.querySelector('.query-conditions');
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
  await expect
    .poll(() =>
      queryBuilder(page).evaluate((qb, idx) => {
        const conds = qb.shadowRoot?.querySelector('.query-conditions');
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
      }, rowIndex),
    )
    .toBe(true);
}

/** Read the internal value labels currently listed in the open value picker. */
async function pickerItemValues(page: Page, rowIndex: number): Promise<string[]> {
  return queryBuilder(page).evaluate((qb, idx) => {
    const conds = qb.shadowRoot?.querySelector('.query-conditions');
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
  return queryBuilder(page).evaluate((qb, idx) => {
    const conds = qb.shadowRoot?.querySelector('.query-conditions');
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
  return queryBuilder(page).evaluate(
    (qb, { idx, val }) => {
      const conds = qb.shadowRoot?.querySelector('.query-conditions');
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
  // Removing a chip dispatches condition-changed up through the query builder and
  // back down, so the chip DOM only updates after an async Lit re-render. Wait
  // for the chip count to actually drop before the next click so we never
  // re-click a stale/detached button, and cap the loop so a removal regression
  // fails fast (a clear poll timeout) instead of spinning until the test timeout.
  let remaining = (await chipValues(page, rowIndex)).length;
  for (let guard = remaining + 5; guard > 0 && remaining > 0; guard -= 1) {
    const removed = await queryBuilder(page).evaluate((qb, idx) => {
      const conds = qb.shadowRoot?.querySelector('.query-conditions');
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
    const before = remaining;
    await expect.poll(async () => (await chipValues(page, rowIndex)).length).toBeLessThan(before);
    remaining = (await chipValues(page, rowIndex)).length;
  }
  await expect.poll(async () => (await chipValues(page, rowIndex)).length).toBe(0);
}

/** Close any open annotation/value picker without closing the dialog. */
async function closeOpenPickers(page: Page): Promise<void> {
  const matchCount = queryBuilder(page).locator('.match-count');
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
 * Drive the numeric range filter for `annotation`. Numeric annotations now render
 * an operator dropdown (`>`, `>=`, `<`, `<=`, `between`) + one or two number fields
 * instead of a bin value picker, and filter on raw values (not bins). This helper
 * drives only the exclusive comparisons it was written for; the inclusive ones and
 * the N/A presence chips are covered separately. Sets the operator and
 * the relevant bound(s); the live match count / Apply-enabled state update after
 * the builder's debounced re-evaluation, which the callers wait on.
 */
async function setNumericFilter(
  page: Page,
  annotation: string,
  operator: 'gt' | 'lt' | 'between',
  bounds: { min?: number; max?: number },
): Promise<void> {
  const rowIndex = await ensureCondition(page, annotation);
  const numeric = conditionRow(page, rowIndex).locator('protspace-query-numeric-input');
  await numeric.locator('.numeric-operator-select').selectOption(operator);
  if (bounds.min !== undefined) {
    await numeric.locator('input.numeric-field[placeholder="min"]').fill(String(bounds.min));
  }
  if (bounds.max !== undefined) {
    await numeric.locator('input.numeric-field[placeholder="max"]').fill(String(bounds.max));
  }
}

/**
 * Clear the active filter and isolation entirely via "Reset". Leaves the
 * builder open (matching the component behaviour). The single caller that filters
 * one annotation uses this to return to the unfiltered view.
 */
async function disableFilter(page: Page, _annotation: string): Promise<void> {
  await openFilter(page);
  await closeOpenPickers(page);
  await filterResetButton(page).click();
}

async function applyFiltersFromMenu(page: Page): Promise<void> {
  await closeOpenPickers(page);
  const apply = filterApplyButton(page);
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(filterDialog(page)).toBeHidden();
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

/**
 * Press the drag handle of the `index`-th sortable row the way a user does: the handle shows only
 * on a hovered row, and showing it moves it (the name gives way), so hover the row first, then
 * read the handle's box and check the pointer really lands on it.
 */
async function pressLegendHandle(page: Page, index: number): Promise<void> {
  const rows = page.locator('protspace-legend .legend-item:not(.legend-item-other)');
  await rows.nth(index).hover();
  const handle = await page.evaluate((rowIndex) => {
    const root = document.querySelector('protspace-legend')?.shadowRoot;
    const row = root?.querySelectorAll('.legend-item:not(.legend-item-other)')[rowIndex];
    const box = row?.querySelector('.drag-handle')?.getBoundingClientRect();
    if (!root || !box) return null;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    return { x, y, hit: root.elementFromPoint(x, y)?.closest('.drag-handle') !== null };
  }, index);
  expect(handle).toMatchObject({ hit: true });
  await page.mouse.move(handle!.x, handle!.y);
  await page.mouse.down();
}

async function dragLegendHandle(page: Page, fromIndex: number, toIndex: number): Promise<void> {
  await pressLegendHandle(page, fromIndex);
  const target = await page
    .locator('protspace-legend .legend-item:not(.legend-item-other)')
    .nth(toIndex)
    .boundingBox();
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
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

  // Hover is coalesced to a frame and the tooltip renders one update later; a loaded suite can
  // take longer than the short probes, so the first target gets a real wait.
  for (const [i, target] of targets.entries()) {
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
        { timeout: i === 0 ? 3_000 : 300 },
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

test('numeric settings apply live and are restored on re-import', async ({ page }) => {
  await page.route(STARTUP_URL_GLOB, async (route) => {
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
      return { rawKind: state.rawKind ?? null, hasBins: (state.binCount ?? 0) > 0 };
    })
    .toEqual({ rawKind: 'numeric', hasBins: true });

  // Task 3.9's check: the order is the header's, not a settings section.
  expect(await legendSortLabel(page)).toBe('By value, low to high');
  const settings = await openLegendSettings(page);
  await expect(
    page.getByRole('dialog', { name: 'Legend settings: Sequence length' }),
  ).toBeVisible();
  expect(await readLegendSettings(page)).toMatchObject({
    palette: 'Batlow',
    distribution: 'Quantile',
    reverseGradient: false,
  });
  await expect(settings.getByRole('spinbutton', { name: 'Bins', exact: true })).toBeVisible();
  await expect(settings.getByRole('spinbutton', { name: 'Point size', exact: true })).toBeVisible();
  expect(
    await settings
      .getByRole('radio')
      .evaluateAll((radios) => radios.map((radio) => radio.textContent?.trim() ?? '')),
  ).toEqual(['Batlow', 'Cividis', 'Inferno', 'Plasma', 'Viridis']);
  expect(
    await settings
      .getByRole('combobox', { name: 'Bin distribution' })
      .evaluate(
        (select: HTMLSelectElement) =>
          select.querySelector<HTMLOptionElement>('option[value="logarithmic"]')?.disabled,
      ),
  ).toBe(false);
  // No Save, no Cancel, and the order lives in the header's sort menu now.
  await expect(settings.getByRole('button', { name: /^(Save|Cancel)$/ })).toHaveCount(0);
  await expect(settings.getByText('Bin order')).toHaveCount(0);
  await expect(settings.getByText('Include shapes')).toHaveCount(0);

  await pickLegendPalette(page, 'Plasma');
  await setLegendSetting(page, 'Bins', '5');
  // Applied with the popover still open.
  await expect(legendSettingsDialog(page)).toBeVisible();
  await expect
    .poll(() => getNumericState(page))
    .toMatchObject({ strategy: 'quantile', binCount: 5 });
  const state = await getNumericState(page);
  expect(state.colors[0]).toBe('#0D0887');
  expect(state.colors.at(-1)).toBe('#F0F921');
  await closeLegendSettings(page);

  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await expect
    .poll(() => getNumericState(page))
    .toMatchObject({ strategy: 'quantile', binCount: 5 });
});

test('reset restores numeric settings defaults and clears saved state on re-import', async ({
  page,
}) => {
  await page.route(STARTUP_URL_GLOB, async (route) => {
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

  await pickLegendPalette(page, 'Plasma');
  await toggleLegendSetting(page, 'Reverse gradient');
  await setLegendSetting(page, 'Bins', '5');
  await expect.poll(async () => (await getNumericState(page)).colors[0]).toBe('#F0F921');
  let state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors.at(-1)).toBe('#0D0887');

  await resetLegendSettings(page);
  // Reset keeps the popover open, showing the defaults.
  await expect(legendSettingsDialog(page)).toBeVisible();
  expect(await readLegendSettings(page)).toMatchObject({
    palette: 'Batlow',
    distribution: 'Quantile',
    reverseGradient: false,
  });
  await expect.poll(async () => (await getNumericState(page)).colors[0]).toBe('#011959');
  state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors.at(-1)).toBe('#FACCFA');
  await closeLegendSettings(page);

  await loadBundleFromBytes(page, bundleBytes, 'phosphatase_no_binning.parquetbundle');
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');
  await waitForLegendAnnotation(page, 'length');

  state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors[0]).toBe('#011959');
  expect(state.colors.at(-1)).toBe('#FACCFA');
  expect(await readLegendSettings(page)).toMatchObject({
    palette: 'Batlow',
    distribution: 'Quantile',
    reverseGradient: false,
  });
  await closeLegendSettings(page);
});

test('closing the settings popover keeps the numeric changes it applied', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialState = await getNumericState(page);
  expect(initialState.strategy).toBe('quantile');
  expect(initialState.colors[0]).toBe('#011959');

  await pickLegendPalette(page, 'Plasma');
  await toggleLegendSetting(page, 'Reverse gradient');
  await setLegendSetting(page, 'Bins', '5');
  // The settings button closes the popover it opened.
  await page
    .locator('protspace-legend')
    .getByRole('button', { name: 'Legend settings', exact: true })
    .click();
  await expect(legendSettingsDialog(page)).toBeHidden();

  await expect.poll(async () => (await getNumericState(page)).colors[0]).toBe('#F0F921');
  const state = await getNumericState(page);
  expect(state.strategy).toBe('quantile');
  expect(state.colors.at(-1)).toBe('#0D0887');
});

test('Escape closes the settings popover and keeps a value typed just before it', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const settings = await openLegendSettings(page);
  // No blur: Escape right after typing must still apply the pending value.
  await settings.getByRole('spinbutton', { name: 'Bins', exact: true }).fill('5');
  await page.keyboard.press('Escape');
  await expect(legendSettingsDialog(page)).toBeHidden();

  await expect.poll(async () => (await getNumericState(page)).binCount).toBe(5);
  expect((await readLegendSettings(page)).maxItems).toBe('5');
  await closeLegendSettings(page);
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

  await pickLegendPalette(page, 'Cividis');
  await setBinDistribution(page, 'Linear');
  await setLegendSetting(page, 'Bins', '5');
  await closeLegendSettings(page);

  await expect.poll(async () => (await getNumericState(page)).binCount).toBe(5);
  const savedState = await getNumericState(page);
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
  expect((await readLegendSettings(page)).reverseGradient).toBe(false);

  await pickLegendPalette(page, 'Cividis');
  await setBinDistribution(page, 'Linear');
  await toggleLegendSetting(page, 'Reverse gradient');
  await closeLegendSettings(page);

  await expect.poll(async () => (await getNumericState(page)).colors[0]).toBe('#FEE838');
  expect((await getNumericState(page)).colors.at(-1)).toBe('#00224E');
  expect((await readLegendSettings(page)).reverseGradient).toBe(true);
  await closeLegendSettings(page);
});

test('numeric palette swatches stay inside the settings popover with 100 bins', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await setLegendSetting(page, 'Bins', '100');
  await setBinDistribution(page, 'Logarithmic');

  const settings = await openLegendSettings(page);
  const panel = (await legendSettingsDialog(page).boundingBox())!;
  const swatches = settings.getByRole('radio');
  await expect(swatches).toHaveCount(5);
  for (const swatch of await swatches.all()) {
    const box = (await swatch.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(panel.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    await expect(swatch.locator('.swatch-gradient')).toHaveCount(1);
  }
  expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await closeLegendSettings(page);
});

test('numeric and categorical palette swatches share the same chrome', async ({ page }) => {
  await loadDataset(page);
  const chrome = async () => {
    const settings = await openLegendSettings(page);
    const result = await settings
      .getByRole('radio')
      .first()
      .evaluate((radio) => {
        const strip = radio.querySelector('.swatch-chips, .swatch-gradient') as HTMLElement;
        return {
          swatchRadius: getComputedStyle(radio).borderRadius,
          stripRadius: getComputedStyle(strip).borderRadius,
          stripHeight: strip.getBoundingClientRect().height,
        };
      });
    await closeLegendSettings(page);
    return result;
  };

  await selectAnnotation(page, 'family');
  const categorical = await chrome();
  await selectAnnotation(page, 'length');
  const numeric = await chrome();
  expect(numeric).toEqual(categorical);
});

test('categorical annotations do not expose gradient palettes or gradient controls', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');
  // Task 3.9's check: the sort button is there, and the order is categorical.
  await expect(legendSortButton(page)).toBeVisible();
  expect(await legendSortLabel(page)).not.toMatch(/^By value/);
  const settings = await openLegendSettings(page);

  await expect(page.getByRole('dialog', { name: 'Legend settings: Family' })).toBeVisible();
  expect(
    await settings
      .getByRole('radio')
      .evaluateAll((radios) => radios.map((radio) => radio.textContent?.trim() ?? '')),
  ).toEqual(['Dark2', "Kelly's Colors", 'Okabe-Ito', 'Set2', 'Tableau 10', 'Tol Bright']);
  await expect(settings.locator('.swatch-gradient')).toHaveCount(0);
  await expect(settings.getByRole('combobox', { name: 'Bin distribution' })).toHaveCount(0);
  await expect(settings.getByRole('switch', { name: 'Reverse gradient' })).toHaveCount(0);
  await expect(
    settings.getByRole('spinbutton', { name: 'Max legend items', exact: true }),
  ).toBeVisible();
  await expect(settings.getByRole('spinbutton', { name: 'Shape size', exact: true })).toBeVisible();
  await closeLegendSettings(page);
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

  expect(await legendSortLabel(page)).toMatch(/^By count/);
});

test('same-slot pointer drag does not switch categorical sorting to manual', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');

  const initialLegend = await readLegendDisplay(page);
  await dragLegendHandle(page, 0, 0);

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(initialLegend.items.map((item) => item.value));

  expect(await legendSortLabel(page)).toMatch(/^By count/);
});

test('dropping a pointer drag outside the legend keeps categorical sorting unchanged', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');

  const initialLegend = await readLegendDisplay(page);
  const legendBounds = (await page.locator('protspace-legend .legend-container').boundingBox())!;
  await pressLegendHandle(page, 0);
  await page.mouse.move(legendBounds.x - 80, legendBounds.y - 80, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(initialLegend.items.map((item) => item.value));

  expect(await legendSortLabel(page)).toMatch(/^By count/);
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

  expect(await legendSortLabel(page)).toMatch(/^By count/);
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

  expect(await legendSortLabel(page)).toMatch(/^Your order/);
});

test('real phosphatase bundle rebins length to five bins without leaving the UI stuck', async ({
  page,
}) => {
  await page.route(STARTUP_URL_GLOB, async (route) => {
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

  const startedAt = Date.now();
  await rebinLength(page, '5');

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
  expect((await readLegendSettings(page)).distribution).toBe('Linear');
  await closeLegendSettings(page);
});

test('numeric header toggle reverses rendered bin order without changing color assignments', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  const initialLegend = await readLegendDisplay(page);
  expect(await legendSortLabel(page)).toBe('By value, low to high');

  await toggleLegendReverse(page);

  await page.waitForFunction((firstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== firstValue;
  }, initialLegend.items[0]?.value ?? '');

  const reversedLegend = await readLegendDisplay(page);
  expect(await legendSortLabel(page)).toBe('By value, high to low');
  expect(reversedLegend.items.map((item) => item.value)).toEqual(
    [...initialLegend.items.map((item) => item.value)].reverse(),
  );
  expect(Object.fromEntries(reversedLegend.items.map((item) => [item.value, item.color]))).toEqual(
    Object.fromEntries(initialLegend.items.map((item) => [item.value, item.color])),
  );
  // (Numeric filtering is now a raw-value range input with no per-bin list, so
  // there is no longer a "filter order mirrors legend order" assertion here.)
});

test('linear numeric bins can realize fewer values than requested', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await rebinLength(page, '20');

  await expect.poll(async () => (await getNumericState(page)).binCount).toBeLessThan(20);
  // (Bins are a legend/coloring concern only; numeric filtering is a raw-value
  // range input, so there is no per-bin filter list to count against here.)
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

test('categorical palette swatches fit the settings popover at 1280 and 1100 px wide', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'family');
  for (const width of [1280, 1100]) {
    await page.setViewportSize({ width, height: 720 });
    const settings = await openLegendSettings(page);
    const panel = (await legendSettingsDialog(page).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    const swatches = settings.getByRole('radio');
    await expect(swatches).toHaveCount(6);
    for (const swatch of await swatches.all()) {
      const box = (await swatch.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
      // Eight chips each; Tol Bright has only seven colours.
      const name = ((await swatch.textContent()) ?? '').trim();
      await expect(swatch.locator('.chip')).toHaveCount(name === 'Tol Bright' ? 7 : 8);
    }
    await closeLegendSettings(page);
  }
});

test('categorical pointer drag from size-asc keeps Other fixed and promotes to manual', async ({
  page,
}) => {
  await loadDemoDataset(page);

  await toggleLegendReverse(page);
  const ascendingLegend = await readLegendDisplay(page);
  expect(ascendingLegend.items.at(-1)?.label.startsWith('Other')).toBe(true);

  await dragLegendHandle(page, 0, 1);
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .not.toEqual(ascendingLegend.items.map((item) => item.value));

  const reorderedLegend = await readLegendDisplay(page);
  expect(reorderedLegend.items.at(-1)?.label.startsWith('Other')).toBe(true);

  expect(await legendSortLabel(page)).toMatch(/^Your order/);
});

test('categorical pointer drag from alphabetical reverse promotes to manual order', async ({
  page,
}) => {
  await loadDemoDataset(page);
  await setLegendSort(page, 'By name');
  await toggleLegendReverse(page);

  const reversedAlphaLegend = await readLegendDisplay(page);
  await dragLegendHandle(page, 0, 1);
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .not.toEqual(reversedAlphaLegend.items.map((item) => item.value));

  expect(await legendSortLabel(page)).toMatch(/^Your order/);
});

test('numeric range filters isolate to the matching subset and reset restores the full view', async ({
  page,
}) => {
  await loadDataset(page);

  // Numeric filtering now matches raw values via an operator + min/max range, not
  // bins. Read the raw length values so we can compute the exact expected count
  // for a `between min,max` filter (inclusive on both ends).
  const lengths = await page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: (options?: { includeFilteredProteinIds?: boolean }) => {
            numeric_annotation_data?: Record<string, Float64Array>;
          };
        })
      | null;
    if (!plot) {
      throw new Error('ProtSpace components were not found');
    }
    const fullData = plot.getCurrentData?.({ includeFilteredProteinIds: false });
    return Array.from(fullData?.numeric_annotation_data?.length ?? []).filter(Number.isFinite);
  });
  expect(lengths.length).toBeGreaterThan(0);

  const sorted = [...lengths].sort((a, b) => a - b);
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  const mid = sorted[Math.floor(sorted.length / 2)]!;
  const countInRange = (min: number, max: number) =>
    lengths.filter((value) => value >= min && value <= max).length;

  const fullCount = await isolatedCount(page);

  // Range A — lower portion [lo, mid].
  await setNumericFilter(page, 'length', 'between', { min: lo, max: mid });
  await applyFiltersFromMenu(page);
  const firstCount = await isolatedCount(page);

  // Filtering stacks via the dedicated filter channel, so reset between applies
  // to compare each range against the full (unfiltered) data.
  await disableFilter(page, 'length');
  await expect.poll(async () => isolatedCount(page)).toBe(fullCount);

  // Range B — upper portion [mid, hi].
  await setNumericFilter(page, 'length', 'between', { min: mid, max: hi });
  await applyFiltersFromMenu(page);
  const secondCount = await isolatedCount(page);

  await disableFilter(page, 'length');
  await expect.poll(async () => isolatedCount(page)).toBe(fullCount);
  const resetCount = await isolatedCount(page);

  expect(firstCount).toBe(countInRange(lo, mid));
  expect(secondCount).toBe(countInRange(mid, hi));
  expect(firstCount).toBeGreaterThan(0);
  expect(firstCount).toBeLessThan(fullCount);
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
  expect(await legendSortLabel(page)).toBe('By value, low to high');
  await dragLegendHandle(page, 0, 1);

  await page.waitForFunction((previousFirstValue) => {
    const legend = document.querySelector('protspace-legend') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const firstItem = legend?.shadowRoot?.querySelector('.legend-item') as HTMLElement | null;
    return firstItem?.dataset.value !== previousFirstValue;
  }, initialLegend.items[0]?.value ?? '');

  const manuallyReorderedLegend = await readLegendDisplay(page);

  expect(await legendSortLabel(page)).toMatch(/^Your order/);

  await toggleLegendReverse(page);

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual([...manuallyReorderedLegend.items.map((item) => item.value)].reverse());

  const reversedLegend = await readLegendDisplay(page);
  expect(await legendSortLabel(page)).toBe('Your order, reversed');
  expect(Object.fromEntries(reversedLegend.items.map((item) => [item.value, item.color]))).toEqual(
    Object.fromEntries(manuallyReorderedLegend.items.map((item) => [item.value, item.color])),
  );
});

test('numeric pointer drag from high-to-low value order promotes to manual', async ({ page }) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await toggleLegendReverse(page);

  const reversedLegend = await readLegendDisplay(page);
  expect(await legendSortLabel(page)).toBe('By value, high to low');
  await dragLegendHandle(page, 0, 1);

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .not.toEqual(reversedLegend.items.map((item) => item.value));

  expect(await legendSortLabel(page)).toMatch(/^Your order/);
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

  expect(await legendSortLabel(page)).toMatch(/^By value/);
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

  expect(await legendSortLabel(page)).toMatch(/^By value/);
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

  expect(await legendSortLabel(page)).toMatch(/^By value/);
});

test('numeric keyboard reordering persists across reload', async ({ page }) => {
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

  expect(await legendSortLabel(page)).toMatch(/^Your order/);

  // (Numeric filtering no longer mirrors legend order — it is a raw-value range
  // input — so the former filter-order assertion is dropped; the reload below
  // verifies the manual legend order itself persists.)
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

  await rebinLength(page, '5');

  await expect
    .poll(async () => (await readLegendDisplay(page)).items.length)
    .toBeLessThan(manualLegend.items.length);

  await loadBundleFromBytes(
    page,
    Array.from(fs.readFileSync(RAW_NUMERIC_BUNDLE_FIXTURE_PATH)),
    'raw_numeric_test.parquetbundle',
  );
  await waitForAnnotationAvailable(page, 'length');
  await selectAnnotation(page, 'length');

  const reloadedLegend = await readLegendDisplay(page);
  await setLegendSort(page, 'By value');

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

  expect(await legendSortLabel(page)).toMatch(/^Your order/);

  await toggleLegendReverse(page);
  const reversed = [...afterReorder.items.map((item) => item.value)].reverse();
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual(reversed);

  // A later item pass, here a live settings edit, keeps the reversed order (it used to flip back).
  const { size } = await readLegendSettings(page);
  await setLegendSetting(page, 'Shape size', size === '20' ? '24' : '20');
  await closeLegendSettings(page);
  expect((await readLegendDisplay(page)).items.map((item) => item.value)).toEqual(reversed);
  expect(await legendSortLabel(page)).toMatch(/^Your order/);

  // Capping the list keeps the top rows and puts Other last; it used to keep the bottom ones.
  await setLegendSetting(page, 'Max legend items', String(reversed.length - 1));
  await closeLegendSettings(page);
  await expect
    .poll(async () => (await readLegendDisplay(page)).items.map((item) => item.value))
    .toEqual([...reversed.slice(0, -1), expect.any(String)]);
  const capped = (await readLegendDisplay(page)).items;
  expect(capped[0]?.value).toBe(reversed[0]);
  expect(capped.at(-1)?.label.startsWith('Other')).toBe(true);
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

  expect(await legendSortLabel(page)).toMatch(/^Your order/);
});

test('long categorical legend labels end in an ellipsis on one line', async ({ page }) => {
  await page.route(STARTUP_URL_GLOB, async (route) => {
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

  const row = page
    .locator('protspace-legend .legend-item')
    .filter({ hasText: /phosphatidylinositol|protein-serine\/threonine/ })
    .first();
  await expect(row).toBeVisible();

  const label = await row.evaluate((element) => {
    const text = element.querySelector('.legend-text') as HTMLElement;
    const count = element.querySelector('.legend-count') as HTMLElement;
    return {
      text: text.textContent?.trim() ?? '',
      textHeight: text.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(text).lineHeight) || 0,
      truncated: text.scrollWidth > text.clientWidth,
      countText: count.textContent?.trim() ?? '',
      countFits: count.scrollWidth <= count.clientWidth + 1,
    };
  });

  expect(label.text).toContain('phosphat');
  expect(label.countText).not.toBe('');
  expect(label.countFits).toBe(true);
  expect(label.textHeight).toBeLessThanOrEqual(label.lineHeight * 1.5);
  expect(label.truncated).toBe(true);
  await expect(row.locator('.legend-item-main')).toHaveAccessibleName(
    new RegExp(`^${escapeRegex(label.text)}: `),
  );
});

test('numeric tooltip shows the raw value within the current bin range after rebinning', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');
  await rebinLength(page, '5');

  // The numeric tooltip shows the raw value (no bin label / comparison markers).
  // To verify it shows the *hovered point's* value — not a stale or
  // wrong-but-in-range value — isolate to a single bin first so every visible
  // point is known to belong to it, then assert the hovered raw value falls
  // within that bin's own range. Checking against the full-data range (the union
  // of all bin edges) would be near-tautological: every protein's value
  // trivially lies inside it. Bin labels can carry thousands separators, so
  // strip them before parsing; a small tolerance absorbs float-edge display
  // rounding (length is integer-typed here, so it is effectively exact).
  const numericBin = (await readLegendDisplay(page)).items
    .map((item) => ({
      label: item.label,
      count: Number(item.count.replace(/[^\d]/g, '')) || 0,
      bounds: item.label.split(' - ').map((part) => Number(part.replace(/,/g, ''))),
    }))
    .filter((bin) => bin.bounds.length === 2 && bin.bounds.every((value) => Number.isFinite(value)))
    .sort((a, b) => b.count - a.count)[0];
  expect(numericBin, 'no numeric bin with a parseable range was found').toBeTruthy();
  const [binMin, binMax] = numericBin!.bounds;

  // Filter to the chosen bin's value range so every visible point is in it.
  await setNumericFilter(page, 'length', 'between', { min: binMin, max: binMax });
  await applyFiltersFromMenu(page);
  expect(await isolatedCount(page)).toBeGreaterThan(0);

  await hoverFirstVisiblePoint(page);
  const tooltip = await readTooltipSummary(page);
  const rawValue = Number(tooltip.rawValue ?? Number.NaN);

  const tolerance = Math.max(0.5, (binMax - binMin) * 0.02);
  expect(Number.isFinite(rawValue)).toBe(true);
  expect(tooltip.rawValue ?? '').not.toContain('<');
  expect(rawValue).toBeGreaterThanOrEqual(binMin - tolerance);
  expect(rawValue).toBeLessThanOrEqual(binMax + tolerance);
});

test('zero-match query disables Apply & Isolate and leaves the view unchanged (no fall-back to full data)', async ({
  page,
}) => {
  await loadDataset(page);
  await selectAnnotation(page, 'length');

  // A numeric range above every length matches nothing — the simplest zero-match
  // query under the range-input model.
  const maxLength = await page.evaluate(() => {
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          getCurrentData?: (options?: { includeFilteredProteinIds?: boolean }) => {
            numeric_annotation_data?: Record<string, Float64Array>;
          };
        })
      | null;
    const data = plot?.getCurrentData?.({ includeFilteredProteinIds: false });
    const lengths = Array.from(data?.numeric_annotation_data?.length ?? []).filter(Number.isFinite);
    return lengths.length ? Math.max(...lengths) : 0;
  });

  const fullCount = await isolatedCount(page);
  await setNumericFilter(page, 'length', 'gt', { min: maxLength + 1 });

  // A zero-match query cannot be isolated: the builder reports zero matches and
  // keeps "Apply & Isolate" disabled, so the view never collapses to empty or
  // falls back to the full data via a stale filter.
  await openFilter(page);
  await expect
    .poll(async () =>
      ((await queryBuilder(page).locator('.match-count').textContent()) ?? '').trim(),
    )
    // Anchor to the start: the count reads "<n> of <total> proteins match", so a bare .toContain('0 of') would also match "10 of"
    .toMatch(/^0 of /);
  await expect(filterApplyButton(page)).toBeDisabled();
  // The builder says why: the count is in, and it is zero.
  await expect(queryBuilder(page).locator('#apply-reason')).toHaveText('No proteins match');
  expect(await isolatedCount(page)).toBe(fullCount);

  // Cancel is the builder's own button, so it is found inside the builder wherever the dialog is.
  await queryBuilder(page).getByRole('button', { name: 'Cancel' }).click();

  const legend = await readLegendDisplay(page);
  expect(legend.items.length).toBeGreaterThan(0);
  expect(legend.items.every((item) => item.value.length > 0)).toBe(true);
});

test('rebinning replaces the numeric bins (stale bin labels are gone)', async ({ page }) => {
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

  await rebinLength(page, '5');

  // After rebinning, the annotation exposes an entirely new set of bins, so the
  // stale bin label must be gone from the current bins. Read the current bins
  // directly (numericMetadata.bins via valueMap) rather than the value-picker
  // list: the picker hides already-selected values as chips, and the stale value
  // is still selected here, so a picker-list check would report it "absent"
  // whether or not rebinning actually replaced it — i.e. a tautology.
  const currentBinLabels = Object.keys((await valueMap(page, 'length')).toInternal);
  expect(currentBinLabels.length).toBeGreaterThan(0);
  expect(currentBinLabels).not.toContain(staleValue);
});

test('loading a new dataset clears active filters before rendering the replacement data', async ({
  page,
}) => {
  await loadDataset(page);
  const replacementBundleBytes = Array.from(fs.readFileSync(REPLACEMENT_BUNDLE_PATH));

  await setFilterValues(page, 'family', ['A']);
  await applyFiltersFromMenu(page);

  // Applying filters the view to the six family-A proteins (the query builder
  // drives the dedicated filteredProteinIds channel, marking filterActive).
  await expect.poll(async () => isolatedCount(page)).toBe(6);
  expect(
    await page.evaluate(() => {
      const plot = document.querySelector('protspace-scatterplot') as unknown as
        | (Element & { filtersActive?: boolean })
        | null;
      return plot?.filtersActive ?? false;
    }),
  ).toBe(true);

  await loadBundleFromBytes(page, replacementBundleBytes, 'toxprot_5181_pca3d.parquetbundle');

  // Loading a new dataset clears the active filter and renders the full
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
    return {
      filterActive:
        (plot as (Element & { filtersActive?: boolean }) | null)?.filtersActive ?? false,
      visibleCount: plot?.getCurrentData?.()?.protein_ids?.length ?? 0,
    };
  });

  expect(replacementState.filterActive).toBe(false);
  expect(replacementState.visibleCount).toBeGreaterThan(1000);
});
