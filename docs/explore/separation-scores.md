# Separation Scores

Separation scores answer one question: **does this annotation actually form clusters in this projection?** A high score means proteins sharing an annotation value sit together and apart from the rest. A low score means the annotation cuts across the layout rather than explaining it.

They appear only for datasets prepared with statistics:

```bash
protspace prepare -i embeddings.h5 -m pca2,umap2 --stats -o output
```

Without `--stats` the bundle carries no statistics part, so the legend shows no strips and the metadata panel drops its Separation and Recovers blocks. It keeps the reduction's parameters, and it keeps Faithfulness to the embedding wherever those metrics were computed: they ride in the projection metadata (`info_json.quality`) rather than in the statistics part. See [Data Preparation](/guide/data-preparation) for the full pipeline.

## Where They Appear

**At the top of the legend panel, above the category list**, two strips place one dot per category on a shared axis, one strip for silhouette and one for Davies–Bouldin. Each dot carries its category's colour, so you can see at a glance whether an annotation separates uniformly or whether one group is dragging the average down. Hovering a dot marks the matching legend row, and hovering a legend row marks its dot. Either way, the readout to the right of each axis gives that category's exact value, so you get its silhouette and its Davies–Bouldin together rather than one at a time. Idle, that readout shows `—`, and it stays at `—` for a category the metric could not score: Davies–Bouldin has no value for a one-member category. Clicking a dot toggles that category's visibility, exactly as clicking its legend row does.

**In the projection metadata panel**, opened with the chart button at the top left of the plot, the Separation section carries the whole-annotation scores for all three metrics and names the annotation it was scored on. It comes first because the score blocks are what change when you recolour. Below it sit Recovers (for a cluster annotation only, described further down), then Faithfulness to the embedding, which holds measures such as trustworthiness that describe the layout itself and involve no annotation at all, and finally How it was made, the reduction's own settings.

## The Three Metrics

| Metric            | Range    | Direction        | Reads as                                                                                                                          |
| ----------------- | -------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Silhouette        | -1 to 1  | Higher is better | Above 0.5 is clear separation, near 0 means the groups overlap, below 0 means proteins are typically closer to a different group. |
| Davies–Bouldin    | 0 upward | Lower is better  | The average overlap between each group and the group it is most confusable with. No upper bound.                                  |
| Calinski–Harabasz | 0 upward | Higher is better | The spread between groups divided by the spread within them. No upper bound, and it grows with dataset size.                      |

Only silhouette is on a fixed scale, so it is the one number that means the same thing across datasets. The other two have no upper bound: read them by comparing projections of the same data, not against a threshold.

Each metric carries an ⓘ popover with that same explanation wherever it is shown: on each strip's header in the legend, on each metric row in the panel's Separation block, on the two metric column heads in Recovers, and on each Faithfulness row. The Separation and Recovers headings carry one of their own too, explaining what the two value columns mean. So you never have to leave the page to interpret a number.

## Why Only Two Metrics Have Per-Category Scores

Silhouette and Davies–Bouldin both decompose. Silhouette is defined as an average over proteins, so grouping those per-protein values by category gives each category its own score. Davies–Bouldin is defined as an average over categories in the first place, and each category's term is its overlap with its single worst rival, so that term is the per-category score.

Calinski–Harabasz is a single global variance ratio with no accepted per-category form, so it appears in the panel only and has no strip.

## The "Embedding" Column

Beside each score in the panel is its value on the original high-dimensional embedding. That is the ceiling: how much separation genuinely exists before any projection, so you can tell "this annotation does not separate" from "this 2D layout lost the separation that was there".

A silhouette of 0.30 against an embedding value of 0.35 means the projection kept almost everything. The same 0.30 against 0.80 means the layout is hiding real structure, and another projection may show it better. Per-category ceilings appear in the strip tooltips.

## Categories With A Single Member

A category holding one protein has no spread: the protein is its own centre. Any separation score for it would describe its neighbours rather than itself, so single-member categories are left out. The strips are where this shows, since legend rows carry no score cell of their own: a single-member category gets no dot on either one, and hovering its legend row leaves both readouts at their `—` idle state.

Davies–Bouldin and Calinski–Harabasz are computed over the remaining categories, since both weight every category equally regardless of size and a single one-member category would otherwise take a full share of the average.

Silhouette is different in one respect worth knowing: its whole-annotation number still covers every protein, single-member categories included, because a lone protein's silhouette is defined as exactly 0 and contributes nothing to the average either way.

The practical effect shows up most on deep taxonomic ranks. Scoring a venom dataset by `class` gives 10 categories of which 2 hold one protein each, so those 2 are dropped and the other 8 score normally. By `family` the same dataset has 42 categories with 14 singletons, and a strip with 14 gaps in it is itself the useful signal: that annotation is too fine-grained for this dataset.

## Scores Cover The Whole Dataset

Scores are computed once, during preparation, over every protein. Hiding legend values or filtering the view does not recompute them, so the panel states it once in a footer: `All scores are for the full dataset.`, which becomes `All scores are for the full dataset, not this view.` while the view is narrowed. It sits at the panel's foot rather than inside Separation because it governs Faithfulness to the embedding just as much. The Separation section's own scope line reports coverage instead, as in `5 categories · 1,427 proteins scored`.

Because a filtered view and a whole-dataset score would contradict each other on screen, the strips are replaced by "Separation scores are hidden while the view is filtered" whenever a filter is active. This includes the EAT reliability slider. Clear the filter and the strips return.

Sorting is not affected. The scores are read from the unsliced dataset, so **By separation** stays available in the legend's sort options and keeps ordering rows correctly while the strips themselves are hidden.

Above 5000 proteins the computation runs on a deterministic 5000-protein subsample, seeded from the protein identifiers, so the same dataset always produces the same scores.

## Cluster Annotations

Preparing with `--stats` also adds `cluster_elbow_*` and `cluster_silhouette_*` annotations, an automatic K-means grouping of the embedding. Selecting one adds a **Recovers** block to the panel: a ranked table of how closely that clustering reproduces each real annotation, best ARI first, because the question it answers is "which known biology do these clusters correspond to?" rather than a lookup. Its header states K once and names the two metrics, `6 clusters vs` / `ARI ↑` / `NMI ↑`, so every row below reads as a sentence. Each row is one annotation, with its category count beside the name (`· 42 cat`): ARI's achievable maximum falls as an annotation's cardinality diverges from K, so a low ARI beside a very different category count can still be a clean correspondence, which is what NMI shows. A row whose comparison covered fewer proteins than the rest of the block says so (`192 of 811 scored`), so thin coverage cannot be misread as a strong match. The best 12 rows show by default, with a `Show 8 more (best 0.31)` button for the rest. The block is absent for ordinary annotations, where the comparison would not make sense.

These clusterings also carry their own separation scores, so the strips work on them exactly as on any annotation. Earlier versions instead attached each protein's own silhouette to its cluster value, so it showed up when you hovered that point in the plot. That was the only place in ProtSpace where a separation score was reported per protein rather than per group, and it is gone: a cluster is read through the strips, like every other annotation. Read those scores as descriptive rather than as a verdict, which is what the note under the strips warns about: K-means drew the boundaries being scored, in the very projection they are scored in, so it starts with an advantage no curated annotation has. A `cluster_silhouette_*` column goes further, since its K was chosen by maximising exactly the silhouette being reported. The per-category numbers are the part worth reading: they say which cluster is tight and which is mush, which the average cannot. The Recovers block is the independent half, comparing the clustering against something it did not choose.

A clustering belongs to the projection it was found in, and the panel's two score blocks treat that differently. Separation and the legend strips are scoped to the projection on screen, so selecting `cluster_elbow_ProtT5 — PCA 2` while viewing `ProtT5 — UMAP 2` shows the groups with no separation scores: none were ever computed for that pair. Recovers is deliberately not scoped that way. ARI and NMI describe the clustering itself, not whichever projection the panel happens to be open on, so PCA 2's agreement numbers stay readable while you look at UMAP 2.

## Next Steps

- [Using the Legend](/explore/legend) - filtering, colours, and sorting by separation
- [Data Preparation](/guide/data-preparation) - preparing a dataset with `--stats`
