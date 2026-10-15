## Why

`protspace export` and the web app's Table export promise the same cells, and the review of #549
found three where they differ. The CLI wrote a boolean annotation as `True`/`False` where the web
writes `true`/`false` (the shared `ARROW_BOOLEAN_LABELS`). It wrote every value of an integer
column with a missing cell as a float (`1.0`), because pandas reads such a column as float64. And
it wrote a whole-number float, a coordinate included, as `2.0` where the web writes `2`. A script
reading either file saw two spellings of one value.

## What Changes

- `read_bundle_table` hands a boolean column back as `true`/`false` and an integer column as
  integers (pandas `Int64`), gaps included; float columns stay numbers.
- `protspace export` writes a whole-number float without its `.0`, as the web export's
  JavaScript `String` does, and a float32 one at float32 precision.

## Capabilities

### Modified Capabilities

- `table-export`: booleans and numbers are written as the web export writes them.

## Impact

- `apps/protspace/src/protspace/data/io/bundle.py` (`read_bundle_table`),
  `apps/protspace/src/protspace/cli/export.py`.
- Tests: `tests/test_export_cli.py`.
