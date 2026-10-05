import { type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { EXAMPLE_MANIFEST } from '../../apps/web/src/explore/example-manifest';
import { exampleServedPath } from '../../apps/web/src/explore/example-served-path';
import { dismissProductTour, waitForDataLoad } from './helpers';

/**
 * Shared setup for the EAT documentation captures.
 *
 * Every other capture in this folder runs against the app's built-in demo
 * dataset, which carries no transferred annotations. These open the Import
 * menu's EAT example, `three-finger-toxins`, the one `docs/explore/eat.md`
 * sends readers to: 1,089 snake three-finger toxins whose unreviewed and
 * held-out members carry a `toxin_class` borrowed from the nearest reviewed
 * toxin, plus a statistics part.
 *
 * The file is a release asset, not in the repository: `pnpm examples:fetch`
 * puts it in `apps/web/public/examples/`, where the dev server serves it. The
 * E2E fixture `example_role_eat_811` is no stand-in: its toxin classes are the
 * venom fixture's EC numbers relabelled.
 */
const EAT_EXAMPLE_ID = 'three-finger-toxins';
const EAT_EXAMPLE = EXAMPLE_MANIFEST.examples[EAT_EXAMPLE_ID];

const EAT_EXAMPLE_BUNDLE = path.join(
  __dirname,
  '../../apps/web/public',
  exampleServedPath(EAT_EXAMPLE),
);

/** The annotation the captures colour by: the one the example opens on. */
export const DEMO_ANNOTATION = 'toxin_class';

/**
 * Open the three-finger toxins example the way its `?dataset=` link does, on
 * the curated view the Import menu opens.
 *
 * Opening it by link rather than through the file input keeps the demo from
 * loading at all: the file-input route had to abort the demo's fetch, and the
 * app then showed its "Couldn't load" toast in every capture.
 */
export async function loadEatExampleBundle(page: Page): Promise<void> {
  if (!fs.existsSync(EAT_EXAMPLE_BUNDLE)) {
    // Without the local file a dev build falls back to protspace.app, which
    // serves only what is deployed there.
    throw new Error(
      `The EAT captures need ${path.relative(process.cwd(), EAT_EXAMPLE_BUNDLE)}: ` +
        'run `pnpm examples:fetch` first.',
    );
  }
  await page.goto(`/explore?dataset=${EAT_EXAMPLE_ID}`);
  await dismissProductTour(page);
  await waitForDataLoad(page, { expectedProteinCount: EAT_EXAMPLE.proteins });
}

interface ProvenanceDemoPair {
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
 * that still sits inside `maxDependants`, keeping the fan-out legible and
 * complete: the busiest `toxin_class` source in the three-finger toxins lends
 * to 32 proteins, more than the renderer draws.
 *
 * `maxDependants` defaults to the renderer's own fan-out cap
 * (`MAX_PROVENANCE_CONNECTORS` in `apps/web/src/explore/eat-provenance.ts`).
 * Above it the extra dependants are dropped without any on-screen notice, so
 * the GIF would claim a fan-out that is silently truncated.
 *
 * Sources that themselves carry a prediction are excluded: the resolver checks
 * the clicked protein's own predicted cell first, so clicking one draws its
 * single source line instead of the fan-out the capture is meant to show.
 *
 * Both endpoints must also stand `clearancePx` apart from every other marker
 * (by default the plot's smallest hit radius, `HIT_RADIUS_MIN_PX` in
 * `scatter-plot.ts`). A click selects the nearest marker, and the three-finger
 * toxins' islands pack near-identical toxins a pixel or two apart, so a click
 * meant for a crowded source can select its neighbour and draw the wrong
 * connectors.
 */
export async function pickProvenanceDemoPair(
  page: Page,
  annotation: string,
  maxDependants = 20,
  clearancePx = 4,
): Promise<ProvenanceDemoPair> {
  const pair = await page.evaluate(
    ({ key, cap, clearance }) => {
      const plot = document.querySelector('protspace-scatterplot') as
        | (Element & {
            data?: {
              protein_ids: string[];
              annotation_predicted?: Record<
                string,
                Array<{ source?: string; confidence?: number } | null>
              >;
            };
            getProteinClientPosition?(proteinId: string): { x: number; y: number } | null;
          })
        | null;
      const ids = plot?.data?.protein_ids;
      const cells = plot?.data?.annotation_predicted?.[key];
      if (!ids || !cells) return null;

      const positions = ids.map((id) => plot?.getProteinClientPosition?.(id) ?? null);
      const standsClear = (index: number | undefined): boolean => {
        const here = index === undefined ? null : positions[index];
        if (!here) return false;
        return positions.every(
          (other, j) =>
            j === index || !other || Math.hypot(other.x - here.x, other.y - here.y) > clearance,
        );
      };

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
      for (const [source, targets] of ranked) {
        if (targets.length > cap || !standsClear(indexById.get(source))) continue;
        const target = targets.find((id) => standsClear(indexById.get(id)));
        if (target) return { source, target, dependantCount: targets.length };
      }
      return null;
    },
    { key: annotation, cap: maxDependants, clearance: clearancePx },
  );

  if (!pair) {
    throw new Error(
      `No provenance pair found for annotation "${annotation}" in the EAT example bundle ` +
        `(needs a non-transferred source with 2-${maxDependants} dependants, it and one ` +
        `of them ${clearancePx} px clear of any other marker)`,
    );
  }
  return pair;
}
