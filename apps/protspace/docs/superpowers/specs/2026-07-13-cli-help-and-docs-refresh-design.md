# CLI help restructure & docs refresh — design

**Date:** 2026-07-13
**Status:** Approved (design)
**Related issues:** [#67](https://github.com/tsenoner/protspace/issues/67) (numeric styling clarity), [#68](https://github.com/tsenoner/protspace/issues/68) (surface `stats`/`transfer`, version drift)

## Summary

The `protspace -h` help lists all nine commands in one flat, alphabetical block, so nothing signals that **`prepare` is the one-shot entry point** and the rest are specialized stages. This design regroups the command list into intent-based panels, tightens every command's one-line summary, adds a quick-start block that steers users to the hosted web explorer (`protspace.app/explore`), and makes the per-command help pages internally consistent. It folds in two open documentation issues (#67, #68) so the CLI and its docs land coherent in one pass.

Behavior is unchanged throughout — this is a docstring / decorator / option-metadata / docs refactor.

## Workstreams at a glance

| # | Workstream                              | Surface                                                | Outcome                                                                                                          |
| - | --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| A | **CLI help restructure**          | `src/protspace/cli/`                                 | `prepare` reads as the entry point; stages/refine/view grouped; crisper summaries; consistent subcommand pages |
| B | **Numeric styling clarity (#67)** | `docs/styling.md`, `utils/add_annotation_style.py` | Doc section on the categorical-only model; a warning when styling a numeric column                               |
| C | **Docs & version refresh (#68)**  | `README.md`, both `CLAUDE.md`                      | `transfer`/EAT + all 5 annotation sources surfaced; version prose → 4.7.0                                     |

Detailed per-file edits are in [Change inventory](#change-inventory) at the bottom; the sections below give the high-level design.

---

## A. CLI help restructure

### A1. Command panels (top-level `protspace -h`)

Group the nine commands into four `rich_help_panel`s. Verified Typer 0.24.1 mechanics: **panel order = order each panel is first registered; within-panel order = registration order.** Both are controlled by the `@app.command(rich_help_panel=...)` string and the import order in `app.py::_register_commands()`.

| Panel                                   | Commands (in order)                                         |
| --------------------------------------- | ----------------------------------------------------------- |
| `Start here`                          | `prepare`                                                 |
| `Pipeline stages · run individually` | `embed`, `project`, `annotate`, `stats`, `bundle` |
| `Refine`                              | `transfer`, `style`                                     |
| `Visualize`                           | `serve`                                                   |

Reorder the `_register_commands()` imports to `prepare, embed, project, annotate, stats, bundle, transfer, style, serve` so panel and within-panel order fall out naturally.

### A2. Header + quick start (main help text)

Set the `typer.Typer(help=...)` to a short mental-model header plus a `\b`-guarded quick-start block (verified: `\b` preserves the block in help text; the `epilog` field does **not** — it rewraps to one paragraph, so quick-start goes in `help`, not `epilog`):

```
ProtSpace — turn protein language model embeddings into an interactive visualization.

Most users only need 'prepare' to build a bundle, then explore it in the browser at https://protspace.app/explore.

Quick start:
  1. protspace prepare -i embeddings.h5 -m pca2,umap2 -o out/
  2. Drag the .parquetbundle onto https://protspace.app/explore   (recommended)
     — or run a local viewer:  protspace serve out/
```

Implementation note: confirm `prepare`'s actual output bundle path (or that `serve <dir>` works) and use the real path in the example.

### A3. One-line summaries

Replace each command's docstring **first line** (the detailed `\b` blocks below it stay unchanged). These drive both the command list and each command's own `-h` header.

| Command      | New summary                                                    |
| ------------ | -------------------------------------------------------------- |
| `prepare`  | Build a visualization bundle in one step (recommended).        |
| `embed`    | FASTA → per-model HDF5 embeddings (Biocentral API).           |
| `project`  | Embeddings → 2D projections (UMAP, t-SNE, PCA, …).           |
| `annotate` | Fetch UniProt / InterPro / taxonomy annotations.               |
| `stats`    | Score projection quality (cluster validity + faithfulness).    |
| `bundle`   | Merge projections + annotations → .parquetbundle.             |
| `transfer` | Fill missing annotations from nearest neighbours (EAT).        |
| `style`    | Set colors, shapes & legend order on a bundle.                 |
| `serve`    | Run a local viewer (web app preferred: protspace.app/explore). |

**Web app as the preferred explorer:** surface `https://protspace.app/explore` in the main-help quick-start (step 2) and in `serve`'s summary + full help, framing the hosted 2D explorer as recommended and local `serve` as the offline/local alternative. Most users should drag their `.parquetbundle` into the web app rather than run a local server.

**3D is help-wording only (non-breaking):** the web app is 2D-only, so drop "3D" from advertised help/examples — `project`'s summary reads "2D projections". `pca3`/`umap3` and `n_components ∈ {2, 3}` stay fully functional (the local Dash `serve` still renders 3D, and existing 3D bundles are unaffected). This changes wording, not behavior — no reducer/config/validation edits. Technically-accurate references (e.g. the EAT note in `docs/cli.md` that distances are computed in the embedding space "not the 2-D/3-D projection") stay as-is.

### A4. Subcommand-page consistency

- **Standardize `--verbose`:** `annotate`, `bundle`, `stats` redefine verbose inline with weaker help ("Increase verbosity."). Switch all commands to the shared `Opt_Verbose` ("Verbosity: -v=INFO, -vv=DEBUG.") and add `show_default=False` to drop the misleading `INTEGER [default: 0]`.
- **Fix option-panel grouping** so related options sit together and core I/O leads instead of scattering into the generic `Options` bucket:
  - `project`: `-i`/`-o`/`-f` are split between `Options` and a stray bottom `Input` panel → unify into one `Input / Output` panel; DR params stay in `Projection`.
  - `prepare`: keep its Input/Embedding/Projection/Annotations/Output panels; verify each own-option lands in the right one.
  - `stats`, `transfer`: today one long ungrouped list → add 2–3 sensible panels (e.g. `transfer`: `Query filters` / `Reference filters` / `Transfer`; `stats`: `Input` / `Output` / `Clustering & validity`).
  - `annotate`, `bundle`, `embed`, `style`, `serve`: small — keep a single panel; verbose standardization only.

---

## B. Numeric styling clarity (#67)

The CLI styling model (`protspace style`) is categorical-only; the web frontend bins numeric columns into gradient ranges instead. A user who styles a numeric column via the CLI silently loses their colors/shapes/pins. Fix = document + warn (no behavior change to styling itself).

- **Docs:** add a **"Numeric annotations"** section to `docs/styling.md` after the Workflow block (before "Styles JSON format", ~line 25). Content: state the categorical-only model; point numeric columns to either pre-binning into categorical strings (the `length_fixed` / `length_quantile` pattern) or the web UI's continuous gradient; warn that `--generate-template` lists every distinct number as a category; note the frontend reinterpretation (`maxVisibleValues` → bin count, `selectedPaletteId` must be a gradient ID, binning/reverse are UI-only); cross-link the frontend legend docs.
- **Code (`src/protspace/utils/add_annotation_style.py`):** add a module-level `logger` (none today); in `generate_template` and the two apply paths (`add_annotation_styles_bundle`, `..._parquet`), detect numeric columns via `from protspace.stats.annotation_select import _is_numeric` and `logger.warning(...)` naming the column + distinct-value count, suggesting binning or the web UI.

**Acceptance (from #67):** styling.md has the numeric section; template/apply on a numeric column warns; doc cross-links the frontend legend behavior.

---

## C. Docs & version refresh (#68)

Reconciled against the current branch: versions are **already 4.7.0** in `pyproject.toml`, `src/protspace/__init__.py`, and `packages/protlabel/pyproject.toml` — **lock-step is intact** (the release-process concern in #68 is resolved; no code change). `docs/cli.md` and `docs/annotations.md` are already current. Remaining work is README + CLAUDE.md prose.

- **`README.md`:** annotation bullet lists only three sources → all five (UniProt, InterPro, Taxonomy, TED domains, Biocentral predictions); add a `transfer`/EAT feature bullet; add a `protspace transfer` line to the power-user workflow linking `docs/cli.md#protspace-transfer`; add a third Colab badge for `notebooks/ProtSpace_Transfer.ipynb` (file exists).
- **`protspace/CLAUDE.md`:** `Version: 4.3.1` → `4.7.0`; add `ProtSpace_Transfer.ipynb` to the notebooks table.
- **`../CLAUDE.md` (suite):** `v4.3.1` → `v4.7.0`; add `stats` and `transfer` to the Entry-point subcommand list.

**Acceptance (from #68):** README lists 5 sources + surfaces `transfer`/EAT + the transfer notebook; CLAUDE.md versions say 4.7.0; suite subcommand list includes `stats` + `transfer`; lock-step confirmed (done — both at 4.7.0).

---

## Non-goals

- No change to any command's runtime behavior, options, or arguments (only their help metadata).
- **3D projection support is retained** — `pca3`/`umap3`, `n_components=3`, and the local Dash `serve` 3D view are unchanged; only 3D's advertising in help is dropped.
- No new commands, no `--version` flag, no restyling of the option-value rendering beyond panel grouping + verbose cleanup.
- No frontend changes (the `protspace_web` companion to #67 is tracked separately).

## Verification

- Re-run `protspace -h` and every `<cmd> -h`; confirm panels, ordering, quick-start block, and no wrapping regressions.
- `uv run ruff check src/ packages/ tests/`.
- `uv run pytest -m "not slow"`; grep tests for any help/docstring/short-help assertions and update.
- Trigger a numeric-column warning manually (`protspace style … --generate-template` on a bundle with a numeric annotation).
- Skim rendered README + CLAUDE.md diffs for broken links / stale counts.

## Change inventory

| File                                            | Change                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/protspace/cli/app.py`                    | New`help=` (header + `\b` quick-start featuring `protspace.app/explore`); reorder `_register_commands()` imports to pipeline order |
| `src/protspace/cli/prepare.py`                | `rich_help_panel="Start here"`; summary; verify option panels                                                                            |
| `src/protspace/cli/embed.py`                  | `rich_help_panel="Pipeline stages · run individually"`; summary                                                                         |
| `src/protspace/cli/project.py`                | Same panel; summary (2D wording, no 3D); unify`-i`/`-o`/`-f` into `Input / Output`                                                 |
| `src/protspace/cli/annotate.py`               | Same panel; summary; use shared`Opt_Verbose`                                                                                             |
| `src/protspace/cli/stats.py`                  | Same panel; summary;`Opt_Verbose`; group options into 3 panels                                                                           |
| `src/protspace/cli/bundle.py`                 | Same panel; summary; use shared`Opt_Verbose`                                                                                             |
| `src/protspace/cli/transfer.py`               | `rich_help_panel="Refine"`; summary; group `--query-*`/`--reference-*`/transfer panels                                               |
| `src/protspace/cli/style.py`                  | `rich_help_panel="Refine"`; summary                                                                                                      |
| `src/protspace/cli/serve.py`                  | `rich_help_panel="Visualize"`; summary + help recommend `protspace.app/explore`                                                        |
| `src/protspace/cli/common_options.py`         | `Opt_Verbose` gets `show_default=False`                                                                                                |
| `src/protspace/utils/add_annotation_style.py` | Module logger; numeric-column warnings in template + apply paths                                                                           |
| `docs/styling.md`                             | "Numeric annotations" section (#67)                                                                                                        |
| `README.md`                                   | 5 annotation sources;`transfer`/EAT bullet + example; 3rd Colab badge (#68)                                                              |
| `protspace/CLAUDE.md`                         | Version → 4.7.0; add transfer notebook (#68)                                                                                              |
| `../CLAUDE.md`                                | Version → 4.7.0; add`stats`/`transfer` to subcommand list (#68)                                                                       |
