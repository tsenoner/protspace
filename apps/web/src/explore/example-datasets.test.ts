import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_DATASETS,
  EXAMPLES_DOCS_URL,
  findExampleDataset,
  formatMegabytes,
  toExampleDatasetSummary,
  type ExampleDataset,
} from './example-datasets';

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
    expect(entry.label).toContain(formatMegabytes(entry.sizeBytes));
  });

  it.each(EXAMPLE_DATASETS)('links "$id" to its docs section', (entry) => {
    expect(entry.docsUrl).toBe(`/docs/explore/example-datasets#${entry.id}`);
    expect(entry.docsUrl.startsWith(`${EXAMPLES_DOCS_URL}#`)).toBe(true);
  });

  it('marks at least one entry large', () => {
    expect(EXAMPLE_DATASETS.some((entry) => entry.large)).toBe(true);
  });
});

describe('toExampleDatasetSummary', () => {
  const entry: ExampleDataset = {
    id: 'swissprot',
    label: 'Swiss-Prot · 574K · 44.9 MB',
    description: 'Every reviewed UniProt protein.',
    insight: 'Domains of life separate.',
    url: './examples/swissprot.parquetbundle',
    sizeBytes: 44_912_345,
    docsUrl: '/docs/explore/example-datasets#swissprot',
    defaultView: { projection: 'ProtT5 — UMAP 2', annotation: 'domain' },
  };

  it('passes the label, description, insight and docs link through', () => {
    expect(toExampleDatasetSummary(entry)).toEqual({
      id: 'swissprot',
      label: 'Swiss-Prot · 574K · 44.9 MB',
      description: 'Every reviewed UniProt protein.',
      insight: 'Domains of life separate.',
      docsUrl: '/docs/explore/example-datasets#swissprot',
    });
  });

  it('marks a large entry and states its download size, memory and load time', () => {
    const summary = toExampleDatasetSummary({
      ...entry,
      large: { memory: 'about 1 GB', loadTime: '15–35 s' },
    });

    expect(summary.large).toBe(true);
    expect(summary.description).toBe(
      'Every reviewed UniProt protein. Large: a 44.9 MB download that needs about 1 GB of browser memory and takes 15–35 s to load.',
    );
  });

  it('formats sizes the way the labels do', () => {
    expect(formatMegabytes(865_499)).toBe('0.9 MB');
    expect(formatMegabytes(44_912_345)).toBe('44.9 MB');
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
