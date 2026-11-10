## 1. Reference

- [x] 1.1 Embed a test FASTA (Pla2g2's 448 proteins, rare residues included, plus three 624–1705 aa
      concatenations) with the current Synthyra path on the locked transformers, for both sizes

## 2. Backend

- [x] 2.1 Map `esmc_300m` / `esmc_600m` to `biohub/ESMC-300M` / `-600M` in `LOCAL_CHECKPOINTS`
- [x] 2.2 Load the `esmc` family with `AutoModel` / `AutoTokenizer`, no `trust_remote_code`
- [x] 2.3 Drop the ESM-C tokenizer special case; check whether the `gc.collect()` workaround is
      still needed (it is: kept, comment corrected)
- [x] 2.4 Update `tests/test_local_embedder.py` for the new checkpoints and loading
- [x] 2.5 Raise the `[local]` floor to `transformers>=5.16.0` with `uv add`, and check the Colab
      snapshot still resolves (`PROTSPACE_COLAB_RESOLVE=1`, `tests/test_colab_compat.py`)

## 3. Parity on real weights

- [x] 3.1 Embed the same FASTA with the new code on transformers 5.16.0 and on the latest release
- [x] 3.2 Compare per-protein vectors with the reference (cosine, relative L2, max abs diff), and
      resume a reference `.h5` with the new code to confirm the producer stamp is accepted
- [x] 3.3 Decide whether existing caches need a producer change, and record the numbers

## 4. Docs

- [x] 4.1 `apps/protspace/CLAUDE.md`: embedder table (local vs Biocentral checkpoint) and the
      ESM-C note that said to keep Synthyra until #46419 merges
- [x] 4.2 `docs/guide/python-cli.md`: local-backend section and licensing note
- [x] 4.3 `local.py` module docstring

## 5. Checks

- [x] 5.1 `uv run pytest -m "not slow"` in `apps/protspace`
- [x] 5.2 `pnpm precommit`
- [x] 5.3 `openspec validate --strict`, archive, prettier on the synced spec
