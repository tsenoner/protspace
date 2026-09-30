## Why

Decoding the 573K Swiss-Prot bundle in the browser takes about 6.5 s and 2.1 GB of heap, almost all
of it spent parsing annotation cells into row objects. PR #477 adds a columnar `.parquetbundle`
container, format v3, that the browser reads straight into typed arrays: about 0.4 s and under
50 MB, in a file about 19% smaller.

The PR shipped the reader and the Python writer without an OpenSpec change, and review turned up
several places where v3 quietly behaves differently from v2: a protein missing from a projection is
drawn at (0,0), boolean columns change spelling, a projection's dimension can come from metadata
that disagrees with the data, and imported bytes reach OPFS only after the render, which breaks
crash recovery. The web exporter still writes v2, so a bundle round-tripped through the app loses
the format. This change records the container, the rules the review settled, and what happens to
v1/v2 files.

## What Changes

- **v3 container.** Six fixed parts: annotations as integer codes, per-row hit counts and float64
  numerics, with the manifest in part 1's footer; projection metadata; wide float32 projections;
  settings; statistics; payloads (label dictionaries and CSR buffers). The physical schema is
  documented in `docs/guide/data-format.md` and not repeated here.
- **v3 is the only format written.** The Python writer already emits v3. The web exporter
  (`packages/utils/src/parquet/bundle-writer.ts`) switches from v2 to v3. `protspace style`,
  which used to keep a legacy bundle legacy, writes a v1/v2 input as v3 too. A web re-export keeps
  the column types Python wrote: the reader carries each column's manifest `sourceType` and the
  exporter echoes it while the column still fits it.
- **v1/v2 stay readable but are deprecated.** Removal is planned for protspace 5.0.0. Python logs
  one warning per legacy read, naming `protspace convert` and 5.0.0. The web app shows a
  non-blocking notice when a user loads a v1/v2 bundle, suggesting a re-export or
  `protspace convert`.
- **`protspace convert`.** New CLI command that rewrites a v1/v2 bundle as v3. It migrates v1 cell
  grammar, keeps settings and statistics, writes atomically, leaves a v3 input untouched, and never
  overwrites its input unless asked to. In the browser, loading a legacy file and exporting it
  writes v3, so the app is also a converter that needs no install.
- **Missing coordinates are not (0,0).** A protein absent from a projection gets NaN coordinates in
  the file and in both browser readers. The scatter plot drops non-finite points in one place,
  before plot data is built, so nothing downstream can draw, pick, lasso, contour, fit, sort, stack
  or export them. The browser protein set is the proteins with at least one finite coordinate
  (v2 parity). The encoder adds projection identifiers missing from the annotations as rows with
  N/A annotations instead of raising.
- **Dimension comes from the data.** A projection is 3D when it has a non-null `z`, 2D otherwise. A
  `dimensions` metadata value that disagrees is ignored with a warning and rewritten to the derived
  value in part 2.
- **Booleans read `true`/`false`**, as the v2 browser reader showed them, not Python's
  `True`/`False`.
- **Crash recovery.** Imported bytes are written to OPFS before the render again, as on `main`. The
  PR's reordering and its `persistBytes` race are removed.
- **Public decode API.** `decodeParquetBundle` is exported from `@protspace/core` and is the
  documented way to read a bundle. `extractRowsFromParquetBundle` is documented as v1/v2-only and
  deprecated.
- **Two version keys.** `protspace_format_version` meant the container version in a v3 part 1
  (`"3"`) and the annotation cell grammar everywhere else (`"2"`, absent for v1). A v3 part 1 now
  declares `protspace_container_version` = `"3"` and carries no grammar key;
  `protspace_format_version` is only the cell grammar, on legacy parts and v2-shaped tables. v3 is
  unreleased, so the wire format can still change.
- **No grammar guessing on write.** The Python v3 encoder refuses an annotations table without a
  v2 grammar stamp instead of migrating it as v1. An already-v2 table that lost its stamp was
  migrated a second time and double-escaped (`%3B` to `%253B`), guarded only by a warning. Callers
  that hold v1 cells migrate them explicitly: `convert`, `transfer` on a v1 bundle, and
  `bundle -a` given an unstamped table, which the CLI reads as plain v1 text.

### Non-goals

- Marking missing-value labels in the manifest.
- Moving the unrelated performance work in #477 (grid picking, counting-sort depth order, dataset
  hashing) into separate PRs.
- Removing v1/v2 read support. That is the 5.0.0 change this one announces.

### Release

A minor feature release. No `BREAKING CHANGE` footer: every existing bundle still loads. Commits
that add the deprecation carry the body line "Deprecates reading v1/v2 parquetbundles; removal
planned for protspace 5.0.0."

## Capabilities

### New Capabilities

- `parquetbundle-v3`: the v3 container as the written format of both producers, legacy read support
  and its deprecation, missing-coordinate and protein-set semantics in the file and the readers,
  dimension from data, boolean spelling, and the public `decodeParquetBundle` API.
- `bundle-conversion`: the `protspace convert` command and the browser re-export path.
- `imported-dataset-persistence`: an imported file's bytes are in OPFS before its render starts.

### Modified Capabilities

- `bundle-format-contract`: the producer now writes six-part v3 bundles, the reader accepts both
  layouts, and the scale scenario targets the columnar reader instead of the legacy
  threshold-routed conversion.
- `point-visibility`: points without finite coordinates are culled when plot data is built, a third
  kind of culling next to query filter and isolation.

## Impact

- Python (`apps/protspace`): `data/io/bundle_v3.py` (NaN coordinates, added identifier rows,
  dimension from data, boolean spelling, finite-only decode, container-version key, grammar
  refusal), `data/io/bundle.py` (deprecation warning, container-key detection, `style` upgrading a legacy input),
  `data/annotations/encoding.py` (`upgrade_cell_grammar`), `cli/bundle.py` and `cli/transfer.py`
  (explicit grammar), a new `cli/convert.py`, the CLI docs and the Colab notebook where they list
  commands.
- Core (`packages/core`): `data-loader/utils/bundle.ts` and `bundle-v3.ts` (NaN for missing
  coordinates, protein set, detecting and reporting the container version from its own key,
  carrying `sourceType`),
  `src/index.ts` (export `decodeParquetBundle`).
- Utils (`packages/utils`): `parquet/bundle-writer.ts` writes v3 and echoes `sourceType`,
  `types.ts` (`Annotation.sourceType`); `visualization/data-processor.ts`
  culls non-finite points.
- Web (`apps/web`): `explore/dataset-controller.ts` (persist before render, legacy notice),
  `explore/notifications.ts`.
- Docs: `docs/guide/data-format.md`, `docs/guide/python-cli.md`, `docs/developers/embedding.md`,
  `docs/developers/api/*`.
- Every bundle shipped in the repo (the default `apps/web/public/data.parquetbundle`, the example
  datasets and most e2e fixtures) is v1 today. They keep loading and do not trigger the notice,
  but they need converting before 5.0.0.
- Older web builds reject a v3 file with `Expected 2 to 4 delimiters in parquetbundle, found 5`.
  Once the exporter writes v3, a file exported from protspace.app will not open in an older
  self-hosted build.
