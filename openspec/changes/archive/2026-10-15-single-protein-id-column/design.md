## Context

Python has keyed its pipeline on `identifier` since the first release and renamed it to
`protein_id` in exactly one place, `BaseProcessor._create_protein_annotations_table`, because the
first web reader looked for `protein_id`. Later writers (`bundle -a`, `transfer`, the v3 encoder)
each restated the rename, and the web exporter picked `identifier` because the v2 browser's
projections were keyed on it. Format v3 records the ID column in its manifest (`idColumn`), so a v3
reader never needs a name rule; everything without a manifest still does.

## Goals / Non-Goals

**Goals:**

- One name, `protein_id`, in every table ProtSpace writes, from both languages.
- v3 readers driven by `idColumn` alone.
- The `identifier` name rule confined to one helper per language, read-side only, and scheduled
  for removal with the legacy readers.

**Non-Goals:**

- The browser's v1/v2 reader (`bundle.ts`, `conversion.ts`). It goes in 5.0.0 with the formats,
  and it reads files nobody writes any more, so its name lists stay as they are.
- `ProteinAnnotations.identifier`, the namedtuple field the retrievers fill. It is an attribute,
  not a column name, and renaming it touches every retriever for nothing a user sees.
- The `query_id` column of `transfer --report`, which names a query, not a table's key.
- The showcase build's `labels.csv` (`build_showcase.py`). It is a published release asset, and
  a CSV's first column is its ID column whatever its header, so its `identifier` header stays and
  a rebuild keeps the published bytes.

## Decisions

- **Rename inside the pipeline, not at the writers.** Renaming only at the write boundary leaves
  `identifier` inside and a rename in every writer, which is how the drift started. The pipeline,
  the annotation manager, the custom loader and the stats code key on `PROTEIN_ID_COLUMN`, so a
  writer has nothing to rename.
- **Normalise at the read boundary.** `data/io/ids.py` holds `PROTEIN_ID_COLUMN`,
  `LEGACY_ID_COLUMN` and three helpers: `id_column_by_name` (`protein_id`, else `identifier`, else
  none), `with_protein_id` (renames a legacy `identifier` key to `protein_id`, keeping the schema
  metadata, since `rename_columns` drops the cell-grammar stamp) and `keyed_on_protein_id`, the
  same with a first-column fallback, for the user's `-a` parquet that `stats` and `bundle` read
  through one `read_annotation_table`. Every reader of a table without a manifest goes through
  them once, so code downstream sees one name. The cell-grammar migration skips only that id
  column, so an `identifier` annotation beside `protein_id` is migrated like any other.
- **`run_transfer` takes either name.** Its CLI hands it a table keyed on `protein_id`, but the
  Preparation notebook calls it directly and, for released protspace < 4.17, keys the table on
  `identifier` (only when that name is free). It returns the table keyed as it was given; the
  removal notes drop this with the other fallbacks.
- **The encoder writes `protein_id` whatever it is given.** `encode_v3` still accepts an
  `identifier`-keyed table (a caller's own, or a v1/v2 table `convert` upgrades) and writes it as
  `protein_id`, so no bundle written from here on carries another name.
- **The decoder renames `idColumn` to `protein_id`.** A v3 file written by an older web export
  has `idColumn: "identifier"`. The decoder reads the column the manifest names and hands it back
  as `protein_id`, so `transfer`, `style`, `export` and scripts see one name for every v3 file.
  A manifest naming `identifier` beside an annotation called `protein_id` cannot come from either
  writer (both took `protein_id` first) and is refused as corrupt.
- **The web exporter always writes `protein_id`.** An annotation called `protein_id` cannot reach
  the web app: the shared `NON_ANNOTATION_COLUMNS` hides it on every read, and the Python loader
  renames it. The exporter refuses one anyway rather than writing a second name.
- **Warn where a user's own file is keyed on `identifier`.** `bundle -a` / `stats -a` on such a
  parquet and a directory whose parts are keyed on it (`bundle -p`, `stats -p`, `ArrowReader`)
  log `deprecations.LEGACY_ID_COLUMN` once per read. A v1/v2 bundle already logs
  `LEGACY_BUNDLE_READ`, so it does not warn twice. The annotation cache is the pipeline's own
  file, rewritten on the next fetch, so it is read silently.
- **The removal shrinks the rule, it does not break files.** After 5.0.0 a parquet without
  `protein_id` is keyed on its first column, which for every `annotate` output ever written is
  `identifier`, so old annotation files keep working. A directory part keyed on `identifier`
  stops being read; the warning names the fix.

## Risks / Trade-offs

- **[A script reads `projections["identifier"]`]** `read_bundle_contents` hands back
  `protein_id` now. The table's documentation is new in this release, and the column the
  annotations table has always been keyed on in a bundle is `protein_id`, so the two now match.
- **[A cache from 4.16 or older]** It is keyed on `identifier`. The cache reader renames it on
  read, and the next fetch writes it back keyed on `protein_id`.
- **[A large mechanical rename]** The tests pin the written names at each boundary (bundle,
  directory, `annotate`, `stats`, cache) and the contract suite pins both writers, so a writer that
  keeps `identifier` fails a test that names it.

## Migration Plan

Nothing to run. Files written before this change read as before, with a deprecation warning
where a user's own file relies on the `identifier` name. `protspace convert` rewrites a v1/v2
bundle as v3 keyed on `protein_id`.
