## Context

ProtSpace renders annotations from `.parquetbundle` files entirely client-side. The backend
`protspace` package produces 42 annotations from 5 sources; only the 4 **Biocentral** columns are
ML predictions and they already carry a `predicted_` prefix. The frontend has no notion of
"predicted vs experimental" and no in-app per-annotation documentation.

Current frontend state:

- `packages/core/src/components/control-bar/annotation-categories.ts` holds a hardcoded
  `ANNOTATION_CATEGORIES` map (UniProt / InterPro / Taxonomy) and `groupAnnotations()`, consumed
  by `annotation-select.ts` and `query-condition-row.ts`, and asserted by
  `annotation-select.test.ts`.
- The dropdown (`annotation-select.ts`) renders the raw column name as the visible label.
- The legend (`packages/core/src/components/legend/legend.ts`) renders its header via
  `LegendRenderer.renderHeader(title, {...})`, where `title = annotationData.name || annotationName`.
- Annotation descriptions live only in the backend repo at `protspace/docs/annotations.md`. The
  web docs (VitePress under `docs/`) have no per-annotation reference page.

Constraint (from brainstorming): **frontend-only**. We consume the existing `predicted_` prefix
as the contract and document it so the backend stays aligned; we do not change the data format,
values, or export columns.

## Goals / Non-Goals

**Goals:**

- One canonical registry drives grouping, the predicted flag, friendly labels, and docs — no
  parallel hardcoded maps.
- Users can tell predicted annotations from curated ones in the dropdown and legend.
- Users can read what each annotation means without leaving the app, with a path to fuller docs.
- Docs page and inline descriptions share a single source so they cannot drift.
- Custom/unknown columns keep working.

**Non-Goals:**

- No backend / Python changes; no new data-format fields.
- No renaming of stored annotation values or exported column names (display labels only).
- No re-theming of the legend or dropdown beyond the additions described.

## Decisions

### D1. Single registry in `@protspace/utils`, keyed by column name

Add `packages/utils/src/visualization/annotation-metadata.ts`:

```ts
export type AnnotationSource = 'UniProt' | 'InterPro' | 'Taxonomy' | 'TED' | 'Biocentral' | 'Other';

export interface AnnotationMeta {
  label: string; // friendly display label, e.g. "EC number"
  source: AnnotationSource; // dropdown grouping
  isPredicted: boolean; // drives Predicted group + legend badge
  description: string; // short inline text for the popover
  docsUrl?: string; // anchor on the generated docs page
}

export const ANNOTATION_METADATA: Record<string, AnnotationMeta> = {
  /* ... */
};

export function getAnnotationMeta(column: string): AnnotationMeta; // registry-first, fallback
export function isPredictedAnnotation(column: string): boolean; // meta ?? predicted_ prefix
export function annotationLabel(column: string): string; // meta.label ?? prettify(column)
export function annotationSource(column: string): AnnotationSource; // meta.source ?? 'Other'
```

`getAnnotationMeta` returns a synthesized record for unknown columns:
`{ label: prettify(column), source: 'Other', isPredicted: column.startsWith('predicted_'), description: '' }`.
**Why utils, not core:** the legend and dropdown both need it, and utils already holds the
cross-cutting data layer (`annotation-data-access`, `color-scheme`, etc.). It is exported from
`packages/utils/src/index.ts`.

Alternative considered: extend the per-bundle `Annotation` type / `BundleSettings`. Rejected —
the metadata is about _known annotation kinds_, not per-bundle data, and bundles won't carry it
without backend changes (out of scope).

### D2. Grouping reads the registry; `predicted_` is the fallback

`annotation-categories.ts` keeps its public surface (`CategoryName`, `GroupedAnnotation`,
`groupAnnotations`) so `annotation-select.ts` and `query-condition-row.ts` are unaffected, but its
body is rewritten to derive groups from `getAnnotationMeta`/`isPredictedAnnotation` instead of the
hardcoded arrays. A new `Predicted` group is added and placed **first** in `categoryOrder`. An item
is "Predicted" when `isPredicted` is true (registry flag, else `predicted_` prefix) regardless of
its source. `TAXONOMY_ORDER` sorting is preserved.
**Why keep the function:** minimizes blast radius and keeps the keyboard-nav/flatten logic intact.

### D3. Friendly labels at display sites only

The dropdown shows `annotationLabel(column)` while `selectAnnotation` still emits the raw column
name (selection/value semantics unchanged). The legend header maps its title through
`annotationLabel` as well. We do **not** touch exports, tooltips' data values, or stored values.
**Why:** friendly labels were the agreed UX, but changing the selected value would ripple through
view-state, settings, and exports — kept out of scope.

### D4. Predicted badge + note in the legend header

Extend `LegendRenderer.renderHeader` to accept an optional `predicted` flag (and short note text).
`legend.ts` computes `isPredictedAnnotation(this.annotationName)` and passes it. Render a compact
`⚡ Predicted` badge next to the title; the note line (e.g. "Predicted by a model, not curated")
appears under the title. Badge styling lives in the legend `.styles` file.

### D5. Info-icon → popover for documentation

A small reusable popover surfaces `description` + a "Learn more ↗" link to `docsUrl`. Placed:

- in the dropdown, an `ⓘ` button per item (next to the existing tooltip-toggle slot);
- in the legend header, an `ⓘ` next to the title/badge.
  Implementation: a lightweight popover (click-to-open, Escape/outside-click to close, reusing
  `dropdown-helpers` patterns) rather than native `title=` so it can hold a link and long text and be
  touch-reachable. Items with empty `description` and no `docsUrl` render no icon.
  Alternative: native tooltip — rejected (truncates, not touch-friendly, can't hold a link).

### D6. Generate the docs page from the registry (anti-drift)

Add a Node script (e.g. `docs/scripts/generate-annotations.mjs`) that imports `ANNOTATION_METADATA`
and emits `docs/guide/annotations.md`, grouped by source, with a stable `#<anchor>` per annotation
that `docsUrl` points to. Wire a `docs:annotations` npm script and a `--check` mode (regenerate to a
temp buffer and diff) runnable in `pnpm precommit`/CI so the committed page can't go stale. Add the
page to the VitePress sidebar in `docs/.vitepress/config.mts` under the Guide section.
**Why generate, not hand-write:** the registry is the single source of truth; a check mode makes
drift a failing build instead of a silent inconsistency.

## Risks / Trade-offs

- **Registry drifts from backend annotation set** → The `predicted_` fallback + graceful unknown
  handling means new backend columns still render (just without rich metadata); add a short
  contract note in `annotation-metadata.ts` pointing at `protspace/docs/annotations.md`, and the
  docs page lists exactly what the frontend knows about.
- **Friendly labels diverge from what power users expect (raw column names)** → Labels are chosen
  to match the backend docs; raw names remain searchable in the dropdown (search matches the
  column) and the popover can show the source. Keep labels conservative.
- **Popover adds interaction complexity / a11y surface** → Reuse existing dropdown escape/focus
  helpers, give the icon an `aria-label`, and ensure the popover is keyboard-dismissable.
- **Docs generator becomes a maintenance burden / flaky check** → Keep the generator tiny and
  deterministic (stable ordering), and only run `--check` in precommit/CI, not at app build time.
- **Test churn** in `annotation-select.test.ts` (it imports `ANNOTATION_CATEGORIES`) → update tests
  to the registry-based grouping; add focused unit tests for the new helpers.

## Open Questions

- Exact friendly-label wording per annotation — to be finalized while seeding the registry from
  `protspace/docs/annotations.md` (kept conservative; reviewable in the PR).
- Whether `docsUrl` should be an absolute `https://protspace.app/...` URL or a site-relative
  `/guide/annotations#...` link — default to site-relative so it works in local docs previews.
