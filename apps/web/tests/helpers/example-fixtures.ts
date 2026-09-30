import type { Page } from '@playwright/test';
import {
  FINAL_CATALOG_IS_LIVE,
  findExampleDataset,
  type ExampleDataset,
} from '../../src/explore/example-datasets';
import {
  ROLE_EAT_FIXTURE,
  ROLE_OTHER_FIXTURE,
  ROLE_SLOW_FIXTURE,
  ROLE_SMALL_FIXTURE,
} from './fixtures';

/**
 * The catalog examples the E2E suite loads, by the part each plays in it, and
 * the fixture each is served from.
 *
 * The suite tests the Import menu, the deep link and their history and race
 * mechanics, not what an example holds, so every example it loads is routed to
 * a pinned fixture (`serveExampleFixtures`) and never downloaded. Each fixture
 * holds its entry's `defaultView` names, so the curated view resolves without a
 * drift warning. When the catalog changes, only this table does: the scenarios
 * name roles, and the annotation names and counts they assert belong to the
 * fixtures.
 *
 * Until the catalog swap a role stands for an interim example (`interimId`),
 * and from then on for a final one (`id`), picked by `FINAL_CATALOG_IS_LIVE`.
 * Its fixture (`apps/web/tests/fixtures/derive-example-role-fixtures.py`)
 * holds both examples' view names, so the suite runs unchanged on either
 * catalog. The cleanup after the swap drops `interimId`.
 */
const EXAMPLE_FIXTURES = {
  /**
   * A small example: `phylum`, `protein_existence`, `length_fixed`,
   * `length_quantile`, and no `ec`.
   */
  small: { id: 'human-fly', interimId: '5K', fixture: ROLE_SMALL_FIXTURE, count: 5181 },
  /** A second small example with another count and `ec`/`pfam`, as the demo has. */
  other: {
    id: 'beta-lactamase',
    interimId: 'phosphatase',
    fixture: ROLE_OTHER_FIXTURE,
    count: 1587,
  },
  /** An example whose decode takes long enough for a Back to race it; no `phylum`. */
  slow: { id: 'swissprot', interimId: '40K', fixture: ROLE_SLOW_FIXTURE, count: 40026 },
  /**
   * The EAT example: its curated annotation carries transferred values, and its
   * bundle stores an EAT reliability threshold of 0.5.
   */
  eat: {
    id: 'three-finger-toxins',
    interimId: 'venom_eat_stats',
    fixture: ROLE_EAT_FIXTURE,
    count: 811,
  },
} as const;

type ExampleRole = keyof typeof EXAMPLE_FIXTURES;

/** The EAT reliability threshold the eat role's fixture stores in its settings. */
export const EAT_ROLE_BUNDLED_THRESHOLD = 0.5;

/** A routed example: its catalog entry, and what its fixture holds. */
interface E2EExample {
  id: string;
  entry: ExampleDataset;
  count: number;
  /** Matches the example's bundle request (its catalog `url`). */
  glob: string;
}

/** The glob of an example's bundle request, from its catalog `url`. */
export const exampleBundleGlob = (entry: ExampleDataset) => `**/${entry.url.replace(/^\.\//, '')}`;

/** The catalog id a role stands for in the catalog the app serves. */
function roleId(role: (typeof EXAMPLE_FIXTURES)[ExampleRole]): string {
  return FINAL_CATALOG_IS_LIVE ? role.id : role.interimId;
}

function catalogEntry(id: string): ExampleDataset {
  const entry = findExampleDataset(id);
  if (!entry) {
    throw new Error(`The catalog has no "${id}" example; update EXAMPLE_FIXTURES.`);
  }
  return entry;
}

/** The example that plays `role` in the suite. */
export function e2eExample(role: ExampleRole): E2EExample {
  const { count } = EXAMPLE_FIXTURES[role];
  const id = roleId(EXAMPLE_FIXTURES[role]);
  const entry = catalogEntry(id);
  return { id, entry, count, glob: exampleBundleGlob(entry) };
}

/**
 * Serves every example in the table from its fixture, and refuses protspace.app's
 * copies, which a development build would otherwise fall back to for a
 * release-hosted example with no local file. Routes a scenario adds later take
 * precedence, and a handler that wants the fixture after all (a held request)
 * passes the request on with `route.fallback()`.
 */
export async function serveExampleFixtures(page: Page): Promise<void> {
  await page.route('https://protspace.app/examples/**', (route) => route.abort());
  for (const role of Object.values(EXAMPLE_FIXTURES)) {
    await page.route(exampleBundleGlob(catalogEntry(roleId(role))), (route) =>
      route.fulfill({ path: role.fixture, contentType: 'application/octet-stream' }),
    );
  }
}
