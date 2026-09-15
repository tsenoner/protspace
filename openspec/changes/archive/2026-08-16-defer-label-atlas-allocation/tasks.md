## 1. The predicate

- [x] 1.1 Add `isMultilabelAnnotationDataCached` to `annotation-data-access.ts`, a `WeakMap` memo over
      the existing predicate, with the no-in-place-mutation reasoning stated
- [x] 1.2 Tests: agrees with the uncached form on every storage shape; memoizes per object rather
      than per content; answers from storage, so hiding cannot retract the state

## 2. The gate

- [x] 2.1 `createStyleGetters` computes it once, over the same `data` binding the colour getters close
      over, and returns `isMultilabel`
- [x] 2.2 `WebGLStyleGetters` gains `isMultilabel`, required so TypeScript consumers cannot omit it
- [x] 2.3 `scatter-plot.ts` forwards it
- [x] 2.4 `syncLabelAtlas` allocates only while it is true and releases when it goes false
- [x] 2.5 `render()` compares the gate against the last observed value and marks styles dirty on a
      transition — load-bearing, because `_refreshSelectedAnnotationValues` nulls the getter cache
      without calling `invalidateStyleCache`
- [x] 2.6 The renderer calls the getter optionally, defaulting to **true**. Omitting it over-allocates
      (wastes memory); under-reporting would silently drop pie segments. Only the first is acceptable.

## 3. Tests

- [x] 3.1 A single-label annotation allocates nothing beyond the 1x1 placeholder and never issues a
      `texSubImage2D`
- [x] 3.2 Single -> multi -> single allocates exactly once and releases, ending on the placeholder
- [x] 3.3 The transition re-stages, even though the style signature cannot observe it
- [x] 3.4 Staying multi-label refreshes in place rather than reallocating
- [x] 3.5 Filter atlas allocations from framebuffer ones in the assertions — the gamma pipeline
      allocates its own canvas-sized texture, which is not what these tests are about

## 4. Ship

- [x] 4.1 `pnpm test` (2,293 tests), `pnpm test:e2e` (124), `pnpm precommit`, `pnpm format:check`
- [x] 4.2 `openspec validate --strict`
- [x] 4.3 Reread proposal/design against the final diff, tick tasks, archive on the branch
- [x] 4.4 Open the PR stacked on `fix/render-cliff-456`; merge or rebase — never squash
