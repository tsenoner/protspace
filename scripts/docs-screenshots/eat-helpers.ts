import { type Page } from '@playwright/test';
import * as path from 'path';
import { dismissProductTour, waitForDataLoad } from './helpers';

/**
 * Shared setup for the EAT documentation captures.
 *
 * Every other capture in this folder runs against the app's built-in demo
 * dataset, which carries no transferred annotations. EAT needs a bundle that
 * actually has `*__pred_*` columns, so these captures load the shipped venom
 * bundle by hand: 811 proteins, `ec` with 384 transferred values and
 * `protein_families` with 14, plus a statistics part.
 */
const VENOM_EAT_BUNDLE = path.join(
  __dirname,
  '../../apps/web/public/data/venom_eat_stats.parquetbundle',
);

/** Protein count in the venom bundle; the load gate waits for exactly this. */
const VENOM_PROTEIN_COUNT = 811;

/** The annotation the captures colour by. Highest transfer coverage in the bundle. */
export const DEMO_ANNOTATION = 'ec';

/**
 * Load the venom EAT bundle through the real file input.
 *
 * The default dataset fetch is aborted first: letting it resolve would render
 * one dataset, then swap to another mid-capture, and the video would show the
 * transition. Aborting keeps the drop zone empty until we feed it the bundle.
 */
export async function loadVenomEatBundle(page: Page): Promise<void> {
  await page.route('**/data.parquetbundle', (route) => route.abort());
  await page.goto('/explore');
  await dismissProductTour(page);

  await page.waitForFunction(() => {
    const loader = document.querySelector('protspace-data-loader') as
      | (Element & { loadFromFile?: (file: File) => Promise<void> })
      | null;
    return typeof loader?.loadFromFile === 'function';
  });

  await page.locator('protspace-data-loader input[type="file"]').setInputFiles(VENOM_EAT_BUNDLE);
  await waitForDataLoad(page, { expectedProteinCount: VENOM_PROTEIN_COUNT });
}

export interface ProvenanceDemoPair {
  /** A reference protein other proteins borrowed from. */
  source: string;
  /** One protein that borrowed from `source`. */
  target: string;
  /** How many proteins borrowed from `source` in total. */
  dependantCount: number;
}

/**
 * Choose a source/target pair to demonstrate provenance connectors with.
 *
 * Derived at capture time rather than hard-coded, so a regenerated bundle does
 * not silently produce an empty GIF. Picks the source with the most dependants
 * that still sits inside `maxDependants`, keeping the fan-out legible: the
 * busiest source in the venom bundle has over 300 dependants, which renders as
 * an unreadable starburst.
 *
 * `maxDependants` defaults to the renderer's own fan-out cap
 * (`MAX_PROVENANCE_CONNECTORS` in `apps/web/src/explore/eat-provenance.ts`).
 * Above it the extra dependants are dropped without any on-screen notice, so
 * the GIF would claim a fan-out that is silently truncated.
 *
 * Sources that themselves carry a prediction are excluded: the resolver checks
 * the clicked protein's own predicted cell first, so clicking one draws its
 * single source line instead of the fan-out the capture is meant to show.
 */
export async function pickProvenanceDemoPair(
  page: Page,
  annotation: string,
  maxDependants = 20,
): Promise<ProvenanceDemoPair> {
  const pair = await page.evaluate(
    ({ key, cap }) => {
      const plot = document.querySelector('protspace-scatterplot') as
        | (Element & {
            data?: {
              protein_ids: string[];
              annotation_predicted?: Record<
                string,
                Array<{ source?: string; confidence?: number } | null>
              >;
            };
          })
        | null;
      const ids = plot?.data?.protein_ids;
      const cells = plot?.data?.annotation_predicted?.[key];
      if (!ids || !cells) return null;

      const indexById = new Map(ids.map((id, index) => [id, index]));
      const dependants = new Map<string, string[]>();
      for (let i = 0; i < cells.length; i++) {
        const source = cells[i]?.source;
        if (!source) continue;
        const list = dependants.get(source);
        if (list) list.push(ids[i]);
        else dependants.set(source, [ids[i]]);
      }

      const ranked = Array.from(dependants.entries())
        .filter(([source, targets]) => {
          if (targets.length < 2) return false;
          const sourceIndex = indexById.get(source);
          // In the dataset, and not itself a transferred protein.
          return sourceIndex !== undefined && !cells[sourceIndex];
        })
        .sort((a, b) => b[1].length - a[1].length);
      const chosen = ranked.find(([, targets]) => targets.length <= cap);
      if (!chosen) return null;

      return { source: chosen[0], target: chosen[1][0], dependantCount: chosen[1].length };
    },
    { key: annotation, cap: maxDependants },
  );

  if (!pair) {
    throw new Error(
      `No provenance pair found for annotation "${annotation}" in the venom bundle ` +
        `(needs a non-transferred source with 2-${maxDependants} dependants)`,
    );
  }
  return pair;
}
