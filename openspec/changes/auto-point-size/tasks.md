## 1. Regression tests (red)

- [x] 1.1 `legend-helpers.test.ts`: `defaultShapeSize` at 0, 1, 10,000, 20,000, 40,000, 105,562 and
      573,649 proteins, and for negative and non-finite counts; `explicitShapeSize` reads 10 and 30
      as unset and keeps any other positive size.
- [x] 1.2 `legend.shape-size.test.ts`: with no stored size, the filler 10 and the legacy 30 give the
      default for the dataset's count; an annotation's own 5 wins over the default; a bundle's
      top-level size and a stored pick win over both; Reset removes the stored key, rewrites stored
      and pending bundle sizes to the filler and returns every annotation to the default; an export
      without a pick writes no top-level size and the filler 10, never the default.
- [x] 1.3 Legend with a mock scatterplot: the default uses the whole dataset's count and does not
      change when categories are hidden or the view is filtered or isolated; switching to a
      dataset of another size recomputes it.
- [x] 1.4 `legend-settings-dialog.test.ts`: the size field's placeholder and hint give the dataset's
      default.
- [x] 1.5 Run the new tests against the unmodified legend and record that they fail.

## 2. Implementation (green)

- [x] 2.1 `legend-helpers.ts`: add `defaultShapeSize(proteinCount)` and `explicitShapeSize(stored)`,
      replacing `seedShapeSize`.
- [x] 2.2 `legend.ts`: record the dataset's protein count with its hash; resolve the shape size as
      stored pick, then the annotation's own size, then the default; store the annotation's own
      size or the filler per annotation, never the live size.
- [x] 2.3 Reset: clear the dataset's stored size and every annotation's own size
      (`PersistenceController.clearShapeSize`) and apply the default.
- [x] 2.4 `legend-settings-dialog.ts`: placeholder and hint from the dataset's default.
- [x] 2.5 Run the unit suites (`pnpm test:ci`) and record that they pass.

## 3. Docs

- [ ] 3.1 `docs/explore/legend.md`, `docs/explore/scatterplot.md`, `docs/explore/eat.md`: the default
      follows the point count, how to override it, what Reset does.
- [ ] 3.2 `docs/guide/styling.md`, `docs/guide/data-format.md`: per-annotation 10 and 30 read as
      unset.
- [ ] 3.3 `docs/developers/api/index.md`: the legend's `shapeSize` and Reset.

## 4. Verification

- [ ] 4.1 Run the e2e projects that touch the legend settings or dot size against a local server;
      update an expectation only where the new default changes it.
- [ ] 4.2 Capture the 105K and 573K example bundles before and after the change and check that
      the clusters read as in the investigation.
- [ ] 4.3 `pnpm test:ci`, `pnpm format:check`, `pnpm lint`, `pnpm docs:build`,
      `openspec validate --all --strict`, and `pnpm precommit` through the commit hook.
