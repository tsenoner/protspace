# Tasks

## 1. Generator

- [x] 1.1 Create `tests/contract/emit_bundles.py` taking an output directory argument.
- [x] 1.2 Build the canonical input tables in-memory: 10 proteins, one percent-encoded label, one `;` multi-hit cell, a categorical column, a numeric column with a null, one 2D and one 3D projection, and projection metadata JSON carrying a large integer.
- [x] 1.3 Write `annotations.parquet`, `projections_metadata.parquet`, `projections_data.parquet`, `settings.json`, and `statistics.parquet` into the output directory.
- [x] 1.4 Comment the file with the assumption it encodes — that these inputs stand in for `protspace annotate` / `protspace project` output, which the contract does not verify.
- [x] 1.5 Invoke `protspace bundle` as a subprocess four times for the `minimal`, `with_settings`, `with_stats`, and `stats_no_settings` variants, raising with captured stderr on a non-zero exit.

## 2. Contract suite

- [x] 2.1 Add `tests/contract/vitest.config.ts` as a standalone project resolving the pnpm workspace packages.
- [x] 2.2 Add a `test:contract` script to the root `package.json`; leave it out of `turbo test`.
- [x] 2.3 In `tests/contract/bundle.contract.test.ts`, spawn the generator once in `beforeAll` into an OS temporary directory and fail the suite with the generator's stderr if it exits non-zero.
- [x] 2.4 Assert the `minimal` variant: identifier column resolution, annotation and projection row counts, and `formatVersion === 2`.
- [x] 2.5 Assert the `with_settings` variant returns settings normalized through the shared normalizer.
- [x] 2.6 Assert the `with_stats` variant returns settings and ignores the statistics part.
- [x] 2.7 Assert the `stats_no_settings` variant reports `settings === null` and ignores the statistics part.
- [x] 2.8 Assert the payload contract: percent-encoded label decoded, multi-hit cell split, null numeric reported as missing, 3D projection exposes `z` with a dimension count of 3, and big-integer metadata does not break extraction.
- [x] 2.9 Assert a file with more than five parts fails with an error naming the observed part count.

## 3. Reader

- [x] 3.1 Widen the part-count check in `packages/core/src/components/data-loader/utils/bundle.ts` from exactly 2 or 3 delimiters to a range of 2 to 4, with a message naming the observed count.
- [x] 3.2 Change the settings branch to trigger on three or more delimiters and slice part 4 to the next delimiter rather than to end-of-file.
- [x] 3.3 Treat a zero-byte settings part as absent settings rather than a parse error.
- [x] 3.4 Confirm `apps/protspace/src/protspace/data/io/bundle.py` and the reader now agree on the accepted part-count range.

## 4. CI

- [x] 4.1 Add `.github/workflows/bundle-contract.yml` installing both `uv` and pnpm and running `pnpm test:contract`.
- [x] 4.2 Trigger the job on every pull request, unfiltered. (Superseded 6.1: a path filter cannot serve as a required status check — GitHub waits forever for a report a skipped workflow never sends.)
- [x] 4.3 Verify the existing `ci.yml` and `protspace-ci.yml` filters are left unchanged and that the new job is the only one covering the seam.

## 5. Verification

- [x] 5.1 Confirm the `with_stats` and `stats_no_settings` cases fail before task 3 and pass after it.
- [x] 5.2 Confirm the suite fails, rather than skipping, when the generator cannot run.
- [x] 5.3 Confirm a branch touching only `bundle.py` and a branch touching only `bundle.ts` each trigger the contract job.
- [x] 5.4 Confirm no `.parquetbundle` file is added to the repository by this change.

## 6. Review findings

- [x] 6.1 Superseded — the path filter was removed entirely rather than widened. Widening only moved the boundary; it was still a hand-copied import graph, and it was already missing the `@protspace/utils` barrel and the hyparquet pin the day it was written.
- [x] 6.2 Emit a `large` variant (6000 proteins × 2 projections) past the reader's 10000-row threshold so the optimized conversion implementation is covered, not only the small-data one.
- [x] 6.3 Assert the zero-byte settings guard by its observable effect (the settings parser is never entered), since `settings === null` holds with the guard removed.
- [x] 6.4 Assert `PROTEIN_COUNT` length before indexing the numeric annotation array, so a dropped row cannot pass as a missing value.
- [x] 6.5 Serialize converted data (`JSON.stringify` + `structuredClone`) rather than only converting it, so the BigInt regression the test names is actually detectable.
- [x] 6.6 Pin the over-long-bundle rejection to the full error message instead of a bare `/5/`.
- [x] 6.7 Remove the vacuous `rejects.not.toThrow` case from `bundle.test.ts`; 5-part acceptance is proven against real producer output in the contract suite.
- [x] 6.8 Verify by mutation that the strengthened assertions fail when the behavior they name regresses.
