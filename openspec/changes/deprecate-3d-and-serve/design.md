## Context

See proposal.md for why (tracking issue #544). The current state that shapes the approach:

- Projection methods reach the package through one function: both `prepare` and `project` turn `-m` into method specs with `pipeline.parse_methods_arg`, and the Colab preparation notebook calls the same function with `*2` methods only. `DimensionReductionConfig` accepts `n_components` 2 or 3, so 3-D is a dimension, not a separate code path, until the bundle is written (`z` column).
- `protspace serve` is the only entry into the Dash app (`main.py` → `app.py` → `ui/`, `visualization/`, `assets/`), which needs the `frontend` extra. The CLI already imports without that extra (`test_cli_no_frontend.py`).
- One deprecation already exists: reading v1/v2 bundles, due for removal in 5.0.0 (`bundle.LEGACY_REMOVAL_VERSION`, warned from `_parse_bundle`). Nothing checks that date.
- Versions come from python-semantic-release v10.6.1 in `protspace-release.yml`, run from `apps/protspace` with the `conventional-monorepo` parser. `released` is decided from the step's output, because PSR exits 0 on "No release will be made".
- The CLI reports warnings through `logging` (`setup_logging` prints `WARNING: …` on stderr); it uses no Python `warnings` for user-facing messages.

## Goals / Non-Goals

**Goals:**

- One place holding each scheduled removal's version and text, read by the warnings, the `-m` help and both checks.
- A version bump to 5.0.0 cannot be released, and cannot stay green on a PR, while a 5.0.0 entry remains.

**Non-Goals:**

- Removing anything. 3-D, `serve` and v1/v2 reading all keep working until the 5.0.0 change.
- Reading 3-D projections. Bundles keep their `z` axis, the web viewer keeps reading 3-D projections as their X/Y view, and `protspace stats` keeps scoring 3-D projections in an existing project. Only producing them is deprecated.
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
- Kept: the bundle `z` axis (`base_processor`, `bundle_v3`, the v3 fixtures with `umap3`), `cli/stats.py`'s 3-D branch, and the web viewer's 3-D handling, which read 3-D projections from existing bundles (see Non-Goals).

### Reading v1/v2 bundles

Owned by the in-flight `parquetbundle-v3` change (its design, "v1/v2 read-only until 5.0.0"): the 3-to-5-part branch of `data/io/bundle._split` and the legacy warning in `_parse_bundle`, the legacy-read tests in `tests/test_convert.py`, and the web app's legacy readers (not gated here). Whether `protspace convert` stays in 5.0.0 is that change's decision.

### The registry itself

Delete each entry once its removal has landed; with no entries left, the module, the gate script and the step can stay for the next deprecation.

## Migration Plan

No migration now: every deprecated path behaves as before apart from the warning. Rollback is reverting the commits; the release gate is one workflow step.

For 5.0.0: land the removals above, delete their registry entries, then let a `BREAKING CHANGE` commit under `apps/protspace/` cut the release. The gate passes once the registry has no entry due at 5.0.0.

## Open Questions

- Whether 5.0.0 should also stop reading 3-D projections in `protspace stats` (it reads existing projects); deferred, does not affect this change.
