import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_DATASETS, findExampleDataset } from './example-datasets';

const PUBLIC_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/data',
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

  // Guards against a typo'd id or filename: every non-demo entry must resolve
  // to a bundle that actually ships under apps/web/public/data/.
  it.each(EXAMPLE_DATASETS.filter((entry) => entry.id !== 'demo'))(
    'ships a bundle file for "$id"',
    (entry) => {
      const fileName = entry.url.replace(/^\.\/data\//, '');
      expect(existsSync(path.join(PUBLIC_DATA_DIR, fileName))).toBe(true);
    },
  );
});
