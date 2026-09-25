## Why

Issue #443: the app can only switch to a single demo dataset, although ten more example bundles already ship under `apps/web/public/data/`. They are reachable only by URL guessing or the perf harness. The datasets used in the publication should be one click and one shareable link away.

## What Changes

- A static example catalog (`apps/web/src/explore/example-datasets.ts`): the startup demo plus the ten bundles listed in `apps/web/public/data/datasets.json`, each with id, label, description and same-origin URL. The bundles stay where they are.
- The control bar's Import menu lists the examples under an "Examples" heading; the loaded one is disabled.
- A `?dataset=<id>` deep link loads an example at startup and follows Back/Forward. It never clears the user's stored import.
- A failed example load shows an error notification instead of only logging to the console.
- **BREAKING** (`@protspace/core`, unpublished): the control bar's `currentDatasetIsDemo` property and `load-demo-dataset` event become `currentExampleId` / `exampleDatasets` and `load-example-dataset` with `detail: { id }`.

## Capabilities

### New Capabilities

- `example-datasets`: the example catalog, choosing an example from the Import menu, the `?dataset=` deep link and its precedence over the stored import, and load-failure handling.

### Modified Capabilities

None. The perf harness keeps its own dataset list (`datasets.json`), so `webgl-perf-harness` is unchanged.

## Impact

- `apps/web/src/explore/`: new catalog; `persisted-dataset.ts`, `runtime.ts`, `startup.ts`, `control-bar-events.ts`, `url-state.ts`, `use-url-state-sync.ts`, `view-controller.ts`, `dataset-controller.ts`, `types.ts`.
- `packages/core/src/components/control-bar/control-bar.ts` and its import-menu test.
- `apps/web/tests/`: one new Playwright spec (`example-datasets.spec.ts`, extended during review with the Back/Forward-ordering and corrupt-bundle cases below); `isolation-dataset-swap.spec.ts` dispatches the renamed event.
- Docs: `docs/explore/control-bar.md`, `importing-data.md`, `eat.md`, `docs/index.md`, `docs/developers/api/index.md`, and the product tour if it names the demo. `control-bar.md`'s example table is pinned against the catalog by `example-datasets-docs.test.ts`.
- No new dependencies, no hosting change, no deploy-size change.

## Review fixes (post-implementation)

Code review on the draft PR found two URL-correctness bugs and one gap, fixed on top of the implementation above (see `tasks.md` §8 and `design.md`'s "A dataset switch and a view-param change..." decision and its "One loader for all examples" update):

- Choosing an example from the menu, or Back/Forward changing `dataset=` and a view param in the same step, could resolve/normalize the view against the wrong (still on-screen) dataset and replace-write that mismatch onto a history entry that wasn't the one it belonged to.
- A failed/unknown `?dataset=` left the param in the URL while the recovery banner was up.
- A parse failure (fetch succeeds, the bundle fails to decode) never dismissed the loading overlay, leaving the UI unusable until reload — newly reachable via any non-demo example, not just a user import.
