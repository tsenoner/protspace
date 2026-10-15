import type { EXAMPLE_MANIFEST } from './example-manifest';

type ExampleBundleRecord = (typeof EXAMPLE_MANIFEST)['examples'][string];

/**
 * The folder release-hosted example bundles are served from, under the app's
 * root: `pnpm examples:fetch` downloads them into `apps/web/public/<this>/`
 * for the dev server, and the deploy into the built app's.
 */
export const EXAMPLES_DIR = 'examples';

/**
 * Where an example's bundle is served, relative to the app's root, which is
 * also where it sits under `apps/web/public/` once fetched: a repo-hosted file
 * at its own path, a release-hosted one in `EXAMPLES_DIR`.
 */
export function exampleServedPath(record: Pick<ExampleBundleRecord, 'file' | 'hosting'>): string {
  return record.hosting === 'repo' ? record.file : `${EXAMPLES_DIR}/${record.file}`;
}
