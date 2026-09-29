Tracks 1–3 run in parallel on separate worktrees branched from `fix/annotation-retrieval`, and
section 4 runs after all three are merged back. Rules for every track:

- Edit only the files your track owns in design.md "Track partition". Where a test file is
  shared, edit only the hunks assigned to you.
- Use TDD. Write the failing test, run it and see it fail, then fix. Tests are offline: mock
  `requests`, `BiocentralAPI` and the retrievers; no live HTTP.
- Run Python only through `uv run`, for example `uv run pytest apps/protspace/tests -q`,
  `uv run ruff check apps/protspace` and `uv run ruff format apps/protspace`. No dependency
  changes are expected. If one is needed, use `uv add`/`uv remove`.
- Write Angular commit subjects under 72 characters, with types chosen per commit because
  semantic-release parses each one: `fix(protspace):` for a bug fix, `feat(protspace):` for a new
  user-visible flag or output, and `test`/`refactor`/`chore`/`docs` for anything that must not
  release. End every message with the session's two trailer lines. No push, no PR.

## 1. Track 1 — retrievers (InterPro fan-out and retry, Biocentral batching, TED retry)

- [x] 1.1 Failing test in `test_interpro_annotation_retriever.py`: two identifiers with identical
      sequences both receive the same parsed InterPro values, and the mocked POST carries that
      MD5 once. Add a third, unique identifier as a control, and a duplicated sequence whose
      result is `found: false`, which leaves both of its identifiers empty.
- [x] 1.2 Map `md5 → [identifiers]` in `InterProRetriever.fetch_annotations` and fan the parsed
      values out in `_parse_interpro_results`. Commit:
      `fix(protspace): give InterPro matches to all proteins sharing a sequence`.
- [x] 1.3 Failing tests for the InterPro POST retry:
  - in `test_http_retry.py`, `post_with_retry`: 503 then 200 succeeds, 429 honours
    `Retry-After`, a 400 is not retried, attempts are bounded, and a timeout or connection
    error is retried;
  - in `test_interpro_annotation_retriever.py`, a batch that fails once and then succeeds
    leaves `failed_batch_count == 0`, and a batch that fails every attempt counts one lost
    batch while the other batches are still parsed.
- [x] 1.4 Add `post_with_retry` to `http_utils.py`, sharing one private retry loop with
      `get_with_retry` so the two policies cannot diverge, and route the InterPro POST through
      it with the default budget and the unchanged 30 s timeout. Commit:
      `fix(protspace): retry InterPro match requests before counting them lost`.
- [x] 1.5 Failing tests in `test_biocentral_retriever.py`, with `BiocentralAPI` mocked:
  - 2,500 unique sequences make 3 `predict` calls of at most 1,000 each;
  - duplicates are submitted once overall and fanned out;
  - a sequence longer than 2,000 aa is submitted;
  - when one of three batches raises, the other batches' proteins keep their predictions,
    `prediction_failed` is `True`, and one warning names the missing-protein and failed-batch
    counts;
  - that warning contains none of the eight `_BIOCENTRAL_DOWN_PATTERNS` substrings. Copy the
    tuple literally, as `test_embed_completeness.py` does; do not import `protspace_prep`.
- [x] 1.6 Batch the deduplicated sequences at `_BATCH_SIZE` in `_run_predictions`: one health
      check, one progress bar, and per-batch results merged by sequence hash. Keep
      `prediction_failed` as the manager-facing signal and the "longer than the recommended"
      warning suppressed. Commit: `fix(protspace): batch Biocentral predictions`.
- [x] 1.7 Failing tests in `test_ted_retriever.py`:
  - a lookup that fails in the first pass and succeeds in the final pass yields its domains and
    `failed_lookup_count == 0`;
  - a lookup failing in both passes counts once, and the warning names it;
  - 10 consecutive final-pass failures stop the pass and count the rest as failed, with no
    further requests;
  - a 404 is never retried in the final pass;
  - the first pass still uses `attempts=2`.
- [x] 1.8 Collect first-pass failures in `TedRetriever.fetch_annotations` and retry them after
      the first pass with the default attempt budget, stopping after 10 consecutive failures.
      `failed_lookup_count` counts only lookups still failing after the final pass, and results
      keep the input order. Commit:
      `fix(protspace): retry failed TED lookups after the first pass`.
- [x] 1.9 Failing tests for the release header:
  - in `test_http_retry.py`, `paginated_get` calls `on_response` once per page;
  - in `test_uniprot_annotation_retriever.py`, `UniProtRetriever.releases` collects every
    `X-UniProt-Release` value seen across batches and single-entry resolution, and is an empty
    set when no response carries the header.
- [x] 1.10 Add the optional `on_response` callback to `paginated_get` and record the header on
      `UniProtRetriever.releases: set[str]`, which is initialised in `__init__`. This is the
      frozen interface Track 3 consumes. Commit:
      `refactor(protspace): record the UniProt release each response reports`.
- [x] 1.11 Track gate, all clean: `uv run pytest apps/protspace/tests -q -m "not slow"`,
      `uv run ruff check apps/protspace` and `uv run ruff format --check apps/protspace`.

## 2. Track 2 — parser + bundle (family names, internal columns)

- [x] 2.1 Failing tests in a new `test_protein_families_parser.py`, using real UniProt text
      shapes:
  - `… (TC 3.A.3) family. Type IIA subfamily` keeps `(TC 3.A.3)`;
  - `X superfamily. Y family. Z subfamily` yields `X superfamily`;
  - text without the prefix yields its first sentence;
  - the evidence suffix is kept;
  - no SIMILARITY comment yields `""`;
  - two sections (the P00561 shape) yield two `;`-joined families in order, each with its
    evidence;
  - four sections (the P27708 shape, `In the 2nd section`, `In the 3rd section`) yield four;
  - a repeated family appears once;
  - a `;` inside a name is still percent-encoded.
- [x] 2.2 Rewrite `UniProtEntry.protein_families` to walk every SIMILARITY text and apply the
      design.md rules: drop the section qualifier, drop the prefix, and split sentences at a `.`
      followed by whitespace or the end of the text, never inside parentheses.
- [x] 2.3 Failing tests: `transform_protein_families` returns a multi-family value with evidence
      unchanged, and does so again when fed its own output; `strip_scores_from_df` strips each
      family's evidence and drops none.
- [x] 2.4 Make `transform_protein_families` pass values through unchanged. Rewrite the
      first-family expectations in `test_transformer.py` and in the protein-family test methods
      of `test_annotation_manager.py` (only those methods) to the new contract. Commit parser
      and transformer together as `fix(protspace): keep UniProt family names whole`.
- [x] 2.5 Failing tests in a new `test_bundle_internal_columns.py`:
  - `write_bundle`, and `protspace bundle -a` given a cache-shaped parquet, drop `organism_id`
    and `sequence`, keep every other column, and keep the v2 format stamp;
  - `replace_annotations_in_bundle`, and `protspace transfer`, drop them from a bundle that
    carried them;
  - `protspace annotate -a sequence`, with its HTTP mocked, still writes `sequence` to its
    parquet.
- [x] 2.6 Drop `INTERNAL_ANNOTATIONS` in `data/io/bundle.py` inside `write_bundle` (annotations
      table) and `replace_annotations_in_bundle`, before stamping. Import the constant inside
      the function. Commit: `fix(protspace): never write internal columns into a bundle`.
- [x] 2.7 Track gate: the same three commands as 1.11, all clean. Run ruff on
      `src/ packages/ tests/` from `apps/protspace`, as CI does: from the repository root,
      `ruff check apps/protspace` also reaches three notebooks that already fail at the base
      commit (I001, E402, format), which CI's ruff paths skip.

## 3. Track 3 — pipeline (per-source cache, `annotate --cache-dir`, `uniprot_release`)

- [x] 3.1 Failing tests in a new `test_annotation_checkpoints.py`, with the retrievers mocked:
  - UniProt and InterPro succeed and the TED fetch raises `KeyboardInterrupt`; the on-disk
    cache then holds the UniProt and InterPro columns, and a second run calls only TED;
  - a later source that is incomplete leaves the earlier checkpoint's columns cached;
  - with `pfam` cached and `smart` newly requested, a checkpoint written before InterPro runs
    still holds `pfam`;
  - in a fill-in run, rows for new identifiers are absent from a checkpoint until every pending
    source has filled them in;
  - a full cache hit writes nothing, and neither does `output_path=None`.
- [x] 3.2 Checkpoint in `ProteinAnnotationManager.to_pd` after each source fetched this run,
      through the final write's rules, following the two design.md rules (pending sources keep
      their cached columns; new rows wait for their pending sources). Keep the failure signals
      the manager reads unchanged. Commit:
      `fix(protspace): persist each annotation source as it finishes`.
- [x] 3.3 Measure one checkpoint (merge, transform, write) on a synthetic 573K-row, 40-column
      frame, and record the time and peak memory in the PR description.
      Measured on an Apple-silicon Mac, 573,649 rows × 40 columns, two sources pending:
      7.7 s per checkpoint (merge, transform, staged parquet write of an 11 MiB file), with
      the process's peak RSS rising by about 2.6 GB during it (3.1 GB → 5.7 GB) and a traced
      Python peak of about 1.6 GiB.
- [x] 3.4 Move the cache orchestration out of `ReductionPipeline._fetch_annotations` into
      `data/annotations/cache.py`: the TED-label rewrite, stale-column refresh, `--refetch`,
      fill-in, the legacy UniProt fallback and the warm-cache fast path. The pipeline method
      stays as the caller that also merges the CSV. The existing `test_pipeline_utils.py` suite
      passes without edits, apart from monkeypatch targets that moved. Commit:
      `refactor(protspace): share the annotation cache logic`.
- [x] 3.5 Move `REFETCH_STAGES`, `ANNOTATION_SOURCES`, `REFETCH_SHORTHANDS` and the refetch
      parsing from `cli/prepare.py` into `cli/common_options.py`, and leave `prepare`'s
      behaviour unchanged.
- [x] 3.6 Failing tests in a new `test_annotate_cache_dir.py`, or in `test_annotate_cli.py`:
  - a run interrupted after UniProt resumes and fetches only the remaining sources, with the
    same output as an uninterrupted run;
  - `--cache-dir OUT/tmp` reuses a `prepare`-shaped cache with no API call;
  - `--refetch interpro` refetches;
  - `--refetch` without `--cache-dir` exits with a usage error before any API call;
  - without `--cache-dir` no cache file is created anywhere;
  - output from a cache holding `organism_id`/`sequence` omits them unless requested;
  - a legacy cache is refreshed through the shared path.
- [x] 3.7 Add `--cache-dir` and `--refetch` to `cli/annotate.py`, calling the shared function
      when a cache dir is given and the unchanged `output_path=None` path otherwise, so
      `test_bundle_version.py`'s fake manager keeps working. Commit:
      `feat(protspace): resume annotate from a cache directory`.
- [x] 3.8 Failing tests in a new `test_run_log.py`, stubbing `UniProtRetriever.releases`:
  - a full fetch stamps `2026_03` on the cache;
  - a fill-in onto `2026_02` stamps both;
  - a refetch replaces the stamp;
  - an unstamped cache contributes `unknown`;
  - no header means no stamp;
  - `run.log` shows `uniprot_release: 2026_03` for a fetch and for a cache-served run, lists
    both releases for mixed input, shows `unknown`, and shows `none` for CSV-only annotations;
  - a `Mock` or a missing `releases` attribute counts as no release.
- [x] 3.9 Stamp `protspace_uniprot_release` in `ProteinAnnotationManager._write_cache`, only
      when known. Resolve the run's releases in `cache.py`, expose them from the pipeline, keep
      the pipeline instance in `prepare`, and write the line under `## Annotations`. Commit:
      `feat(protspace): record the UniProt release in run.log`.
- [x] 3.10 Track gate: the same three commands as 1.11, all clean.

## 4. Integration (after tracks 1–3 are merged into `fix/annotation-retrieval`)

- [x] 4.1 Merge each track branch with a merge commit (never squash), resolve any conflicts, and
      run the full non-slow suite.
- [x] 4.2 Failing tests for the legacy-cache refresh:
  - a cache stamped at version 1 with `protein_families` refetches UniProt once when that
    column is requested;
  - one with `pfam` refetches InterPro once;
  - one requesting neither drops both and refetches nothing;
  - a failed refresh writes no stale value under a current stamp;
  - a test pins the literal InterPro list in `encoding.py` to `INTERPRO_ANNOTATIONS`.
- [x] 4.3 Add `CACHE_SEMANTICS_CHANGES[2]` (`protein_families` plus the ten InterPro columns) in
      `encoding.py`, and turn the hard-coded `{"protspace_annotation_cache_version": 1}`
      assertions in `test_pipeline_utils.py` into version-key checks that tolerate the release
      attribute. Commit:
      `fix(protspace): refresh caches from before the family/InterPro fixes`.
- [x] 4.4 Add an offline end-to-end test across Tracks 1 and 3: a mocked UniProt response
      carrying `X-UniProt-Release` reaches the `run.log` line of a `prepare` run, and duplicate
      sequences get InterPro values in the bundle. Commit as `test(protspace): …`.
- [x] 4.5 Update `docs/guide/python-cli.md`:
  - add `--cache-dir` and `--refetch` to the `annotate` flag table, with a resume example;
  - mention the `run.log` `uniprot_release:` line;
  - under Intermediate Caching, describe per-source persistence;
  - add a legacy-cache bullet for the family and InterPro refresh;
  - state that bundles never carry `organism_id`/`sequence`.
- [x] 4.6 Update `docs/guide/fetching-and-caching.md`:
  - per-source persistence;
  - InterPro retries covering the POST;
  - Biocentral batches;
  - the TED final retry pass;
  - `annotate --cache-dir` sharing `prepare`'s cache;
  - a caveat that sequence-dependent sources are cached per identifier, so use a separate cache
    directory or `--refetch interpro,biocentral` when the FASTA behind the identifiers changes.
- [x] 4.7 Rewrite the `protein_families` description in
      `packages/utils/src/visualization/annotation-metadata.ts` and its details in
      `docs/scripts/annotation-details.ts`. Families are kept whole, and multi-section entries
      list each family. Then regenerate with `pnpm docs:annotations` and pass
      `pnpm docs:annotations:check`. Commit:
      `docs(utils): describe multi-family protein_families`.
- [x] 4.8 Add the new test files and the caching behaviour to `apps/protspace/CLAUDE.md`.
- [x] 4.9 Check `apps/protspace/notebooks/*.ipynb` for restated behaviour: the first-family
      wording, `annotate` flags, `run.log`, bundle columns. Edit only what is restated, and check
      that every edited code cell parses with IPython's `TransformerManager().transform_cell`.
      Record "nothing restated" if so.
      Nothing restated: no notebook mentions the first-family wording, `annotate` flags,
      `run.log` or the bundle's internal columns. The preparation notebook reaches annotations
      through `ReductionPipeline._fetch_annotations`, whose signature is unchanged, and its
      "annotations are cached in output/tmp" text still holds.
- [x] 4.10 Run the gates and confirm each is clean:
  - `uv run ruff check apps/protspace`;
  - `uv run ruff format --check apps/protspace`;
  - `uv run pytest apps/protspace/tests -q -m "not slow"`;
  - `uv run pytest apps/prep/tests -q`, because prep shells out to `annotate`;
  - `pnpm install`, then `pnpm test:contract`, `pnpm format:check` and `pnpm precommit`;
  - `openspec validate annotation-retrieval-robustness --strict`.

  All clean, except that the two ruff commands, run on `apps/protspace` from the root, also reach
  the three notebooks. They fail identically on `origin/main` (5 lint errors, 3 files to
  reformat), and this change does not touch them. The paths CI lints, `src/`, `packages/` and
  `tests/`, are clean.

- [x] 4.11 Optional live smoke run (network, not CI): `annotate --cache-dir` on P00561, P04191,
      P27708 plus two accessions sharing a sequence, with `-a protein_families,pfam,ted`. Kill
      the run during TED, rerun it, then check the families, the shared-sequence Pfam and the
      cache's release stamp.
      Run on 2026-09-29 with P62805/P62806 (human and mouse histone H4, identical sequences):
      InterPro got 4 sequences for 5 proteins and both H4 entries got `PF15511`; P00561 gave
      two families, P27708 four, and P04191 kept `(TC 3.A.3)` whole. A SIGINT during TED left
      a cache with the UniProt and InterPro columns, stamped version 2 and `2026_03`; the rerun
      fetched only TED, and its output matched an uninterrupted run.

- [ ] 4.12 After review, and after section 5, archive the change
      (`openspec archive annotation-retrieval-robustness`) as the last commit on the branch
      before merge. Merge with a merge commit, because the
      branch touches `apps/protspace/`.

## 5. Review follow-ups

- [x] 5.1 A failed source whose columns the cache already holds no longer discards the sources
      that finished: its current cached values are kept beside them, a stale column is never
      kept, and the write is skipped only when no other source finished. Tests in the new
      `test_failed_source_cache.py` and in `test_legacy_cache_refresh.py`. Commit:
      `fix(protspace): keep a failed source's cached values, save the rest`.
- [x] 5.2 InterPro and Biocentral count as incomplete when a lost UniProt batch left a
      requested protein without a sequence. Commit:
      `fix(protspace): don't cache lookups a lost UniProt batch left empty`.
- [x] 5.3 InterPro stops requesting matches after 10 batches in a row are lost. Commit:
      `refactor(protspace): stop asking InterPro for matches once it is down`, typed refactor
      because the retry it bounds is unreleased.
- [x] 5.4 A run whose identifiers include no UniProt accession reports `uniprot_release: none`,
      and its cache says so for later runs. Commit:
      `refactor(protspace): report no UniProt release for non-UniProt IDs`, typed refactor
      because the line is unreleased.
- [x] 5.5 Restate "Legacy PDB annotation caches are refreshed safely" and "An incomplete
      annotation retrieval never overwrites the cache" as MODIFIED requirements, list the exact
      retryable statuses, and correct the rollback note.
- [x] 5.6 Shorten the two commit subjects over 72 characters and retype
      `warn about an uncached source only when it stays so` as `refactor`, since the bug it
      fixed never shipped: a message-only rewrite of the unpushed branch (`git filter-branch
    --msg-filter`), which keeps every tree and merge.
