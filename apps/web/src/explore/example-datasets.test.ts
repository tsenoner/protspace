import { describe, expect, it } from 'vitest';
import { EXAMPLE_DATASETS, findExampleDataset } from './example-datasets';

// Every catalog `url` must resolve to a bundle that actually ships under
// apps/web/public/. Found by glob rather than fs/path/url (which would leak
// Node types into the browser tsconfig — see packages/core/src/styles/styles-integrity.test.ts
// for the same pattern) so a typo'd id or filename fails here instead of at
// runtime. The demo bundle lives directly under public/, the rest under
// public/data/.
const SHIPPED_BUNDLE_PATHS = new Set(
  Object.keys({
    ...import.meta.glob('../../public/data.parquetbundle'),
    ...import.meta.glob('../../public/data/*.parquetbundle'),
  }),
);

describe('example datasets catalog', () => {
  it('has unique ids', () => {
    const ids = EXAMPLE_DATASETS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists the demo first', () => {
    expect(EXAMPLE_DATASETS[0]?.id).toBe('demo');
    expect(EXAMPLE_DATASETS[0]?.url).toBe('./data.parquetbundle');
  });

  it('finds a known id', () => {
    expect(findExampleDataset('demo')).toEqual(EXAMPLE_DATASETS[0]);
  });

  it('returns undefined for an unknown id', () => {
    expect(findExampleDataset('not-a-real-dataset')).toBeUndefined();
  });

  it.each(EXAMPLE_DATASETS)('ships a bundle file for "$id"', (entry) => {
    const publicPath = entry.url.replace(/^\.\//, '../../public/');
    expect(SHIPPED_BUNDLE_PATHS.has(publicPath)).toBe(true);
  });
});
