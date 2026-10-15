## Context

See proposal.md for why (tracking issue #544). The current state that shapes the approach:

- Projection methods reach the package through one function: both `prepare` and `project` turn `-m` into method specs with `pipeline.parse_methods_arg`, and the Colab preparation notebook calls the same function with `*2` methods only. `DimensionReductionConfig` accepts `n_components` 2 or 3, so 3-D is a dimension, not a separate code path, until the bundle is written (`z` column).
- `protspace serve` is the only entry into the Dash app (`main.py` → `app.py` → `ui/`, `visualization/`, `assets/`), which needs the `frontend` extra. The CLI already imports without that extra (`test_cli_no_frontend.py`).
- One deprecation already exists: reading v1/v2 bundles, due for removal in 5.0.0 (`bundle.LEGACY_REMOVAL_VERSION`, warned from `_parse_bundle`). Nothing checks that date.
- Versions come from python-semantic-release v10.6.1 in `protspace-release.yml`, run from `apps/protspace` with the `conventional-monorepo` parser. `released` is decided from the step's output, because PSR exits 0 on "No release will be made".
- Every reader shows a 3-D projection as its X/Y view in the browser (`docs/explore/control-bar.md`); Python reads keep `z` (`read_tables`, `ArrowReader`, `stats`). A projection is 3-D when its rows hold a finite `z`: the data decides, as in the v3 encoder and the browser's legacy reader.
- `protspace convert` (from `parquetbundle-v3`) upgrades v1/v2 to v3 and leaves a v3 input untouched; that change's 5.0.0 follow-up said convert would stop reading v1/v2 too.
- The CLI reports warnings through `logging` (`setup_logging` prints `WARNING: …` on stderr); it uses no Python `warnings` for user-facing messages.

## Goals / Non-Goals

**Goals:**

- One place holding each scheduled removal's version and text, read by the warnings, the `-m` help and both checks.
- A version bump to 5.0.0 cannot be released, and cannot stay green on a PR, while a 5.0.0 entry remains.

**Non-Goals:**

- Removing anything. 3-D, `serve` and v1/v2 reading all keep working until the 5.0.0 change.
- Changing how 3-D projections are read or shown before 5.0.0. They keep loading everywhere, with a warning.
- Gating the web app's own legacy-bundle readers. The gate guards the PyPI package; `deploy.yml` has no version to compare.

## Decisions

### A stdlib-only module, `protspace/deprecations.py`

Each entry is a frozen dataclass: `key`, `feature` (what goes, in words), `remove_in`, `message` (a `str.format` template that receives `remove_in` plus caller fields such as the requested methods or the bundle path), and `removal` (short `path: what to do` notes). A `warn(key, logger, **fields)` helper formats and logs the message through the caller's own logger, so records keep the logger name existing tests filter on (`protspace.data.io.bundle`), and `due(version)` returns the entries a version has reached.

The module imports nothing outside the standard library, because the release gate loads it from its file path on a runner with no protspace installed, and `common_options.py` imports it on every CLI start (including `--help`).

Alternatives: a TOML/JSON data file (the warnings would need a loader on the hot path, and help text cannot import it cheaply); keeping versions next to each feature (that is what we have, and nothing reads them together).

### Versions compare on the release core

`due()` compares `MAJOR.MINOR.PATCH` as integers and ignores any pre-release or build suffix, so `5.0.0-rc.1` counts as 5.0.0. The package does not publish pre-releases today; if it starts, a 5.0.0 release candidate is exactly where the removals should already be in. A version that is not `X.Y.Z` (an optional leading `v` allowed) raises, rather than passing the gate silently.

### Warn in `parse_methods_arg`, once per call

Both commands that accept methods, and any script or notebook that parses `-m` strings, go through it, so one call site covers every entry point without touching `prepare.py`'s flow. It logs one warning listing every requested 3-D method and the first one's 2-D variant.

Trade-off: in `prepare`, methods are parsed after the inputs are loaded and embedded, so on a FASTA input the warning appears after embedding, not at start-up. Moving the parse earlier would reorder a file other work is editing; the warning is still printed before any projection runs and lands in the same terminal output.

Alternatives: a Typer callback on `-m` (fires before `setup_logging`, so the line would lack the `WARNING:` prefix, and it would duplicate method parsing); a check in `DimensionReductionConfig` (fires once per embedding set × method, too noisy).

### `serve` uses Typer's `deprecated=True` plus the registry warning

Typer (0.26.8 here; the floor 0.24.1 also supports it) prints `(deprecated)` beside the command in `protspace --help` and its own help, and Click prints a generic `DeprecationWarning: The command 'serve' is deprecated.` on invocation. That line cannot say where to go, so the command also logs the registry warning (version + https://protspace.app/explore) after `setup_logging(0)`. Passing a string to `deprecated=` would print a single combined line, but Typer types the parameter as `bool`, so it is not relied on. The command help is built from the registry so the version shown is the registered one.

### The v1/v2 read deprecation joins the registry

Its removal version moves from `bundle.LEGACY_REMOVAL_VERSION` into the registry (the constant stays as an alias so imports keep working), and its warning text becomes the registry template, unchanged word for word. Leaving it out would let 5.0.0 pass the gate with the legacy reader still in, which is the failure this change exists to prevent.

### The web app's copies of the v1/v2 version are pinned, not shared

The browser restates 5.0.0 in TypeScript: the legacy-format notice users see (`apps/web/src/explore/notifications.ts`) and the decoder's deprecation notes (`packages/core/.../utils/bundle.ts`, `data-loader.ts`). TypeScript cannot import the Python registry, and generating a TS constant from it would add a build step for one string. Instead `tests/test_deprecations.py` reads those three files and asserts every removal version they name (after "protspace", "ends in" or "until") equals the registry's, and that the user-facing notice says "stop opening in ProtSpace <remove_in>". The files join `protspace-ci.yml`'s path filter so an edit to only the web copy runs the test. The release gate still guards only the PyPI package; the web removal is `parquetbundle-v3` task 6.3, tracked in #544.

### Reading 3-D projections warns where the projections are read

Maintainer decision (2026-10-15): 5.0.0 stops reading 3-D projections as well as producing them. The warning goes where a bundle's projections become tables: `read_tables`, `read_bundle_contents` (which `ArrowReader` uses), `read_bundle` and `extract_bundle_to_dir`, each logging one registry warning (`3d-projection-read`) per read through the bundle logger, after the v1/v2 warning when both apply. A helper, `bundle.three_d_projection_names(projections)`, lists the projections whose rows hold a finite `z`, in first-seen order, from the v2-shaped table every read produces. `protspace stats` reads a projection directory directly, so it warns with the same entry.

Not warned: `read_settings_from_bundle` / `read_statistics_from_bundle` never touch projections (so `protspace style`, which only rewrites settings, stays quiet), the writers read their input without decoding projections, `convert` prints its own message (below), and `protspace bundle` passing a `project` directory through (that directory's 3-D projections were warned about when `project` made them). `read_bundle_contents(..., warn_3d=False)` exists for callers that read such files on purpose, like `warn_legacy`.

Alternative: one warning in `decode_v3`. It would miss legacy bundles and fire inside `convert`.

### The web notice reuses the legacy-format notice

`getThreeDProjectionNotification(names)` in `apps/web/src/explore/notifications.ts` builds an info notice, deduped on `three-d-projections`. `dataset-controller.ts` shows it under the same rule as the legacy-format notice (a user's own import only, since a visitor cannot convert a dataset the app serves), counting `data.projections` with `dimension === 3`. Both notices can show for one file; each has its own dedupe key. The core decoder shows no UI. The Python pin test reads the notice's version as it reads the v1/v2 ones.

### `protspace convert` stays, and learns `--flatten-3d`

Maintainer decision (2026-10-15): `convert` survives 5.0.0 as the upgrade path. In 5.0.0 the general readers drop v1/v2 and 3-D; `convert` keeps a reader of its own for both and always writes v3 with 2-D projections. That retained reader is by design, so it is **not** a registry entry and the gate never asks for its removal. The registry's v1/v2 removal notes say so, and `parquetbundle-v3` task 6.2 and its Migration Plan step 4 are amended.

`--flatten-3d` does the 5.0.0 behaviour now, on request:

- each 3-D projection becomes 2-D with its X and Y (what the web viewer shows today, so the picture does not change) and its `z` dropped;
- it is renamed `<name> (X/Y)`, and its `info_json` gains `"flattened_from_3d": true`, so a reader sees it is not a 2-D fit; a name that would collide with an existing projection is refused;
- its `info_json.quality` (faithfulness) and its `statistics` rows (`space_kind == "projection"`, `space_name == <name>`) are dropped, because they describe the 3-D layout; other statistics rows and settings are kept byte for byte;
- it applies to v3 inputs too. Without the flag (or with nothing to flatten) a v3 input is still left untouched, as `parquetbundle-v3`'s `bundle-conversion` spec requires; with the flag and a 3-D projection present, a v3 input is rewritten.

Without the flag, `convert` keeps 3-D projections and prints a warning naming them, the removal version and `--flatten-3d`; in 5.0.0 flattening becomes automatic. `convert_bundle` returns a `Conversion` (input version, 3-D names found, names flattened, whether it wrote) instead of a bare version, so the command can report all of it; its only caller is `cli/convert.py` (tests ignore the return).

Alternatives: keep the projection name and mark only the metadata (the projection menu would show a 2-D layout under a 3-D method's name with nothing visible to tell them apart); project to the first two principal axes of the 3-D coordinates (changes the picture users have been looking at).

### The release gate: `semantic-release version --print`, then a script

A new step before "Run Semantic Release" runs, from `apps/protspace` with the same pinned PSR:

```
next=$(uv tool run --from python-semantic-release semantic-release version --print | tail -n 1)
python3 scripts/check_deprecations.py --next-version "$next"
```

`--print` computes the next version from the same history and config the real step uses and exits without writing a commit, tag, changelog or version file. Verified locally on a full clone of `origin/main` at v4.16.5 with PSR 10.6.1: stdout `4.16.5` (and "No release will be made…" on stderr, exit 0) with nothing due; `4.17.0` after a `feat(cli)` commit touching `apps/protspace`; `5.0.0` after a `BREAKING CHANGE` commit there; still `4.16.5` after a breaking commit outside `apps/protspace` (the monorepo path filter applies). `git status` stayed clean after each run.

The script (stdlib only) loads `src/protspace/deprecations.py` by path, reads the current version from `src/protspace/__init__.py`, and:

- passes, saying no release is due, when the next version equals the current one (what `--print` prints when nothing is to be released, including the run triggered by a release's own bump commit);
- passes when the next version is earlier than every `remove_in`;
- otherwise exits 1, listing each due feature, its `remove_in` and its removal notes, with `::error::` annotations on Actions.

A failing `--print` fails the step (`set -euo pipefail`). With PSR pinned at 10.6.1, "nothing to release" exits 0, so that only happens on a genuine error, which would fail the release step too. The release step and its output-based `released` logic are untouched.

A test reads the workflow and asserts the gate step exists and runs before the `semantic-release version --commit` step, so the gate cannot be deleted or reordered quietly; `protspace-ci.yml` gains the workflow in its path filter so an edit to it runs that test.

### The unit test is the earlier tripwire

`tests/test_deprecations.py` asserts `due(protspace.__version__) == []`. The release commit that bumps to 5.0.0 cannot be made while the gate holds, but a manual bump, or a gate that was bypassed, still turns every following PR red. It also asserts each entry's removal notes name files that exist, so the inventory below cannot point at paths that have already moved.

## Risks / Trade-offs

- [The gate only sees what PSR computes; a hand-made `v5.0.0` tag bypasses it] → the unit test fails on the next PR, and `AGENTS.md` says the bump is blocked until the removals land.
- [`--print`'s stdout format changes in a later PSR] → the pin is explicit (10.6.1); the script rejects a value that is not a version, so a format change fails loudly instead of passing.
- [Two deprecation lines for `serve` (Click's generic one and ours)] → accepted; ours carries the version and the replacement.
- [3-D warning appears late in a FASTA `prepare`] → accepted, see the decision above.

## v5.0.0 removal inventory

Verified by grepping for importers on this branch (4.16.5). The registry's `removal` notes are the short form of this list.

### `protspace serve` and the Dash viewer

Delete:

- `src/protspace/cli/serve.py`, and its `serve` import in `cli/app.py:_register_commands` plus `PANEL_VISUALIZE` (used only by `serve`).
- `src/protspace/main.py` (imported only by `cli/serve.py`).
- `src/protspace/app.py` (imported only by `main.py`).
- `src/protspace/ui/` (`callbacks.py`, `layout.py`, `styles.py`, `__init__.py`; imported only by `app.py` and each other).
- `src/protspace/visualization/` (`plotting.py`, `molstar.py`; imported only by `app.py`, `ui/callbacks.py` and `tests/test_display_decode.py`).
- `src/protspace/assets/` (CSS, logos, `help_content/*.md`; used only as `app.py`'s `assets_folder` and by `ui/layout.py`).
- `src/protspace/core/config.py` (`DEFAULT_PORT`, panel widths, highlight styles, `NAN_COLOR`, `MARKER_SHAPES_2D/3D`: used only by `ui/` and `visualization/`), its re-exports and lazy `__getattr__` in `core/__init__.py`, and `core/constants.is_projection_3d` with its `ArrowReader` import (used only by `ui/callbacks.py`). Keep the rest of `core/constants.py`: `MISSING_VALUE_TOKENS`, `BROWSER_MISSING_TOKENS` and `standardize_missing` are used by `cli/transfer.py`, `data/io/bundle_v3.py`, `stats/annotation_select.py`, `scripts/generate_examples/build_showcase.py` and `tests/test_biocentral_retriever.py`.
- `pyproject.toml`: the `frontend` extra (dash, dash-bootstrap-components, dash-daq, dash-iconify, plotly, kaleido, dash-molstar); from the dev group `dash[testing]`, `webdriver-manager` and `dash-mantine-components` (no importer anywhere today); the `selenium`, `kaleido` and `dash_molstar` entries in pytest `filterwarnings`; then relock `uv.lock`.
- Tests: `tests/test_cli_no_frontend.py` (its purpose ends with the extra); the `create_plot` / `prepare_dataframe` tests in `tests/test_display_decode.py` (the rest of that file tests `add_annotation_style` and `ArrowReader`, which stay).
- Docs: the `frontend` row of the extras table in both `apps/protspace/README.md` and `docs/guide/python-cli.md` (kept identical by `test_docs_extras_sync.py`); the `serve` rows and the `## protspace serve` section of `python-cli.md`; the `serve` mention in `docs/guide/data-format.md` (v3 decode paragraph) and `apps/protspace/docs/cli.md`; `apps/protspace/CLAUDE.md` (commands table, package tree, "Frontend (optional)" dependency line, `test_cli_no_frontend.py` row).
- CI / Docker: nothing. No workflow installs the `frontend` extra, the Dash image was retired in fec6a2cb (`protspace-publish.yml`), and `docker-compose.yml` runs only the prep service.

Not deleted, but worth a pass afterwards: `utils/arrow_reader.ArrowReader` stays (`protspace style` uses it through `add_annotation_style.py`), yet `get_projection_names`, `get_projection_data`, `get_projection_info`, `get_protein_ids`, `get_marker_shape`, `get_annotation_colors`, `get_unique_annotation_values`, `get_protein_annotations` and `get_data` are then used only by tests.

### 3-D projections

- `src/protspace/utils/constants.py`: `DimensionReductionConfig.n_components` allows `[2]` only (and its docstring).
- `src/protspace/data/processors/pipeline.py`: the 3-D warning in `parse_methods_arg` becomes a usage error naming the 2-D variant.
- `src/protspace/cli/common_options.py`: the deprecation sentence in `-m` help.
- `docs/guide/python-cli.md`: the 3D column and dimension-suffix wording under "Projection Methods", and the `project` row ("2D projections").
- Tests: the 3-D warning tests in `tests/test_deprecations.py` become rejection tests.

### Reading 3-D projections

Verified by grepping both languages for `z`, `dimension === 3`, `is3D`, `projectionPlane`, `has_z` and `__z` on this branch. In 5.0.0 every general reader treats a bundle as 2-D; `protspace convert` keeps reading `z` to flatten (see Decisions).

Python:

- `src/protspace/data/io/bundle_v3.py`: the encoder's 3-D branch (`z` column, finite-`z` dimension detection, `__z` axis), the decoder's axis list (`("x", "y", "z")[:dimension]`) and the long-format `z` column.
- `src/protspace/data/io/bundle.py`: the 3-D read warning and `three_d_projection_names` (convert keeps the latter).
- `src/protspace/data/processors/base_processor.py`: the `z` column it writes (the producer side, gone with 3-D methods).
- `src/protspace/utils/arrow_reader.py`: the empty frame's `z` column and the `z` coordinate it reads per point.
- `src/protspace/cli/stats.py`: the 3-D branch of `_load_reductions` and its warning.
- `src/protspace/cli/convert.py`: `--flatten-3d` becomes the default (the flag can stay as a no-op or go).
- Scripts: `scripts/generate_examples/build_showcase.py` (`z` axis when rebuilding a bundle), `scripts/generate_examples/write_manifest.py` (the `z` column in its schema list), `scripts/generate_v3_fixture.py` (the `umap3` projection of the golden fixture).
- Tests that read 3-D bundles as a supported case: `test_bundle_v3_fixture.py`, `test_bundle_v3_encode.py`, `test_bundle_v3_decode.py`, `test_bundle_v3_container.py`, `test_arrow_reader.py`, `test_stats.py`, `test_stats_cli.py`, `test_directory_io.py`, plus the read-warning tests in `test_deprecations.py`.

Web (TypeScript):

- `packages/core/src/components/data-loader/utils/bundle-v3.ts`: manifest dimension 3 and the `__z` interleave.
- `packages/utils/src/parquet/v3-format.ts`: `V3_AXES` includes `z`.
- `packages/core/src/components/data-loader/utils/conversion.ts`: the `z` column and the `dimension === 3` path of the row reader.
- `packages/utils/src/types.ts`: `dimension: 2 | 3` and `metadata.dimension`; `packages/core/src/components/control-bar/{control-bar,types}.ts` repeat it.
- `packages/utils/src/visualization/data-processor.ts` and `packages/core/src/components/scatter-plot/scatter-plot.ts`: `projectionPlane` (`xy`/`xz`/`yz`) and the 3-D coordinate paths.
- `packages/utils/src/parquet/bundle-writer.ts`: writes as many axes as a projection has (generic, nothing to delete once nothing is 3-D).
- `packages/core/src/components/publish/publish-state.ts`: the figure editor's `dimensionality` fingerprint.
- `apps/web/src/explore/notifications.ts` / `dataset-controller.ts`: the 3-D notice and its trigger.
- Fixtures and tests: the `umap3` projection in `packages/core/.../__fixtures__/v3-sample.parquetbundle` and the tests asserting it (`bundle-v3.test.ts`, `v3-equivalence.test.ts`, `bundle-roundtrip.test.ts`, `decode-transferables.test.ts`), `slice-visualization-data.test.ts`, `data-processor.test.ts`, the scatter-plot tests using `projectionPlane`, `bundle-writer.test.ts`, `tests/contract/bundle.contract.test.ts` (`PCA_3`), and the e2e 3-D notice test in `apps/web/tests/dataset-reload.spec.ts`.

Docs and specs: `docs/explore/control-bar.md` (3D tip), `docs/explore/figure-editor.md` (2D/3D fingerprint), `docs/explore/scatterplot.md` ("2D or 3D layout"), `docs/developers/api/index.md` (`projectionPlane`), `docs/guide/data-format.md` (`<name>__z`, "A projection is 3D when…"), `docs/guide/python-cli.md`; the `bundle-format-contract` spec's "A three-dimensional projection is read" scenario and `eat-provenance-connectors`'s "Projection or 3-D plane change" scenario need MODIFIED deltas in the 5.0.0 change.

### Reading v1/v2 bundles

Owned by the in-flight `parquetbundle-v3` change (its design, "v1/v2 read-only until 5.0.0"): the 3-to-5-part branch of `data/io/bundle._split` for the general readers and the legacy warning in `_parse_bundle`, the legacy-read tests in `tests/test_convert.py`, and the web app's legacy readers (not gated here). `protspace convert` keeps a legacy reader of its own (maintainer decision 2026-10-15; that change's task 6.2 is amended), so the v1 cell migration and the v2 id-column fallback move into it rather than going.

### The registry itself

Delete each entry once its removal has landed; with no entries left, the module, the gate script and the step can stay for the next deprecation.

## Migration Plan

No migration now: every deprecated path behaves as before apart from the warning. Rollback is reverting the commits; the release gate is one workflow step.

For 5.0.0: land the removals above, delete their registry entries, then let a `BREAKING CHANGE` commit under `apps/protspace/` cut the release. The gate passes once the registry has no entry due at 5.0.0.

## Open Questions

- When both changes archive, `parquetbundle-v3`'s `bundle-conversion` requirement "SHALL leave a v3 input untouched" needs the `--flatten-3d` exception this change adds to `deprecation-policy`; whichever archives second should reconcile the wording.
