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

- [ ] 7.1 `pnpm test`, `pnpm test:e2e`, `pnpm precommit`, `pnpm format:check`
