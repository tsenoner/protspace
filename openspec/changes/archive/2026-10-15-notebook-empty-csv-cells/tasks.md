## 1. Implementation

- [x] 1.1 `align_annotations` in `pipeline.py`, used by `run()`
- [x] 1.2 The Preparation notebook calls it, with an inline fallback for protspace <= 4.16

## 2. Tests

- [x] 2.1 Notebook: a CSV with empty cells and an uncovered protein, under the current package
      and with the released loader's nulls and no `align_annotations`
- [x] 2.2 `align_annotations`: order, the id column renamed, nulls and uncovered proteins empty

## 3. Docs

- [x] 3.1 `apps/protspace/CLAUDE.md`

## 4. Verify

- [x] 4.1 `tests/test_notebooks.py` under ipywidgets 8 and 7.7.1
- [x] 4.2 `openspec validate notebook-empty-csv-cells --strict`
