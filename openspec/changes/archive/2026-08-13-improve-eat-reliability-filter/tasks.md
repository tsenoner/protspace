## 1. Own the condition instead of matching its shape

- [x] 1.1 Add group-aware find/replace over every numeric condition targeting a column.
- [x] 1.2 Treat an untagged numeric condition on an eat-confidence column as owned, so hand-built and restored conditions mirror.
- [x] 1.3 Replace the shape-matching helpers with a column lookup.

## 2. Three modes

- [x] 2.1 Model the filter as a mode plus bounds; translate each to one un-negated condition with the N/A presence chip.
- [x] 2.2 Respect the logical operator when reading the state back.
- [x] 2.3 Add the legend mode select and the band's second bound; reset the bound a mode no longer uses.
- [x] 2.4 Emit the full state from the legend and consume it in the runtime, keeping the scalar fallback.

## 3. Mirror and safety

- [x] 3.1 Key the de-dupe guard per eat-confidence column; force-emit on an annotation switch.
- [x] 3.2 Clear rather than activate the filter channel when a query matches nothing.

## 4. Reconcile with the specs that landed while this change waited

`filter-query-semantics` and `query-builder-controls` did not exist when this change was written;
#416's and #437's work created them, and the first states the reliability filter's old shape as
current behaviour.

- [x] 4.1 Add a `MODIFIED Requirements` delta for `filter-query-semantics`, restating the EAT
      reliability requirement in full so it describes the mode set and column-keyed identity
      rather than a single `gte` condition matched by shape.
- [x] 4.2 Correct this change's own "Curated proteins stay visible in every mode" requirement, which
      still claimed each mode is expressed as a **negated** condition — the pre-restack design. The
      implementation emits un-negated conditions carrying the N/A chip; under #416's `NOT` the
      negated form would hide exactly the proteins the requirement protects.
- [x] 4.3 Check `query-builder-controls` for contradictions with the legend mode select and the
      band's second bound.

## 5. Verification

- [x] 5.1 `pnpm type-check`, `pnpm lint` (0 errors), `pnpm knip`, `pnpm format:check` clean.
- [x] 5.2 `pnpm test:ci` — core 1665, utils 377, app 167 (+1 skipped), all passing.
- [x] 5.3 Playwright `eat-visualization` — both scenarios, including #416's own "curated points stay visible" test.
- [x] 5.4 `openspec validate improve-eat-reliability-filter --strict` passes.
- [x] 5.5 Merge `main` into the branch, then archive this change before the merge.
