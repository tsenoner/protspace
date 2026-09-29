<!--
  AUTO-GENERATED: do not edit by hand.
  Catalog (menu names, insight, curated view): apps/web/src/explore/example-datasets.ts
  Bundle facts and provenance: apps/web/src/explore/example-manifest.ts
  Prose: docs/scripts/example-details.ts
  Regenerate: pnpm docs:examples
-->

# Example Datasets

The **Import** menu's **Examples** section opens these datasets: the ones behind the figures of the ProtSpace paper, plus the small demo ProtSpace starts with. A link of the form `/explore?dataset=<id>` opens one directly, as each section's **Open in ProtSpace** link does. An example opens on a view chosen to show its structure straight away.

Examples always reopen in that curated view, so changes you make to one, such as legend colours, hidden categories or tooltip fields, are not kept between visits. To keep them, export the example as a `.parquetbundle` with its legend settings included and import that file. Keep the file: your copy counts as the same dataset as the example, so opening the example again resets the copy's saved settings until you import the file again. See [Data & Settings Persistence](/explore/importing-data#data-settings-persistence).

The paper's datasets keep the paper's proteins and projection coordinates, so their layouts match the figures, while their annotations were fetched again with a current ProtSpace; each section gives the releases. The two EAT examples also keep the paper's transferred values.

Figure numbers refer to the ProtSpace web-server paper and may differ from its preprint ([doi:10.64898/2026.05.04.722720](https://doi.org/10.64898/2026.05.04.722720)). To cite ProtSpace, see [How do I cite ProtSpace?](/guide/faq#how-do-i-cite-protspace). Protein data from [UniProt](https://www.uniprot.org) is used under the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license.

::: warning Values still to come
Values in ‹angle quotes› are filled in when the rebuilt bundles and the last author facts land. Until then, the Import menu also lists test bundles that have no section here.
:::

| Example                                          | Proteins        | Download        | Opens on                               |
| ------------------------------------------------ | --------------- | --------------- | -------------------------------------- |
| [Venom toxins (demo)](#demo)                     | 7,831           | 0.9 MB          | `ProtT5 — UMAP 2` · `protein_families` |
| [Venom toxins (EAT)](#venom-eat)                 | ‹pending build› | ‹pending build› | `ProtT5 — UMAP 2` · `ec`               |
| [Phosphatases (EAT benchmark)](#phosphatase-eat) | ‹pending build› | ‹pending build› | `ProtT5 — UMAP 2` · `ec`               |
| [Human + fly](#human-fly)                        | ‹pending build› | ‹pending build› | `ProtT5 — UMAP 2` · `species`          |
| [β-lactamases](#beta-lactamase)                  | ‹pending build› | ‹pending build› | `ProtT5 — UMAP 2` · `protein_families` |
| [Swiss-Prot](#swissprot)                         | ‹pending build› | ‹pending build› | `ProtT5 — UMAP 2` · `domain`           |

## Venom toxins (demo) {#demo}

_The small dataset ProtSpace opens with: reviewed animal venom proteins._

**Toxin families such as three-finger toxins and phospholipase A2 form their own clusters.**

Each colour in the `protein_families` legend is one toxin family, and the smaller families are grouped under **Other**. Switch to an `ESM2-650M` projection to see how a second protein language model arranges the same proteins.

- **Opens on:** `ProtT5 — UMAP 2`, coloured by `protein_families`; the tooltip adds `species` and `ec`.
- **Source:** Reviewed animal proteins that UniProt links to venom, UniProtKB query `(taxonomy_id:33208) AND (cc_tissue_specificity:venom OR cc_scl_term:SL-0177) AND (reviewed:true)`.
- **Proteins:** 7,831, from UniProt release ‹pending build›.
- **Embedding:** ProtT5-XL-U50 and ESM2-650M, computed on the mature peptides (signal peptides removed).
- **Projections:** UMAP 2D (50 neighbours, minimum distance 0.5, Euclidean, seed 42) and PCA 2D, for each model.
- **Annotations:** 17 columns from UniProt, Taxonomy and InterPro; releases: ‹pending build›.
- **Extras:** None.
- **Built with:** ‹pending build›
- **In the paper:** Not one of the paper's figures; ProtSpace opens with it because it is small.

<a href="/explore?dataset=demo" target="_self">Open in ProtSpace</a> · <a href="/data.parquetbundle" download>Download the bundle (0.9 MB)</a>

::: details How this bundle was built

‹pending build›

:::

## Venom toxins (EAT) {#venom-eat}

_Annotation transfer and separation scores on reviewed, secreted animal toxins._

**Rings are EC numbers transferred from the nearest annotated neighbour; drag reliability to 0.5 to keep 244 of 384.**

Coloured by `ec`, proteins whose EC number UniProt leaves empty show the value [EAT](/explore/eat) transferred from their nearest annotated neighbour as a hollow ring. The reliability filter starts at 0, so every transfer is shown and the [separation score](/explore/separation-scores) strips above the legend stay visible; any filter hides them. Hover P0DPU8: its EC number, phospholipase A2 (3.1.1.4), was transferred from F5CPF0 with reliability 0.58.

- **Opens on:** `ProtT5 — UMAP 2`, coloured by `ec`; the tooltip adds `protein_families` and `species`.
- **Source:** Reviewed UniProtKB proteins with the keywords Toxin (KW-0800) and Secreted (KW-0964), the paper's set; ‹query and release to be confirmed›.
- **Proteins:** ‹pending build›, from UniProt release ‹pending build›.
- **Embedding:** ProtT5-XL-U50 per-protein embeddings.
- **Projections:** UMAP 2D (25 neighbours, minimum distance 0.1, Euclidean, seed 42), the paper's coordinates, and PCA 2D.
- **Annotations:** ‹pending build›
- **Extras:** ‹pending build›
- **Built with:** ‹pending build›
- **In the paper:** Fig. 4 (panels a, d, e and f).

The transferred values, their reliabilities and the separation scores are the paper's own (EAT with k = 1), so the figure's numbers hold; the other annotations were fetched again for this build.

Open in ProtSpace: ‹pending build› · Download: ‹pending build›

::: details How this bundle was built

‹pending build›

:::

## Phosphatases (EAT benchmark) {#phosphatase-eat}

_The held-out benchmark behind the paper's 98.1 %._

**EC was withheld from 213 phosphatases and transferred back; above reliability 0.5, 98.1 % of the transfers are correct.**

EC numbers and protein families were withheld from 213 of the 832 reviewed phosphatases, and [EAT](/explore/eat) transferred them back from the nearest of the other 619. Coloured by `ec`, the view opens with the reliability filter at 0.5; hover a query to compare the transferred EC number with the withheld one. Like any filter, it hides the separation score strips; drag it to 0 to see every transfer. Colour by `eat_split` to see which proteins were queries and which were references.

- **Opens on:** `ProtT5 — UMAP 2`, coloured by `ec`; the tooltip adds `eat_split`, `ec_withheld` and `protein_families_withheld`.
- **Source:** UniProtKB query `(ft_domain:phosphatase) AND (reviewed:true)`; 213 of the 707 proteins with both an EC number and a family were held out as queries.
- **Proteins:** ‹pending build›, from UniProt release ‹pending build›.
- **Embedding:** ProtT5-XL-U50 per-protein embeddings from UniProt.
- **Projections:** UMAP 2D (25 neighbours, minimum distance 0.1, Euclidean) and PCA 2D.
- **Annotations:** ‹pending build›
- **Extras:** ‹pending build›
- **Built with:** ‹pending build›
- **In the paper:** The abstract and the annotation-transfer benchmark in the Results (k = 1, Euclidean: 91.5 % of the 213 transfers correct, 98.1 % of the 160 with reliability of at least 0.5).

The transfers are the paper's own. No step of this build refills the withheld values, so the benchmark still holds out what it held out.

Open in ProtSpace: ‹pending build› · Download: ‹pending build›

::: details How this bundle was built

‹pending build›

:::

## Human + fly {#human-fly}

_Two reference proteomes in one layout._

**Most families overlap across species (about 1,700 protein kinases). Recolour by protein family to find human-only MHC class I/II, β-defensins and CC chemokines and fly-only odorant-binding proteins.**

Coloured by `species`, human and fly proteins share most of the map, and the regions only one species occupies are where its own families sit. That overlap is the point of the view, which is why the separation score for `species` is close to zero. Recolour by `protein_families`: conserved families such as the protein kinases sit in the shared region, while MHC class I and II, β-defensins and CC chemokines are human-only and the odorant-binding proteins (PBP/GOBP family) are fly-only.

- **Opens on:** `ProtT5 — UMAP 2`, coloured by `species`; the tooltip adds `protein_families` and `reviewed`.
- **Source:** The reference proteomes UP000005640 (_Homo sapiens_) and UP000000803 (_Drosophila melanogaster_), with the paper's protein set.
- **Proteins:** ‹pending build›, from UniProt release ‹pending build›.
- **Embedding:** ProtT5-XL-U50 per-protein embeddings from UniProt.
- **Projections:** UMAP 2D (50 neighbours, minimum distance 0.2, Euclidean, seed 42), the paper's coordinates, and PCA 2D.
- **Annotations:** ‹pending build›
- **Extras:** ‹pending build›
- **Built with:** ‹pending build›
- **In the paper:** Fig. 2B.

UniProt no longer publishes an embedding for 146 of these proteins; they keep their position from the paper.

Open in ProtSpace: ‹pending build› · Download: ‹pending build›

::: details How this bundle was built

‹pending build›

:::

## β-lactamases {#beta-lactamase}

_One enzyme superfamily across all of life._

**Class C forms a sharp region while classes A and D are diffuse. Q02940, curated as class C, sits away from the other class-C proteins.**

Coloured by `protein_families`, the Ambler class C proteins form one sharp region, classes A and D are diffuse, and the metallo-β-lactamase superfamily, about 70 % of the entries, spreads over much of the map. That catch-all is why the separation score for the whole annotation is low even though class C separates well. Search for Q02940: curated as class C, it sits away from the other class-C proteins, a candidate misannotation. Then colour by `ec`, the annotation that agrees best with the clusters of the layout.

- **Opens on:** `ProtT5 — UMAP 2`, coloured by `protein_families`; the tooltip adds `ec` and `species`.
- **Source:** UniProtKB query `family:"beta-lactamase"` at release 2026_02, the paper's 113,015 proteins; ‹how they were selected from the query's hits: to be confirmed›.
- **Proteins:** ‹pending build›, from UniProt release ‹pending build›.
- **Embedding:** ProtT5-XL-U50 per-protein embeddings from UniProt.
- **Projections:** UMAP 2D (200 neighbours, minimum distance 0.4, Euclidean, seed 42), the paper's coordinates, and PCA 2D.
- **Annotations:** ‹pending build›
- **Extras:** ‹pending build›
- **Built with:** ‹pending build›
- **In the paper:** Fig. 3.

Open in ProtSpace: ‹pending build› · Download: ‹pending build›

::: details How this bundle was built

‹pending build›

:::

## Swiss-Prot {#swissprot}

_Every reviewed UniProtKB protein in one map._

**Bacteria and eukaryotes occupy largely distinct regions; archaeal and viral proteins form compact islands.**

The colours are `domain`, the domain of life. Scored over the whole map the domains separate poorly, because bacterial and eukaryotic proteins each spread over large areas, but per category the archaeal proteins stand out. Colour by `pfam`: a protein with several Pfam families is drawn as a pie. Search for P12931 (SRC) to see one.

- **Opens on:** `ProtT5 — UMAP 2`, coloured by `domain`; the tooltip adds `protein_families` and `species`.
- **Source:** All reviewed UniProtKB/Swiss-Prot entries that UniProt publishes a ProtT5 embedding for (it computes none for sequences over 12,000 residues), the paper's protein set.
- **Proteins:** ‹pending build›, from UniProt release ‹pending build›.
- **Embedding:** ProtT5-XL-U50 per-protein embeddings from UniProt.
- **Projections:** UMAP 2D (500 neighbours, minimum distance 0.2, Euclidean, seed 42), the paper's coordinates. There is no PCA, to keep the download smaller.
- **Annotations:** ‹pending build›
- **Extras:** ‹pending build›
- **Built with:** ‹pending build›
- **In the paper:** Fig. 2A and the abstract.
- **Large:** ‹pending build›

Open in ProtSpace: ‹pending build› · Download: ‹pending build›

::: details How this bundle was built

‹pending build›

:::

## Next Steps

- [Importing Data](/explore/importing-data) - open your own `.parquetbundle` or FASTA file
- [Using Python CLI](/guide/python-cli) - build a bundle like these from your own proteins
