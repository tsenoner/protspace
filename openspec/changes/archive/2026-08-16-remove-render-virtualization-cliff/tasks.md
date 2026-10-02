## 1. Lock the current behaviour before changing it

- [x] 1.1 Add `scatter-plot.render-path.test.ts` asserting object identity: with a `_plotData` whose
      `length` is above the threshold and two different transforms, `_getPointsForRendering()`
      returns `el._plotData` (`toBe`, not `toEqual`) both times and `queryByPixels` is never called.
      The gate reads `.length` and nothing else, so a `{ length }` fake keeps this O(1).
- [x] 1.2 Verified **red on the parent commit**, for exactly the right reason: 4 failed / 2 passed —
      the 999,999 and empty cases pass (they took the direct path even then), and 1,000,000 /
      1,500,000 / 2,000,000 plus the quadtree case fail.
- [x] 1.3 Add the case to `webgl-renderer.signature.test.ts`: two `PlotData` with identical sampled
      coordinates but different `length` still rebuild — the mechanism that made re-materialisation
      catastrophic

## 2. One shared cap

- [x] 2.1 Add `packages/core/src/utils/limits.ts` exporting `MAX_POINTS_PER_PROJECTION = 2_000_000`,
      with the measured heap figures that justify the value in the doc comment
- [x] 2.2 `webgl/types.ts`: `MAX_POINTS_DIRECT_RENDER` becomes `MAX_RENDERABLE_POINTS`, derived from
      the shared constant; four import sites and both clamps updated
- [x] 2.3 `data-loader/utils/validation.ts`: `MAX_ROWS_DEFAULT` derives from the shared constant,
      with the long-format reasoning stated
- [x] 2.4 Add `limits.invariant.test.ts`. It needed a seam: the loader's limits are module constants
      with a parameter hook nothing uses, so `getValidationLimitsForTest()` exposes the row cap. The
      third case checks the implication itself — for projection counts 1, 2, 3 and 10, the maximum
      proteins the loader admits never exceeds what the renderer draws.
- [x] 2.5 Confirmed the rename is internal: `packages/core` exports only `.` and `./publish`, and
      `index.ts` never re-exports `webgl/index.ts`

## 3. Delete the cull

- [x] 3.1 Delete `VIRTUALIZATION_THRESHOLD`, `VIRTUALIZATION_PADDING` and the stale comment block
- [x] 3.2 Delete `_visiblePlotData`, `_virtualizationCacheKey`, `_quadtreeGeneration` and both bumps
- [x] 3.3 Delete `_invalidateVirtualizationCache` and its six call sites
- [x] 3.4 Collapse `_getPointsForRendering` to its existing guard, returning `this._plotData`
- [x] 3.5 Drop the now-unused `computeViewportWindow` / `buildViewKey` / `gatherPlotData` imports
- [x] 3.6 Quadtree still built, still used by hover, click, brush and lasso — only the render path
      stops touching it
- [x] 3.7 Update the four tests that asserted the deleted machinery: the F-17 describe block and two
      internals-type entries in `scatter-plot.b6.test.ts`, and the two virtualization spies in
      `scatter-plot.legend-reactivity.test.ts`. The INV-08 substance is kept — `invalidateDepthOrder`
      is the half that governs the renderer's colour-only fast path, and it is unchanged.

## 4. Report what was drawn

- [x] 4.1 Add `drawnPointCount` and `uploadedBytesTotal` accessors to `WebGLRenderer`
- [x] 4.2 Account uploaded bytes in `updateBuffer` and at both atlas upload sites
- [x] 4.3 Record both per pass in `webgl-render-perf.ts`, leaving `renderedPoints` as `pd.length`
- [x] 4.4 Add `webgl-renderer.no-clamp.test.ts`. Scope grew beyond the plan: it also asserts that a
      repeat render of the same object uploads **zero** additional bytes (the fix as an invariant),
      that a real style change still uploads, and that capacity shrinks — so task 5.2 lands here too.
      The `setTrackRenderedPointIds` assertion was dropped: it is host-side wiring, already covered
      by the host's own suite, and asserting it here would test the mock.

## 5. Capacity shrink

- [x] 5.1 Reallocate when `capacity > max(MIN_CAPACITY, maxPoints * 4)`, passing `currentCapacity = 0`
      on the shrink branch so the 1.5x growth rule does not fight it
- [x] 5.2 Tested in `webgl-renderer.no-clamp.test.ts`: an outsized footprint is released, and an
      ordinary switch within 4x issues no new `bufferData`

## 6. Say what the limit is

- [x] 6.1 Replace `Too many rows: N exceeds limit` with a message naming the limit, what it counts,
      and the remediation
- [x] 6.2 Assert the message contains the count, the limit, what it counts, and a remediation
- [x] 6.3 No error `code` added — see the plan's reasoning; tracked separately

## 7. Docs

- [x] 7.1 Rewrite the FAQ entry, which claimed "Not recommended. Performance degrades above 500K
      proteins" — wrong in both directions after this change
- [x] 7.2 Only the issue's measured numbers are quoted, and the tip explains the proteins x
      projections counting rule, which is the part users actually trip over

## 8. Prove it

- [x] 8.1 E2E `camera-no-restage.spec.ts`. **Changed from the plan:** perf passes are only recorded
      while a benchmark scenario is active, so the spec reads `uploadedBytesTotal` off the renderer
      directly around a real `zoomBy` / `panBy` gesture instead. Same assertion, no benchmark run.
      The spec states in its own header that it would also pass on `main` at demo size, so it is a
      guardrail rather than the proof; the proof at >= 1M is task 1.1.
- [x] 8.2 E2E: `drawnPoints === protein_ids.length`, plus a third case asserting a real styling
      change still uploads — so the guardrail cannot be satisfied by a renderer that has stopped
      uploading altogether
- [x] 8.3 `pnpm test` (2,286 tests), `pnpm precommit`, `pnpm format:check`, `pnpm test:e2e` (124
      passed) all green
- [x] 8.4 No probe bundles exist in this repo and none are generated here, so **the wall-clock
      numbers in the PR body are the reporter's, not reproduced by this branch.** What this branch
      demonstrates is the mechanism: zero bytes uploaded on a camera move, and the identity
      assertion that is red on the parent commit.

## 9. Ship

- [x] 9.1 `openspec validate --strict`
- [x] 9.2 Reread `proposal.md` / `design.md` against the final diff, tick every task, run
      `/opsx:archive` on the branch
- [x] 9.3 Open the PR stacked on `fix/label-atlas-device-limits`; merge or rebase — never squash
