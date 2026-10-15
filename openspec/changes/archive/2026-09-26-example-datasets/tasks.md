## 1. Catalog

- [x] 1.1 Author reviews the draft catalog table in `design.md` (labels, descriptions)
- [x] 1.2 Add `apps/web/src/explore/example-datasets.ts` (`ExampleDataset`, `EXAMPLE_DATASETS`, `findExampleDataset`) with a unit test covering unique ids, demo first, and known/unknown lookup

## 2. Loader

- [x] 2.1 `persisted-dataset.ts`: `loadDefaultDataset` → `loadExampleDataset(entry)` returning success; `notify.error` and overlay dismissal on failure; `loadExampleDatasetAndClearPersistedFile(id)`
- [x] 2.2 Replace `setCurrentDatasetIsDemo` with `setCurrentExampleId`; drop `DEFAULT_DATASET_NAME` in `runtime.ts` in favour of the catalog label
- [x] 2.3 Unit tests: success sets the example id, and an HTTP failure calls `notify.error` and leaves the current dataset alone (mocked `fetch`)

## 3. Control bar (`packages/core`)

- [x] 3.1 Add `exampleDatasets` / `currentExampleId` and remove `currentDatasetIsDemo`; render the Examples section in the Import menu (description as tooltip, loaded one disabled)
- [x] 3.2 Emit `load-example-dataset {id}` and remove `load-demo-dataset`; update `control-bar-events.ts` and `runtime.ts` wiring
- [x] 3.3 Update `control-bar.import-menu.test.ts` and `apps/web/tests/isolation-dataset-swap.spec.ts`

## 4. Deep link

- [x] 4.1 `url-state.ts`: `getDatasetParam` / `setDatasetParam` with unit tests
- [x] 4.2 `ExploreController`: `subscribeToDatasetChanges(cb(id, source))` and `setRequestedDataset(id | null)`; update `types.ts` and the no-op controller
- [x] 4.3 `startup.ts`: accept a requested example id; a known id loads without touching OPFS; unknown id or failure warns, then falls back to the persisted-or-default flow
- [x] 4.4 `use-url-state-sync.ts`: pass the initial `dataset` param in `attachController`; push on a menu load, replace-delete on user/startup/failed loads; react to Back/Forward param changes

## 5. E2E

- [x] 5.1 New Playwright spec, registered in `tests/playwright.config.ts`: deep link keeps the stored import, menu choice + Back, user import removes the param, unknown id warns

## 6. Docs

- [x] 6.1 `docs/explore/control-bar.md` §9 (Examples, `?dataset=`), `docs/explore/importing-data.md` (examples, stored-import behaviour)
- [x] 6.2 `docs/explore/eat.md` (remove "no dataset picker"), `docs/index.md`, `docs/developers/api/index.md` (event rename), product tour if it names the demo

## 7. Verify

- [x] 7.1 `pnpm test`, `pnpm test:e2e`, `pnpm precommit`, `pnpm format:check`

## 8. Review fixes

- [x] 8.1 Fix the wrong-history-entry bug, in two parts. A menu choice could resolve/normalize the
      view against the dataset still on screen before the new dataset's own `dataset=` push landed,
      writing the normalization to the wrong entry — fixed by emitting the dataset change before
      `applyLatestViewForDatasetLoad` in `handleDataLoaded` (commit fa214349). Back/Forward changing
      `dataset=` and a view param together had the same problem from the other direction — fixed by
      merging `use-url-state-sync.ts`'s `[requestState]`/`[datasetParam]` effects into one and adding
      `ViewController.recordRequestedView` (record without resolving/applying) for the case where a
      dataset switch is pending (commit ae6a599e).
- [x] 8.2 `startup.ts`'s `runPersistedOrDefaultFlow`: replace-delete a stale `?dataset=` on the
      `recovery-required` outcome too, via a new `DatasetController.reportDatasetChange`. Add a unit
      test.
- [x] 8.3 Dismiss the loading overlay on a parse-failure `data-error` in `handleDataError`'s generic
      branch (dataset-controller.ts) — neither the success path nor the fetch-catch path ran for it,
      so the UI stayed behind the overlay. Add a unit assertion.
- [x] 8.4 `docs/explore/control-bar.md` §9: document the Back-doesn't-restore-a-cleared-import caveat,
      drop "today" wording, and shrink the 11-row example table to id+name; add
      `example-datasets-docs.test.ts` pinning it against `EXAMPLE_DATASETS` (`import.meta.glob`, no
      `node:fs`).
- [x] 8.5 New Playwright cases in `example-datasets.spec.ts`: an annotation surviving a menu choice +
      Back, the Back/Forward repro with a dataset switch and a view pick landing on the same step, and
      a corrupt (200, garbage body) bundle leaving the URL/name/menu/plot unchanged with a retryable
      menu item.
- [x] 8.6 Reread `proposal.md`/`design.md` against the final diff and update them (this file's own
      entries above, plus `design.md`'s "One loader for all examples", the startup/`runtime.ts` note,
      the new decision on effect ordering, and the Risks section).
- [x] 8.7 The truthful load outcome (commit fa214349): `resolvePendingLoadFinalization` carries a
      success flag, and `handleDataLoaded`/`handleDataError` key on the example carried in load meta
      (never `kind === 'default'` alone, which the perf suite also uses) so name/id/emit happen only
      once a load actually reaches `data-loaded`.
- [x] 8.8 The overlay-before-fetch and the request-sequence supersession guard (commit fa214349):
      the loading overlay shows before `fetch()` starts, and each `loadExampleDataset` call bumps a
      sequence number checked after each `await`, dropping a superseded fetch instead of letting it
      overwrite a newer request once it resolves.
- [x] 8.9 Revert the Node-types leak: `apps/web/tsconfig.app.json`'s `"types": ["node"]`, added only
      so `example-datasets.test.ts` could use `node:fs`/`node:path`/`node:url`, leaked Node globals
      into browser app code; verify shipped bundles with `import.meta.glob` instead (commit 8dc1d227).
- [x] 8.10 Remove the unknown-example-id check duplicated in `control-bar-events.ts` (already handled
      by `loadExampleDatasetAndClearPersistedFile`) and a stale startup log in `runtime.ts` (commit
      40fa57a3).
- [x] 8.11 Fix 1 (BLOCKER): a request superseded by a newer one (rapid Back, or a menu choice racing
      a slower deep link) resolved `false`, which `loadRequestedDatasetOrFallback` treated as a real
      failure and used to run the persisted-or-default fallback (the demo) over what the newer
      request had already loaded, replace-deleting `dataset=`. Made the loader's result three-way
      (`'loaded' | 'failed' | 'superseded'`); callers fall back only on `'failed'`.
- [x] 8.12 Fix 2: an example load superseded while still decoding — a real decode can take long
      enough for a second Back/menu choice to land mid-way — could still label itself, emit, and
      resolve the pending (now newer) view request against its own data, replace-writing its default
      annotation onto the newer entry. Carry the request id through load meta; `handleDataLoaded`
      checks it both before and after the render call and skips labeling/emit/view-apply if stale.
- [x] 8.13 Fix 3 (nits): track a real success flag for `resolvePendingLoadFinalization` instead of
      always resolving success in `finally`; call `supersedePendingExampleFetch()` from `runtime.ts`'s
      lifecycle cleanup so an example fetch/decode still in flight at teardown recognizes itself as
      stale; drop `DatasetController.reportDatasetChange` — `loadPersistedOrDefaultDataset` now emits
      `(null, 'startup')` for `'recovery-required'` itself, the same way it already does for
      `'auto-loaded'`.
- [x] 8.14 Fix 4 (test only): `dataset-recovery.spec.ts`'s `beforeEach` now waits for the page's own
      startup load before clearing/seeding OPFS, fixing a pre-existing race where the first page's
      startup could wipe the half-written seed.
