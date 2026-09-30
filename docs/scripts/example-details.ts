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
 * Until the catalog swap, the cards of the final examples the app does not serve yet take their
 * catalog fields from `FINAL_EXAMPLE_SPECS` in the catalog module.
 *
 * `‹…›` marks a value still to come (an author fact, or a number from a bundle not built yet). The
 * page renders it as is, flagged by a warning at the top, and the check refuses any once the
 * catalog swap has emptied `INTERIM_CATALOG_IDS`.
 */

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
  /** Where the dataset appears in the ProtSpace paper, or why it does not. */
  paper: string;
  /**
   * Only for an example that is not one of the paper's datasets (nor the demo): what it was built
   * to show, completing "one example built for the web to show …" in the page intro.
   */
  builtToShow?: string;
  /** Caveats, one sentence or two each. */
  notes?: readonly string[];
}

const PAPER_UMAP_AND_PCA = (neighbours: number, minDist: number) =>
  `UMAP 2D (${neighbours} neighbours, minimum distance ${minDist}, Euclidean, seed 42) and PCA 2D, both the paper's coordinates.`;

/**
 * The three large paper datasets carry no Biocentral predictions (owner decision D4). The docs check
 * requires this note on every card whose bundle has no `predicted_*` column, and refuses it on the
 * others.
 */
export const NO_BIOCENTRAL =
  'This bundle has no Biocentral predictions (the `predicted_*` columns). Their models read per-residue ProtT5 embeddings, which UniProt does not publish, so they would have to be computed for every protein: 10 to 25 hours per 100,000 proteins on the public Biocentral server. Signal peptides are still covered, by the Phobius `signal_peptide` column.';

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
    notes: [
      'The sequence-based annotations (InterPro and the Biocentral predictions) were computed on the full-length sequences, signal peptides included, since that is what their sources annotate.',
      "`length` is the one column kept from the source bundle: the length of the embedded mature peptide, which is shorter than UniProt's sequence for 4,440 of the 7,831 proteins.",
    ],
  },
  'three-finger-toxins': {
    title: 'Snake three-finger toxins (EAT)',
    tagline:
      'Annotation transfer on a real case: toxin classes for snake venom toxins that UniProt has not classified.',
    lookAt:
      'Coloured by `toxin_class`, each colour is one functional class of three-finger toxin. The reviewed toxins carry the class UniProt curators give them. The unreviewed ones, 552 toxins mostly sequenced from venom glands, have none, and [EAT](/explore/eat) transferred one from the nearest reviewed toxin; they are drawn as hollow rings. A fifth of the reviewed toxins, 107, were held out: their class was withheld and transferred like the others, and `toxin_class_withheld` in the tooltip shows the truth, so you can check each of those transfers yourself. The transferred class is right for 101 of them (94 %), and for all 95 that EAT transferred at a reliability of 0.5 or more. The reliability filter starts at 0, so every transfer is shown and the [separation score](/explore/separation-scores) strips stay visible.',
    tryNext:
      'Drag the reliability filter to 50 % (a reliability of 0.5): the least certain transfers, the rings between the islands, disappear first. Then colour by `eat_split` to see the references, the held-out toxins and the unreviewed queries.',
    source:
      'UniProtKB query `(xref:interpro-IPR003571 OR family:"three-finger toxin family") AND (taxonomy_id:8570)`: the three-finger toxins of snakes, reviewed and unreviewed. `toxin_class` groups the subfamily and sub-subfamily that UniProt curators record for each reviewed toxin into functional classes such as the type I, II and III α-neurotoxins, the cytotoxins and the κ-neurotoxins. The held-out fifth was drawn within each class with a recorded seed, and `eat_split` records the draw.',
    embedding:
      'ProtT5-XL-U50, computed on the mature chains, cut by the same rule for reviewed and unreviewed toxins: signal peptides removed, and the propeptide the curators mark on some colubrid toxins removed from their unreviewed relatives too. Most unreviewed entries are precursors that still carry their signal peptide, while many reviewed ones are mature chains sequenced as protein; embedded as they are, the toxins would group by whether they carry a signal peptide rather than by class.',
    projections:
      'UMAP 2D (25 neighbours, minimum distance 0.1, Euclidean, seed 42) and PCA 2D. Transfer: EAT with k = 1 and the Euclidean distance.',
    paper:
      "Not one of the paper's datasets. The paper's annotation-transfer sets are benchmarks, built to measure transfer rather than to show it, so this example was built for the web; their exact files stay in the paper's data deposit.",
    builtToShow: '[annotation transfer (EAT)](/explore/eat) on a real case',
    notes: [
      "The classes are the curators' subfamilies, assigned from sequence similarity, not measured activities.",
      'One reviewed toxin, the muscarinic toxin Mlalpha (P0DJB0), has no curated subfamily and so no `toxin_class`; it is the single N/A in the legend.',
      'A random hold-out leaves most held-out toxins with relatives from their own genus among the references. Annotating a genus EAT has never seen is harder: in a pilot on full-length sequences that held out whole genera, the transferred class was right for about 70 % of the toxins, and for about 85 % above reliability 0.5.',
      '_Naja_ (the cobras) supplies 183 of the 537 reviewed toxins, about a third, so the references lean towards cobra toxins.',
      '116 of the 552 unreviewed toxins, about a fifth, are fragments.',
      'The sequence-based annotations (InterPro and the Biocentral predictions) were computed on the full-length sequences, signal peptides included.',
    ],
  },
  'human-fly': {
    title: 'Human + fly',
    tagline: 'Two reference proteomes in one layout.',
    lookAt:
      'Coloured by `species`, human and fly proteins share most of the map, and the regions only one species occupies are where its own families sit. That overlap is the point of the view, which is why the separation score for `species` is close to zero.',
    tryNext:
      'Recolour by `protein_families`: conserved families such as the protein kinases (about 2,000 proteins, three quarters of them human) sit in the shared region, while MHC class I and II, β-defensins and CC chemokines are human-only and the odorant-binding proteins (PBP/GOBP family) are fly-only.',
    source:
      "The reference proteomes UP000005640 (_Homo sapiens_) and UP000000803 (_Drosophila melanogaster_), with the paper's protein set.",
    embedding: 'ProtT5-XL-U50 per-protein embeddings from UniProt.',
    projections: PAPER_UMAP_AND_PCA(50, 0.2),
    paper: 'Fig. 2B.',
    notes: [
      'UniProt no longer publishes an embedding for 146 of these proteins; they keep their position from the paper.',
      'The paper counts 1,703 protein kinases; this build counts about 2,000, mostly because UniProt has since given unreviewed entries an automatic family annotation.',
      "74 of the paper's accessions have no current UniProt entry, so their UniProt annotations are empty. Another 139 rows carry accessions that UniProt has since merged into another entry of the set, so 111 current entries appear more than once (one of them six times).",
      NO_BIOCENTRAL,
    ],
  },
  'beta-lactamase': {
    title: 'β-lactamases',
    tagline: 'One enzyme superfamily across all of life.',
    lookAt:
      'Coloured by `protein_families`, the serine β-lactamases of Ambler classes A, C and D sit in their own regions, apart from the metallo-β-lactamase superfamily, which makes up about 70 % of the entries and spreads over most of the map. That catch-all is why the separation score for the whole annotation is low.',
    tryNext:
      'Search for Q02940: curated as class C, it sits away from the other class-C proteins, a candidate misannotation. Then colour by `ec`, whose categories follow the clusters of the layout closely.',
    source:
      'Every UniProtKB entry returned by the query `family:"beta-lactamase"` at release 2026_02, unfiltered: the paper\'s 113,015 proteins. The same query returns 116,260 at 2026_03, because 3,324 entries created in 2026_02 received their family annotation only in the next release.',
    embedding: 'ProtT5-XL-U50 per-protein embeddings from UniProt.',
    projections: PAPER_UMAP_AND_PCA(200, 0.4),
    paper: 'Fig. 3.',
    notes: [
      "In the paper's statistics the class C proteins stood out, with a silhouette of +0.32 in the embedding; with the refreshed labels they score about +0.17 there and below zero on the UMAP. UniProt has relabelled β-lactamases since (class C grew from 3,140 to 3,236 proteins), and proteins with several families now count as categories of their own.",
      "78 of the paper's accessions have no current UniProt entry, so their UniProt annotations are empty.",
      NO_BIOCENTRAL,
    ],
  },
  swissprot: {
    title: 'Swiss-Prot',
    tagline: 'Every reviewed UniProtKB protein in one map.',
    lookAt:
      'The colours are `domain`: the domain of life, or the realm for viruses. Scored over the whole map the domains separate poorly, because bacterial and eukaryotic proteins each spread over large areas, and no domain scores well on its own.',
    tryNext:
      'Colour by `pfam`: a protein with several Pfam families is drawn as a pie. Search for P12931 (SRC) to see one.',
    source:
      "All reviewed UniProtKB/Swiss-Prot entries that UniProt publishes a ProtT5 embedding for (it computes none for sequences over 12,000 residues), the paper's protein set.",
    embedding: 'ProtT5-XL-U50 per-protein embeddings from UniProt.',
    projections: PAPER_UMAP_AND_PCA(500, 0.2),
    paper: 'Fig. 2A and the abstract.',
    notes: [
      'The viral realm Fig. 2A labels Monodnaviria appears here as Floreoviria (1,293 proteins): NCBI Taxonomy has renamed it since.',
      "`domain` is empty for 736 proteins: 706 viruses that NCBI Taxonomy places in no realm, and 30 of the paper's accessions that have no current UniProt entry. Another 15 current entries appear twice, under their own accession and under one since merged into them.",
      NO_BIOCENTRAL,
    ],
  },
};

/**
 * The interim catalog's test and perf bundles, which had no card. The check fails when one of them
 * is no longer in the catalog, so the catalog swap (tasks 7.7, 7.10) emptied the list, and an empty
 * list is what makes the check refuse `‹…›` placeholders. The cleanup after the swap deletes it.
 */
export const INTERIM_CATALOG_IDS: readonly string[] = [];

/**
 * Cards whose thumbnail (`docs/explore/images/examples/<id>.png`) is not captured yet. The
 * `examples-live` Playwright project writes them once the final bundles are built and the curated
 * views reviewed (tasks 7.5, 7.10). The check fails when a listed thumbnail exists, and, after the
 * catalog swap, while the list names anything.
 */
export const THUMBNAILS_PENDING: readonly string[] = [];
