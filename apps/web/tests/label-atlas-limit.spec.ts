import { expect, test, type Page } from '@playwright/test';
import { dismissTourIfPresent, waitForExploreDataLoad } from './helpers/explore';
import {
  distinctCanvasColors,
  simulateTextureLimit,
  simulatedGlStats,
} from './helpers/gl-simulation';

/**
 * The label atlas against a device whose texture limit it cannot fit.
 *
 * jsdom has no WebGL, so this is the only layer that exercises the real
 * renderer. But a limit *stub* alone proves nothing: `gl.MAX_TEXTURE_SIZE` only
 * changes what the app believes, while the actual driver on this machine happily
 * accepts the allocation. So the driver's refusal is simulated too —
 * `texImage2D` past the simulated limit does not call through and arms
 * `getError`, exactly as a real driver does: no exception, no unwinding, the
 * texture left unallocated.
 *
 * That simulation is what makes the assertion meaningful. The reported failure
 * is silent — nothing in the app called `gl.getError()` — so "no console errors"
 * would pass on the broken code too. What the test asserts instead is that the
 * renderer never *issues* an allocation the device would refuse.
 *
 * The demo dataset is ~7.8K proteins, so its atlas is 2048x31 — no realistic
 * limit forces a stride reduction at that size. This spec therefore covers the
 * "no atlas fits at all" path; the reduced-stride path needs the 573K fixture
 * and lives in load-large-bundle.spec.ts.
 */

// A multi-value annotation in the shipped demo dataset, so the atlas is actually
// in play. `cath` and `superfamily` are the others.
const MULTI_VALUE_ANNOTATION = 'keyword';

/**
 * One texel below the narrowest atlas width (2048), so no atlas layout fits and
 * the renderer must allocate none. The broken code ignored the limit entirely
 * and issued 2048 x 31, which this simulated driver refuses.
 *
 * Deliberately not something far lower like 1024: the simulation intercepts
 * *every* texture in the page, and the renderer's own gamma-pipeline colour
 * target is allocated at the plot canvas's physical size (`framebuffer.ts`). A
 * limit under that size would record it as a refusal the atlas work never
 * caused, coupling these assertions to the viewport and the sidebar's width.
 */
const NO_ATLAS_FITS_LIMIT = 2047;

test.describe('label atlas on a device that cannot hold it', () => {
  test('never issues an allocation the device would refuse', async ({ page }) => {
    await simulateTextureLimit(page, NO_ATLAS_FITS_LIMIT);

    await page.goto(`/explore?annotation=${MULTI_VALUE_ANNOTATION}`);
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    const stats = await simulatedGlStats(page);
    expect(
      stats.refusedAllocations,
      `renderer issued texture allocations the device refuses: ${JSON.stringify(stats.refusedAllocations)}`,
    ).toEqual([]);
    // The permanent half: once an allocation is refused, every later update
    // targets storage that does not exist.
    expect(stats.refusedUpdates).toBe(0);
  });

  test('still draws every point, in colour rather than black', async ({ page }) => {
    await simulateTextureLimit(page, NO_ATLAS_FITS_LIMIT);

    await page.goto(`/explore?annotation=${MULTI_VALUE_ANNOTATION}`);
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    const proteinCount = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as
        | (Element & { data?: { protein_ids?: { length?: number } } })
        | null;
      return plot?.data?.protein_ids?.length ?? 0;
    });
    expect(proteinCount).toBeGreaterThan(0);

    // Fidelity degrades; coverage does not. Markers fall back to their dominant
    // colour, which is what the legend shows — never the solid black an
    // unallocated atlas produced.
    const colors = await distinctCanvasColors(page);
    expect(colors.length).toBeGreaterThan(1);
    expect(colors.every((c) => c === '0,0,0')).toBe(false);
  });

  test('tells the user that marker fidelity was reduced', async ({ page }) => {
    await simulateTextureLimit(page, NO_ATLAS_FITS_LIMIT);

    await page.goto(`/explore?annotation=${MULTI_VALUE_ANNOTATION}`);
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    await expect(page.getByText('Rendering quality reduced.')).toBeVisible({ timeout: 15_000 });
  });

  test('is inert on a device with ample limits', async ({ page }) => {
    // Same simulation, a limit nothing reaches: the atlas allocates normally and
    // no refusal is recorded, so the simulation itself cannot be what fails the
    // tests above.
    await simulateTextureLimit(page, 8192);

    await page.goto(`/explore?annotation=${MULTI_VALUE_ANNOTATION}`);
    await dismissTourIfPresent(page);
    await waitForExploreDataLoad(page);

    const stats = await simulatedGlStats(page);
    expect(stats.refusedAllocations).toEqual([]);
    expect(stats.refusedUpdates).toBe(0);
    await expect(page.getByText('Rendering quality reduced.')).toHaveCount(0);
  });
});
