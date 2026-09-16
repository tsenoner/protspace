## 1. Shared name renderer

- [x] 1.1 Add `predictedBadge(column)` and `renderAnnotationName(column, definition, labelClass)` in
      `control-bar/annotation-name.ts`: the label, then the ⚡ badge with its title and aria-label.
- [x] 1.2 Move `.predicted-badge` and `.dropdown-item-label` from `annotation-select.styles.ts` into
      `dropdownMixin`.
- [x] 1.3 Draw the dropdown row's badge with `predictedBadge`, and the dropdown trigger through
      `renderAnnotationName`, so the chosen annotation carries its badge there too.

## 2. Query builder

- [x] 2.1 Render each annotation picker row through `renderAnnotationName`, keeping `data-annotation`
      as the column name.
- [x] 2.2 Render the condition button through `renderAnnotationName`, keeping the placeholder when no
      annotation is chosen.
- [x] 2.3 Update `query-condition-row.test.ts` to assert labels, and add coverage that picking a
      label stores the column name and that a predicted annotation carries the badge.
- [x] 2.4 Update the `numeric-binning` e2e helpers to find rows and picker items by column name
      (`condition.annotation`, `data-annotation`) instead of by visible text.

## 3. Search rule

- [x] 3.1 Reduce `annotationMatchesQuery` to a substring match on the displayed label, dropping the
      column-name word match.
- [x] 3.2 Pin in `annotation-metadata.test.ts` and `annotation-select.test.ts` that `predicted` and
      `ted` match no `predicted_*` column, that label substrings still match, and that an
      unregistered column is found through its derived label.

## 4. Verification

- [x] 4.1 Run the core and utils unit suites, `pnpm precommit`, and `pnpm format:check`.
- [x] 4.2 Confirm in the running app that the query builder shows labels, and in the dropdown
      component (no bundle in the repo carries Biocentral columns) that `predicted` matches nothing.
- [x] 4.3 Archive this change before the merge.
