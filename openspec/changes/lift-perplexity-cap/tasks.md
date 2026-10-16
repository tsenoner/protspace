## 1. Package

- [ ] 1.1 `DimensionReductionConfig.perplexity`: `gte 5` only; docstring
- [ ] 1.2 `check_method_params`: refuse t-SNE perplexity >= proteins before annotations, with
      both numbers and `n / 3`; the t-SNE reducer refuses it the same way
- [ ] 1.3 Tests: > 50 accepted, >= n refused with the message before annotations, 20 proteins
      with the default, docs range in step

## 2. Notebook and docs

- [ ] 2.1 Perplexity slider 5–500; Generate checks it against the protein count first
- [ ] 2.2 `python-cli.md` and `data-preparation.md`
