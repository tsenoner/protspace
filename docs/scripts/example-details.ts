/**
 * Docs-only prose for the Example datasets page (`docs/explore/example-datasets.md`).
 *
 * Consumed by `generate-examples.mts` and never by the app, so none of this text ships in the app
 * bundle. The page takes the rest of each card from two other sources: what the Import menu shows
 * (name, insight, curated `defaultView`, the large-download note) from the catalog in
 * `apps/web/src/explore/example-datasets.ts`, and every fact that depends on how the bundle was
 * built (protein count, size, columns, separation scores, releases, ProtSpace version, command)
 * from the generated `apps/web/src/explore/example-manifest.ts`. Write here only what neither of
 * them knows: what the dataset is, how to read its view, and where its proteins came from.
 *
 * `pnpm docs:examples:check` (in CI and precommit) fails when an id here and the catalog disagree,
 * when `lookAt` does not name the entry's colour-by annotation, or when the page is stale.
 *
 * `‹…›` marks a value still to come (an author fact, or a number from a bundle not built yet). The
 * page renders it as is, flagged by a warning at the top, and the check refuses any once the
 * catalog swap has emptied `INTERIM_CATALOG_IDS`.
 */

import type { ExampleDataset } from '../../apps/web/src/explore/example-datasets.ts';

export interface ExampleDetails {
  /** Card heading. */
  title: string;
  /** One line under the heading: what the dataset is. */
  tagline: string;
  /**
   * How to read the curated view, beyond the insight line the catalog already states. Must name
   * the entry's colour-by annotation as inline code, so a change of `defaultView` cannot leave the
   * prose describing another view.
   */
  lookAt: string;
  /** One thing to try next. */
  tryNext: string;
  /** Where the proteins come from: the query or proteomes. The manifest adds the release. */
  source: string;
  /** The embedding model, and where the vectors came from. */
  embedding: string;
  /** Projection methods and their parameters. */
  projections: string;
  /** Where the dataset appears in the ProtSpace paper. */
  paper: string;
  /** Caveats, one sentence each. */
  notes?: readonly string[];
  /**
   * Only until the catalog swap (tasks 7.7): the catalog fields the card needs for an id that has
   * no catalog entry yet, exactly as the entry will state them. At the swap they move into the
   * catalog, and the check fails while both exist.
   */
  beforeSwap?: Pick<ExampleDataset, 'insight' | 'defaultView'> & { large?: true };
}

const UMAP_PCA = (neighbours: number, minDist: number) =>
  `UMAP 2D (${neighbours} neighbours, minimum distance ${minDist}, Euclidean, seed 42), the paper's coordinates, and PCA 2D.`;

/** One card per example, in the Import menu's order: the demo, then ascending protein count. */
export const EXAMPLE_DETAILS: Readonly<Record<string, ExampleDetails>> = {
  demo: {
    title: 'Venom toxins (demo)',
    tagline: 'The small dataset ProtSpace opens with: reviewed animal venom proteins.',
    lookAt:
      'Each colour in the `protein_families` legend is one toxin family, and the smaller families are grouped under **Other**.',
    tryNext:
      'Switch to an `ESM2-650M` projection to see how a second protein language model arranges the same proteins.',
    source:
      'Reviewed animal proteins that UniProt links to venom, UniProtKB query `(taxonomy_id:33208) AND (cc_tissue_specificity:venom OR cc_scl_term:SL-0177) AND (reviewed:true)`.',
    embedding:
      'ProtT5-XL-U50 and ESM2-650M, computed on the mature peptides (signal peptides removed).',
    projections:
      'UMAP 2D (50 neighbours, minimum distance 0.5, Euclidean, seed 42) and PCA 2D, for each model.',
    paper: "Not one of the paper's figures; ProtSpace opens with it because it is small.",
  },
  'venom-eat': {
    title: 'Venom toxins (EAT)',
    tagline: 'Annotation transfer and separation scores on reviewed, secreted animal toxins.',
    lookAt:
      'Coloured by `ec`, proteins whose EC number UniProt leaves empty show the value [EAT](/explore/eat) transferred from their nearest annotated neighbour as a hollow ring. The reliability filter starts at 0, so every transfer is shown and the [separation score](/explore/separation-scores) strips above the legend stay visible; any filter hides them.',
    tryNext:
      'Hover P0DPU8: its EC number, phospholipase A2 (3.1.1.4), was transferred from F5CPF0 with reliability 0.58.',
    source:
      "Reviewed UniProtKB proteins with the keywords Toxin (KW-0800) and Secreted (KW-0964), the paper's set; ‹query and release to be confirmed›.",
    embedding: 'ProtT5-XL-U50 per-protein embeddings.',
    projections: UMAP_PCA(25, 0.1),
    paper: 'Fig. 4 (panels a, d, e and f).',
    notes: [
      "The transferred values, their reliabilities and the separation scores are the paper's own (EAT with k = 1), so the figure's numbers hold; the other annotations were fetched again for this build.",
    ],
    beforeSwap: {
      insight:
        'Rings are EC numbers transferred from the nearest annotated neighbour; drag reliability to 0.5 to keep 244 of 384.',
      defaultView: {
        projection: 'ProtT5 — UMAP 2',
        annotation: 'ec',
        tooltip: ['protein_families', 'species'],
      },
    },
  },
  'phosphatase-eat': {
    title: 'Phosphatases (EAT benchmark)',
    tagline: "The held-out benchmark behind the paper's 98.1 %.",
    lookAt:
      'EC numbers and protein families were withheld from 213 of the 832 reviewed phosphatases, and [EAT](/explore/eat) transferred them back from the nearest of the other 619. Coloured by `ec`, the view opens with the reliability filter at 0.5; hover a query to compare the transferred EC number with the withheld one. Like any filter, it hides the separation score strips; drag it to 0 to see every transfer.',
    tryNext: 'Colour by `eat_split` to see which proteins were queries and which were references.',
    source:
      'UniProtKB query `(ft_domain:phosphatase) AND (reviewed:true)`; 213 of the 707 proteins with both an EC number and a family were held out as queries.',
    embedding: 'ProtT5-XL-U50 per-protein embeddings from UniProt.',
    projections: 'UMAP 2D (25 neighbours, minimum distance 0.1, Euclidean) and PCA 2D.',
    paper:
      'The abstract and the annotation-transfer benchmark in the Results (k = 1, Euclidean: 91.5 % of the 213 transfers correct, 98.1 % of the 160 with reliability of at least 0.5).',
    notes: [
      "The transfers are the paper's own. No step of this build refills the withheld values, so the benchmark still holds out what it held out.",
    ],
    beforeSwap: {
      insight:
        'EC was withheld from 213 phosphatases and transferred back; above reliability 0.5, 98.1 % of the transfers are correct.',
      defaultView: {
        projection: 'ProtT5 — UMAP 2',
        annotation: 'ec',
        // The withheld-truth column names are provisional; the build fixes them (task 6.3).
        tooltip: ['eat_split', 'ec_withheld', 'protein_families_withheld'],
      },
    },
  },
  'human-fly': {
    title: 'Human + fly',
    tagline: 'Two reference proteomes in one layout.',
    lookAt:
      'Coloured by `species`, human and fly proteins share most of the map, and the regions only one species occupies are where its own families sit. That overlap is the point of the view, which is why the separation score for `species` is close to zero.',
    tryNext:
      'Recolour by `protein_families`: conserved families such as the protein kinases sit in the shared region, while MHC class I and II, β-defensins and CC chemokines are human-only and the odorant-binding proteins (PBP/GOBP family) are fly-only.',
    source:
      "The reference proteomes UP000005640 (_Homo sapiens_) and UP000000803 (_Drosophila melanogaster_), with the paper's protein set.",
    embedding: 'ProtT5-XL-U50 per-protein embeddings from UniProt.',
    projections: UMAP_PCA(50, 0.2),
    paper: 'Fig. 2B.',
    notes: [
      'UniProt no longer publishes an embedding for 146 of these proteins; they keep their position from the paper.',
    ],
    beforeSwap: {
      insight:
        'Most families overlap across species (about 1,700 protein kinases). Recolour by protein family to find human-only MHC class I/II, β-defensins and CC chemokines and fly-only odorant-binding proteins.',
      defaultView: {
        projection: 'ProtT5 — UMAP 2',
        annotation: 'species',
        tooltip: ['protein_families', 'reviewed'],
      },
    },
  },
  'beta-lactamase': {
    title: 'β-lactamases',
    tagline: 'One enzyme superfamily across all of life.',
    lookAt:
      'Coloured by `protein_families`, the Ambler class C proteins form one sharp region, classes A and D are diffuse, and the metallo-β-lactamase superfamily, about 70 % of the entries, spreads over much of the map. That catch-all is why the separation score for the whole annotation is low even though class C separates well.',
    tryNext:
      'Search for Q02940: curated as class C, it sits away from the other class-C proteins, a candidate misannotation. Then colour by `ec`, the annotation that agrees best with the clusters of the layout.',
    source:
      'UniProtKB query `family:"beta-lactamase"` at release 2026_02, the paper\'s 113,015 proteins; ‹how they were selected from the query\'s hits: to be confirmed›.',
    embedding: 'ProtT5-XL-U50 per-protein embeddings from UniProt.',
    projections: UMAP_PCA(200, 0.4),
    paper: 'Fig. 3.',
    beforeSwap: {
      insight:
        'Class C forms a sharp region while classes A and D are diffuse. Q02940, curated as class C, sits away from the other class-C proteins.',
      defaultView: {
        projection: 'ProtT5 — UMAP 2',
        annotation: 'protein_families',
        tooltip: ['ec', 'species'],
      },
    },
  },
  swissprot: {
    title: 'Swiss-Prot',
    tagline: 'Every reviewed UniProtKB protein in one map.',
    lookAt:
      'The colours are `domain`, the domain of life. Scored over the whole map the domains separate poorly, because bacterial and eukaryotic proteins each spread over large areas, but per category the archaeal proteins stand out.',
    tryNext:
      'Colour by `pfam`: a protein with several Pfam families is drawn as a pie. Search for P12931 (SRC) to see one.',
    source:
      "All reviewed UniProtKB/Swiss-Prot entries that UniProt publishes a ProtT5 embedding for (it computes none for sequences over 12,000 residues), the paper's protein set.",
    embedding: 'ProtT5-XL-U50 per-protein embeddings from UniProt.',
    projections:
      "UMAP 2D (500 neighbours, minimum distance 0.2, Euclidean, seed 42), the paper's coordinates. There is no PCA, to keep the download smaller.",
    paper: 'Fig. 2A and the abstract.',
    beforeSwap: {
      insight:
        'Bacteria and eukaryotes occupy largely distinct regions; archaeal and viral proteins form compact islands.',
      defaultView: {
        projection: 'ProtT5 — UMAP 2',
        annotation: 'domain',
        tooltip: ['protein_families', 'species'],
      },
      large: true,
    },
  },
};

/**
 * Only until the catalog swap (tasks 7.7): the interim catalog's test and perf bundles, which leave
 * the Import menu at the swap and get no card. The check fails when one of them is no longer in the
 * catalog, so the list empties with the swap; an empty list is what makes the check refuse `‹…›`
 * placeholders and `beforeSwap`.
 */
export const INTERIM_CATALOG_IDS: readonly string[] = [
  'venom_eat_stats',
  'phosphatase',
  '5K',
  '7K_toxprot',
  '35K_ec_brenda',
  'beta_lactamase_ec',
  '40K',
  '105K_homoSapiens_drosophilaMelanogaster',
  '127K_beta_lactamase',
  'beta_lactamase_pn',
];

/**
 * Cards whose thumbnail (`docs/explore/images/examples/<id>.png`) is not captured yet. The
 * `examples-live` Playwright project writes them once the final bundles are built and the curated
 * views reviewed (tasks 7.5, 7.10). The check fails when a listed thumbnail exists, so the list
 * empties as they land.
 */
export const THUMBNAILS_PENDING: readonly string[] = [
  'demo',
  'venom-eat',
  'phosphatase-eat',
  'human-fly',
  'beta-lactamase',
  'swissprot',
];
