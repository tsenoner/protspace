# reducer-parameter-limits Specification

## Purpose

Which dimensionality-reduction parameter values protspace refuses, when it refuses them, and how it says so: t-SNE's perplexity has a floor of 5 and must stay below the number of proteins.

## Requirements

### Requirement: t-SNE perplexity has a floor of 5 and no fixed ceiling

`DimensionReductionConfig` SHALL accept any t-SNE perplexity of at least 5, so `prepare`,
`project` and the Colab panel accept a perplexity above 50.

#### Scenario: Perplexity 100 on a large dataset

- **WHEN** `protspace prepare` runs t-SNE with `--perplexity 100` on 5,000 proteins
- **THEN** the projection is computed with perplexity 100

### Requirement: A perplexity the data cannot support is refused before the work starts

The pipeline SHALL refuse a t-SNE perplexity at or above the number of proteins before it fetches
annotations, with a message naming the perplexity, the protein count and the `n / 3` rule of
thumb. The t-SNE reducer SHALL refuse it with the same message.

#### Scenario: The default perplexity on 20 proteins

- **WHEN** `prepare` runs t-SNE with the default perplexity 30 on 20 proteins
- **THEN** it stops before fetching annotations, saying 30 is not below 20 proteins and to use
  about 6
- **AND** no scikit-learn traceback is shown

#### Scenario: n_neighbors above the protein count

- **WHEN** UMAP runs with n_neighbors 25 on 20 proteins
- **THEN** the run is not refused
