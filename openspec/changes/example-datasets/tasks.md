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

- [x] 8.1 Fix the wrong-history-entry bug: a menu choice, or Back/Forward changing `dataset=` and a
      view param together, could resolve/normalize the view against the dataset still on screen and
      replace-write that onto the wrong history entry. Merge `use-url-state-sync.ts`'s
      `[requestState]`/`[datasetParam]` effects into one and add `ViewController.recordRequestedView`
      (record without resolving/applying) for the case where a dataset switch is pending.
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
