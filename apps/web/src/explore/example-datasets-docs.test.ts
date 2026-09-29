import { describe, expect, it } from 'vitest';
import { EXAMPLE_DETAILS, INTERIM_CATALOG_IDS } from '../../../../docs/scripts/example-details';
import { EXAMPLE_DATASETS, EXAMPLES_DOCS_URL } from './example-datasets';

/**
 * Pins the catalog against the generated Example datasets page
 * (docs/explore/example-datasets.md), per AGENTS.md's "pin a fact that has to
 * live in two places with a test". Each example's info popover links to
 * `#<id>` on that page and VitePress never checks anchors, so a renamed or
 * missing section would otherwise break the link silently. Read via `?raw`
 * rather than `node:fs`, because `tsconfig.app.json` deliberately carries no
 * Node types.
 *
 * Until the catalog swap, the interim catalog's test bundles have no section
 * (`INTERIM_CATALOG_IDS`) and the final examples not yet in the catalog have a
 * section with placeholder values (`beforeSwap` in example-details.ts). Both
 * lists are empty afterwards, and `pnpm docs:examples:check` fails while
 * either outlives its reason.
 */
const docsModules = import.meta.glob('../../../../docs/explore/example-datasets.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const PAGE = Object.values(docsModules)[0] as string;

/** The ids of the page's cards: the explicit `{#id}` anchors on its level-2 headings. */
const SECTION_IDS = [...(PAGE ?? '').matchAll(/^## .* \{#([^}]+)\}$/gm)].map((match) => match[1]);

const interim = new Set(INTERIM_CATALOG_IDS);
const DOCUMENTED = EXAMPLE_DATASETS.filter((entry) => !interim.has(entry.id));

describe('example-datasets.md', () => {
  it('is found', () => {
    expect(PAGE).toBeTruthy();
  });

  it.each(DOCUMENTED)('has a section anchored at $id', (entry) => {
    expect(SECTION_IDS).toContain(entry.id);
  });

  it.each(EXAMPLE_DATASETS)("links $id's info to its section", (entry) => {
    expect(entry.docsUrl).toBe(`${EXAMPLES_DOCS_URL}#${entry.id}`);
  });

  it('has no section for an id outside the catalog, except one waiting for the swap', () => {
    const catalogIds = new Set(EXAMPLE_DATASETS.map((entry) => entry.id));
    for (const id of SECTION_IDS) {
      expect(catalogIds.has(id) || Boolean(EXAMPLE_DETAILS[id]?.beforeSwap), id).toBe(true);
    }
    // And the page isn't accidentally empty.
    expect(SECTION_IDS.length).toBeGreaterThanOrEqual(DOCUMENTED.length);
  });

  it('documents the startup demo', () => {
    expect(SECTION_IDS).toContain(EXAMPLE_DATASETS[0].id);
  });
});
