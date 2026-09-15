> Retroactive change: the work shipped in #416 (`feat/improved_filtering`, merged as `81ad450b`)
> before this OpenSpec entry existed. Every task below is recorded against the commit that did it.

## 1. Presence model (#416, `e27c7be8`)

- [x] 1.1 Add the `ANY_VALUE = '__ANY__'` sentinel to `query-types.ts` as the exact complement of
      `NA_VALUE`, with the rationale for keeping it out of `missing-values.ts`.
- [x] 1.2 Add the optional `presence?: string[]` field to `NumericCondition` and seed it in
      `createNumericCondition`.
- [x] 1.3 Add the inclusive `gte` / `lte` operators to `NumericOperator` and to the
      `numericFieldsFor` bounds table.
- [x] 1.4 Teach `matchesNumericValue` the union rule: a null matches only an explicit `NA_VALUE`
      chip; `ANY_VALUE` matches every non-null; the comparison is otherwise unchanged.
- [x] 1.5 State readiness once — `isNumericConditionReady = hasNumericBounds || presence.length > 0`
      — derived from `numericFieldsFor` rather than a second operator switch.
- [x] 1.6 Honour `ANY_VALUE` in `evaluateCondition` for categorical conditions, including
      multi-label proteins whose labels mix real values and nulls.

## 2. N/A-aware NOT (#416, `e27c7be8`)

- [x] 2.1 Add `collectAnnotations` (every annotation a condition or group references) and
      `proteinsWithAnyValue` (carriers of at least one real label across those annotations).
- [x] 2.2 Redefine `NOT` in `evaluateItems` as `difference(proteinsWithAnyValue, matches)` instead
      of a complement over all indices.
- [x] 2.3 Keep an unconfigured condition a match-all no-op so `NOT (unconfigured)` matches nothing
      rather than isolating every protein, and keep Apply gated by `hasConfiguredCondition`.
- [x] 2.4 Handle numeric annotations in `proteinsWithAnyValue` via `numeric_annotation_data`
      (non-null), not the categorical index path.

## 3. Query builder UI (#416, `e27c7be8`)

- [x] 3.1 Offer `ANY_VALUE` first in the value picker, ahead of the annotation's declared values.
- [x] 3.2 Make `ANY_VALUE` exclusive on the categorical side: selecting it replaces the selection,
      and the picker locks the rest out (`is-disabled`, `aria-disabled`, inert click).
- [x] 3.3 Add presence chips (`+ N/A`, `+ Any value`) to the numeric row, styled as the categorical
      value chips they mirror.
- [x] 3.4 Make `ANY_VALUE` exclusive on the numeric side: it clears both bounds, disables the
      operator and value fields, and withdraws the `+ N/A` offer.
- [x] 3.5 Make the value picker's live counts `NOT`-aware —
      `|matched ∩ has-value| − |that slice carrying v|` — and cross-check them against
      `evaluateQuery` for the same single condition.

## 4. EAT reliability filter (#416, `e27c7be8`)

- [x] 4.1 Rewrite `setEatConfidenceThreshold` to upsert `<eat-confidence column> >= x` with an
      `NA_VALUE` presence chip, replacing `NOT(EAT_confidence < x)`.
- [x] 4.2 Update the reverse mirror's recognizer to match the new shape (numeric, that exact column,
      `gte`, un-negated, carries the N/A chip) and scope both directions to one base's column.
- [x] 4.3 Correct the five stale `NOT(EAT_confidence < x)` requirements in
      `openspec/changes/add-eat-visualization/specs/eat-annotation-overlay/spec.md`.

## 5. Deduplication pass (#416, `1aedc853` + `082b8b75`)

- [x] 5.1 Extract `query-presence.ts` with `displayFilterValue` and `renderValueChip`, and delete the
      three copies of the sentinel-display rule and the two copies of the chip markup.
- [x] 5.2 Keep `ANY_DISPLAY` module-private — nothing imports it, and exporting it fails `knip`.
- [x] 5.3 Restore the side-effect `import './query-value-picker'` in `query-condition-row.ts`, which
      had been getting element registration for free via the dropped `ANY_DISPLAY` named import.
- [x] 5.4 Extract `presenceOf(condition)` returning a frozen shared empty array, so a chip-less
      condition cannot be given a chip through a stray mutation.

## 6. Preview correctness and cost (#416, `a3b65b2a` + `082b8b75`)

- [x] 6.1 Make `countNumericMatches` walk `protein_ids.length` and normalize a missing slot to null,
      so a sparse column cannot make the preview undershoot the applied result.
- [x] 6.2 Memoize the value picker's dataset walk, invalidating on `data`, `annotation`,
      `matchedIndices` and `logicalOp`, so typing in the search box stops re-scanning ~570K rows per
      character.
- [x] 6.3 Fold `anyCount` and `mixedNaCount` into the single count-map walk and delete
      `_proteinsWithValue`, so the `NOT` preview needs no second scan.
- [x] 6.4 Precompute an `isRealValue` table per _declared_ value in `proteinsWithAnyValue` instead of
      calling `toInternalValue` per label per protein.

## 7. Tests and docs (#416)

- [x] 7.1 `query-evaluate.test.ts` — NOT scoping, `NOT (is N/A)` ≡ `is Any value`, group scoping,
      NOT over unconfigured, missing columns.
- [x] 7.2 `query-value-picker.test.ts` — AND/OR/NOT count arithmetic, multi-label counted once, and
      the cross-check against `evaluateQuery`.
- [x] 7.3 `query-numeric-input.test.ts` / `query-numeric-helpers.test.ts` — presence chips,
      exclusivity, inclusive operators, sparse-column counting.
- [x] 7.4 `control-bar.query-apply.test.ts` + Playwright `eat-visualization` — the reliability
      slider's two-way mirror against the real phosphatase bundle.
- [x] 7.5 Update `docs/explore/control-bar.md` for the new `NOT`, the presence chips and the
      inclusive operators.

## 8. Spec wrap-up (this change)

- [x] 8.1 Write `proposal.md`, `design.md` and the `filter-query-semantics` spec delta covering the
      semantics #416 shipped.
- [x] 8.2 Record the deliberately-unfixed findings as Non-Goals / Open Questions rather than as
      requirements: the numeric row's `logicalOp`-blind live count, reliability-condition ownership
      (#427), `presence` as a 3-state enum, the un-type-checked `<option>` list, and the Kleene
      refactor that would delete `collectAnnotations` + `proteinsWithAnyValue`.
- [x] 8.3 `openspec validate --strict` clean.
- [x] 8.4 Archive so `openspec/specs/filter-query-semantics/` becomes the source of truth, on the
      branch and before the merge.
