## 1. Annotation-metadata registry (@protspace/utils)

- [x] 1.1 Create `packages/utils/src/visualization/annotation-metadata.ts` with the
      `AnnotationSource` type, `AnnotationMeta` interface, and `ANNOTATION_METADATA` record seeded
      from `protspace/docs/annotations.md` (all UniProt / InterPro / Taxonomy / TED / Biocentral
      columns; set `isPredicted: true` for the 4 `predicted_*` Biocentral entries), with a header
      comment noting the `predicted_` contract and pointing at the backend docs.
- [x] 1.2 Implement helpers `getAnnotationMeta`, `isPredictedAnnotation`, `annotationLabel`,
      `annotationSource`, plus a `prettify(column)` fallback, with graceful synthesis for unknown
      columns (label = prettified name, source `Other`, empty description, prefix-based predicted).
- [x] 1.3 Export the module from `packages/utils/src/index.ts`.
- [x] 1.4 Add unit tests for the helpers: known lookup, `predicted_` prefix fallback, experimental
      classification, and unknown-column synthesis.

## 2. Dropdown grouping (Predicted group + labels)

- [x] 2.1 Rewrite `packages/core/src/components/control-bar/annotation-categories.ts` to derive
      groups from the registry (`annotationSource` / `isPredicted`); add a `Predicted` group placed
      first in `categoryOrder`; keep `CategoryName`, `GroupedAnnotation`, `groupAnnotations`,
      `TAXONOMY_ORDER` exports and the taxonomy sort intact. Add `Predicted` to `CategoryName`.
- [x] 2.2 Update `annotation-select.ts` to display `annotationLabel(column)` for items while still
      emitting the raw column name on selection; ensure search still matches the column name.
- [x] 2.3 Update `annotation-select.test.ts` (and `query-condition-row.ts` if needed) for the
      registry-based grouping and the new Predicted group; remove reliance on the deleted hardcoded
      `ANNOTATION_CATEGORIES` arrays. (query-condition-row renders categories generically — no change
      needed.)

## 3. Legend predicted badge + note

- [x] 3.1 Extend `LegendRenderer.renderHeader` to accept an optional `predicted` flag (+ note text)
      and render a compact `⚡ Predicted` badge next to the title and the note line beneath it.
- [x] 3.2 In `legend.ts`, compute `isPredictedAnnotation(this.annotationName)` and pass it (plus
      label via `annotationLabel`) into `renderHeader`.
- [x] 3.3 Add badge/note styles to the legend `.styles` file.

## 4. Documentation popover (info icon)

- [x] 4.1 Add a small reusable popover (click-to-open, Escape / outside-click to close via existing
      `dropdown-helpers` patterns) that shows `description` + an optional "Learn more ↗" `docsUrl`
      link; renders nothing when both are empty. (`components/common/info-popover.ts`)
- [x] 4.2 Wire an info `ⓘ` button per item in the dropdown (next to the tooltip-toggle slot), shown
      only when metadata has a description or `docsUrl`; add `aria-label`.
- [x] 4.3 Wire an info `ⓘ` control in the legend header for the active annotation, reusing the same
      popover content.
- [x] 4.4 Add styles for the info icon and popover.

## 5. Generated docs page (anti-drift)

- [x] 5.1 Add `docs/scripts/generate-annotations.mts` that imports `ANNOTATION_METADATA` and emits
      `docs/guide/annotations.md` grouped by source with a stable `#anchor` per annotation; support
      a `--check` mode that diffs against the committed file and exits non-zero on drift. (Run with
      `node` — native TS strip — since tsx mangles named exports under Node 26.)
- [x] 5.2 Add `docs:annotations` (generate) and a check invocation; wire the check into
      `pnpm precommit` so a stale page fails the build.
- [x] 5.3 Generate and commit `docs/guide/annotations.md`; add it to the VitePress sidebar in
      `docs/.vitepress/config.mts` under the Guide section.
- [x] 5.4 Point each registry `docsUrl` at the matching `/guide/annotations#<anchor>` (site-relative).

## 6. Verification

- [x] 6.1 Run quality gates (prettier, eslint=0 errors, type-check, vitest=1316 passing, knip,
      docs:annotations:check, vitepress docs:build) — all green.
- [x] 6.2 Browser-verified (Playwright) on a bundle with predicted + experimental annotations:
      Predicted group appears first in the dropdown, friendly labels show, the legend `⚡ Predicted`
      badge + note appear for `predicted_membrane` and not for `phylum`, and the info popover shows
      the description + working "Learn more" link (`/guide/annotations#protein_families`).
- [x] 6.3 Confirmed a custom/unknown column loads with a readable (prettified) label, lands in
      `Other`, has no info icon, and is not marked predicted.
