/**
 * The static catalog of example datasets: the Import menu's "Examples" section
 * and the ids a `?dataset=<id>` link can name (`openspec/specs/example-datasets/spec.md`).
 *
 * Every entry is curated: `defaultView` is the projection, colour-by annotation
 * and tooltip annotations it opens on whenever its URL names none of them (a
 * menu choice, a bare `?dataset=<id>` link, the startup demo). Changing what an
 * example opens on is a one-line edit of its `defaultView`.
 *
 * What the entry's file holds is not typed here: its URL, its size and the
 * protein count and size in its label come from its record in the generated
 * `example-manifest.ts`, which `write_manifest.py` reads from the file itself,
 * and a unit test checks every `defaultView` name against that record.
 *
 * Interim catalog: the startup demo plus the bundles still shipped under
 * `apps/web/public/data/`. The `curated-example-datasets` change replaces them
 * with the manuscript's datasets; until then each `defaultView` is provisional
 * and names columns and projections its current bundle really has.
 *
 * Order matters: the demo is first, then the rest ascend by protein count, to
 * match the Import menu's "Examples" section.
 */

import type { ExampleDatasetSummary } from '@protspace/core';
import { URLS } from '../../../../config/urls';
import { EXAMPLE_MANIFEST } from './example-manifest';

/**
 * The view an example opens on when its URL names no `annotation`,
 * `projection` or `tooltip`. Names are exact bundle names: `projection` as in
 * the bundle's `projection_name` column, the others as annotation columns.
 */
interface ExampleDefaultView {
  projection: string;
  /** Colour-by annotation: neither tooltip-only nor an EAT `__pred_*` companion. */
  annotation: string;
  /** Extra hover-tooltip annotations; never the colour-by annotation itself. */
  tooltip?: readonly string[];
}

export interface ExampleDataset {
  id: string;
  /** Menu label: name · protein count · download size, the numbers from the manifest. */
  label: string;
  description: string;
  /** One line naming what the curated view shows. */
  insight: string;
  /** Same-origin: `./<file>` for a repo-hosted bundle, `./examples/<file>` for a release-hosted one. */
  url: string;
  /**
   * Where a development build fetches a release-hosted bundle that is missing
   * locally: the same file on protspace.app. Never used by a production build
   * (see `fetchExampleBundle`).
   */
  devFallbackUrl?: string;
  /** Decoded size of the bundle file in bytes, from the manifest. */
  sizeBytes: number;
  /** The entry's section of the Example datasets documentation page. */
  docsUrl: string;
  defaultView: ExampleDefaultView;
  /** The manuscript figure the dataset belongs to, if any. */
  figure?: string;
  /**
   * Slow to download and decode. The Import menu marks it "Large", and its
   * info states the download size plus these costs, e.g. `memory: 'about
   * 1 GB'`, `loadTime: '15–35 s'`.
   */
  large?: { memory: string; loadTime: string };
}

/** The Example datasets documentation page, linked from the Import menu's "Examples" heading. */
export const EXAMPLES_DOCS_URL = '/docs/explore/example-datasets';

const docsUrlFor = (id: string) => `${EXAMPLES_DOCS_URL}#${id}`;

/** A byte count in decimal megabytes with one decimal, as the menu labels state sizes. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * A protein count as the menu labels state it: exact below 1,000, one decimal
 * in thousands below 10,000, whole thousands below a million.
 */
export function formatProteinCount(count: number): string {
  if (count < 1_000) {
    return String(count);
  }
  if (count < 9_950) {
    return `${(count / 1e3).toFixed(1)}K`;
  }
  if (count < 999_500) {
    return `${Math.round(count / 1e3)}K`;
  }
  return `${(count / 1e6).toFixed(1)}M`;
}

/** What a catalog entry states by hand; the rest comes from its manifest record. */
type ExampleSpec = Omit<
  ExampleDataset,
  'label' | 'url' | 'devFallbackUrl' | 'sizeBytes' | 'docsUrl'
> & {
  /** Menu name; the label adds the protein count and size from the manifest. */
  name: string;
};

function defineExample({ name, ...spec }: ExampleSpec): ExampleDataset {
  const record = EXAMPLE_MANIFEST.examples[spec.id];
  if (!record) {
    throw new Error(`Example "${spec.id}" has no record in example-manifest.ts.`);
  }
  const label = `${name} · ${formatProteinCount(record.proteins)} · ${formatMegabytes(record.bytes)}`;
  const common = { ...spec, label, sizeBytes: record.bytes, docsUrl: docsUrlFor(spec.id) };
  if (record.hosting === 'repo') {
    return { ...common, url: `./${record.file}` };
  }
  return {
    ...common,
    url: `./examples/${record.file}`,
    devFallbackUrl: `${URLS.production.base}/examples/${record.file}`,
  };
}

const EXAMPLE_SPECS: readonly ExampleSpec[] = [
  {
    id: 'demo',
    name: 'Demo',
    description:
      'Mixed UniProt sample with ESM2 and ProtT5 projections, taxonomy, Pfam/CATH and EC.',
    insight:
      'Toxin families such as three-finger toxins and phospholipase A2 form their own clusters.',
    defaultView: {
      projection: 'ProtT5 — UMAP 2',
      annotation: 'protein_families',
      tooltip: ['species', 'ec'],
    },
  },
  {
    id: 'venom_eat_stats',
    name: 'Venom EAT',
    description:
      'Venom proteins with EAT-transferred EC and protein-family predictions, GO terms and cluster labels.',
    insight: 'Rings mark EC numbers transferred by EAT from the nearest annotated neighbour.',
    figure: 'Fig. 4',
    defaultView: {
      projection: 'ProtT5 — UMAP 2',
      annotation: 'ec',
      tooltip: ['protein_families', 'species'],
    },
  },
  {
    id: 'phosphatase',
    name: 'Phosphatases',
    description:
      'Phosphatases with rich domain annotations (Pfam, SMART, CDD, PANTHER, TED) and predicted localisation.',
    insight: 'Phosphatase families laid out by ESM2-650M embeddings.',
    defaultView: {
      projection: 'ESM2-650M — UMAP 2',
      annotation: 'protein_families',
      tooltip: ['ec', 'species'],
    },
  },
  {
    id: '5K',
    name: 'Swiss-Prot 5K',
    description: 'Small Swiss-Prot subset with a 3D PCA projection and length bins.',
    insight: 'Phyla on a 2D PCA; switch to PCA 3 for the 3D view.',
    defaultView: { projection: 'PCA_2', annotation: 'phylum', tooltip: ['protein_existence'] },
  },
  {
    id: '7K_toxprot',
    name: 'ToxProt',
    description: 'Animal toxins from UniProt ToxProt with taxonomy, domains and signal peptides.',
    insight: 'Toxin families on a UMAP of ToxProt.',
    defaultView: { projection: 'UMAP_2', annotation: 'protein_families', tooltip: ['species'] },
  },
  {
    id: '35K_ec_brenda',
    name: 'EC (BRENDA)',
    description: 'Enzymes with BRENDA EC numbers.',
    insight: 'Enzymes coloured by domain of life on one UMAP.',
    defaultView: {
      projection: 'UMAP_2',
      annotation: 'domain',
      tooltip: ['protein_families', 'species'],
    },
  },
  {
    id: 'beta_lactamase_ec',
    name: 'β-lactamases (EC)',
    description: 'β-lactamases selected by EC number.',
    insight: 'β-lactamase families on a UMAP.',
    defaultView: { projection: 'UMAP_2', annotation: 'protein_families', tooltip: ['species'] },
  },
  {
    id: '40K',
    name: 'Swiss-Prot 40K',
    description: 'Swiss-Prot subset with a 3D PCA projection.',
    insight: 'Sequence-length bins on a 2D PCA; switch to PCA 3 for the 3D view.',
    defaultView: { projection: 'PCA_2', annotation: 'length_quantile', tooltip: ['pfam'] },
  },
  {
    id: '105K_homoSapiens_drosophilaMelanogaster',
    name: 'Human + fly',
    description: 'Human and Drosophila melanogaster proteomes.',
    insight: 'Human and fly proteins share one layout; most families overlap across species.',
    figure: 'Fig. 2B',
    defaultView: {
      projection: 'UMAP_2',
      annotation: 'species',
      tooltip: ['protein_families', 'reviewed'],
    },
  },
  {
    id: '127K_beta_lactamase',
    name: 'β-lactamases',
    description: 'β-lactamase family, broad selection.',
    insight: 'β-lactamase families on a UMAP.',
    defaultView: { projection: 'UMAP_2', annotation: 'protein_families', tooltip: ['species'] },
  },
  {
    id: 'beta_lactamase_pn',
    name: 'β-lactamases (PN)',
    description: 'Large β-lactamase set for stress-testing at 248K points.',
    insight: 'The broadest β-lactamase selection, 248K points coloured by domain of life.',
    // Interim stand-in for `swissprot`. Rough figures from one local dev-server
    // load (5.8 s, 118 MB of JS heap plus the typed-array buffers).
    large: { memory: 'a few hundred MB', loadTime: '5–10 s' },
    defaultView: {
      projection: 'UMAP_2',
      annotation: 'domain',
      tooltip: ['protein_families', 'species'],
    },
  },
];

export const EXAMPLE_DATASETS: readonly ExampleDataset[] = EXAMPLE_SPECS.map(defineExample);

/** The startup demo: what loads when there is no `?dataset=` and no stored import. */
export const DEFAULT_EXAMPLE_DATASET: ExampleDataset = EXAMPLE_DATASETS[0];

export function findExampleDataset(id: string): ExampleDataset | undefined {
  return EXAMPLE_DATASETS.find((entry) => entry.id === id);
}

/**
 * The Import menu's view of an entry. A large entry's description ends with
 * what opening it costs: the download size, the browser memory and the load
 * time.
 */
export function toExampleDatasetSummary(entry: ExampleDataset): ExampleDatasetSummary {
  const description = entry.large
    ? `${entry.description} Large: a ${formatMegabytes(entry.sizeBytes)} download that needs ${entry.large.memory} of browser memory and takes ${entry.large.loadTime} to load.`
    : entry.description;
  return {
    id: entry.id,
    label: entry.label,
    description,
    insight: entry.insight,
    docsUrl: entry.docsUrl,
    ...(entry.large && { large: true }),
  };
}
