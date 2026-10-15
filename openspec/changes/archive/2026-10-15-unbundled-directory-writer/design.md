## Context

A ProtSpace dataset exists in two forms: the `.parquetbundle` container, and an unbundled
directory holding one parquet file per bundle part. The bundle has one writer
(`_write_parts`) and a spec; the directory had three writers and none. `ArrowReader` reads
both, and `protspace style` accepts both. #540 had already fixed the annotations file name in
`save_data`; settings, statistics and where styles go were still different per writer.

## Goals / Non-Goals

**Goals:**

- One function owns the directory layout, so a file name or an optional part cannot drift
  between writers again.
- Styling a directory does what styling a bundle does: new settings, everything else kept as
  stored.
- An older directory (with `visualization_state.json`) still reads and gets migrated the
  first time its settings are rewritten.

**Non-Goals:**

- One directory reader that folds `visualization_state.json` into settings at read time. The
  JSON-over-settings rule still lives in `ArrowReader`, `dump_settings` and the writer's
  cleanup; that consolidation is a follow-up.
- Removing a stale `settings.parquet` or `statistics.parquet` when a writer is given none.
  Callers keep what an absent part means today.
- Any change to the bundle container or the web reader.

## Decisions

- **`write_directory(core_parts, dir, *, settings=None, statistics=None)` in `data/io/bundle.py`.**
  It sits beside `write_bundle` and uses the same `CORE_FILENAMES` / `SETTINGS_FILENAME` /
  `STATISTICS_FILENAME` the reader uses. A part may be a table or stored parquet bytes, so
  `extract_bundle_to_dir` can write a legacy bundle's parts as stored instead of decoding and
  re-encoding them. A `None` core part writes no file, which is what `protspace project`
  needs. Writes go through `atomic_write_bytes`: `style` rewrites a user's directory in place,
  and every other in-place writer in the package is atomic.
- **Remove `visualization_state.json` only when settings are written.** The reader prefers the
  JSON, so leaving it would hide the new settings. With no settings written there is nothing
  to hide, and deleting it would throw away the only copy of an older `style` run's styles
  (`project` into a styled directory). Alternative considered: reverse the reader's
  precedence. Rejected, because an old in-place `style` left both files and the JSON is the
  newer of the two.
- **`replace_settings_in_directory` for `style <dir>`, not `ArrowReader.save_data`.** It mirrors
  `replace_settings_in_bundle`: the core tables are never rebuilt through pandas, so dtypes,
  footer stamps and bytes survive. In place, only `settings.parquet` is written. Into another
  directory, the other parts are streamed across through `staged_write` and any the input
  lacks are removed, so the output never mixes two datasets.
- **One styling pass, `_styled_settings`, for both inputs.** The directory path used to
  validate against display values and ignore the settings-level keys (`sortMode`,
  `pinnedValues`, ...); it now builds exactly the settings a bundle gets.
- **`rewrap_settings` overlays in both shapes.** `visualization_state_to_settings` rebuilds
  only the annotations that carry colours, shapes or overrides; it already overlaid them on a
  frontend envelope's annotation map, but returned a flat map bare, dropping every other
  annotation's settings. Fixing it in `rewrap_settings` fixes the bundle and directory paths
  and `save_data` at once.
- **`ArrowReader` carries statistics, a directory's as unread bytes.** `save_data` must not drop
  them, but the reader never uses them, so a corrupt file must not stop a load (`serve`).
- **`save_data` keeps its public behaviour.** Colours and shapes set on the reader are stored in
  its settings (the `visualization_state` → settings conversion); unchanged settings are
  written as read.

## Risks / Trade-offs

- [A restyled directory's colours now read back as `rgba(...)`, like a styled bundle's, not
  the hex a `visualization_state.json` held] → Same representation as the bundle path; the
  #540 test is updated to it.
- [Reading `settings.parquet` even when a JSON exists means a corrupt settings file is now
  touched on load] → It is read inside the existing best-effort `try`, logged at debug, as
  for a bundle.
- [Copying into another directory removes files the input lacks] → Only the managed part
  names, and only in the `style` output directory the user named.
