import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  dismissTourIfPresent,
  waitForExploreDataLoad,
  getFirstLegendItemValue,
} from './helpers/explore';

const SPEC_DIR = path.dirname(new URL(import.meta.url).pathname);
const SPROT_FIXTURE = path.resolve(SPEC_DIR, 'fixtures/sprot_50.parquetbundle');
const fixtureAvailable = fs.existsSync(SPROT_FIXTURE);

test.describe('large bundle load (sprot_50, 573k proteins)', () => {
  test.skip(
    !fixtureAvailable,
    'Fixture sprot_50.parquetbundle not present; copy from protspace/data/other/sprot/.',
  );
  test.setTimeout(120_000);

  test('loads sprot_50 without OOM and renders the legend', async ({ page }) => {
    let pageCrashed = false;
    const consoleErrors: string[] = [];

    page.on('crash', () => {
      pageCrashed = true;
    });

    // Third-party hostnames whose console errors we expect on dev-mode loads.
    // We match the hostname in either the message text or msg.location().url
    // because Chrome reports CORS preflight failures with the *calling page*
    // as the source (URL match misses) but the blocked URL appears verbatim
    // in the message text (text match catches it). Resource-load errors flip
    // the polarity — both checks together are robust to either flavor.
    const IGNORED_HOSTS = ['cloudflareinsights.com', 'cloudflare-insights.com'];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const sourceUrl = msg.location()?.url ?? '';

      // 1) Third-party analytics — match the hostname in URL OR message text.
      if (IGNORED_HOSTS.some((host) => sourceUrl.includes(host) || text.includes(host))) return;
      // 2) Lit dev-mode banner — text-stable across versions.
      if (text.startsWith('Lit is in dev mode')) return;
      consoleErrors.push(`${text}${sourceUrl ? `  (from ${sourceUrl})` : ''}`);
    });

    await page.goto('/explore');
    await page.evaluate(() => localStorage.setItem('driver.overviewTour', 'true'));
    await dismissTourIfPresent(page);

    // Open the import menu and set the file via the file input inside the data loader.
    await page.locator('protspace-control-bar [data-driver-id="import"] .dropdown-trigger').click();
    await expect(
      page.locator('protspace-control-bar [data-driver-id="import-own-dataset"]'),
    ).toBeVisible();

    await page
      .locator('protspace-data-loader')
      .locator('input[type="file"]')
      .setInputFiles(SPROT_FIXTURE);

    await waitForExploreDataLoad(page, 90_000);

    // Verify page did not OOM-crash (Aw, Snap = error code 5).
    expect(pageCrashed, 'Page crashed (OOM) during or after loading sprot_50').toBe(false);
    expect(consoleErrors).toEqual([]);

    // Verify all 573,649 proteins loaded (evaluate only the count, not the full array).
    const proteinCount = await page.evaluate(() => {
      const plot = document.querySelector('#myPlot') as
        | (Element & { data?: { protein_ids?: { length?: number } } })
        | null;
      return plot?.data?.protein_ids?.length ?? 0;
    });
    expect(proteinCount).toBe(573_649);

    // The legend must be populated (not just upgraded) — :host { display: flex }
    // would let toBeVisible() pass on an empty legend, so check for a real item.
    const initialLegendItem = await getFirstLegendItemValue(page);
    expect(initialLegendItem.length, 'legend item value should be non-empty').toBeGreaterThan(0);

    // Switch the selected annotation across categorical (kingdom),
    // multi-valued (pfam), high-card (gene_name), and numeric (annotation_score)
    // and verify the legend stays populated after each switch.
    for (const annotation of ['kingdom', 'pfam', 'gene_name', 'annotation_score']) {
      await page.evaluate((name) => {
        const plot = document.querySelector('#myPlot') as
          | (Element & { selectedAnnotation?: string })
          | null;
        if (plot) plot.selectedAnnotation = name;
      }, annotation);

      await page.waitForFunction(
        (name) => {
          const plot = document.querySelector('#myPlot') as
            | (Element & { selectedAnnotation?: string })
            | null;
          return plot?.selectedAnnotation === name;
        },
        annotation,
        { timeout: 10_000, polling: 200 },
      );

      const legendItem = await getFirstLegendItemValue(page);
      expect(
        legendItem.length,
        `legend item value should be non-empty after switching to ${annotation}`,
      ).toBeGreaterThan(0);

      // After switching to gene_name (the annotation that exercises the
      // tooltip header), synthesize a hover and verify the buildTooltipView
      // path renders non-empty content into the tooltip element.
      if (annotation === 'gene_name') {
        const tooltipText = await page.evaluate(() => {
          const plot = document.querySelector('protspace-scatterplot') as
            | (HTMLElement & {
                // _plotData is a columnar PlotData; build a boxed PlotDataPoint for slot 0.
                _plotData?: {
                  length: number;
                  xs: ArrayLike<number>;
                  ys: ArrayLike<number>;
                  zs: ArrayLike<number> | null;
                  originalIndices: ArrayLike<number> | null;
                  proteinIds: string[];
                };
                _handleMouseOver?: (evt: MouseEvent, point: unknown) => void;
                shadowRoot: ShadowRoot | null;
              })
            | null;
          const pd = plot?._plotData;
          if (!pd?.length) return null;
          const slot = 0;
          const originalIndex = pd.originalIndices ? pd.originalIndices[slot] : slot;
          const point: { id: string; x: number; y: number; originalIndex: number; z?: number } = {
            id: pd.proteinIds[originalIndex],
            x: pd.xs[slot],
            y: pd.ys[slot],
            originalIndex,
          };
          if (pd.zs) point.z = pd.zs[slot];
          const rect = plot.getBoundingClientRect();
          const evt = new MouseEvent('mouseover', {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
          });
          plot._handleMouseOver?.(evt, point);
          const tooltip = plot.shadowRoot?.querySelector('protspace-protein-tooltip') as
            | (HTMLElement & { shadowRoot: ShadowRoot | null })
            | null;
          return tooltip?.shadowRoot?.textContent ?? null;
        });

        // The tooltip element is mounted lazily on first hover via the
        // _tooltipData state; if Lit hasn't flushed yet, give it a tick.
        if (!tooltipText) {
          await page.waitForFunction(
            () => {
              const plot = document.querySelector('protspace-scatterplot') as
                | (HTMLElement & { shadowRoot: ShadowRoot | null })
                | null;
              const tooltip = plot?.shadowRoot?.querySelector('protspace-protein-tooltip') as
                | (HTMLElement & { shadowRoot: ShadowRoot | null })
                | null;
              const text = tooltip?.shadowRoot?.textContent ?? '';
              return text.trim().length > 0;
            },
            undefined,
            { timeout: 5_000, polling: 100 },
          );
        }

        const finalTooltipText = await page.evaluate(() => {
          const plot = document.querySelector('protspace-scatterplot') as
            | (HTMLElement & { shadowRoot: ShadowRoot | null })
            | null;
          const tooltip = plot?.shadowRoot?.querySelector('protspace-protein-tooltip') as
            | (HTMLElement & { shadowRoot: ShadowRoot | null })
            | null;
          return tooltip?.shadowRoot?.textContent ?? null;
        });

        expect(finalTooltipText, 'tooltip should render after hover').toBeTruthy();
        expect(
          finalTooltipText!.trim().length,
          'tooltip should have non-empty text',
        ).toBeGreaterThan(0);
      }
    }
  });
});
