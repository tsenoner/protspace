## 1. Notebook

- [x] 1.1 One cell with every setting; `_run()` under `__main__`; a download-again cell
- [x] 1.2 ESM C through transformers' `esmc` (biohub weights, checked equal to ESM++); ESM3 from
      `biohub/esm3-sm-open-v1`, the `esm` package installed only for it; no pyfaidx
- [x] 1.3 No second weights download; model kept across re-runs; resume; `_per_res` files
- [x] 1.4 One line per stage with a live timer for the weights; HF bars and load reports hidden;
      Drive mounted for a Drive path; '/' in IDs replaced; accessions by default

## 2. Docs and checks

- [x] 2.1 Root README, package README, data-preparation and CLI guides list it as an embedding tool
- [x] 2.2 Tests rewritten for the one cell; real runs with ESM2-8M, ESM C 300M and ProtT5 in a
      Colab-like environment (transformers 5.18, torch 2.11)
