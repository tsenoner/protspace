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

  it.each(EXAMPLE_DATASETS)('states the size of "$id" in its label', (entry) => {
    expect(entry.label).toContain(`${(entry.sizeBytes / 1e6).toFixed(1)} MB`);
  });

  it.each(EXAMPLE_DATASETS)('links "$id" to its docs section', (entry) => {
    expect(entry.docsUrl).toBe(`/docs/explore/example-datasets#${entry.id}`);
  });
});

// Mirrors `TOOLTIP_ONLY_ANNOTATIONS` in packages/core/src/components/control-bar/control-bar.ts,
// which the colour-by dropdown never offers.
const TOOLTIP_ONLY_ANNOTATIONS = new Set(['gene_name', 'protein_name', 'uniprot_kb_id']);
const EAT_COMPANION_PATTERN = /__pred_(value|confidence|source)$/;

describe('example datasets curated default view', () => {
  it.each(EXAMPLE_DATASETS)('"$id" names a projection and an annotation', (entry) => {
    expect(entry.defaultView.projection.trim()).not.toBe('');
    expect(entry.defaultView.annotation.trim()).not.toBe('');
  });

  it.each(EXAMPLE_DATASETS)('"$id" colours by a colourable annotation', (entry) => {
    const { annotation } = entry.defaultView;
    expect(TOOLTIP_ONLY_ANNOTATIONS.has(annotation)).toBe(false);
    expect(annotation).not.toMatch(EAT_COMPANION_PATTERN);
  });

  it.each(EXAMPLE_DATASETS)(
    '"$id" has a tooltip without duplicates or the colour-by annotation',
    (entry) => {
      const tooltip = entry.defaultView.tooltip ?? [];
      expect(new Set(tooltip).size).toBe(tooltip.length);
      expect(tooltip).not.toContain(entry.defaultView.annotation);
      for (const name of tooltip) {
        expect(name).not.toMatch(EAT_COMPANION_PATTERN);
      }
    },
  );
});
