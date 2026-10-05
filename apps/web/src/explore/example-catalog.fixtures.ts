/**
 * A two-entry example catalog for unit tests.
 *
 * The product catalog changes whenever an example is added, dropped or moved
 * to release hosting, so no unit test indexes it or depends on its size. A test
 * that exercises the catalog's consumers swaps this one in:
 *
 *   vi.mock('./example-datasets', async (importOriginal) =>
 *     (await import('./example-catalog.fixtures')).withTestCatalog(await importOriginal()),
 *   );
 *
 * and names its entries `TEST_DEMO` and `TEST_EXAMPLE`. Only the catalog's
 * contents are replaced; its helpers stay the real ones.
 */
import type * as Catalog from './example-datasets';
import type { ExampleDataset } from './example-datasets';

type CatalogModule = typeof Catalog;

/** The startup demo: the catalog's first entry, served from the repository. */
export const TEST_DEMO: ExampleDataset = {
  id: 'demo',
  label: 'Test demo · 7.8K · 0.9 MB',
  description: 'The startup demo of the test catalog.',
  insight: 'Protein families form their own clusters.',
  url: './data.parquetbundle',
  sizeBytes: 865_499,
  docsUrl: '/docs/explore/example-datasets#demo',
  defaultView: {
    projection: 'ProtT5 — UMAP 2',
    annotation: 'protein_families',
    tooltip: ['species', 'ec'],
  },
};

/**
 * A second example. Repo-hosted, so it has no development fallback and a
 * failed fetch is never retried from protspace.app (`example-fetch.test.ts`
 * covers that path).
 */
export const TEST_EXAMPLE: ExampleDataset = {
  id: 'test-example',
  label: 'Test example · 1.6K · 0.4 MB',
  description: 'A second example of the test catalog.',
  insight: 'EC numbers separate the enzyme classes.',
  url: './test-example.parquetbundle',
  sizeBytes: 434_341,
  docsUrl: '/docs/explore/example-datasets#test-example',
  defaultView: { projection: 'ProtT5 — UMAP 2', annotation: 'ec', tooltip: ['species'] },
};

const TEST_CATALOG: readonly ExampleDataset[] = [TEST_DEMO, TEST_EXAMPLE];

/** The catalog module (`importOriginal()`'s result) with its contents replaced by the test catalog. */
export function withTestCatalog(actual: unknown): CatalogModule {
  return {
    ...(actual as CatalogModule),
    EXAMPLE_DATASETS: TEST_CATALOG,
    DEFAULT_EXAMPLE_DATASET: TEST_DEMO,
    findExampleDataset: (id: string) => TEST_CATALOG.find((entry) => entry.id === id),
  };
}
