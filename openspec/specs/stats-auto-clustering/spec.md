# stats-auto-clustering Specification

## Purpose

Where `stats` and `prepare --stats` run their automatic K-means clustering (each projection, each embedding, or both), how each cluster column is named and shared, and how an embedding clustering is scored, styled and captioned.

## Requirements

### Requirement: Cluster space selection

`protspace stats` and `protspace prepare --stats` SHALL accept `--cluster-space` with the values `projection`, `embedding` and `both`, defaulting to `both`. `projection` SHALL cluster each projection on its own coordinates, `embedding` SHALL cluster each embedding once in the embedding space, and `both` SHALL do both. `prepare` SHALL reject a non-default `--cluster-space` given without `--stats`.

#### Scenario: Default writes both kinds of column

- **WHEN** `prepare -i emb.h5:esm2_650m -m umap2,tsne2 --stats` runs with no `--cluster-space`
- **THEN** the bundle carries `cluster_elbow_ESM2-650M — UMAP 2`, `cluster_elbow_ESM2-650M — t-SNE 2` and `cluster_elbow_esm2_650m`

#### Scenario: Projection only

- **WHEN** the same command runs with `--cluster-space projection`
- **THEN** the bundle carries the two per-projection columns and no `cluster_elbow_esm2_650m`

#### Scenario: Embedding only

- **WHEN** the same command runs with `--cluster-space embedding`
- **THEN** the bundle carries `cluster_elbow_esm2_650m` and no per-projection cluster column

#### Scenario: Option without --stats

- **WHEN** `prepare` runs with `--cluster-space embedding` and without `--stats`
- **THEN** it exits with an error naming `--stats`

### Requirement: Statistics API cluster-space default

The statistics API SHALL apply the CLI's default cluster space when none is given, and SHALL fall back to it for an unrecognised value rather than emitting no clustering.

#### Scenario: Unrecognised value

- **WHEN** `compute_statistics` is called with `cluster_space="nowhere"`
- **THEN** it emits the same cluster columns as with no `cluster_space`

### Requirement: Projection-space cluster columns

Projection-space clustering SHALL write, for each projection, one categorical annotation column per K-selection, named `cluster_elbow_<projection name>` or `cluster_silhouette_<projection name>`, holding `cluster N` for every protein of that projection. Cluster numbers SHALL be independent between projections.

#### Scenario: One column per projection

- **WHEN** a run with `--cluster-space projection` has a UMAP and a t-SNE of one embedding
- **THEN** each projection gets its own `cluster_elbow_*` column, and the same protein can carry different cluster numbers in the two

### Requirement: Embedding-space cluster columns

Embedding-space clustering SHALL run once per embedding that is not a precomputed similarity matrix, and SHALL write one categorical annotation column per K-selection, named `cluster_elbow_<embedding name>` or `cluster_silhouette_<embedding name>`, holding `cluster N` for every protein of that embedding. Every projection of that embedding SHALL share the column. K SHALL be chosen by the same `--cluster-selection` rule as projection clustering.

#### Scenario: Shared across projections

- **WHEN** a UMAP and a t-SNE of embedding `esm2_650m` are prepared with `--stats`
- **THEN** one column `cluster_elbow_esm2_650m` exists, and colouring either projection by it shows each protein in the same cluster

#### Scenario: Two embeddings

- **WHEN** a run has embeddings `prot_t5` and `esm2_650m`
- **THEN** it writes `cluster_elbow_prot_t5` and `cluster_elbow_esm2_650m`, each clustered in its own embedding

#### Scenario: Precomputed similarity input

- **WHEN** the only input is a precomputed similarity matrix
- **THEN** no embedding-space cluster column is written

### Requirement: Embedding clustering input

An embedding of more than 50 dimensions SHALL be clustered on its top 50 principal components, and one of 50 or fewer dimensions as it is. The cluster labels SHALL depend only on the set of protein ids and the seed, not on the row order.

#### Scenario: Row order does not matter

- **WHEN** the same embedding is clustered twice with its rows in a different order
- **THEN** every protein gets the same cluster number both times

#### Scenario: High-dimensional embedding

- **WHEN** an 80-dimensional embedding holding four well-separated groups is clustered
- **THEN** the elbow finds four clusters, each holding one group

### Requirement: Embedding cluster separation scores

An embedding-space clustering SHALL be scored as an annotation, with `label_kind` `kmeans_elbow` or `kmeans_silhouette` and the column's name as `annotation`. Its separation scores SHALL be computed on the full embedding, with `space_kind=embedding` and the embedding's name, and again on the coordinates of every projection whose source is that embedding, with `space_kind=projection` and the projection's name.

#### Scenario: Separation in every projection

- **WHEN** a bundle prepared with `--stats` and the default cluster space is opened on its t-SNE and coloured by `cluster_elbow_<embedding>`
- **THEN** the legend shows separation strips for that column on the t-SNE, and the panel's Embedding column shows the same clustering's scores on the embedding

#### Scenario: Stats without annotations

- **WHEN** `protspace stats` runs without `-a`
- **THEN** no embedding cluster column and none of its separation rows are written

### Requirement: Auto-cluster score caveat names where K-means ran

The web app SHALL print one caveat under an auto-cluster column's separation scores, in the legend strips and in the panel's Separation block, chosen by the `space_kind` of that column's `n_clusters` row. A projection clustering SHALL get the caveat that its scores in this projection are optimistic. An embedding clustering SHALL get the caveat that its Embedding scores are optimistic and that its scores in a projection show how well the layout keeps its groups.

#### Scenario: Embedding clustering on a projection

- **WHEN** a projection is coloured by `cluster_elbow_<embedding>`
- **THEN** the note under the strips and under Separation says K-means found the clusters in the embedding, and does not call this projection's scores optimistic

#### Scenario: Projection clustering

- **WHEN** a projection is coloured by its own `cluster_elbow_<projection>`
- **THEN** the note says K-means found the clusters in this projection, so these scores are optimistic

### Requirement: Embedding cluster K and agreement rows

An embedding-space clustering's chosen K SHALL be recorded as an `n_clusters` meta row with `space_kind=embedding`. When annotations are scored, its ARI and NMI against each one SHALL be recorded once, with `space_kind=embedding`.

#### Scenario: Recovers block

- **WHEN** a bundle prepared with `--stats` and an annotation `family` is coloured by `cluster_elbow_<embedding>`
- **THEN** the panel's Recovers block lists `family` with the embedding clustering's ARI and NMI

#### Scenario: K without annotations

- **WHEN** `protspace stats` runs without `-a`
- **THEN** each embedding still gets an `n_clusters` row

### Requirement: Cluster column styling

Every cluster column, projection-space or embedding-space, that landed values in the annotations table SHALL get an auto-generated legend style: one Kelly-palette colour per `cluster N`, ordered by N.

#### Scenario: Embedding column is styled

- **WHEN** `protspace stats -a annotations.parquet --settings-out styles.json` runs with the default cluster space
- **THEN** `styles.json` holds an entry for `cluster_elbow_<embedding>` next to the per-projection entries
