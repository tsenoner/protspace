## Why

Running EAT at all required inventing a column. `protspace transfer` without `--query-*`/`--reference-*` raised "Classifier matched no query proteins", because an empty `Rule` matched nothing rather than everything. Users had to add a marker column describing "the rows that are empty" — producing the shipped EAT demo bundle needed exactly that, a synthetic `eat_split` column plus two flags (`apps/protspace/data/eat_demo/README.md`).

Separately, the predicted (hollow ring) and observed (filled) glyphs were outlined inconsistently, and the outline was a fraction of the sprite rather than an absolute width — so at the app's own `nature-1col` preset (89 mm @ 300 dpi) the observed-dot outline fell below the reproducible-line floor for print while the ring survived. In a published figure only one glyph class had an outline at all.

## What Changes

- A classification rule with no clauses is **open** — it matches every protein — so passing no rules means "transfer within this dataset". Precedence between query and reference applies only between two _explicit_ rules, so an open rule never starves the other set. An explicit rule that matches nothing stays an error.
- The glyph outline is measured in **device pixels**, derived from the isotropic pixel scale the ring already used, applied to both filled dots and predicted rings and budget-capped on the ring. Filled-vs-hollow remains the encoding that distinguishes them.

## Capabilities

### New Capabilities

- `eat-transfer-scope`: which proteins act as queries and references when `protspace transfer` runs, including the no-rules (self-transfer) case.

### Modified Capabilities

<!-- The EAT specs live in the unarchived `add-eat-visualization` change, not in openspec/specs/, so there is no committed requirement to modify. -->

## Impact

- **Backend:** `apps/protspace/src/protspace/analysis/classification.py`, `cli/transfer.py`. `feat:` on `apps/protspace/` — earns a PyPI minor bump, correct for a user-visible CLI behaviour change.
- **Shader:** `packages/core/src/components/scatter-plot/webgl/renderer/export-shaders.ts`, the single source compiled by both the live and export renderers.
- **Bundle format:** unchanged; `format_version` stays 2.
- **Not included:** the EAT reliability filter (#380) — it depends on filter-query semantics being changed by #416 and is restacked on that branch; audit mode (#424).
