/**
 * The static catalog of example datasets: the Import menu's "Examples" section
 * and the ids a `?dataset=<id>` link can name (`openspec/specs/example-datasets/spec.md`).
 *
 * Every entry is curated: `defaultView` is the projection, colour-by annotation
 * and tooltip annotations it opens on whenever its URL names none of them (a
 * menu choice, a bare `?dataset=<id>` link, the startup demo). Changing what an
 * example opens on is a one-line edit of its `defaultView`.
 *
 * Interim catalog: the startup demo plus the bundles still shipped under
 * `apps/web/public/data/`. The `curated-example-datasets` change replaces them
 * with the manuscript's datasets; until then each `defaultView` is provisional
 * and names columns and projections its current bundle really has.
 *
 * Order matters: the demo is first, then the rest ascend by protein count, to
 * match the Import menu's "Examples" section.
 */

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
  /** Menu label: name · protein count · download size. */
  label: string;
  description: string;
  /** One line naming what the curated view shows. */
  insight: string;
  url: string;
  /** Size of the bundle file in bytes. */
  sizeBytes: number;
  /** The entry's section of the Example datasets documentation page. */
  docsUrl: string;
  defaultView: ExampleDefaultView;
  /** The manuscript figure the dataset belongs to, if any. */
  figure?: string;
  /** Slow to download and decode; the menu marks it. */
  large?: boolean;
}

const docsUrlFor = (id: string) => `/docs/explore/example-datasets#${id}`;

export const EXAMPLE_DATASETS: readonly ExampleDataset[] = [
  {
    id: 'demo',
    label: 'Demo · 7.8K · 0.9 MB',
    description:
      'Mixed UniProt sample with ESM2 and ProtT5 projections, taxonomy, Pfam/CATH and EC.',
    insight:
      'Toxin families such as three-finger toxins and phospholipase A2 form their own clusters.',
    url: './data.parquetbundle',
    sizeBytes: 865_499,
    docsUrl: docsUrlFor('demo'),
    defaultView: {
      projection: 'ProtT5 — UMAP 2',
      annotation: 'protein_families',
      tooltip: ['species', 'ec'],
    },
  },
  {
    id: 'venom_eat_stats',
    label: 'Venom EAT · 811 · 0.2 MB',
    description:
      'Venom proteins with EAT-transferred EC and protein-family predictions, GO terms and cluster labels.',
    insight: 'Rings mark EC numbers transferred by EAT from the nearest annotated neighbour.',
    url: './data/venom_eat_stats.parquetbundle',
    sizeBytes: 201_687,
    docsUrl: docsUrlFor('venom_eat_stats'),
    figure: 'Fig. 4',
    defaultView: {
      projection: 'ProtT5 — UMAP 2',
      annotation: 'ec',
      tooltip: ['protein_families', 'species'],
    },
  },
  {
    id: 'phosphatase',
    label: 'Phosphatases · 1.6K · 0.4 MB',
    description:
      'Phosphatases with rich domain annotations (Pfam, SMART, CDD, PANTHER, TED) and predicted localisation.',
    insight: 'Phosphatase families laid out by ESM2-650M embeddings.',
    url: './data/phosphatase.parquetbundle',
    sizeBytes: 434_341,
    docsUrl: docsUrlFor('phosphatase'),
    defaultView: {
      projection: 'ESM2-650M — UMAP 2',
      annotation: 'protein_families',
      tooltip: ['ec', 'species'],
    },
  },
  {
    id: '5K',
    label: 'Swiss-Prot 5K · 5.2K · 0.2 MB',
    description: 'Small Swiss-Prot subset with a 3D PCA projection and length bins.',
    insight: 'Phyla on a 2D PCA; switch to PCA 3 for the 3D view.',
    url: './data/5K.parquetbundle',
    sizeBytes: 244_359,
    docsUrl: docsUrlFor('5K'),
    defaultView: { projection: 'PCA_2', annotation: 'phylum', tooltip: ['protein_existence'] },
  },
  {
    id: '7K_toxprot',
    label: 'ToxProt · 7.4K · 0.6 MB',
    description: 'Animal toxins from UniProt ToxProt with taxonomy, domains and signal peptides.',
    insight: 'Toxin families on a UMAP of ToxProt.',
    url: './data/7K_toxprot.parquetbundle',
    sizeBytes: 576_771,
    docsUrl: docsUrlFor('7K_toxprot'),
    defaultView: { projection: 'UMAP_2', annotation: 'protein_families', tooltip: ['species'] },
  },
  {
    id: '35K_ec_brenda',
    label: 'EC (BRENDA) · 35K · 4.5 MB',
    description: 'Enzymes with BRENDA EC numbers.',
    insight: 'Enzymes coloured by domain of life on one UMAP.',
    url: './data/35K_ec_brenda.parquetbundle',
    sizeBytes: 4_487_626,
    docsUrl: docsUrlFor('35K_ec_brenda'),
    defaultView: {
      projection: 'UMAP_2',
      annotation: 'domain',
      tooltip: ['protein_families', 'species'],
    },
  },
  {
    id: 'beta_lactamase_ec',
    label: 'β-lactamases (EC) · 36K · 2.1 MB',
    description: 'β-lactamases selected by EC number.',
    insight: 'β-lactamase families on a UMAP.',
    url: './data/beta_lactamase_ec.parquetbundle',
    sizeBytes: 2_084_334,
    docsUrl: docsUrlFor('beta_lactamase_ec'),
    defaultView: { projection: 'UMAP_2', annotation: 'protein_families', tooltip: ['species'] },
  },
  {
    id: '40K',
    label: 'Swiss-Prot 40K · 40K · 1.8 MB',
    description: 'Swiss-Prot subset with a 3D PCA projection.',
    insight: 'Sequence-length bins on a 2D PCA; switch to PCA 3 for the 3D view.',
    url: './data/40K.parquetbundle',
    sizeBytes: 1_843_827,
    docsUrl: docsUrlFor('40K'),
    defaultView: { projection: 'PCA_2', annotation: 'length_quantile', tooltip: ['pfam'] },
  },
  {
    id: '105K_homoSapiens_drosophilaMelanogaster',
    label: 'Human + fly · 106K · 10.1 MB',
    description: 'Human and Drosophila melanogaster proteomes.',
    insight: 'Human and fly proteins share one layout; most families overlap across species.',
    url: './data/105K_homoSapiens_drosophilaMelanogaster.parquetbundle',
    sizeBytes: 10_109_361,
    docsUrl: docsUrlFor('105K_homoSapiens_drosophilaMelanogaster'),
    figure: 'Fig. 2B',
    defaultView: {
      projection: 'UMAP_2',
      annotation: 'species',
      tooltip: ['protein_families', 'reviewed'],
    },
  },
  {
    id: '127K_beta_lactamase',
    label: 'β-lactamases · 127K · 8.7 MB',
    description: 'β-lactamase family, broad selection.',
    insight: 'β-lactamase families on a UMAP.',
    url: './data/127K_beta_lactamase.parquetbundle',
    sizeBytes: 8_717_148,
    docsUrl: docsUrlFor('127K_beta_lactamase'),
    defaultView: { projection: 'UMAP_2', annotation: 'protein_families', tooltip: ['species'] },
  },
  {
    id: 'beta_lactamase_pn',
    label: 'β-lactamases (PN) · 248K · 12.2 MB',
    description: 'Large β-lactamase set for stress-testing at 248K points.',
    insight: 'The broadest β-lactamase selection, 248K points coloured by domain of life.',
    url: './data/beta_lactamase_pn.parquetbundle',
    sizeBytes: 12_210_217,
    docsUrl: docsUrlFor('beta_lactamase_pn'),
    large: true,
    defaultView: {
      projection: 'UMAP_2',
      annotation: 'domain',
      tooltip: ['protein_families', 'species'],
    },
  },
];

/** The startup demo: what loads when there is no `?dataset=` and no stored import. */
export const DEFAULT_EXAMPLE_DATASET: ExampleDataset = EXAMPLE_DATASETS[0];

export function findExampleDataset(id: string): ExampleDataset | undefined {
  return EXAMPLE_DATASETS.find((entry) => entry.id === id);
}
