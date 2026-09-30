# Tasks

## 1. v3 container (already on the PR branch)

- [x] 1.1 Python `encode_v3` / `decode_v3` in `data/io/bundle_v3.py`; `write_bundle` emits six parts,
      every read decodes v3 back to v2-shaped tables
- [x] 1.2 Browser columnar reader in `data-loader/utils/bundle-v3.ts`, reached through
      `decodeParquetBundle`, with manifest validation against part 1's physical schema
- [x] 1.3 CSR annotation storage in the `@protspace/utils` accessors and the EAT overlay rebuild
- [x] 1.4 Golden v3 fixture read by both languages; contract suite reads producer bundles through
      `decodeParquetBundle`
- [x] 1.5 Format v3 layout and physical schema in `docs/guide/data-format.md`

## 2. Python track (`apps/protspace`)

- [ ] 2.1 Encoder writes NaN, not `0.0`, into part 3 for a protein a projection does not cover
- [ ] 2.2 `decode_v3` emits long-format projection rows only for finite coordinates
- [ ] 2.3 Encoder adds projection identifiers missing from the annotations as rows with every
      annotation missing, instead of raising
- [ ] 2.4 Dimension from the data (non-null `z` means 3); a disagreeing `dimensions` metadata value
      is ignored with a warning naming the projection and both values
- [ ] 2.5 `BOOLEAN` annotation columns encode as `true` / `false`
- [ ] 2.6 One deprecation warning per v1/v2 read, naming `protspace convert` and 5.0.0; none for v3
- [ ] 2.7 `protspace convert INPUT [OUTPUT] [--in-place]`: v1 grammar migration, settings and
      statistics preserved, v3 input reported and left untouched, atomic write, usage error when
      neither `OUTPUT` nor `--in-place` is given
- [ ] 2.8 Tests for 2.1 to 2.7, including a v1 fixture with a literal `%` and a parenthesised `;`
- [ ] 2.9 `docs/guide/python-cli.md` (command table and a `protspace convert` section), the
      data-format guide's writer table, missing-coordinate and deprecation notes, and the Colab
      notebooks where they list commands

## 3. TypeScript track (`packages/*`, `apps/web`)

- [ ] 3.1 v3 reader keeps NaN for missing coordinates; legacy reader fills coordinate arrays with
      NaN before writing the rows it has
- [ ] 3.2 Browser protein set is the proteins with at least one finite coordinate in some
      projection, in both readers; annotation arrays are built over that set
- [ ] 3.3 Cull non-finite points in `DataProcessor.processVisualizationData`, keeping the identity
      path when nothing is missing
- [ ] 3.4 Make `_updatePlotDataCoordinates` fall back to a full rebuild when the new projection's
      surviving set differs; audit every other direct read of `data.projections`
- [ ] 3.5 Tests: nothing non-finite reaches drawing, picking, brush, lasso, contours, scale domains,
      depth sort, duplicate stacks or export; projection switching between complete and incomplete
      projections
- [ ] 3.6 Web exporter (`packages/utils/src/parquet/bundle-writer.ts`) writes v3, with `true` /
      `false` for booleans and NaN for missing coordinates; round-trip tests for v1, v2 and v3
      inputs, with and without settings and statistics
- [ ] 3.7 `decodeParquetBundle` reports the container format version; the web app shows a
      non-blocking legacy-format notice for user imports only
- [ ] 3.8 Restore `main`'s persist-before-render ordering in `explore/dataset-controller.ts`, remove
      the deferred `persistBytes`, keep the other v3 changes there; test that the bytes are stored
      before the render starts
- [ ] 3.9 Export `decodeParquetBundle` from `@protspace/core`; `extractRowsFromParquetBundle` rejects
      a v3 bundle with an error naming `decodeParquetBundle` and is marked deprecated
- [ ] 3.10 `docs/developers/embedding.md` and `docs/developers/api/index.md` use
      `decodeParquetBundle`; the web export notes in the data-format guide say exports are v3

## 4. Contract suite (`tests/contract`)

- [ ] 4.1 `emit_bundles.py` adds a `BOOLEAN` annotation column and a protein that one projection
      does not cover
- [ ] 4.2 Assert `true` / `false`, NaN coordinates in the uncovered projection, and the protein kept
      in the protein list

## 5. Release and follow-ups

- [ ] 5.1 Deprecation commits carry "Deprecates reading v1/v2 parquetbundles; removal planned for
      protspace 5.0.0."; no `BREAKING CHANGE` footer; merge without squashing
- [ ] 5.2 Follow-up: convert `apps/web/public/data.parquetbundle`, the example datasets and the e2e
      fixtures to v3 before 5.0.0
- [ ] 5.3 Follow-up (5.0.0): remove the legacy readers, `extractRowsFromParquetBundle` and the
      notice
