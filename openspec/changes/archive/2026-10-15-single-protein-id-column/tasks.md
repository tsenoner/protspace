## 1. Shared name

- [x] 1.1 `PROTEIN_ID_COLUMN` in `contracts/shared-constants.json`, with the generator check that
      it is one of `NON_ANNOTATION_COLUMNS`; regenerate both modules
- [x] 1.2 `data/io/ids.py`: `PROTEIN_ID_COLUMN`, `LEGACY_ID_COLUMN`, `id_column_by_name`,
      `with_protein_id`, `keyed_on_protein_id`; re-export pinned in `test_shared_constants.py`
- [x] 1.3 `deprecations.LEGACY_ID_COLUMN` with its removal notes

## 2. Python writers and readers

- [x] 2.1 `encode_v3` writes `protein_id` from either name; `decode_v3` hands `idColumn` back as
      `protein_id` and keys the long projections on it
- [x] 2.2 Legacy bundle reads key their projections (and an `identifier`-keyed annotations
      table) on `protein_id`
- [x] 2.3 Pipeline, annotation manager, formatters, writers and cache key on `protein_id`; the
      cache reads an `identifier` key silently
- [x] 2.4 Custom loader keys on `protein_id`; a parquet `-a` goes through
      `ids.keyed_on_protein_id` (one reader, `read_annotation_table`, for `stats` and `bundle`),
      which warns on `identifier`
- [x] 2.5 Directory readers (`bundle -p`, `stats -p`, `ArrowReader`) go through `with_protein_id`
- [x] 2.6 `transfer`, `predictions`, `classification`, `stats`, `export` read `protein_id`

## 3. Web writer

- [x] 3.1 `bundle-writer.ts` always writes `PROTEIN_ID_COLUMN`, refusing an annotation of that name

## 4. Tests

- [x] 4.1 Written names pinned per boundary: bundle, directory, `annotate`, `stats -a`, cache
- [x] 4.2 Reads: old v3 `idColumn: identifier`, old directory and parquet warn once, both names
      key on `protein_id` without warning, old cache reused silently
- [x] 4.3 Contract suite: the `annotate` stand-in keyed on `protein_id`, both writers' `idColumn`
      pinned to `PROTEIN_ID_COLUMN`
- [x] 4.4 Vitest: the writer names the column `protein_id` beside an `identifier` annotation and
      refuses a `protein_id` annotation

## 5. Docs

- [x] 5.1 `docs/guide/data-format.md` (tables, part 1, web-export notes, Read a Bundle in Python)
- [x] 5.2 `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`, `contracts/README.md`

## 6. Verify

- [x] 6.1 Python suite, data-loader and writer vitest suites, `pnpm test:contract`
- [x] 6.2 `openspec validate single-protein-id-column --strict`
