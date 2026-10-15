## Why

The web app and the Python package each decide which annotation cells are missing, and they
disagree. The web reader (`normalizeMissingValue`) treats a blank cell, or one spelled `na`,
`n/a`, `nan`, `null`, `none` or `__na__` in any case and with surrounding whitespace, as
N/A. Python's `MISSING_VALUE_TOKENS` is a different list (`""`, `nan`, `none`, `null`, `NA`,
`NaN`), compared case-sensitively, and its three consumers do not even agree with each other:

| Cell        | Web | Dash plot (`standardize_missing`) | `stats`  | `transfer` |
| ----------- | --- | --------------------------------- | -------- | ---------- |
| null        | N/A | category `None`                   | missing  | missing    |
| `N/A`       | N/A | category                          | category | category   |
| `None`      | N/A | category                          | missing  | category   |
| `NULL`      | N/A | category                          | category | category   |
| `NA` padded | N/A | category                          | category | missing    |
| `__NA__`    | N/A | category                          | category | category   |

So `transfer` copies the label `N/A` from a reference onto queries, `stats` scores a
phantom `N/A` cluster, and the Dash legend shows every null cell as a `None` category. It is
the bug class behind #339: a value one side read as a category and the other as missing.
A second Python list, `BROWSER_MISSING_TOKENS`, already mirrors the web for the v3 encoder,
which is how the two lists drifted without anything failing.

## What Changes

- One Python definition: `MISSING_VALUE_TOKENS` becomes the web's set (lower-case) and a new
  `is_missing_value()` mirrors `normalizeMissingValue` (null, non-finite numbers, blank, or
  a token after trimming and lower-casing). `BROWSER_MISSING_TOKENS` is removed; its users
  (the v3 encoder's numeric inference, the showcase build's N/A gate) take the shared set.
- `standardize_missing` (Dash plot), `stats` annotation selection and `transfer` decide
  missingness through `is_missing_value`, so all three agree with the web. `stats` still
  also drops the display forms pandas round trips produce (`<N/A>`, `<NA>`, `<NaN>`, `NaT`).
- The bundle contract suite pins the agreement: the generator writes Python's token set and
  its verdict on a table of probe spellings into the manifest, and the suite asserts the
  web's set and `normalizeMissingValue` give the same answers. The Python test that read the
  set out of the TypeScript source with a regex is removed in its favour.
- A Python test runs every fixed producer vocabulary (TMbed, signal peptide, PDB
  cross-reference, fragment, reviewed, boolean labels) through `is_missing_value`, and
  scans the annotation producer modules for any string literal spelled like a missing token.

## Capabilities

### New Capabilities

### Modified Capabilities

- `bundle-format-contract`: adds a requirement that the producer and the web reader read the
  same annotation cells as missing, checked by the contract suite, and that no fixed category
  the producer writes is spelled like a missing value.

## Impact

- `apps/protspace/src/protspace/core/constants.py` (token set, new predicate,
  `standardize_missing`), `stats/annotation_select.py`, `cli/transfer.py`,
  `data/io/bundle_v3.py`, `scripts/generate_examples/build_showcase.py`.
- `tests/contract/emit_bundles.py` and `tests/contract/bundle.contract.test.ts`.
- Python tests: new `tests/test_missing_values.py`; `test_biocentral_retriever.py` loses
  its regex parity check.
- Docs: `docs/guide/data-format.md` (Missing Values) says the Python readers follow the same
  rule, and `docs/guide/python-cli.md` (`transfer`) links to it.
- Behaviour: a Python run now treats `N/A`, `NULL`, `None`, `__NA__` and padded tokens as
  missing in the Dash plot, `stats` and `transfer`, as the web already does. The
  numeric-column warning of `protspace style`, which reuses the `stats` check, now also
  skips them, so `1`, `2`, `N/A` warns as numeric, as the web bins it. No change to the
  bundle format or to what the web reader does.
- Not covered: the style-key N/A aliases (`_NA_LABELS` in `settings_converter.py` and
  `add_annotation_style.py`), which map a styles file's N/A spelling to the data's, and the
  web's per-hit dropping of missing spellings inside a multi-hit cell. Both stay as they are.
