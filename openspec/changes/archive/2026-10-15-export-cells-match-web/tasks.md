## 1. Implementation

- [x] 1.1 `read_bundle_table`: booleans as `true`/`false`, integer columns as `Int64`
- [x] 1.2 `protspace export`: whole-number floats without `.0`

## 2. Tests

- [x] 2.1 `tests/test_export_cli.py`: a bundle with bool, int, float and float32 columns and
      gaps exports the cells the web export writes

## 3. Verify

- [x] 3.1 `tests/test_export_cli.py`, `openspec validate export-cells-match-web --strict`
