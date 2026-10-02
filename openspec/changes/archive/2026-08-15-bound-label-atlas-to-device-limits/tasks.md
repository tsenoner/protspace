## 1. Extend the mock WebGL2 context (own commit — every renderer suite depends on it)

- [x] 1.1 Add the constants `MAX_TEXTURE_SIZE` (0x0d33), `NO_ERROR` (0), `INVALID_VALUE` (0x0501),
      `INVALID_OPERATION` (0x0502), `OUT_OF_MEMORY` (0x0505) to `test-support/mock-webgl2.ts`
- [x] 1.2 Add `getParameter(pname)` returning `opts.maxTextureSize ?? 8192` for `MAX_TEXTURE_SIZE`
- [x] 1.3 Add `getError()` shifting from an `opts.glErrors: number[]` queue, then `NO_ERROR`
- [x] 1.4 Make `texImage2D`, `texSubImage2D` and `uniform1i` recording `vi.fn()`s rather than no-ops.
      Also `getParameter`, `bufferData`, and `bufferSubData` — the last was **absent entirely**, so no
      test had ever exercised the already-initialised upload path. `deleteTexture` stays a plain noop
      because `webgl-renderer.lifecycle.test.ts` wraps it with `vi.spyOn`.
- [x] 1.5 Run the full renderer suite unchanged and confirm green before touching any source
      (23 files, 115 tests, all passing)

## 2. Plan atlas geometry in a pure module

- [x] 2.1 Add `webgl/renderer/label-atlas-plan.ts` with `MAX_LABELS`, the width ladder
      `[2048, 4096, 8192]`, the stride ladder `[8, 4, 2]`, `LabelAtlasPlan`, and `planLabelAtlas`
- [x] 2.2 Iterate stride outer, width inner, smallest width first; return `null` when nothing fits
- [x] 2.3 Re-export `MAX_LABELS` from `stage-point.ts` so existing importers are unaffected
- [x] 2.4 Add `label-atlas-plan.test.ts` including the no-change lock
      `planLabelAtlas(573_696, 8192) === { width: 2048, height: 2241, stride: 8 }`
- [x] 2.5 Add the table-driven invariant over `MTS × capacity`
- [x] 2.6 **Added during implementation:** an optional `maxStride` argument, so the export renderer
      inherits the live view's fidelity by _planning at that stride_ rather than by planning at full
      stride and then capping. Capping after the fact would have sized the texture for slices it
      then refused to draw. Covered by a `stride inheritance` describe block.

## 3. Clamp planned capacity

- [x] 3.1 Optional fifth `maxCapacity` argument, floored at the snapped requirement
- [x] 3.2 Rename the fourth parameter to `capacityGranularity` and rewrite the doc block
- [x] 3.3 Pass `MAX_POINTS_DIRECT_RENDER` from `expandCapacity`
- [x] 3.4 All seven existing `capacity-planner.test.ts` cases pass **unchanged**
- [x] 3.5 Add the clamp cases, including `(950_000, 900_096, 1024, 256, 1_000_000) === 1_000_192`
      against the unbounded `1_350_144`, plus an inertness case for the default argument

## 4. Clamp the staged label count

- [x] 4.1 Add `maxLabels: number` to `StagePointArrays` and make `labelColorData` nullable
- [x] 4.2 `stagePointStyle` writes `Math.min(pointColors.length, target.maxLabels)`
- [x] 4.3 Skip `fillLabelColorTexels` entirely when `labelColorData` is null
- [x] 4.4 `buildStageArrays` supplies `maxLabels: this.labelAtlas?.stride ?? MAX_LABELS`
- [x] 4.5 Tests for the 12-colour clamp, a reduced stride, the null atlas, and the single-label case

## 5. Fix and gate the fragment shader

- [x] 5.1 Add `precision highp int;`
- [x] 5.2 Declare `uniform int u_labelAtlasCapacity` and gate the pie branch on it
- [x] 5.3 Clamp `count` to `float(u_maxLabels)` and `sliceIndex` to `count - 1.0`
- [x] 5.4 Add `labelAtlasCapacity` to `PointUniformLocations`, resolve it, and push it
- [x] 5.5 Take `labelTextureHeight` explicitly, replacing the array-length derivation
- [x] 5.6 Extend `export-shaders.test.ts` to pin all four shader edits by text

## 6. Rework the live renderer

- [x] 6.1 Probe `gl.MAX_TEXTURE_SIZE` in `ensureGL`, falling back to the 2048 spec floor
- [x] 6.2 Replace the `labelColorData` field with the plan, a nullable array, a disabled flag, and a
      `degradeReported` reason latch
- [x] 6.3 Clear all four in `resetRendererState`
- [x] 6.4 Delete the inline allocation from `expandCapacity`
- [x] 6.5 Add `syncLabelAtlas`, called at the top of `populateBuffers` after `expandCapacity`
- [x] 6.6 Add `uploadLabelAtlas` with one `getError` and the 1x1 placeholder fallback
- [x] 6.7 Add the buffer `getError` on the allocating path only, before any texture call
- [x] 6.8 Hoist the six style-buffer uploads to `if (updateStyles || needsReorder)`
- [x] 6.9 Pass the plan-derived draw params from `renderPoints`

## 7. Repair the export path

- [x] 7.1 Probe the export context's own `MAX_TEXTURE_SIZE`
- [x] 7.2 Inherit the live stride; allocate no atlas when the live view has none
- [x] 7.3 Apply `getError` after the export `texImage2D`; fall back to flat marks and still export
- [x] 7.4 `MAX_DIMENSION` becomes `Math.min(8192, deviceMaxTextureSize)`; message names the limit
      actually enforced
- [x] 7.5 Delete the local `LABEL_TEXTURE_WIDTH` and the false reuse comment

## 8. Surface degradation to the user

- [x] 8.1 Add `scatter-plot.events.ts` with `RendererDegradedDetail` and its factory; export from
      `packages/core/src/index.ts`
- [x] 8.2 Add an `onDegraded` renderer callback wired in `_createWebglRenderer`; the host dispatches
      `bubbles: true, composed: true`
- [x] 8.3 Route `handleGammaFallback` through the same channel
- [x] 8.4 Register in `runtime.ts`; map reason to copy in `notifications.ts` with a `dedupeKey` and
      a report action
- [x] 8.5 Add `maxTextureSize` to `_collectPerfMetadata`

## 9. Mock-GL unit coverage

- [x] 9.1 `getParameter(MAX_TEXTURE_SIZE)` called exactly once per `ensureGL`, never during `render()`
- [x] 9.2 At `maxTextureSize: 8192`, Swiss-Prot-scale data calls `texImage2D` with `(2048, 2241)`
- [x] 9.3 At `maxTextureSize: 2048`, every allocation is within the limit and the reported stride is 4.
      The uniform push itself is asserted in `render-target.test.ts` (9.8) rather than here, where the
      mock's shared uniform recorder cannot attribute a value to a location.
- [x] 9.4 Failure is not latched: no later `texSubImage2D`, a `(1,1)` placeholder follows, and
      `onDegraded` fires exactly once across five renders
- [x] 9.5 A buffer allocation error leaves `buffersInitialized` false so the next populate reallocates
- [x] 9.6 A positions-only restage still uploads the style buffers (the hoist)
- [x] 9.7 Export inherits the passed stride and allocates none when it is null
      (`label-atlas-plan.test.ts` stride-inheritance block); export enforces and _names_ the device
      limit (`export-renderer.test.ts`). The off-screen GL pipeline itself is unreachable in jsdom —
      `getContext('webgl2')` returns null — so its assertions stop at the seams.
- [x] 9.8 `point-locations.test.ts` resolves the new uniform; `render-target.test.ts` asserts it is
      pushed, and that 0 is pushed when no atlas is allocated
- [x] 9.9 `webgl-renderer.lifecycle.test.ts` `deleteTexture` count unchanged
- [x] 9.10 `label-texture-utils.test.ts` gains a table-driven case pinning the JS byte offset against
      the shader's `(globalIndex % width, globalIndex / width)` at every supported width and stride

## 10. Playwright — the only layer that proves it

- [x] 10.1 Add `apps/web/tests/label-atlas-limit.spec.ts` to the default suite, with its own project
      entry in `playwright.config.ts`.
      **Changed from the plan:** a `getParameter` stub alone proves nothing — it changes what the app
      believes while the real driver still accepts the allocation, so the pre-fix code passes. The
      driver's refusal is therefore simulated too, in `helpers/gl-simulation.ts`. And the limit is
      1024, not 2048: at ~7.8K demo proteins the atlas is 2048x31, which no realistic limit refuses.
- [x] 10.2 Assert the renderer never issues an allocation the device would refuse. **Verified red on
      the parent commit:** `renderer issued texture allocations the device refuses: [[2048,31]]`.
- [x] 10.3 Assert the warning is surfaced. **Also verified red on the parent commit** — the pre-fix
      failure is entirely silent, which is why the console-based assertion in the original plan would
      have passed on broken code.
- [x] 10.4 Assert the canvas renders more than one colour and is not solid black
- [x] 10.5 Assert the same simulation at an ample limit records no refusal and raises no warning —
      so the simulation itself cannot be what fails the tests above
- [x] 10.6 Add the reduced-stride case to `load-large-bundle.spec.ts` (opt-in): at 573,649 proteins
      the atlas is 2048x2241, the exact case the issue reported, on the dataset the app ships

## 11. Ship

- [x] 11.1 `pnpm precommit`, `pnpm format:check`, `pnpm test` all green (2,270 unit tests)
- [x] 11.2 `pnpm test:e2e` green — 121 passed, no regressions
- [x] 11.3 `openspec validate --strict` passes for this change
- [x] 11.4 Reread `proposal.md` / `design.md` against the final diff, tick every task, run
      `/opsx:archive` on the branch
- [x] 11.5 Open the PR against `main`; merge or rebase — never squash
