import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  captureExploreViewStability,
  clickLegendItem,
  dismissTourIfPresent,
  getFirstLegendItemValue,
  isLegendItemHidden,
  supportsExplorePersistedDataset,
  waitForExploreDataLoad,
  waitForExploreInteractionReady,
  waitForPersistedExploreDataset,
} from './helpers/explore';

const SPEC_DIR = path.dirname(new URL(import.meta.url).pathname);
const RAW_NUMERIC_BUNDLE_FIXTURE_PATH = path.join(
  SPEC_DIR,
  'fixtures',
  'raw_numeric_test.parquetbundle',
);
// The default demo dataset (its annotation/projection names) changes over time,
// and names can contain spaces/em-dashes (e.g. "ProtT5 — UMAP 2") that get
// URL-encoded. Discover the demo's view at runtime and derive non-default
// targets, so the tests don't hardcode names and survive demo swaps.
let demoAnnotations: string[] = [];
let demoDefaultAnnotation = '';
let demoDefaultProjection = '';
let targetAnnotation = '';
let targetProjection = '';
let secondAnnotation = '';
let secondProjection = '';

async function getCurrentView(page: Page) {
  return page.evaluate(() => {
    const controlBar = document.querySelector('protspace-control-bar') as
      | (Element & {
          selectedAnnotation?: string;
          selectedProjection?: string;
          annotations?: string[];
          projections?: string[];
        })
      | null;
    const plot = document.querySelector('protspace-scatterplot') as
      | (Element & {
          selectedAnnotation?: string;
          selectedProjectionIndex?: number;
          data?: { projections?: Array<{ name: string }> };
        })
      | null;

    const projections =
      controlBar?.projections ?? plot?.data?.projections?.map((p) => p.name) ?? [];
    const projectionIndex =
      plot?.selectedProjectionIndex ?? projections.indexOf(controlBar?.selectedProjection ?? '');
    const plotProjection = projectionIndex >= 0 ? projections[projectionIndex] : null;

    return {
      annotation: controlBar?.selectedAnnotation ?? plot?.selectedAnnotation ?? null,
      projection: plotProjection ?? controlBar?.selectedProjection ?? null,
      controlBarProjection: controlBar?.selectedProjection ?? null,
      plotProjection,
      annotations: controlBar?.annotations ?? [],
      projections,
    };
  });
}

async function waitForView(
  page: Page,
  expected: { annotation?: string; projection?: string },
  timeout = 30_000,
): Promise<void> {
  if (expected.annotation) {
    await expect
      .poll(async () => (await getCurrentView(page)).annotation, { timeout })
      .toBe(expected.annotation);
  }

  if (expected.projection) {
    await expect
      .poll(async () => (await getCurrentView(page)).projection, { timeout })
      .toBe(expected.projection);
  }

  const annotationTriggerText = page.locator(
    'protspace-control-bar protspace-annotation-select .dropdown-trigger-text',
  );
  const projectionTriggerText = page.locator(
    'protspace-control-bar #projection-trigger .dropdown-trigger-text',
  );

  if (expected.annotation) {
    await expect(annotationTriggerText).toHaveText(expected.annotation, { timeout });
  }

  if (expected.projection) {
    await expect(projectionTriggerText).toHaveText(expected.projection, { timeout });
  }
}

async function selectAnnotation(page: Page, annotation: string): Promise<void> {
  await waitForExploreInteractionReady(page);

  const annotationSelect = page
    .locator('protspace-control-bar')
    .locator('protspace-annotation-select');

  await annotationSelect.locator('.dropdown-trigger').click();
  await annotationSelect.getByText(annotation, { exact: true }).click();
}

async function selectProjection(page: Page, projection: string): Promise<void> {
  await waitForExploreInteractionReady(page);
  await page.locator('protspace-control-bar').locator('#projection-trigger').click();
  await page.getByRole('option', { name: projection, exact: true }).click();
}

async function loadBundleFromPath(page: Page, filePath: string, fileName: string): Promise<void> {
  const bytes = Array.from(fs.readFileSync(filePath));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(
        async ({ byteValues, nextFileName }) => {
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

            const file = new File([new Uint8Array(byteValues)], nextFileName, {
              type: 'application/octet-stream',
            });
            void loader.loadFromFile(file, { source: 'user' });
          });
        },
        { byteValues: bytes, nextFileName: fileName },
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
        return typeof loader?.loadFromFile === 'function';
      });
    }
  }
}

async function queueUserLoads(
  page: Page,
  firstFilePath: string,
  firstFileName: string,
): Promise<void> {
  const firstFileBytes = Array.from(fs.readFileSync(firstFilePath));

  await page.evaluate(
    async ({ byteValues, nextFileName }) => {
      const loader = document.querySelector('protspace-data-loader') as
        | (Element & {
            loadFromFile?: (file: File, options?: { source?: 'user' | 'auto' }) => Promise<void>;
          })
        | null;

      if (!loader?.loadFromFile) {
        throw new Error('ProtSpace data loader was not found');
      }

      const demoResponse = await fetch('/data.parquetbundle');
      if (!demoResponse.ok) {
        throw new Error(`Failed to fetch demo dataset: ${demoResponse.status}`);
      }

      const demoBuffer = await demoResponse.arrayBuffer();
      const firstFile = new File([new Uint8Array(byteValues)], nextFileName, {
        type: 'application/octet-stream',
      });
      const secondFile = new File([demoBuffer], 'queued-demo.parquetbundle', {
        type: 'application/octet-stream',
      });

      await Promise.all([
        loader.loadFromFile(firstFile, { source: 'user' }),
        loader.loadFromFile(secondFile, { source: 'user' }),
      ]);
    },
    { byteValues: firstFileBytes, nextFileName: firstFileName },
  );
}

async function dropBundleOnScatterplot(
  page: Page,
  filePath: string,
  fileName: string,
): Promise<void> {
  const bytes = Array.from(fs.readFileSync(filePath));

  await page.evaluate(
    async ({ byteValues, nextFileName }) => {
      const plot = document.getElementById('myPlot');
      const loader = document.querySelector('protspace-data-loader') as
        | (Element & {
            addEventListener: EventTarget['addEventListener'];
          })
        | null;

      if (!plot) {
        throw new Error('ProtSpace scatterplot was not found');
      }

      await new Promise<void>((resolve, reject) => {
        loader?.addEventListener('data-loaded', () => resolve(), { once: true });
        loader?.addEventListener(
          'data-error',
          (event: Event) => {
            const detail = (event as CustomEvent<{ error?: string; message?: string }>).detail;
            reject(new Error(detail?.error || detail?.message || 'data-error'));
          },
          { once: true },
        );

        const file = new File([new Uint8Array(byteValues)], nextFileName, {
          type: 'application/octet-stream',
        });

        plot.dispatchEvent(
          new CustomEvent('file-dropped', {
            detail: { file },
          }),
        );
      });
    },
    { byteValues: bytes, nextFileName: fileName },
  );
}

/** Assert a single URL query param decodes to `expected` (robust to +/%20/em-dash encoding). */
async function expectUrlParam(
  page: Page,
  key: 'annotation' | 'projection' | 'foo',
  expected: string,
): Promise<void> {
  await expect
    .poll(() => page.evaluate((k) => new URL(window.location.href).searchParams.get(k), key))
    .toBe(expected);
}

// Discover the default demo's annotations/projections once per worker. Names can
// contain spaces/em-dashes and change with demo swaps, so tests derive
// non-default targets at runtime instead of hardcoding them.
test.beforeAll(async ({ browser }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('driver.overviewTour', 'true');
      } catch {
        /* ignore */
      }
    });
    await page.goto('/explore');
    await waitForExploreDataLoad(page);
    const view = await getCurrentView(page);
    demoAnnotations = view.annotations;
    demoDefaultAnnotation = view.annotation ?? view.annotations[0] ?? '';
    demoDefaultProjection = view.projection ?? view.projections[0] ?? '';
    targetAnnotation =
      view.annotations.find((a) => a !== demoDefaultAnnotation) ?? demoDefaultAnnotation;
    targetProjection =
      view.projections.find((p) => p !== demoDefaultProjection) ?? demoDefaultProjection;
    secondAnnotation =
      view.annotations.find((a) => a !== demoDefaultAnnotation && a !== targetAnnotation) ??
      targetAnnotation;
    secondProjection =
      view.projections.find((p) => p !== demoDefaultProjection && p !== targetProjection) ??
      targetProjection;
  } finally {
    await context.close();
  }
});

test.describe('URL-backed explore view state', () => {
  test('keeps a bare explore URL unchanged on first load', async ({ page }) => {
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    const currentView = await getCurrentView(page);

    await expect(page).toHaveURL('http://localhost:8080/explore');
    expect(currentView.annotation).toBeTruthy();
    expect(currentView.projection).toBeTruthy();
    expect(currentView.annotations).toContain(currentView.annotation);
    expect(currentView.projections).toContain(currentView.projection);
  });

  test('applies a valid deep link and preserves it across refresh', async ({ page }) => {
    await page.goto(
      `/explore?annotation=${encodeURIComponent(targetAnnotation)}&projection=${encodeURIComponent(targetProjection)}&foo=1`,
    );
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForView(page, { annotation: targetAnnotation, projection: targetProjection });

    await expectUrlParam(page, 'annotation', targetAnnotation);
    await expectUrlParam(page, 'projection', targetProjection);
    await expect(page).toHaveURL(/foo=1/);

    await page.reload();
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForView(page, { annotation: targetAnnotation, projection: targetProjection });
  });

  test('deep links render the requested view directly without an initial default swap', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const win = window as Window & {
        __controlBarAnnotationAssignments?: string[];
        __controlBarProjectionAssignments?: string[];
      };
      const originalDefine = customElements.define.bind(customElements);

      customElements.define = (name, constructor, options) => {
        if (name === 'protspace-scatterplot') {
          const proto = constructor.prototype as {
            __urlViewStatePatched?: boolean;
          };

          if (!proto.__urlViewStatePatched) {
            proto.__urlViewStatePatched = true;
            const dataDescriptor = Object.getOwnPropertyDescriptor(proto, 'data');

            if (dataDescriptor?.get && dataDescriptor?.set) {
              Object.defineProperty(proto, 'data', {
                configurable: true,
                enumerable: dataDescriptor.enumerable ?? true,
                get: dataDescriptor.get,
                set(value) {
                  win.__controlBarAnnotationAssignments = [];
                  win.__controlBarProjectionAssignments = [];
                  return dataDescriptor.set.call(this, value);
                },
              });
            }
          }
        }

        if (name === 'protspace-control-bar') {
          const proto = constructor.prototype as {
            __urlViewStatePatched?: boolean;
          };

          if (!proto.__urlViewStatePatched) {
            proto.__urlViewStatePatched = true;

            const annotationDescriptor = Object.getOwnPropertyDescriptor(
              proto,
              'selectedAnnotation',
            );
            if (annotationDescriptor?.get && annotationDescriptor?.set) {
              Object.defineProperty(proto, 'selectedAnnotation', {
                configurable: true,
                enumerable: annotationDescriptor.enumerable ?? true,
                get: annotationDescriptor.get,
                set(value) {
                  win.__controlBarAnnotationAssignments ??= [];
                  if (typeof value === 'string') {
                    win.__controlBarAnnotationAssignments.push(value);
                  }
                  return annotationDescriptor.set.call(this, value);
                },
              });
            }

            const projectionDescriptor = Object.getOwnPropertyDescriptor(
              proto,
              'selectedProjection',
            );
            if (projectionDescriptor?.get && projectionDescriptor?.set) {
              Object.defineProperty(proto, 'selectedProjection', {
                configurable: true,
                enumerable: projectionDescriptor.enumerable ?? true,
                get: projectionDescriptor.get,
                set(value) {
                  win.__controlBarProjectionAssignments ??= [];
                  if (typeof value === 'string') {
                    win.__controlBarProjectionAssignments.push(value);
                  }
                  return projectionDescriptor.set.call(this, value);
                },
              });
            }
          }
        }

        return originalDefine(name, constructor, options);
      };
    });

    await page.goto(
      `/explore?annotation=${encodeURIComponent(targetAnnotation)}&projection=${encodeURIComponent(targetProjection)}`,
    );
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForView(page, { annotation: targetAnnotation, projection: targetProjection });

    const assignments = await page.evaluate(() => {
      const win = window as Window & {
        __controlBarAnnotationAssignments?: string[];
        __controlBarProjectionAssignments?: string[];
      };

      return {
        annotations: win.__controlBarAnnotationAssignments ?? [],
        projections: win.__controlBarProjectionAssignments ?? [],
      };
    });

    expect(assignments.annotations.length).toBeGreaterThan(0);
    expect(assignments.projections.length).toBeGreaterThan(0);
    expect(assignments.annotations[0]).toBe(targetAnnotation);
    expect(assignments.projections[0]).toBe(targetProjection);
    expect(assignments.annotations).not.toContain(demoDefaultAnnotation);
    expect(assignments.projections).not.toContain(demoDefaultProjection);
  });

  test('canonicalizes duplicate view params to a single effective pair', async ({ page }) => {
    await page.goto('/explore?seed=baseline');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    const baselineHistoryLength = await page.evaluate(() => history.length);

    await page.goto(
      `/explore?annotation=${encodeURIComponent(targetAnnotation)}&annotation=${encodeURIComponent(secondAnnotation)}&projection=${encodeURIComponent(targetProjection)}&projection=${encodeURIComponent(secondProjection)}&foo=1`,
    );
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForView(page, { annotation: targetAnnotation, projection: targetProjection });

    const params = await page.evaluate(() => {
      const searchParams = new URL(window.location.href).searchParams;
      return {
        annotations: searchParams.getAll('annotation'),
        projections: searchParams.getAll('projection'),
      };
    });

    expect(params.annotations).toEqual([targetAnnotation]);
    expect(params.projections).toEqual([targetProjection]);
    await expect(page).toHaveURL(/foo=1/);
    await expect.poll(() => page.evaluate(() => history.length)).toBe(baselineHistoryLength + 1);

    await page.goBack();
    await expect(page).toHaveURL('http://localhost:8080/explore?seed=baseline');
  });

  test('normalizes fully invalid params while preserving unrelated ones', async ({ page }) => {
    await page.goto('/explore?seed=baseline');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    const baselineHistoryLength = await page.evaluate(() => history.length);

    await page.goto('/explore?annotation=bad_value&projection=bad_projection&foo=1');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    const currentView = await getCurrentView(page);
    expect(currentView.annotation).not.toBe('bad_value');
    expect(currentView.projection).not.toBe('bad_projection');
    await expectUrlParam(page, 'annotation', currentView.annotation ?? '');
    await expectUrlParam(page, 'projection', currentView.projection ?? '');
    await expect(page).toHaveURL(/foo=1/);
    await expect.poll(() => page.evaluate(() => history.length)).toBe(baselineHistoryLength + 1);

    await page.goBack();
    await expect(page).toHaveURL('http://localhost:8080/explore?seed=baseline');
  });

  test('normalizes empty params as invalid values without adding history entries', async ({
    page,
  }) => {
    await page.goto('/explore?seed=baseline');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    const baselineHistoryLength = await page.evaluate(() => history.length);

    await page.goto('/explore?annotation=&projection=%20&foo=1');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    const currentView = await getCurrentView(page);
    await expectUrlParam(page, 'annotation', currentView.annotation ?? '');
    await expectUrlParam(page, 'projection', currentView.projection ?? '');
    await expect(page).toHaveURL(/foo=1/);
    await expect.poll(() => page.evaluate(() => history.length)).toBe(baselineHistoryLength + 1);

    await page.goBack();
    await expect(page).toHaveURL('http://localhost:8080/explore?seed=baseline');
  });

  test('preserves valid keys when only one param is invalid', async ({ page }) => {
    await page.goto(
      `/explore?annotation=${encodeURIComponent(targetAnnotation)}&projection=bad_projection`,
    );
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForView(page, { annotation: targetAnnotation });

    const currentView = await getCurrentView(page);
    expect(currentView.annotation).toBe(targetAnnotation);
    expect(currentView.projection).not.toBe('bad_projection');
    await expectUrlParam(page, 'annotation', targetAnnotation);
    await expectUrlParam(page, 'projection', currentView.projection ?? '');
  });

  test('pushes one history entry for a user change and back/forward restores in one step', async ({
    page,
  }) => {
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForExploreInteractionReady(page);

    const initialView = await getCurrentView(page);
    const nextAnnotation = initialView.annotations.find(
      (annotation) => annotation !== initialView.annotation,
    );

    expect(nextAnnotation).toBeTruthy();

    const initialHistoryLength = await page.evaluate(() => history.length);
    const stability = await captureExploreViewStability(page, async () => {
      await selectAnnotation(page, nextAnnotation!);
      await waitForView(page, { annotation: nextAnnotation! });

      const afterChangeHistoryLength = await page.evaluate(() => history.length);
      expect(afterChangeHistoryLength).toBe(initialHistoryLength + 1);

      await page.goBack();
      await waitForView(page, {
        annotation: initialView.annotation ?? undefined,
        projection: initialView.projection ?? undefined,
      });

      await page.goForward();
      await waitForView(page, {
        annotation: nextAnnotation!,
        projection: initialView.projection ?? undefined,
      });
    });

    expect(stability.samePlot).toBe(true);
    expect(stability.sameLoader).toBe(true);
    expect(stability.navigationEntries).toBe(stability.initialNavigationEntries);
    expect(stability.loadStarts).toBe(0);
    expect(stability.overlayShows).toBe(0);
    expect(stability.overlayPresent).toBe(false);
  });

  test('user-driven projection changes push URL state and restore on back/forward', async ({
    page,
  }) => {
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    const initialView = await getCurrentView(page);
    const nextProjection = initialView.projections.find(
      (projection) => projection !== initialView.projection,
    );

    test.skip(!nextProjection, 'The current dataset exposes only one projection.');

    const initialHistoryLength = await page.evaluate(() => history.length);
    await selectProjection(page, nextProjection!);
    await waitForView(page, { projection: nextProjection! });
    await expectUrlParam(page, 'projection', nextProjection!);
    const afterChangeHistoryLength = await page.evaluate(() => history.length);
    expect(afterChangeHistoryLength).toBe(initialHistoryLength + 1);

    await page.goBack();
    await waitForView(page, { projection: initialView.projection ?? undefined });

    await page.goForward();
    await waitForView(page, { projection: nextProjection! });
  });

  test('preserves unrelated params when a user-driven change updates the URL', async ({ page }) => {
    await page.goto('/explore?foo=1');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    const initialView = await getCurrentView(page);
    const nextAnnotation = initialView.annotations.find(
      (annotation) => annotation !== initialView.annotation,
    );

    expect(nextAnnotation).toBeTruthy();

    await selectAnnotation(page, nextAnnotation!);
    await waitForView(page, { annotation: nextAnnotation! });

    const currentView = await getCurrentView(page);
    await expect(page).toHaveURL(/foo=1/);
    await expectUrlParam(page, 'annotation', currentView.annotation ?? '');
    await expectUrlParam(page, 'projection', currentView.projection ?? '');
  });

  test('annotation changes update history without reloading the page instance', async ({
    page,
  }) => {
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForExploreInteractionReady(page);

    const initialView = await getCurrentView(page);
    const nextAnnotation = initialView.annotations.find(
      (annotation) => annotation !== initialView.annotation,
    );

    expect(nextAnnotation).toBeTruthy();

    const after = await captureExploreViewStability(page, async () => {
      await selectAnnotation(page, nextAnnotation!);
      await waitForView(page, { annotation: nextAnnotation! });
    });

    expect(after.samePlot).toBe(true);
    expect(after.sameLoader).toBe(true);
    expect(after.navigationEntries).toBe(after.initialNavigationEntries);
    expect(after.loadStarts).toBe(0);
    expect(after.overlayShows).toBe(0);
    expect(after.overlayPresent).toBe(false);
  });

  test('annotation and projection changes do not trigger the ProtSpace loading splash again', async ({
    page,
  }) => {
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForExploreInteractionReady(page);

    const initialView = await getCurrentView(page);
    const nextAnnotation = initialView.annotations.find(
      (annotation) => annotation !== initialView.annotation,
    );
    const nextProjection = initialView.projections.find(
      (projection) => projection !== initialView.projection,
    );

    expect(nextAnnotation).toBeTruthy();
    test.skip(!nextProjection, 'The current dataset exposes only one projection.');

    const postInteraction = await captureExploreViewStability(page, async () => {
      await selectAnnotation(page, nextAnnotation!);
      await waitForView(page, { annotation: nextAnnotation! });
      await selectProjection(page, nextProjection!);
      await waitForView(page, { projection: nextProjection! });
    });

    expect(postInteraction.loadStarts).toBe(0);
    expect(postInteraction.overlayShows).toBe(0);
    expect(postInteraction.overlayPresent).toBe(false);
  });

  test('normalizes stale params after switching to a dataset with different annotations', async ({
    page,
  }) => {
    await page.goto(
      `/explore?annotation=${encodeURIComponent(targetAnnotation)}&projection=${encodeURIComponent(targetProjection)}`,
    );
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForView(page, { annotation: targetAnnotation, projection: targetProjection });
    const historyLengthBeforeDatasetSwitch = await page.evaluate(() => history.length);

    await loadBundleFromPath(
      page,
      RAW_NUMERIC_BUNDLE_FIXTURE_PATH,
      'raw_numeric_test.parquetbundle',
    );
    await waitForView(page, { annotation: 'length' });

    const currentView = await getCurrentView(page);
    expect(currentView.annotation).toBe('length');
    await expect(page).toHaveURL(/annotation=length/);
    await expectUrlParam(page, 'projection', currentView.projection ?? '');
    await expect
      .poll(() => page.evaluate(() => history.length))
      .toBe(historyLengthBeforeDatasetSwitch);
  });

  test('queues back-to-back loads so the later dataset wins', async ({ page }) => {
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await queueUserLoads(page, RAW_NUMERIC_BUNDLE_FIXTURE_PATH, 'raw_numeric_test.parquetbundle');
    await waitForView(page, {
      annotation: demoDefaultAnnotation,
      projection: demoDefaultProjection,
    });

    const currentView = await getCurrentView(page);
    expect(currentView.annotation).toBe(demoDefaultAnnotation);
    expect(currentView.projection).toBe(demoDefaultProjection);
    // The later (demo) load wins: the view exposes the demo's exact annotation
    // set, not the queued fixture's.
    expect(currentView.annotations).toEqual(demoAnnotations);
    await expect(page).toHaveURL(/\/explore$/);
  });

  test('scatterplot file-drop imports still flow through the runtime', async ({ page }) => {
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await dropBundleOnScatterplot(
      page,
      RAW_NUMERIC_BUNDLE_FIXTURE_PATH,
      'raw_numeric_test.parquetbundle',
    );
    await waitForView(page, { annotation: 'length' });

    const currentView = await getCurrentView(page);
    expect(currentView.annotation).toBe('length');
    expect(currentView.annotations).toContain('length');
    expect(currentView.annotations).not.toContain(demoDefaultAnnotation);
  });

  test('restores the OPFS dataset and validates params against it on reload', async ({ page }) => {
    // OPFS persist + reload + restore means several full data loads; under
    // parallel CPU load this can exceed the default timeout, so allow more time.
    test.slow();
    await page.goto('/explore');
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    // navigator.storage only exists after navigation, so check OPFS support here.
    test.skip(
      !(await supportsExplorePersistedDataset(page)),
      'OPFS is unavailable in this browser.',
    );

    await loadBundleFromPath(
      page,
      RAW_NUMERIC_BUNDLE_FIXTURE_PATH,
      'raw_numeric_test.parquetbundle',
    );
    await waitForView(page, { annotation: 'length' });
    await waitForPersistedExploreDataset(page);

    const importedView = await getCurrentView(page);
    await page.goto(
      `/explore?annotation=length&projection=${encodeURIComponent(importedView.projection ?? '')}&foo=1`,
    );
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForView(page, {
      annotation: 'length',
      projection: importedView.projection ?? undefined,
    });

    await expect(page).toHaveURL(/annotation=length/);
    await expect(page).toHaveURL(/foo=1/);
  });

  test('resets hidden legend state when back navigation changes annotation via URL', async ({
    page,
  }) => {
    await page.goto(
      `/explore?annotation=${encodeURIComponent(targetAnnotation)}&projection=${encodeURIComponent(targetProjection)}`,
    );
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);
    await waitForView(page, { annotation: targetAnnotation, projection: targetProjection });

    const currentView = await getCurrentView(page);
    const nextAnnotation = currentView.annotations.find(
      (annotation) => annotation !== targetAnnotation,
    );
    expect(nextAnnotation).toBeTruthy();

    const firstLegendValue = await getFirstLegendItemValue(page);
    await clickLegendItem(page, firstLegendValue);
    await expect.poll(() => isLegendItemHidden(page, firstLegendValue)).toBe(true);

    await selectAnnotation(page, nextAnnotation!);
    await waitForView(page, { annotation: nextAnnotation! });

    await page.goBack();
    await waitForView(page, { annotation: targetAnnotation, projection: targetProjection });
    await expect.poll(() => isLegendItemHidden(page, firstLegendValue)).toBe(false);
  });
});
