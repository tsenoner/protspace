## Why

Three code paths wrote an unbundled parquet directory, each its own way: `prepare --no-bundled`
(`BaseProcessor.save_output`), `extract_bundle_to_dir`, and `ArrowReader.save_data`, which is
what `protspace style <dir>` used. The last one dropped `settings.parquet` and
`statistics.parquet` and stored the styles in `visualization_state.json`, while styling a
bundle writes them to its settings part. A styled directory lost its statistics and its
settings, and the only spec that covers the format (`bundle-format-contract`) says nothing
about the directory form at all, so nothing pinned what a directory holds.

## What Changes

- One writer, `write_directory`, for every unbundled directory: `prepare --no-bundled`,
  `extract_bundle_to_dir`, `protspace project` (projections only) and `ArrowReader.save_data`.
  It names the files by the shared constants, writes atomically, and writes
  `settings.parquet` / `statistics.parquet` when there are any.
- A `visualization_state.json` left by an older `style` is removed whenever settings are
  written, because the reader prefers it over `settings.parquet`.
- `protspace style <dir>` writes its styles to `settings.parquet` through the same styling
  pass as a bundle, and keeps every other file byte for byte (in place, only the settings
  file is written; into another directory, the other parts are copied and any the input
  lacks are removed).
- `protspace style` (bundle or directory) keeps the stored settings of every annotation it
  does not style. Before, flat (Python-written) settings lost them.
- `ArrowReader` carries a directory's statistics through unread, so an unreadable
  `statistics.parquet` no longer stops a directory from loading.
- `extract_bundle_to_dir` writes a legacy bundle's parts as stored, and decodes a v3 core
  back to the v2 shape as before.

No change to the `.parquetbundle` container or to what the web reader accepts.

## Capabilities

### New Capabilities

- `unbundled-directory`: the on-disk layout of a ProtSpace parquet directory (file names,
  optional settings and statistics, the legacy `visualization_state.json`), who writes it,
  and how `protspace style` and `ArrowReader` treat it.

### Modified Capabilities

None. `bundle-format-contract` covers the bundle container and the cross-language reader,
neither of which changes.

## Impact

- `apps/protspace/src/protspace/data/io/bundle.py`: `write_directory`,
  `replace_settings_in_directory`, `VISUALIZATION_STATE_FILENAME` and the per-file constants;
  `extract_bundle_to_dir` rewritten on top of them.
- `data/processors/base_processor.py`, `cli/project.py`, `cli/stats.py`, `cli/bundle.py`:
  write or look up the directory through the helper and constants.
- `utils/arrow_reader.py`: statistics carried, settings always loaded, `save_data` through
  the helper.
- `utils/add_annotation_style.py`: one `_styled_settings` pass for both inputs.
- `data/io/settings_converter.py`: `rewrap_settings` overlays flat settings too.
- Docs: `docs/guide/data-format.md` (Unbundled directory), `apps/protspace/CLAUDE.md`.
- Tests: `tests/test_directory_io.py` (new); `test_arrow_reader.py`, `test_display_decode.py`
  updated for colours that now come back from settings in rgba form.
