## 1. Shared HDF5 layer

- [x] 1.1 Add `apps/protspace/src/protspace/data/embedding/store.py` with
      `load_existing_ids`, `save_embeddings`, `validate_headers` (moved from
      `biocentral.py` / `local.py`) and `finish_run()`.
- [x] 1.2 Re-export `load_existing_ids` and `save_embeddings` from `biocentral.py`
      so `local.py`, `cli/annotate.py` and existing tests keep importing them.
- [x] 1.3 `finish_run()` computes `expected = requested − skipped`, raises when the
      HDF5 does not cover `expected`, raises when nothing landed at all, and
      otherwise emits one stderr summary at warning level.

## 2. Both backends call the contract

- [x] 2.1 `biocentral.py`: call `validate_headers` before the first batch; replace
      the inline gate with `finish_run(..., skipped={})`.
- [x] 2.2 `local.py`: capture over-length and OOM-skipped identifiers into a
      `{id: reason}` map instead of only logging them; call `finish_run` with it.
- [x] 2.3 `local.py`: stop advancing the progress bar for an OOM-skipped sequence.
- [x] 2.4 Verify neither backend imports from the other.

## 3. `--max-length`

- [x] 3.1 Add `Opt_MaxLength` to `cli/common_options.py`, rejecting values below 1.
- [x] 3.2 Wire it through `cli/embed.py` and `cli/prepare.py` into `LocalEmbedConfig`.
- [x] 3.3 Reject it (or document it as ignored) for `--backend biocentral`, which
      has no length cap.

## 4. FASTA coverage

- [x] 4.1 Add the coverage check to `data/processors/pipeline.py`, normalising both
      sides through `parse_identifier`.
- [x] 4.2 Fail when similarity is requested and any embedded protein is uncovered;
      warn otherwise; say nothing when the FASTA is a superset.
- [x] 4.3 Place it so it runs before `compute_similarity`, not after.
- [x] 4.4 Confirm the message contains no `_BIOCENTRAL_DOWN_PATTERNS` substring.

## 5. Tests

- [x] 5.1 `test_local_embedder.py`: over-length skip exits 0 and is named; OOM skip
      exits 0 and is named; a non-skip shortfall fails; skipping everything fails;
      the bar does not advance for a skip.
- [x] 5.2 `test_biocentral_embedder.py`: `/` now rejected up front; the disk gate
      still catches a writer that under-delivers.
- [x] 5.3 New coverage tests: uncovered + similarity fails, uncovered alone warns,
      superset silent, mixed identifier styles reconcile.
- [x] 5.4 `test_backend_switch.py`: `--max-length` wiring and rejection.
- [x] 5.5 Both backends raise the same error for the same invalid identifier.

## 6. Docs + verification

- [x] 6.1 Update `apps/protspace/docs/cli.md` and `README.md` for `--max-length`
      and the completeness/coverage behaviour.
- [x] 6.2 Update the CLI table in `apps/protspace/CLAUDE.md` if it drifts.
- [x] 6.3 Check the Colab notebooks for anything relying on a partial run exiting 0.
- [x] 6.4 `uv run ruff check src/ packages/ tests/` + `uv run ruff format --check src/ packages/ tests/`.
- [x] 6.5 `uv run pytest -m "not slow"` from `apps/protspace`.
- [x] 6.6 `pnpm format:check` for the openspec markdown.
- [x] 6.7 `openspec validate embed-completeness-contract --type change --strict`.

## 7. Follow-ups filed, not fixed here

- [x] 7.1 Filed #471 for the `np.allclose(np.diag(data), 1)` heuristic in
      `base_processor.py` — thread an explicit `is_similarity` flag from
      `compute_similarity` instead of inferring it from the diagonal.
- [x] 7.2 Filed #472 for `load_existing_ids` vs the loader's grouped view: a
      grouped third-party `.h5` re-embeds everything and writes flat duplicates.
- [x] 7.3 Filed #473 for `protspace embed` writing raw `sp|…` keys where
      `prepare` writes parsed accessions.
