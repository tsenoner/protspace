## 1. Failing tests first

- [x] 1.1 `tests/test_directory_io.py`: `write_directory` writes the layout the reader reads, skips absent parts, and clears a stale `visualization_state.json` only when it writes settings
- [x] 1.2 Same file: an extracted bundle equals `prepare --no-bundled` output, value for value
- [x] 1.3 Same file: `style <dir>` keeps every other part byte for byte, lands the settings a styled bundle gets, rewrites only the settings in place, drops parts the input lacks from a reused output directory, and replaces a stale `visualization_state.json`
- [x] 1.4 Same file: `style` keeps an unstyled annotation's settings, on a bundle and on a directory
- [x] 1.5 Same file: an unreadable `statistics.parquet` does not stop a directory loading and is carried through `save_data`
- [x] 1.6 Run them and watch each fail for the stated reason

## 2. One directory writer

- [x] 2.1 Per-file constants, `VISUALIZATION_STATE_FILENAME`, and `write_directory` (atomic, table or bytes per part, `None` writes no file) in `data/io/bundle.py`
- [x] 2.2 `BaseProcessor.save_output(bundled=False)`, `extract_bundle_to_dir`, `cli/project.py` and `ArrowReader.save_data` write through it
- [x] 2.3 `cli/stats.py`, `cli/bundle.py`, `dump_settings` and the showcase build look the files up by the constants

## 3. Style on a directory

- [x] 3.1 `_styled_settings`: one styling pass for bundle and directory input
- [x] 3.2 `replace_settings_in_directory`, the counterpart of `replace_settings_in_bundle`, used by `add_annotation_styles_parquet`
- [x] 3.3 `rewrap_settings` overlays the rebuilt annotations on flat settings as well as on the frontend envelope

## 4. Reader

- [x] 4.1 `ArrowReader` keeps statistics (a directory's as unread bytes) and loads `settings.parquet` even when a `visualization_state.json` is present
- [x] 4.2 `save_data` stores reader-side colour and shape edits in settings and writes unchanged settings as read; #540's tests updated for rgba colours

## 5. Docs and verification

- [x] 5.1 `docs/guide/data-format.md`: Unbundled directory section
- [x] 5.2 `apps/protspace/CLAUDE.md`: output-format notes and the `test_directory_io.py` row
- [x] 5.3 `uv run pytest -m "not slow"` and `ruff` clean; `pnpm precommit` through the commit hook
