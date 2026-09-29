import type { Page } from '@playwright/test';
import { findExampleDataset, type ExampleDataset } from '../../src/explore/example-datasets';
import { PE1_40026_FIXTURE, PHOSPHATASE_1587_FIXTURE, TOXPROT_5181_FIXTURE } from './fixtures';

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
 */
const EXAMPLE_FIXTURES = {
  /** A small example: `phylum`, `protein_existence`, `length_fixed`, `length_quantile`. */
  small: { id: '5K', fixture: TOXPROT_5181_FIXTURE, count: 5181 },
  /** A second small example with another count and `ec`/`pfam`, as the demo has. */
  other: { id: 'phosphatase', fixture: PHOSPHATASE_1587_FIXTURE, count: 1587 },
  /** An example whose decode takes long enough for a Back to race it. */
  slow: { id: '40K', fixture: PE1_40026_FIXTURE, count: 40026 },
} as const;

type ExampleRole = keyof typeof EXAMPLE_FIXTURES;

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

function catalogEntry(id: string): ExampleDataset {
  const entry = findExampleDataset(id);
  if (!entry) {
    throw new Error(`The catalog has no "${id}" example; update EXAMPLE_FIXTURES.`);
  }
  return entry;
}

/** The example that plays `role` in the suite. */
export function e2eExample(role: ExampleRole): E2EExample {
  const { id, count } = EXAMPLE_FIXTURES[role];
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
  for (const { id, fixture } of Object.values(EXAMPLE_FIXTURES)) {
    await page.route(exampleBundleGlob(catalogEntry(id)), (route) =>
      route.fulfill({ path: fixture, contentType: 'application/octet-stream' }),
    );
  }
}
