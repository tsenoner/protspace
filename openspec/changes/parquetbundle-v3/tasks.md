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

- [x] 2.1 Encoder writes NaN, not `0.0`, into part 3 for a protein a projection does not cover
- [x] 2.2 `decode_v3` emits long-format projection rows only for finite coordinates
- [x] 2.3 Encoder adds projection identifiers missing from the annotations as rows with every
      annotation missing, instead of raising
- [x] 2.4 Dimension from the data (a finite `z` means 3; a NaN `z` counts as missing); a disagreeing `dimensions` metadata value
      is ignored with a warning naming the projection and both values
- [x] 2.5 `BOOLEAN` annotation columns encode as `true` / `false`
- [x] 2.6 One deprecation warning per v1/v2 read, naming `protspace convert` and 5.0.0; none for v3
- [x] 2.7 `protspace convert INPUT [OUTPUT] [--in-place]`: v1 grammar migration, settings and
      statistics preserved, v3 input reported and left untouched, atomic write, usage error when
      neither `OUTPUT` nor `--in-place` is given
- [x] 2.8 Tests for 2.1 to 2.7, including a v1 fixture with a literal `%` and a parenthesised `;`
- [x] 2.9 `docs/guide/python-cli.md` (command table and a `protspace convert` section), the
      data-format guide's writer table, missing-coordinate and deprecation notes, and the Colab
      notebooks where they list commands
- [x] 2.10 Two version keys: `encode_v3` writes `protspace_container_version` = 3 into part 1's
      footer and strips `protspace_format_version`; `_split` detects v3 from the container key and
      rejects a part count that disagrees with it; `decode_v3` returns tables stamped grammar 2
      without the container key; golden fixture regenerated
- [x] 2.11 `encode_v3` refuses an annotations table not stamped grammar 2; `upgrade_cell_grammar`;
      `bundle -a` reads the input's stamp before its rename and treats an unstamped table as v1
      plain text; `transfer` restores the grammar it read; `replace_annotations_in_bundle` no
      longer stamps; the double-migration warning and its prose are removed
- [x] 2.12 Part 2's `dimensions` is rewritten to the derived dimension when the input metadata
      disagrees (integer type kept, `int64` otherwise), and `decode_v3` returns the manifest's
      dimension in the metadata it decodes

- [x] 2.13 `protspace style` writes a legacy input as v3 through `convert`'s encoding (one warning
      naming the input version), keeps a v3 input's parts byte for byte; tests, the CLI guide's
      `style` section and the data-format writer table updated
- [x] 2.14 `bundle -a` reads the `prepare` annotation cache as v2: the cache is stamped when
      written, a cache from before the stamp is recognised by its cache-version attribute, and
      `ArrowReader.save_data` keeps the stamp it read
- [x] 2.15 An integer column with a value beyond ±2^53 is encoded as exact categorical labels
      (no lossy or refused float64 cast) and decoded back to its integer type

## 3. TypeScript track (`packages/*`, `apps/web`)

- [x] 3.1 v3 reader keeps NaN for missing coordinates; legacy reader fills coordinate arrays with
      NaN before writing the rows it has
- [x] 3.2 Browser protein set is the proteins with at least one finite coordinate in some
      projection, in both readers; annotation arrays are built over that set
- [x] 3.3 Cull non-finite points in `DataProcessor.processVisualizationData`, keeping the identity
      path when nothing is missing
- [x] 3.4 Make `_updatePlotDataCoordinates` fall back to a full rebuild when the new projection's
      surviving set differs; audit every other direct read of `data.projections`
- [x] 3.5 Tests: nothing non-finite reaches drawing, picking, brush, lasso, contours, scale domains,
      depth sort, duplicate stacks or export; projection switching between complete and incomplete
      projections
- [x] 3.6 Web exporter (`packages/utils/src/parquet/bundle-writer.ts`) writes v3, with `true` /
      `false` for booleans and NaN for missing coordinates; round-trip tests for v1, v2 and v3
      inputs, with and without settings and statistics
- [x] 3.7 `decodeParquetBundle` reports the container format version; the web app shows a
      non-blocking legacy-format notice for user imports only
- [x] 3.8 Restore `main`'s persist-before-render ordering in `explore/dataset-controller.ts`, remove
      the deferred `persistBytes`, keep the other v3 changes there; test that the bytes are stored
      before the render starts
- [x] 3.9 Export `decodeParquetBundle` from `@protspace/core`; `extractRowsFromParquetBundle` rejects
      a v3 bundle with an error naming `decodeParquetBundle` and is marked deprecated
- [x] 3.10 `docs/developers/embedding.md` and `docs/developers/api/index.md` use
      `decodeParquetBundle`; the web export notes in the data-format guide say exports are v3
- [x] 3.11 `decodeParquetBundle` detects v3 from `protspace_container_version`, rejects six parts
      without it and unknown container versions, and still reports format 1/2 from the grammar
      key for the legacy notice; the web exporter writes `protspace_container_version` and no
      grammar key

- [x] 3.12 The v3 reader keeps the manifest's `sourceType` on the loaded `Annotation`; the web
      exporter echoes it for a column that still fits it (integer range, `bool` labels, numeric
      kind), and falls back to its inferred type otherwise; round-trip tests
- [x] 3.13 The point-visibility requirements that named the picking quadtree name the point grid
      (`PointGridIndex`) that replaced it
- [x] 3.14 The v3 reader refuses a part 3 whose row count differs from part 1's
- [x] 3.15 The v3 reader refuses hit or score counts whose prefix sum leaves the int32 offset
      range, instead of wrapping them back onto the payload length
- [x] 3.16 The v3 reader refuses a manifest whose id column is not a string column or whose
      columns share a physical part 1 column with each other or with the id column
- [x] 3.17 The web exporter declares an EAT `__pred_confidence` column `float`, as
      `protspace transfer` writes it, since the overlay leaves no carried `sourceType` to echo

## 4. Contract suite (`tests/contract`)

- [x] 4.1 `emit_bundles.py` adds a `BOOLEAN` annotation column and a protein that one projection
      does not cover
- [x] 4.2 Assert `true` / `false`, NaN coordinates in the uncovered projection, and the protein kept
      in the protein list
- [x] 4.3 A generated v2 bundle upgraded by `protspace convert` decodes to the same dataset, and
      bundles exported by the web writer are read back by the Python tooling (`read_bundles.py`)
      with the same content as the Python-written originals
- [x] 4.4 The `annotate` stand-in is stamped v2 as `annotate` stamps it; the layout assertion checks
      `protspace_container_version` = 3 and no grammar key on every producer and web bundle, and
      the grammar key `2` without a container key on the legacy v2 input

- [x] 4.5 The reverse-direction test compares the Arrow type of every annotation column Python
      decodes from a web re-export with the Python-written original (no boolean folding)

## 5. Release and follow-ups

- [ ] 5.1 Deprecation commits carry "Deprecates reading v1/v2 parquetbundles; removal planned for
      protspace 5.0.0."; no `BREAKING CHANGE` footer; merge without squashing
- [x] 5.2 Convert `apps/web/public/data.parquetbundle` and the example datasets under
      `apps/web/public/data/` to v3 with `protspace convert`, each verified to decode to the same
      dataset; keep the e2e fixtures and `v2-sample` legacy as the legacy reader's test data;
      `scripts/landing-data` reads v3; `encode_legacy_cell` splits a hit at its last pipe
- [ ] 5.3 Follow-up (5.0.0): remove the legacy readers, `extractRowsFromParquetBundle` and the
      notice
