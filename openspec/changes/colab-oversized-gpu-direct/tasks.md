## 1. Backend

- [x] 1.1 `setup_model` loads every family with `device_map=<the GPU>` on CUDA when `accelerate` is
      importable; CPU and no-`accelerate` loads unchanged
- [x] 1.2 `accelerate` in the `[local]` extra
- [x] 1.3 Public `stages_in_host_ram()`, shared with the placement rule
- [x] 1.4 `embed_sequences` warns about an oversized model only where it stages in host RAM

## 2. Notebook

- [x] 2.1 Preparation panel: block `COLAB_OVERSIZED` only where `stages_in_host_ram()` (missing on
      released packages = True) and RAM < 16 GB

## 3. Tests

- [x] 3.1 `device_map` per family × {CUDA + accelerate, CUDA without, CPU}
- [x] 3.2 `stages_in_host_ram()` per runtime; the oversized warning follows it
- [x] 3.3 Panel: a small runtime that loads onto the GPU enables `esmc_6b`/`esm2_3b`; one that stages
      (incl. a released package without the function) blocks them

## 4. Measurement and docs

- [x] 4.1 Colab benchmark on the free T4 (results in the proposal and the PR)
- [x] 4.2 `docs/guide/python-cli.md` local-backend section, `apps/protspace/CLAUDE.md`
- [ ] 4.3 tsenoner/protspace#563: the ClickThrough notebook's loader and RAM gate get the same rule
