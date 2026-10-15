## 1. Failing tests first

- [x] 1.1 `tests/test_custom_annotations.py`: loader cases (second file merged, tab and semicolon in
      a `.csv`, one-column warning, `.CSV`/`.txt`, `protein_id` and `identifier` not first, two
      id-named columns, empty cells, CRLF and mixed endings, BOM, column in two files, unmatched-id
      warning, output aligned to the input ids, plain-text cells encoded)
- [x] 1.2 `prepare` end to end: two CSVs both reach the bundle, no `nan` cells
- [x] 1.3 `annotate`, `stats`, `bundle` with a CSV; non-parquet input and unknown source name as
      usage errors; `stats` and `bundle` resolving a parquet's id column alike
- [x] 1.4 `project -a` / `--stats` usage error naming `prepare` and `bundle`; neither in `--help`
- [x] 1.5 Embedding-option warnings on HDF5 input; none with defaults; `--max-length` no longer
      fails there
- [x] 1.6 A fresh-interpreter HDF5-only `prepare` leaves `protspace.data.embedding`,
      `biocentral_api` and `torch` out of `sys.modules`
- [x] 1.7 Run them and watch each fail for the stated reason

## 2. Shared loader

- [x] 2.1 `data/processors/custom_annotations.py`: suffix test and `-a` splitting, id-column rule,
      header-sniffed delimiter, text read, merge with collision error, per-file coverage report,
      v2 encoding, output aligned to the input ids, fetched-column override
- [x] 2.2 `ReductionPipeline` reads every file through it; `run()` keeps empty cells empty

## 3. Commands

- [x] 3.1 `annotate -a`: files beside names, files only fetch nothing, unknown names a usage error
- [x] 3.2 `stats -a`: CSV scored and written to `<projections>/<file stem>.annotations.parquet`,
      never over the directory's own `selected_annotations.parquet`; shared id-column rule for a
      parquet; unreadable input a usage error
- [x] 3.3 `bundle -a`: CSV through the loader; shared id-column rule; unreadable input a usage error
- [x] 3.4 `project`: hidden `-a/--annotations` and `--stats` refusing with the routes; help names
      `prepare`
- [x] 3.5 `prepare`: embedding config only when embedding; warnings for ignored options; `run.log`
      without embedding settings; the `-b` help says it applies only when embedding

## 4. Docs

- [x] 4.1 `docs/guide/python-cli.md`: "Which command do I need?", H5 + CSV + `--stats` example
      (2-D methods), `-b` row, "Custom annotation files" with the rules and every command, the
      stepwise recipe, `project`/`annotate`/`stats`/`bundle` `-a` rows, "Upgrading from v4.4",
      `KeyError: 'ESM_8M'` troubleshooting
- [x] 4.2 `docs/guide/faq.md`: custom-annotation answer, bundle part count
- [x] 4.3 `apps/protspace/CLAUDE.md`: new module and test file
- [x] 4.4 Colab Preparation notebook (applied at integration): the upload hint names the id
      columns before the first column, and the panel takes its accepted suffixes from
      `CUSTOM_ANNOTATION_SUFFIXES` (`.csv`/`.tsv` on a released package without it);
      `data-preparation.md` states the same rule
- [x] 4.5 Pin the guide's accepted suffixes to `CUSTOM_ANNOTATION_SUFFIXES` with a test

## 5. Review round

- [x] 5.1 A comma in a custom file's name no longer splits it (`flatten_annotation_args`, used by
      `prepare` and the pipeline); regression tests for the split and for `prepare`
- [x] 5.2 `prepare` checks that every `-a` file exists before embedding; test that nothing is
      embedded first
- [x] 5.3 `stats -a x.csv` writes `x.annotations.parquet`, so a `prepare --no-bundled` directory's
      `selected_annotations.parquet` survives; test
- [x] 5.4 Migration Plan and the guide's upgrade note: an id-named column now outranks the first
      column

## 6. Verify

- [x] 6.1 `openspec validate custom-csv-annotations --strict`
- [x] 6.2 `uv run --directory apps/protspace pytest` (non-slow) and ruff
- [x] 6.3 `pnpm precommit` and `pnpm format:check`
