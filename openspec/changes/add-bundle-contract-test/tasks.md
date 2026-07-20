# Tasks

## 1. Generator

- [ ] 1.1 Create `tests/contract/emit_bundles.py` taking an output directory argument.
- [ ] 1.2 Build the canonical input tables in-memory: 10 proteins, one percent-encoded label, one `;` multi-hit cell, a categorical column, a numeric column with a null, one 2D and one 3D projection, and projection metadata JSON carrying a large integer.
- [ ] 1.3 Write `annotations.parquet`, `projections_metadata.parquet`, `projections_data.parquet`, `settings.json`, and `statistics.parquet` into the output directory.
- [ ] 1.4 Comment the file with the assumption it encodes — that these inputs stand in for `protspace annotate` / `protspace project` output, which the contract does not verify.
- [ ] 1.5 Invoke `protspace bundle` as a subprocess four times for the `minimal`, `with_settings`, `with_stats`, and `stats_no_settings` variants, raising with captured stderr on a non-zero exit.

## 2. Contract suite

- [ ] 2.1 Add `tests/contract/vitest.config.ts` as a standalone project resolving the pnpm workspace packages.
- [ ] 2.2 Add a `test:contract` script to the root `package.json`; leave it out of `turbo test`.
- [ ] 2.3 In `tests/contract/bundle.contract.test.ts`, spawn the generator once in `beforeAll` into an OS temporary directory and fail the suite with the generator's stderr if it exits non-zero.
- [ ] 2.4 Assert the `minimal` variant: identifier column resolution, annotation and projection row counts, and `formatVersion === 2`.
- [ ] 2.5 Assert the `with_settings` variant returns settings normalized through the shared normalizer.
- [ ] 2.6 Assert the `with_stats` variant returns settings and ignores the statistics part.
- [ ] 2.7 Assert the `stats_no_settings` variant reports `settings === null` and ignores the statistics part.
- [ ] 2.8 Assert the payload contract: percent-encoded label decoded, multi-hit cell split, null numeric reported as missing, 3D projection exposes `z` with a dimension count of 3, and big-integer metadata does not break extraction.
- [ ] 2.9 Assert a file with more than five parts fails with an error naming the observed part count.

## 3. Reader

- [ ] 3.1 Widen the part-count check in `packages/core/src/components/data-loader/utils/bundle.ts` from exactly 2 or 3 delimiters to a range of 2 to 4, with a message naming the observed count.
- [ ] 3.2 Change the settings branch to trigger on three or more delimiters and slice part 4 to the next delimiter rather than to end-of-file.
- [ ] 3.3 Treat a zero-byte settings part as absent settings rather than a parse error.
- [ ] 3.4 Confirm `apps/protspace/src/protspace/data/io/bundle.py` and the reader now agree on the accepted part-count range.

## 4. CI

- [ ] 4.1 Add `.github/workflows/bundle-contract.yml` installing both `uv` and pnpm and running `pnpm test:contract`.
- [ ] 4.2 Set its path filter to the union of the producer paths, the consumer paths, `tests/contract/**`, and the workflow file itself.
- [ ] 4.3 Verify the existing `ci.yml` and `protspace-ci.yml` filters are left unchanged and that the new job is the only one covering the seam.

## 5. Verification

- [ ] 5.1 Confirm the `with_stats` and `stats_no_settings` cases fail before task 3 and pass after it.
- [ ] 5.2 Confirm the suite fails, rather than skipping, when the generator cannot run.
- [ ] 5.3 Confirm a branch touching only `bundle.py` and a branch touching only `bundle.ts` each trigger the contract job.
- [ ] 5.4 Confirm no `.parquetbundle` file is added to the repository by this change.
