import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXAMPLE_DATASETS,
  EXAMPLES_DOCS_URL,
  findExampleDataset,
  formatDownload,
  formatMegabytes,
  formatProteinCount,
  toExampleDatasetSummary,
  type ExampleDataset,
} from './example-datasets';
import { EXAMPLE_MANIFEST } from './example-manifest';

// Every bundle committed under apps/web/public/. Found by glob rather than
// fs/path/url (which would leak Node types into the browser tsconfig; see
// packages/core/src/styles/styles-integrity.test.ts for the same pattern).
// `public/examples/` is left out: it is gitignored and holds what
// `pnpm examples:fetch` downloaded.
const COMMITTED_PUBLIC_BUNDLES = Object.keys(
  import.meta.glob(['../../public/**/*.parquetbundle', '!../../public/examples/**']),
);

/** Catalog ids: lowercase and letter-leading, words joined by single hyphens. */
const ID_FORMAT = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

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

  it.each(EXAMPLE_DATASETS)('has a manifest record for "$id"', (entry) => {
    expect(EXAMPLE_MANIFEST.examples[entry.id]).toBeDefined();
  });

  it.each(
    Object.entries(EXAMPLE_MANIFEST.examples).filter(([, record]) => record.hosting === 'repo'),
  )('ships the repo-hosted bundle of "%s" under public/', (_id, record) => {
    expect(COMMITTED_PUBLIC_BUNDLES).toContain(`../../public/${record.file}`);
  });

  it.each(EXAMPLE_DATASETS)('serves "$id" from where its manifest record says', (entry) => {
    const record = EXAMPLE_MANIFEST.examples[entry.id];
    if (record.hosting === 'repo') {
      expect(entry.url).toBe(`./${record.file}`);
      expect(entry.devFallbackUrl).toBeUndefined();
    } else {
      expect(entry.url).toBe(`./examples/${record.file}`);
      expect(entry.devFallbackUrl).toBe(`https://protspace.app/examples/${record.file}`);
    }
  });

  it.each(EXAMPLE_DATASETS)(
    'takes the size and count in the label of "$id" from the manifest',
    (entry) => {
      const record = EXAMPLE_MANIFEST.examples[entry.id];
      expect(entry.sizeBytes).toBe(record.bytes);
      expect(entry.label).toMatch(
        new RegExp(` · [0-9.]+[KM]? · ${formatMegabytes(record.bytes)}$`),
      );
    },
  );

  it('lists the rest in ascending order of protein count after the demo', () => {
    const counts = EXAMPLE_DATASETS.slice(1).map(
      (entry) => EXAMPLE_MANIFEST.examples[entry.id].proteins,
    );
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it.each(EXAMPLE_DATASETS)('links "$id" to its docs section', (entry) => {
    expect(entry.docsUrl).toBe(`/docs/explore/example-datasets#${entry.id}`);
    expect(entry.docsUrl.startsWith(`${EXAMPLES_DOCS_URL}#`)).toBe(true);
  });

  // Task 4.10: the startup demo is the only bundle in the repository; every
  // other example is release-hosted.
  it('ships no bundle under public/ but the demo', () => {
    expect(COMMITTED_PUBLIC_BUNDLES).toEqual(['../../public/data.parquetbundle']);
  });

  // ‹…› marks a value still to come (design Decision 15). The docs check
  // refuses any on the page; this keeps them out of the Import menu itself,
  // which shows the description, insight and large note.
  it.each(EXAMPLE_DATASETS)('shows no value still to come for "$id"', (entry) => {
    const shown = [entry.description, entry.insight, entry.large?.memory, entry.large?.loadTime];
    expect(shown.filter((text) => text?.includes('‹'))).toEqual([]);
  });
});

describe('the catalog', () => {
  const ids = EXAMPLE_DATASETS.map((entry) => entry.id);

  it('holds the demo, the EAT showcase and the manuscript datasets, in menu order', () => {
    expect(ids).toEqual([
      'demo',
      'three-finger-toxins',
      'human-fly',
      'beta-lactamase',
      'swissprot',
    ]);
  });

  it('marks swissprot, and only swissprot, large', () => {
    expect(EXAMPLE_DATASETS.filter((entry) => entry.large).map((entry) => entry.id)).toEqual([
      'swissprot',
    ]);
  });

  // Task 1.7: ids double as the `?dataset=` value and the docs anchor, and
  // published links name them, so their format is fixed.
  it.each(ids)('gives "%s" a lowercase, letter-leading id', (id) => {
    expect(id).toMatch(ID_FORMAT);
  });

  it('accepts hyphenated ids and refuses the other forms', () => {
    expect('three-finger-toxins').toMatch(ID_FORMAT);
    for (const id of ['3ftx-eat', 'Swissprot', 'human_fly', 'beta--lactamase', 'demo-']) {
      expect(id).not.toMatch(ID_FORMAT);
    }
  });

  // Every example carries a UMAP, which it opens on, and a PCA (design
  // Decision 16), checked against its manifest record.
  it.each(EXAMPLE_DATASETS)('gives "$id" a UMAP to open on and a PCA', (entry) => {
    const { projections } = EXAMPLE_MANIFEST.examples[entry.id];
    expect(entry.defaultView.projection).toMatch(/UMAP/);
    expect(projections.some((name) => /PCA/.test(name))).toBe(true);
  });
});

describe('the E2E startup pin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('points only the startup demo at VITE_STARTUP_DATASET_URL', async () => {
    vi.stubEnv('VITE_STARTUP_DATASET_URL', '/@fs/repo/apps/web/tests/fixtures/demo.parquetbundle');
    vi.resetModules();
    const catalog = await import('./example-datasets');

    expect(catalog.DEFAULT_EXAMPLE_DATASET.url).toBe(
      '/@fs/repo/apps/web/tests/fixtures/demo.parquetbundle',
    );
    expect(catalog.EXAMPLE_DATASETS.slice(1).map((entry) => entry.url)).toEqual(
      EXAMPLE_DATASETS.slice(1).map((entry) => entry.url),
    );
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

  it('puts "an" before a size read aloud with a vowel sound', () => {
    expect(formatDownload(44_912_345)).toBe('a 44.9 MB download');
    expect(formatDownload(135_853_411)).toBe('a 135.9 MB download');
    expect(formatDownload(865_499)).toBe('a 0.9 MB download');
    // eighty-seven, eight hundred and twelve, eleven, eighteen
    expect(formatDownload(87_783_085)).toBe('an 87.8 MB download');
    expect(formatDownload(812_000_000)).toBe('an 812.0 MB download');
    expect(formatDownload(11_200_000)).toBe('an 11.2 MB download');
    expect(formatDownload(18_000_000)).toBe('an 18.0 MB download');
    // one hundred and eighty, one thousand one hundred, eleven thousand
    expect(formatDownload(180_000_000)).toBe('a 180.0 MB download');
    expect(formatDownload(1_100_000_000)).toBe('a 1100.0 MB download');
    expect(formatDownload(11_000_000_000)).toBe('an 11000.0 MB download');
  });

  it('formats protein counts the way the labels do', () => {
    expect(formatProteinCount(811)).toBe('811');
    expect(formatProteinCount(1_587)).toBe('1.6K');
    expect(formatProteinCount(7_831)).toBe('7.8K');
    expect(formatProteinCount(9_960)).toBe('10K');
    expect(formatProteinCount(35_504)).toBe('36K');
    expect(formatProteinCount(573_649)).toBe('574K');
    expect(formatProteinCount(1_200_000)).toBe('1.2M');
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

  // The drift guard: a renamed or dropped column or projection fails here, in
  // CI, without downloading any bundle.
  it.each(EXAMPLE_DATASETS)('"$id" names only what its bundle holds', (entry) => {
    const record = EXAMPLE_MANIFEST.examples[entry.id];
    const { projection, annotation, tooltip = [] } = entry.defaultView;
    expect(record.projections).toContain(projection);
    for (const name of [annotation, ...tooltip]) {
      expect(record.columns).toContain(name);
    }
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
