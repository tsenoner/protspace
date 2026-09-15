## Why

`protspace embed` has two backends with two different ideas of what "done" means.

The Biocentral backend now fails when the output HDF5 does not cover everything it
was asked to embed. The local backend does not: it drops every sequence over
`max_length` (2000 aa, not exposed on the CLI) and every sequence that OOMs at
batch size 1, logs a warning, and exits 0 as long as **one** embedding landed. A
90 %-complete `.h5` then projects, bundles and scores normally, and every
downstream number is computed on a silently truncated dataset.

The divergence is not principled. `local.py` imports `load_existing_ids` and
`save_embeddings` **from `biocentral.py`** — there is already a shared HDF5 layer,
it just has no home, so each backend re-derived its own completeness rule.

Separately, nothing anywhere compares an embedding set against the FASTA it came
from. That gap is not merely cosmetic: `compute_similarity` zero-fills the matrix
for any protein it cannot find in the FASTA, leaving that protein's **diagonal at
0**, and `base_processor` only converts similarity → distance when
`np.allclose(np.diag(data), 1)`. One uncovered protein makes that test false for
the whole matrix, so MDS consumes raw similarities as distances and the entire
projection inverts — near-identical proteins are placed furthest apart.

## What Changes

- Add `data/embedding/store.py`, a shared HDF5 layer owned by neither backend,
  holding `load_existing_ids`, `save_embeddings`, `validate_headers`, and a single
  `finish_run()` that both backends call to report and verify a run.
- Split **skipped** from **failed**. A documented capability limit (over
  `--max-length`, GPU OOM at batch size 1) is skipped: named in the summary, exit 0. Anything else absent from the `.h5` fails. `expected = requested − skipped`.
- Report one summary per run on **stderr at warning level** — requested, embedded,
  skipped, with the skipped identifiers named. Stdout is discarded by the hosted
  prep service, so an affirmative `typer.echo` summary would be invisible there.
- Call `validate_headers` from **both** backends before any work begins. Only the
  local backend rejects `/` today; Biocentral pays for a full embedding run and
  then reports a shortfall it cannot explain.
- Expose `--max-length` on `embed` and `prepare`, so a skipped sequence is
  actionable rather than a dead end.
- Compare embedding identifiers against the `-f/--fasta` set, normalising both
  sides through `parse_identifier`. Directional: uncovered embeddings warn, and
  **fail** when `-s/--similarity` is requested; a FASTA that is a superset is
  routine (a resumed embedding cache) and is not reported.

## Capabilities

### New Capabilities

- `embed-completeness`: when an embedding run is considered complete, which
  sequences may be skipped rather than failed, how coverage against the source
  FASTA is verified, and what each run reports.

### Modified Capabilities

<!-- None. prep-failure-routing keys on the `embed` step's exit code and its
stderr patterns; both are unchanged in kind. The hosted path runs the Biocentral
backend (no length cap, no OOM skip) and invokes the stage commands directly
rather than `prepare`, so neither the new skip class nor the FASTA coverage check
reaches it. The new messages deliberately avoid every substring in
`_BIOCENTRAL_DOWN_PATTERNS` so they cannot be mis-tagged `BIOCENTRAL_UNAVAILABLE`. -->

## Impact

- `apps/protspace/src/protspace/data/embedding/store.py` (new).
- `apps/protspace/src/protspace/data/embedding/biocentral.py`,
  `local.py` — both call the shared contract; `load_existing_ids` /
  `save_embeddings` re-exported from `biocentral.py` for compatibility.
- `apps/protspace/src/protspace/cli/embed.py`,
  `apps/protspace/src/protspace/cli/prepare.py`,
  `apps/protspace/src/protspace/cli/common_options.py` — `--max-length`.
- `apps/protspace/src/protspace/data/processors/pipeline.py` — FASTA coverage.
- No API, dependency, or bundle-schema changes. `apps/prep/` untouched.
- **Known limitation, deliberately out of scope:** the `np.allclose(np.diag(data), 1)`
  heuristic in `base_processor.py` remains. This change stops a partially-covered
  FASTA from reaching it; it does not make the heuristic itself robust. Tracked
  separately.
