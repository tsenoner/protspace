import { describe, expect, it } from 'vitest';
import { EXAMPLE_DATASETS } from './example-datasets';

/**
 * Pins the catalog table in docs/explore/control-bar.md §9 against
 * EXAMPLE_DATASETS, per AGENTS.md's "pin a fact that has to live in two
 * places with a test": every catalog id must be documented (so the
 * `?dataset=` link works from the docs alone) and no stale/unknown id must
 * remain if a bundle is ever renamed or removed. Read via `?raw` rather than
 * `node:fs` — `tsconfig.app.json` deliberately carries no Node types.
 */
const docsModules = import.meta.glob('../../../../docs/explore/control-bar.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const CONTROL_BAR_DOC = Object.values(docsModules)[0] as string;

describe('control-bar.md example ids', () => {
  it('is found', () => {
    expect(CONTROL_BAR_DOC).toBeTruthy();
  });

  it.each(EXAMPLE_DATASETS)('documents "$id"', (entry) => {
    expect(CONTROL_BAR_DOC).toContain(`\`${entry.id}\``);
  });

  it('documents no id outside the catalog', () => {
    // Scope the match to the id table itself — other tables on the page
    // (e.g. the numeric filter operators) also use a `` `backticked` ``
    // first column.
    const tableStart = CONTROL_BAR_DOC.indexOf('Each example also has an id');
    const tableEnd = CONTROL_BAR_DOC.indexOf('Each example is also reachable', tableStart);
    expect(tableStart).toBeGreaterThan(-1);
    expect(tableEnd).toBeGreaterThan(tableStart);
    const table = CONTROL_BAR_DOC.slice(tableStart, tableEnd);

    const documentedIds = [...table.matchAll(/^\| `([^`]+)`/gm)].map((match) => match[1]);
    const knownIds = new Set(EXAMPLE_DATASETS.map((entry) => entry.id));
    for (const id of documentedIds) {
      expect(knownIds.has(id)).toBe(true);
    }
    // And the table isn't accidentally empty.
    expect(documentedIds.length).toBe(EXAMPLE_DATASETS.length);
  });
});
