Sequencing (design Decision 15): tasks §1–§6 run against the interim catalog (today's eleven repo-hosted entries), while the CLI fixes proceed on `fix/annotation-retrieval`. §7 swaps in the five final entries after those fixes are released. §8 is for the owner. §9 happens in the manuscript repository. §10 records the second lineup (owner decisions R2-D1 to R2-D4, 2026-09-30: `three-finger-toxins` replaces the two paper EAT sets, PCA in every example, no Biocentral on the three large sets, rebuild once on the released CLI).

Before every commit:

- run `pnpm precommit` and `pnpm format:check`;
- run the unit tests with `pnpm test:ci`;
- after changing `packages/utils`, run `pnpm --filter @protspace/utils build`, and after changing `packages/core`, run `pnpm --filter @protspace/core build`;
- run E2E with `CI=1 pnpm test:e2e --project=<name> --reporter=line`, with nothing listening on :8080;
- give every new spec file a `projects[]` entry in `apps/web/tests/playwright.config.ts`.

## 1. Curated default view

- [x] 1.1 `example-datasets.ts`:
  - add `ExampleDefaultView { projection; annotation; tooltip? }` and a **required** `defaultView`, plus `insight`, `sizeBytes`, `docsUrl` and `large?`;
  - give each interim entry a provisional `defaultView` naming a column and projection its current bundle really has;
  - rewrite the header comment (no more "verbatim from the archived design").
- [x] 1.2 `view-state.ts`: add `ExploreViewDefaults`.
- [x] 1.3 `url-state.ts`: `resolveExploreView(requested, annotations, projections, defaults = {})` with the landing rule.
  - `url-state.test.ts` cases:
    - a landing request takes the whole default, tooltip included, with no normalization;
    - a partial request fills only the missing field, and the tooltip is `[]`;
    - an invalid annotation falls back to the default and is flagged;
    - drifted default names fall back to `[0]`;
    - the default tooltip drops the effective annotation;
    - `{}` gives today's output.
- [x] 1.4 `view-controller.ts`: add `setDatasetDefaults(defaults | null)` and use it in both resolve calls.
  - `view-controller.test.ts`: an empty `setRequestedView` after `setDatasetDefaults` applies the defaults with no normalization, and `null` restores the first-available fallback.
- [x] 1.5 `dataset-controller.ts` `handleDataLoaded`, after the supersede checks and before `loadData`:
  - `setDatasetDefaults(loadMeta.example?.entry.defaultView ?? null)`;
  - for `source === 'menu'`, `recordRequestedView(createEmptyExploreViewRequest())`;
  - a development-mode `console.warn` naming any `defaultView` name the loaded data lacks.
- [x] 1.6 `dataset-controller.dataset-changes.test.ts`:
  - a menu load calls both methods before `loadData` (`invocationCallOrder`);
  - a `url` or `startup` load keeps the recorded request;
  - user, OPFS and perf loads pass `null`;
  - a load superseded before render changes neither.
  - Add `vi.fn()` for `setDatasetDefaults`/`recordRequestedView` to the hand-built mocks in `example-dataset-load.test.ts`, `dataset-controller.dataset-changes.test.ts` and `dataset-controller.eat.test.ts`.
- [x] 1.7 `example-datasets.test.ts` (the colourable-annotation and tooltip checks landed with §1; the manifest-name check and the protein-count order landed with 4.1; the id format landed with the final catalog, task 10.3, and is checked on `FINAL_EXAMPLE_SPECS` and, once the switch is flipped, on the served catalog): assert, for every entry,
  - that each `defaultView` name is in the entry's manifest `columns`/`projections`;
  - that the annotation is colourable (not tooltip-only, not `__pred_*`);
  - that the tooltip has no duplicates and does not repeat the annotation;
  - that ids are unique, lowercase and letter-leading, with words joined by single hyphens (`three-finger-toxins` passes, `3ftx-eat` fails), and the demo is first;
  - that the order is ascending by manifest protein count after the demo.

## 2. Behaviour decisions (a), (b1), (b2), (c), (d)

- [x] 2.1 (c) `getDatasetSearchParamsUpdate(…, 'menu')`: set `dataset=<id>`, delete `annotation`/`projection`/`tooltip`, keep other parameters.
  - Update the `url-state.test.ts` expectation `annotation=ec&dataset=demo` to `dataset=demo`.
  - Add: `seed=` survives a menu choice; `user`/`startup` keep the view parameters.
- [x] 2.2 (a) Keep the plot on a failed Back/Forward:
  - `datasetController.hasDisplayedDataset()`;
  - `loadRequestedDatasetOrFallback(…, { keepCurrentOnFailure })` returns its outcome, and `runtime.ts` passes `hasDisplayedDataset()`;
  - `ExploreController.setRequestedDataset` returns `Promise<void>` (update `types.ts` and the no-op controller).
- [x] 2.3 (a) Retry and Report:
  - `NotifyAction` becomes `{label, href} | {label, onClick}`, and `NotifyOptions.secondaryAction` maps to sonner `cancel`;
  - a download-failure toast gets Retry (primary) and Report (secondary); a parse-failure toast keeps Report only.
  - Retry after a failed Back/Forward re-reads the URL entry's view parameters, records them, and calls `setRequestedDataset(id)`; Retry after a failed menu choice repeats the menu choice.
  - Tests in `notifications.test.ts`.
- [x] 2.4 (a, G11) After a failed Back/Forward, re-record the displayed view in the view controller unless the user retries.
  - The hook tracks the displayed dataset id, so the next app-written entry for a user view change names the displayed dataset.
  - Unit tests: `startup.test.ts` (no fallback with the flag; fallback without it), and `dataset-controller.dataset-changes.test.ts` (`hasDisplayedDataset()` flips only on success, and stays unchanged after a `data-error`).
- [x] 2.5 (b1) Add the pure `decideUrlChange({ datasetParam, currentDatasetId, switchPending })` to `url-state.ts`, with unit tests.
  - `use-url-state-sync.ts` keeps a switch token settled by `setRequestedDataset`'s promise; while it is pending, a view-only change is recorded, not applied.
- [x] 2.6 (b1) Add `cancelPendingExampleLoad()` (supersede, abort the fetch through an `AbortController`, hide the overlay). A POP navigation (`useNavigationType()`) while a menu load is pending calls it.
- [x] 2.7 (b2) Request epoch in `persisted-dataset.ts`:
  - add `beginUserRequest()`/`isCurrentRequest(epoch)`;
  - user requests take a new epoch: menu, Back/Forward (including to an entry without `dataset=`), file import (`runtime.ts`), recovery-banner buttons, Retry and Cancel;
  - the OPFS restore, the startup demo, corrupt-store recovery and the deep-link fallback carry their start epoch and bail out before each load;
  - `PersistedLoadOutcome` gains `{ kind: 'preempted' }`, which shows no banner;
  - the opfs `data-error` recovery passes its epoch.
- [x] 2.8 (b2) Unit tests (`persisted-dataset.test.ts` with a deferred `loadLastImportedFile`; `startup.test.ts`; `dataset-controller.dataset-changes.test.ts`):
  - a click during the OPFS read wins, with a stored file and with none;
  - `preempted` shows no banner;
  - a corrupt restore during a click only clears the store;
  - a mid-session `null` request begins a user request before the startup flow.
- [x] 2.9 (d) Keep the reset on every example load. The hint and docs text are tasks 3.1 and 5.x (the hint line and the `importing-data.md` exception landed with §2).
- [x] 2.10 E2E in `example-datasets.spec.ts`, using fixtures routed per task 4.9 (the (c) cases landed with §1, and the (a), (b1) and (b2) cases with §2; since 4.9 they run on fixtures by role; the (d) case landed with task 10.4, which hides a legend category rather than recolouring it):
  - (c) from `?annotation=<a>&tooltip=<t>`, a menu choice gives `?dataset=<id>` and the control bar shows `defaultView`; Back restores `<a>` and `<t>`;
  - (c) `?dataset=<id>`, pick an annotation, Back → `defaultView`; explicit deep-link parameters beat the defaults;
  - (a) a fixture routed to 500 on Back keeps the plot, the URL and `history.length`, and Retry recovers after `unroute`;
  - (a) a deep link that fails at startup still falls back;
  - (b1) a gated fetch plus two `goBack()` calls keeps the second entry's `annotation`; Back during a pending menu load leaves the previous dataset with no `dataset=` pushed;
  - (b2) Back to an entry without `dataset=` while an example is pending shows the startup load, not the example;
  - (d) change a legend colour on `?dataset=demo`, reload, and the curated colour is back; the same steps on a user import keep the change.
- [x] 2.12 Review fixes to (a), (b1) and (b2), with unit tests and E2E cases (design Decisions 4 and 5):
  - a menu example that has begun replacing the plot is committed, and a view-only Back/Forward leaves it to finish (E2E: Back after its protein count flips);
  - the OPFS restore and user imports are superseded like example loads, a superseded restore still records `'success'`, and a startup flow waits for a restore in flight (E2E: Forward during the restore, with the example succeeding and failing);
  - a restore preempted while marking `'pending'` puts the previous status back;
  - a user request aborts a FASTA preparation and takes the overlay's Cancel over (E2E: Forward during a preparation);
  - failure toasts dedupe per request kind; a failed startup demo after Back re-records the view; an empty `tooltip=`/`annotation=` is named, not a landing.
- [x] 2.11 File a separate issue for the pre-existing bug where a failed user import marks the healthy stored import as `error`, and add it to Project #2: #500. The rare Back/Forward race that leaves superseded data on screen after a failed download (review finding, deferred as too invasive) is #501, also on Project #2.

## 3. Import-menu UI, download progress and cancel

- [x] 3.1 `packages/core` control bar (the hint line landed with §2):
  - `ExampleDatasetSummary` gains optional `insight`, `docsUrl` and `large`;
  - new `examplesDocsUrl` property (`examples-docs-url`) renders "About these examples ↗" in the Examples heading row;
  - a muted hint line: examples open curated, and changes are not kept;
  - each item becomes a row (button plus `protspace-info-popover` with description, insight and "Learn more ↗"), following the `annotation-select.ts` pattern; drop `title=`. The popover gains an optional `detail` paragraph, which carries the insight;
  - a "Large" badge;
  - the same info control next to the current-dataset name when an example is loaded;
  - then run `pnpm --filter @protspace/core build`.
- [x] 3.2 `control-bar.import-menu.test.ts`:
  - the link is rendered only when the URL is set, and the hint only with at least one example;
  - one info control per item, and opening it does not dispatch `load-example-dataset`;
  - the Large badge renders for `large: true`.
- [x] 3.3 Web wiring: pass `insight`, `docsUrl` and `large` through `runtime.ts` (`toExampleDatasetSummary` in `example-datasets.ts`), and set `examplesDocsUrl` to `/docs/explore/example-datasets` (`EXAMPLES_DOCS_URL`).
  - The catalog's `large` becomes `{ memory, loadTime }`, which the summary appends to a large entry's description with its download size.
- [x] 3.4 Streamed download in `loadExampleDataset`:
  - read `response.body`, report received ÷ `entry.sizeBytes` (capped) with "x / y MB" on the overlay;
  - build the `File` from a `Blob` of the chunks;
  - re-map the overlay ranges so the download gets a real share (0–40 %; `progressAfterExampleDownload` in `loading-overlay.ts` maps an example's decode and render phases onto 40–100 %).
  - Unit test: progress stays capped when a gzip-sized `Content-Length` is present.
- [x] 3.5 Cancel:
  - `overlayController.setCancelHandler(…, 'Cancel download')` during the download (not for `'startup'` loads); it takes a user epoch and calls `cancelPendingExampleLoad()`;
  - no toast, `registerFileLoad` never called, the overlay hidden, the URL unchanged;
  - on an empty screen, run the startup load and replace-remove `dataset=` (`handleCancelledExampleLoad` in `startup.ts`, wired through `onExampleLoadCancelled`); after a cancelled Back/Forward with a plot on screen, re-record the displayed view;
  - clear the handler when decoding starts.
  - Unit tests in `persisted-dataset.test.ts`/`startup.test.ts`.
- [x] 3.6 E2E: a gated fetch plus Cancel leaves the previous dataset, the URL unchanged, and no overlay or toast; the Large badge and the info popover's docs link are visible. Also: Cancel of a startup deep link runs the startup load and removes `dataset=` in place.
- [x] 3.7 `docs/developers/api/index.md`: the new `examplesDocsUrl` property/attribute and the `ExampleDatasetSummary` fields.

## 4. Hosting, manifest, and decoupling fixtures and perf

- [x] 4.1 Manifest writer `apps/protspace/scripts/generate_examples/write_manifest.py` (pyarrow; `chore:`) emits `apps/web/src/explore/example-manifest.ts`, with:
  - top level: `release` and `retained[]`;
  - per id: `file`, `hosting`, `bytes`, `sha256`, `proteins`, `columns`, `projections`, `statistics` (added with §5, for the docs page), `releases`, `protspaceVersion`, `gitSha?`, `command`, `builtAt` and `zenodoDoi`.
  - Export only consumed symbols (knip `ignoreExportsUsedInFile: false`).
  - Generate the interim manifest from the current repo-hosted bundles (`release: null`). Unit-test the writer, and run `uv run ruff check`.
- [x] 4.2 Catalog derives `url`, `sizeBytes` and the label's count and size from the manifest record (`./<file>` for repo-hosted, `./examples/<file>` for release-hosted). Any `import.meta.env` read is optional-chained, so tsx can load the module.
- [x] 4.3 `scripts/examples/fetch.mts` (tsx; `--base-url` points it at a mirror or a local server):
  - `pnpm examples:fetch [--out dir] [--with-retained]` downloads `https://github.com/tsenoner/protspace/releases/download/<release>/<file>` for every release-hosted record;
  - it verifies bytes and sha256, verifies the in-repo demo against its record, and exits non-zero on any mismatch or missing asset;
  - it is a no-op for an all-repo manifest.
  - Add `apps/web/public/examples/` and `perf/datasets/` to `.gitignore`.
- [x] 4.4 `deploy.yml`: after `pnpm build`, run `pnpm examples:fetch --out apps/web/dist/examples --with-retained`; the deploy fails on any mismatch.
  - A job on PRs that touch `example-manifest.ts` (its own workflow, `example-bundles.yml`, so the path filter scopes it) runs the same fetch into a temporary directory, then `write_manifest.py --refresh --check` against the fetched files.
- [x] 4.5 Development fallback: in `import.meta.env.DEV`, when a release-hosted file's same-origin fetch is not OK or returns HTML, retry from `https://protspace.app/examples/<file>`. Unit test with mocked `fetch`: a production build never leaves the origin.
- [x] 4.6 Fixtures: add byte-identical copies (the same blobs) in `apps/web/tests/fixtures/`:
  - `demo_toxprot_7831` (from `public/data.parquetbundle`);
  - `toxprot_5181_pca3d` (5K);
  - `pe1_40026_pca3d` (40K);
  - `phosphatase_1587`;
  - `venom_eat_stats_811`.
  - Repoint the path users (through `apps/web/tests/helpers/fixtures.ts`): `dataset-reload.spec.ts`, `isolation-dataset-swap.spec.ts`, `numeric-binning.spec.ts`, `example-datasets.spec.ts`, `scripts/docs-screenshots/eat-helpers.ts` (and `docs/explore/images/README.md`), `packages/core/.../bundle-roundtrip.test.ts` (5 sites) and `generate_toxprot_demo.py`'s default settings source (the demo fixture; task 6.7).
  - `tests/helpers/opfs.ts` (`seedOpfsState`, used by `dataset-recovery.spec.ts` and `example-datasets.spec.ts`) passes fixture bytes into `page.evaluate` instead of fetching `/data/5K.parquetbundle`.
  - The `public/data/` originals are deleted in 7.8.
- [x] 4.7 Startup pin:
  - `playwright.config.ts` sets `webServer.env.VITE_STARTUP_DATASET_URL` to `/@fs/<repo>/apps/web/tests/fixtures/demo_toxprot_7831.parquetbundle`; the demo entry's `url` honours it; add a `vite-env.d.ts` entry.
  - Add `STARTUP_URL_GLOB` in `apps/web/tests/helpers/`, and switch the hard-coded startup globs and fetches in `numeric-binning.spec.ts` (×5), `eat-visualization.spec.ts` and `url-view-state.spec.ts`.
  - Leave the root-config docs-capture projects unpinned.
  - A guard scenario in `example-datasets.spec.ts` fails, naming the cause, when the startup load does not come from the fixture (a dev server reused without the variable).
  - Fallback if `/@fs/` fails: copy into a gitignored `public/__e2e__/` in global setup.
- [x] 4.8 E2E guard: run the default suite after 4.6/4.7 with the product demo temporarily replaced by another bundle, and confirm that nothing depends on it; record the result in the PR.
  - Result (2026-09-29): with `apps/web/public/data.parquetbundle` replaced by the 40K bundle, `CI=1 pnpm test:e2e` passed 149/149, the same as with the real demo.
- [x] 4.9 `apps/web/tests/helpers/example-fixtures.ts` maps each catalog id a spec loads to a fixture that contains its `defaultView` names. `example-datasets.spec.ts` routes by the entry's `url`, asserts that no drift warning is logged, and gives its race tests explicit `annotation=`/`projection=`.
  - The scenarios name examples by role (`small`, `other`, `slow`), so the swap (7.9) edits only the helper's table; held requests pass on with `route.fallback()` so they reach the fixture, and protspace.app's copies are refused so a development build's fallback can never download a real example. With the three `public/data` originals moved away, the project still passes (26/26).
- [x] 4.10 `example-datasets.test.ts`: replace "the file exists under `public/`" with "every catalog id has a manifest record" and "the only `.parquetbundle` under `public/` is the demo" (the former landed with 4.1, plus "every repo-hosted record's file ships under `public/`"; the latter is written, leaves out the gitignored `public/examples/`, and runs once `FINAL_CATALOG_IS_LIVE` is flipped, in the swap commit that also removes `public/data/`, tasks 7.7–7.8).
- [x] 4.11 Perf datasets:
  - `perf/datasets.manifest.json` (`{ id, file, bytes, sha256 }`) for the eleven current `public/data` bundles plus `beta_lactamase_2026_stats` (113K) and `phosphatase_eat` (832), under their original names;
  - `pnpm perf:fetch` (the same fetch script, perf mode; `--only` for a subset) into `perf/datasets/`.
  - Each record also carries `default` (the ten of the former `datasets.json`, the default sweep) and `source` (the git blob or manuscript path it was staged from). The `example-bundles.yml` workflow runs `pnpm perf:fetch` on PRs that change the list, so it stays red until the owner publishes the release (8.1).
- [x] 4.12 `perf/webgl-perf.spec.ts` routes `**/data/<id>.parquetbundle` and `**/data/datasets.json` to `perf/datasets/`; a missing file is recorded as a dataset error naming `pnpm perf:fetch`.
  - Remove the fallback list in `apps/web/src/perf/webgl-perf-suite.ts`.
  - Update `perf/README.md` and `perf/plot_perf_results.py` (the plotter needed no change: the release keeps the original ids its ordering list names).
  - A missing or malformed `datasets.json` is recorded under `failures` (the results file is still emitted), and a failed dataset fetch carries the response body (the spec's `pnpm perf:fetch` hint) into its error.
  - Point `load-large-bundle.spec.ts` and its `playwright.config.ts` comment at `perf/datasets/573K_swissprot.parquetbundle`.
- [x] 4.13 A staging script (`build_showcase.py stage-perf`, task 6.6) collects the `perf-datasets` assets from git blobs and the NM paths into a local directory with `SHA256SUMS`, and prints the owner's `gh release create` command without running it (§6 added the build, verify and `stage-release` subcommands to the same script).
- [x] 4.14 `CONTRIBUTING.md`: fixtures vs examples, `pnpm examples:fetch`, `pnpm perf:fetch`, and stopping a running dev server before E2E so the startup pin applies.

- [x] 4.15 Review fixes to hosting:
  - `write_manifest.py` refuses a retained file named like a new one with other bytes and drops an identical one; `examples:fetch` fails before downloading when two pinned files share a name with other bytes, re-verifies every file once all are in place, and rejects a perf manifest that is not `{ release, datasets }`;
  - `--zenodo-doi` records the deposit's DOI after the build, and later runs keep it while the bytes are unchanged;
  - `_annotation_releases` reads the build's `{ group: { release, columns } }` objects (the agreed provenance format), leaving out groups with no release, and still the flat `{ group: release }` form of older bundles; a test stamps a bundle exactly as `set_provenance` does;
  - the E2E web server stops with the run (`gracefulShutdown`), and the docs captures refuse an app whose startup load is the E2E fixture.

## 5. Docs tooling and prose

- [x] 5.1 (Superseded by 10.5, the five-entry lineup.) `docs/scripts/example-details.ts` holds docs-only prose for the six final ids: title, tagline, how to read the default view, what to try next, source and query, embedding, projection parameters, paper figure and notes (the membership release comes from the manifest, and the thumbnail path is `images/examples/<id>.png` by convention). Use journal-neutral citation text (preprint DOI `10.64898/2026.05.04.722720` plus the FAQ citation anchor) and credit UniProt under CC BY 4.0.
  - Until the swap it also holds the interim lists (design Decision 14): `INTERIM_CATALOG_IDS`, `beforeSwap` (insight and provisional `defaultView` for the five final ids not yet in the catalog) and `THUMBNAILS_PENDING`. Author facts still to come are written as `‹…›`.
- [x] 5.2 `docs/scripts/generate-examples.mts` writes `docs/explore/example-datasets.md` (formatted with prettier):
  - `## Title {#id}` cards;
  - raw `<a href>` "Open in ProtSpace" and "Download (size)" links;
  - a `::: details How this bundle was built` block with the manifest command;
  - release per column group;
  - an intro stating that examples reopen curated, how to keep changes, and the imported-copy storage edge case.
  - `--check` fails on a stale page, a catalog/details id mismatch, a missing thumbnail, a demo/manifest mismatch, a label that disagrees with the manifest, or prose that does not name the colour-by annotation; while the interim lists are non-empty it allows their exceptions, and once they are empty it refuses `‹…›` placeholders and `beforeSwap`.
  - The manifest gained a `statistics` flag so the cards can say whether a bundle has separation scores.
- [x] 5.3 Scripts `docs:examples` and `docs:examples:check`, with `docs:examples:check` in `precommit`. Add `docs:annotations:check` and `docs:examples:check` to the `ci.yml` `build-docs` job (the interim lists let both pass before the swap).
- [x] 5.4 Opt-in `examples-live` Playwright project (`RUN_EXAMPLES_E2E=1`, after `pnpm examples:fetch`), with a `projects[]` entry: every catalog id opens on its `defaultView` with no URL write and no drift warning, and writes `docs/explore/images/examples/<id>.png`.
  - It also checks the protein count against the manifest, serves the product demo in place of the E2E startup fixture, refuses the development fallback to protspace.app (so a missing local file fails), and runs serially. `EXAMPLES_THUMBNAIL_DIR` redirects the thumbnails.
  - Against the interim catalog it passes 11/11 (thumbnails written to a scratch directory, not committed), and it fails when a `defaultView` names a column the bundle lacks.
- [x] 5.5 Sidebar entry "Example Datasets" after "Importing Data" in `docs/.vitepress/config.mts`; `/docs/explore/example-datasets` in `apps/web/public/sitemap.xml`.
  - `example-datasets-docs.test.ts` is retargeted from `control-bar.md` to the new page (anchors for every catalog id outside `INTERIM_CATALOG_IDS`, every `docsUrl` pointing at its section, no section outside the catalog except a `beforeSwap` one).
- [x] 5.6 `docs/explore/control-bar.md` §9 (the ⓘ, the Large badge, "About these examples" and Cancel landed with §3): shrink it to behaviour (menu vs link; the curated reset (c); failure keeps the plot plus Retry (a); the Large badge, progress and Cancel (e); the "About these examples" link), move the id table to the new page, and drop "every bundle that ships". Fix the stale demo alt text and the "NOT phospholipase A2" example (the lines at 137 and 192).
- [x] 5.7 `docs/explore/importing-data.md` (the (d) exception, with the export-and-import route and the imported-copy edge case, and "Starting fresh" landed with §2):
  - the "Settings persist per dataset" bullet gains the example exception (d) with the export-and-import route;
  - "Starting fresh" for an example;
  - the demo name ("the startup demo, a small set of venom toxins", linked to its card, so it reads right before and after the relabel);
  - drop "eleven";
  - replace the Venom EAT sentence with a pointer to the new page.
- [x] 5.8 (Superseded by 10.5, which points "Trying It" at `three-finger-toxins`.) `docs/explore/eat.md` "Trying It": `venom-eat` (threshold 0, strips visible, and "drag to 0.5 → 244 of 384"), the `?dataset=venom-eat` link, a link to its card, and a fix for "nearly half the dataset is a ring". Keep the venom numbers in `separation-scores.md` and `scatterplot.md`, since the frozen statistics part keeps them valid.
- [x] 5.9 `docs/index.md` (drop "eleven", link the page), `docs/explore/index.md`, `docs/guide/index.md` (link `#swissprot`), `docs/guide/faq.md` (optional Swiss-Prot link), `docs/explore/images/README.md` (the venom fixture path).
  - The FAQ link was left out: its load-time sentence describes the 44.9 MB paper bundle, and the refreshed Swiss-Prot example may load more slowly (the D2 gate allows up to about 35 s). The images README got the fixture path with §4.
- [x] 5.11 `docs:examples:check`, once `INTERIM_CATALOG_IDS` is empty, also fails while `THUMBNAILS_PENDING` lists anything and when a stated release (membership or a column group) is not `YYYY_MM`, which the `‹…›` check alone would miss for a note stamped by the build.
- [x] 5.10 Product tour step 2 (`product-tour.ts`) mentions **Examples** and uses the extensionless docs link; check `product-tour.spec.ts` (it asserts titles and targets only, and passes unchanged).

## 6. Showcase build script (Python dev tooling, `chore:` commits)

- [x] 6.1 `apps/protspace/scripts/generate_examples/build_showcase.py` plus `showcase.toml` hold per-dataset recipes (design Decision 9), with subcommands `build <id>`, `verify <id>`, `report`, `record-load`, `stage-release` and `stage-perf` (the manifest is `stage-release`'s, through `write_manifest.py`; no second writer). Every step runs through `uv run`.
- [x] 6.2 Helpers:
  - `split_bundle`, `select_proj` (keep, rename `UMAP_2` → `ProtT5 — UMAP 2`, UMAP first), and `extract_ann` (part 0 only);
  - drop `sequence`/`organism_id`;
  - put the insight annotation first;
  - explicit `--stats-annotation` lists (G12);
  - envelope settings with the curated legend and the EAT threshold (venom 0, phosphatase 0.5).
- [x] 6.3 EAT specifics:
  - venom: freeze coordinates, statistics, `ec`, `protein_families` and `*__pred_*`, and add InterPro, TED and Biocentral from full-length sequences;
  - phosphatase: re-encode the v1 columns before grafting (or rebuild and graft `eat_split` plus `*__pred_*`), add the withheld-truth columns, and **refuse** any step that refills `ec`/`protein_families` on the 213 query rows.
- [x] 6.4 Provenance key/value metadata on the annotations table: `example_id`, `protspace_version`, `git_sha`, `uniprot_release` per column group, `membership_release`, `built_at`, `command` and `zenodo_doi`.
- [x] 6.5 `verify <id>` gates:
  - the common gates and each dataset's story gates (design Decision 9);
  - the obsolete-accession count;
  - `defaultView` names present, read from the catalog;
  - the phosphatase accuracy against fetched truth (91.5 % over 213; 98.1 % over n = 160 at reliability ≥ 0.5);
  - the Swiss-Prot load time and heap (the D2 gate, measured in a real browser).
- [x] 6.6 `stage-release` writes `<id>_<release>.parquetbundle` files plus `SHA256SUMS` into a staging directory, calls `write_manifest.py`, and prints the owner's `gh release create`/`upload` commands; `stage-perf` does the same for task 4.13.
  - One tool: the build branch's pipeline rebased onto this branch keeps the web side's `stage-perf` (`PERF_DATASETS`, `--out`, `perf/datasets.manifest.json` as `{ release, datasets }`) and drops its own `manifest.json` sidecar and `[perf]` list.
- [x] 6.7 `generate_toxprot_demo.py`:
  - all annotation columns, keeping the mature `length`;
  - InterPro and Biocentral run on **full-length** sequences (G8);
  - the default settings source becomes the demo fixture.
- [x] 6.8 pytest for the pure helpers (projection rename and order, provenance metadata, the no-refill guard, gate predicates) under `apps/protspace/tests/`. Run `uv run pytest` and `uv run ruff check`.
- [x] 6.9 Review fixes to the build:
  - a fetch step is done only when the CLI reported every requested source complete: its incomplete-source warnings (it exits 0 on a partial InterPro, TED or Biocentral fetch) make the step run again, then fail without a marker;
  - provenance records the release the CLI recorded for its data (`run.log`, the cache's release stamp, the FASTA responses); what UniProt serves at a probe only stops a fetch from starting, so a finished build can be finalized after a rollover;
  - step markers are keyed on a digest of the step's inputs (the recipe keys it reads, style file contents, input file fingerprints, the CLI commit, its command), so a `showcase.toml` or style edit re-runs the steps that read it;
  - the D2 measurement (`record-load`) is tied to the file's sha256, `pending` blocks like a failure, the web-cut decision is kept for later builds, and `stage-release` ships only files whose `verify.json` passed on their exact bytes (`--force` to override);
  - `pfam_duplicates` fails without its cache, the obsolete-accession count falls back to `protein_name` (and fails when it cannot count), a refreshed source empty on every row fails, an unknown gate type fails, and an unconfirmed release (not `YYYY_MM`) keeps the `provenance` gate pending;
  - outputs may not land in the repository or an input directory.

- [x] 6.10 Second lineup in the build (design Decisions 16–18; the `embed-build` kind, merged from `feat/curated-example-datasets-3ftx`, with the review fixes: mature chains cut by one rule, a pinned hold-out split, the EAT provenance, exact transfer counts and the web's N/A order):
  - a build kind for `three-finger-toxins` that makes its own coordinates: the pinned accession list, mature chains embedded with ProtT5-XL-U50, `prepare` keeping its UMAP and PCA, sequence-based sources on full-length sequences, the `toxin_class` CSV, the hold-out (sorted classes, recorded seed, the realised `eat_split` shipped), `transfer` with k = 1 and the Euclidean distance, statistics after the transfer, and the Decision 17 gates as tolerances; with tests;
  - PCA in every example: `swissprot` adds the paper's PCA as `ProtT5 — PCA 2`, and the demo keeps all four projections;
  - commit the Biocentral skip for `human-fly`, `beta-lactamase` and `swissprot` with its reason;
  - a build command without machine paths (`--cli-root $CLI`), the web's missing-value set for the N/A gate, the `root` and `predicted_transmembrane` gates of Decision 9, and `--latest=false` in the printed `gh release create` commands.
- [x] 6.11 Drop `venom-eat` and `phosphatase-eat` from `showcase.toml`; their frozen files stay fixtures, `perf-datasets` assets and Zenodo files.

## 7. Data build and catalog swap (after the CLI fixes merge)

- [x] 7.1 Prerequisites:
  - `fix/annotation-retrieval` (PR #495) merged with a merge commit and released as protspace 4.15.0, tag `v4.15.0` (4.14.0 was PR #478) (InterPro fan-out plus retry, the family parser, Biocentral batching, the per-source cache and `annotate --cache-dir`, the `run.log` release line, `root` and TMbed's "no TM segment", and the cache-semantics bump that makes a rebuild refetch them);
  - PR #452 (the faithfulness statistics) merged (done, released in 4.13.1);
  - author facts collected: the Swiss-Prot and human + fly membership releases (2025_04 is inferred from the data); how the 113,015 were selected. These are a hard prerequisite of the swap commit (7.7): the docs check refuses any `‹…›` once the switch is flipped.
  - Result: every bundle was built on `v4.15.0` (the manifest records 4.15.0 and its commit). The author facts are derived from the data and recorded per recipe in `showcase.toml` with their reasoning: Swiss-Prot and human + fly 2025_04; the 113,015 β-lactamases are every hit of `family:"beta-lactamase"` at 2026_02, unfiltered. They are not yet confirmed by the author, who confirms them in 7.5 (then note "derived, author-confirmed on <date>" here).
- [x] 7.2 Rebuild every example on the released CLI (R2-D2), `swissprot` first (the critical path; run alone). Gates: N = 573,649, no `(TC n`/"In the … section", the Pfam empty rate on duplicate-sequence rows ≈ unique rows, domain counts within ±1 % of Fig. 2A, and the paper's PCA present. Then apply the **D2 gate** again on the rebuilt file with its PCA (≤ ~35 s, ≤ ~1.5 GB heap, `record-load`, reference laptop), or produce the GO/TED-free web copy.
  - Result: all gates pass (573,649 rows; 0 `(TC n`/"In the … section"; Pfam empty on 1.5 % of duplicate-sequence rows against 4.4 % of unique ones; 9 of 9 domain counts within ±1 %; `ProtT5 — PCA 2` present; 30 rows without a current UniProt entry). The D2 gate passed on the rebuilt 135.9 MB file with its PCA: 27.4 s and 1,192 MiB of peak JS heap, re-measured on 2026-10-02 after the restyle of 434210ae changed the file's bytes (limits 35 s and 1,536 MiB; `JSHeapUsedSize`, so ArrayBuffer and GPU memory are not in it), measured in headless Chromium on an Apple M4 Pro, so no web cut.
- [x] 7.3 Build `beta-lactamase`, then `human-fly`, staggered after Swiss-Prot's TED run:
  - `beta-lactamase`: Q02940 still class C; the Fig. 3 legend counts within 2 %; `xref_pdb` has both values;
  - `human-fly`: kinases about 2,000 (1,488 human, 513 fly at 2026_03) and shared; MHC I/II, β-defensins and CC chemokines human-only; PBP/GOBP fly-only; species about 83,546 / 21,942 plus the obsolete rows; the 146 vector-less rows annotated.
  - Result: every gate passes. `beta-lactamase`: Q02940 is `class-C beta-lactamase family|IC` and none of its 50 nearest neighbours is class C; 10 of 10 Fig. 3 legend counts within 2 %; `xref_pdb` has both values; 78 rows without a current UniProt entry. `human-fly`: 2,001 protein kinases (1,488 human, 513 fly); 4 human-only and 1 fly-only family labels (≥ 98 %); both species counts within 0.5 %; 74 rows without a current UniProt entry; of the 146 vector-less rows, the 73 that UniProt still has were annotated from FASTA.
- [x] 7.4 Build `three-finger-toxins` (task 6.10; the Decision 17 gates) and `demo` (7,831; coordinates unchanged; `pfam` coverage checked; all four projections).
  - Result: every gate passes. `three-finger-toxins`: 1,089 rows (537 Swiss-Prot, 552 TrEMBL), 107 held out; `toxin_class` right for 94.4 % of them (101 of 107) and for all 95 at reliability ≥ 0.5 (`toxin_subfamily` 97.2 %); 312 of the 552 TrEMBL transfers at reliability ≥ 0.5; the largest donor gives to 32 queries; 96.2 % agreement with the class a query's name states. `demo`: 7,831 rows, coordinates unchanged, four projections, `pfam` on 66.4 % of rows (was 26.9 %), every input full-length.
- [ ] 7.5 Final `defaultView` picks: score the candidates by the stated criterion (kNN label agreement, or the per-category silhouette of the story's categories); capture the `examples-live` thumbnails; **the author reviews them**; set each final pick in one catalog line. Where figure fidelity wins over the criterion, the card explains why. (The owner's picks are in `FINAL_EXAMPLE_SPECS`, task 10.3; the thumbnails were captured with the swap, 7.7, and the author's review of them is left.) With the thumbnails, the author also confirms the two points below. A change to either is baked into the bundle (its provenance or its legend settings) and so means a rebuild, a new sha256 and a new manifest record: decide before the `showcase-2026_03` release is created (8.2), since a release file name never carries different bytes.
  - 7.1's derived facts: Swiss-Prot's membership 2025_04 (2025_04 re-issued 2025_03 unchanged, so 2025_03 fits the data equally), human + fly's 2025_04, and the 113,015 β-lactamases as every hit of `family:"beta-lactamase"` at 2026_02;
  - the `human-fly` default view's draw order: its bundled legend puts Homo sapiens (zOrder 0, drawn on top) over Drosophila melanogaster, so the fly points are hidden inside the shared core and the thumbnail is almost all human.
- [x] 7.6 `build_showcase.py stage-release` for `showcase-2026_03`, writing the manifest with `release: 'showcase-2026_03'` and `hosting: 'release'` for the four release-hosted entries and `'repo'` for the demo. Record the release per column group.
  - Result: staged every file whose `verify.json` passed on its bytes; the manifest (committed with 7.7) records membership 2026_01 for the demo, 2026_03 for `three-finger-toxins`, 2025_04 for `human-fly` and `swissprot` and 2026_02 for `beta-lactamase`, annotations refreshed at 2026_03, ProtSpace 4.15.0.
- [x] 7.7 Catalog swap, in **one commit** with 7.6's manifest, 7.8 and 7.10 (design Decision 15: `docs:examples:check` runs in precommit, the commit hook and CI, and refuses the flipped catalog until all of this is in place):
  - set `FINAL_CATALOG_IS_LIVE` to `true` (the final entries, names, descriptions, insights and relabelled demo are already in `FINAL_EXAMPLE_SPECS`);
  - fill their `‹…›` values from the built files: the three-finger toxins' hold-out accuracy, and `swissprot`'s `large` memory and load time from the D2 gate;
  - fill the `‹…›` counts in `docs/explore/eat.md` ("Trying It") and the three-finger toxins card from the built file, and the author facts of 7.1 in the prose;
  - capture the five thumbnails with the `examples-live` project from the flipped working tree, the staged release files copied into `apps/web/public/examples/`, before committing;
  - before the real swap, dry-run the E2E suite once on a scratch flip (uncommitted: `FINAL_CATALOG_IS_LIVE` true and a scratch manifest whose four release records point at any files), `CI=1 pnpm test:e2e --project=example-datasets --workers=1`, since the release-hosted entries take the development fallback path the interim catalog never exercised (a first dry run on 2026-09-30, with the four release records pointing at the role fixtures' sizes, passed 32 of 32; repeat it on the real manifest).
  - Result: the swap commit fills the catalog from the build (the three-finger toxins' hold-out accuracy, 94 %, 101 of 107; Swiss-Prot's `large` note, about 1.2 GB and about 30 s, from the D2 measurement of 1,192 MiB and 27.4 s; after review it reads "at least 1.2 GB" and "about 30 s on a fast laptop", since one run on an M4 Pro and a heap without ArrayBuffer or GPU memory are a floor, not a typical cost) and every `‹…›` in the prose and `eat.md` (1,089 toxins, 537 reviewed, 552 unreviewed, 107 held out, 659 rings at threshold 0, 407 transfers at reliability ≥ 0.5, 183 _Naja_ toxins, 116 TrEMBL fragments, UMAP 25 neighbours and minimum distance 0.1). The `examples-live` project captured the five thumbnails from the staged release files (5 of 5 passed), and the dry run on the real manifest passed 33 of 33 (`CI=1`, `--workers=1`, against a dev server of its own on another port).
- [x] 7.8 Remove `apps/web/public/data/` entirely (including `datasets.json`); this makes the four non-demo fixtures `git mv`s in the branch diff. Replace `apps/web/public/data.parquetbundle` with the new demo. The "only the demo under `public/`" assertion runs from the flipped switch on. The landing page's build reads both files, so in the same commit:
  - repoint `VENOM_BUNDLE` in `scripts/landing-data/build-landing-data.mts` (now `apps/web/public/data/venom_eat_stats.parquetbundle`) at `apps/web/tests/fixtures/venom_eat_stats_811.parquetbundle`, the same bytes, or at the `perf-datasets` copy; otherwise `pnpm landing:data` fails with ENOENT;
  - re-run `pnpm landing:data` against the new demo, so `apps/web/public/landing/demo.json` (whose `source` names the bundle it was built from), `demo.bin` and `demo-labels.json` match the demo `/explore` opens, and `venom.json` names the new `VENOM_BUNDLE`.
  - Result: the fixture's sha256 equals the removed file's; the rebuilt `demo.json` differs only in the refreshed `protein_families` counts (the coordinates are unchanged), and `venom.json` only in its `source`.
- [x] 7.9 `apps/web/tests/helpers/example-fixtures.ts` switches to the final ids with the flag (task 10.4); run the E2E suite on the flipped catalog. A later cleanup drops the roles' `interimId`, the interim view names from `derive-example-role-fixtures.py` and its fixtures, `INTERIM_EXAMPLE_SPECS` and the switch.
  - The helper already picks the final ids from `FINAL_CATALOG_IS_LIVE`, so the flip needed no edit there; the `example-datasets` project passed 33 of 33 on the flipped catalog (7.7), and the full default suite runs in 7.12.
- [x] 7.10 Part of the 7.7 commit: empty `INTERIM_CATALOG_IDS` in `docs/scripts/example-details.ts`, fill in the remaining `‹…›` author facts and counts, add the thumbnails (emptying `THUMBNAILS_PENDING`), and regenerate `docs/explore/example-datasets.md`. (The page, the retargeted pin test and the CI/precommit wiring landed with §5; the final cards with task 10.5.)
- [x] 7.11 Re-run `pnpm docs:images` against the new demo; check the PLD/Kunitz overlay coordinates and the demo-dependent alt texts. Check the landing page against the landing data rebuilt in 7.8: the preview, and the demo-dependent copy and alt texts in `apps/web/src/landing/FeatureShowcase.tsx` (the "… venom proteins" label, and A4FS04 "from the demo bundle"). Move the EAT captures (`scripts/docs-screenshots/eat-helpers.ts`) to the `three-finger-toxins` bundle, `toxin_class`, as its note says, re-capture the four EAT images and check the `eat.md` alt texts.
  - Result: `pnpm docs:images` re-captured every image from a plain dev server on another port (`PLAYWRIGHT_BASE_URL`, which the capture config now reads), 26 of 26 captures. The demo's coordinates are unchanged, so the hand-placed overlays still land: the circle and "PLD" on the arthropod phospholipase D cluster, the "Kunitz" arrow into the venom Kunitz-type cluster. Their alt text described a red circle and a "Cluster A" label, and the zoom inset's put the target in the lower right; both now say what the images show. The annotation dropdown now opens on the demo's new Biocentral section, so the control-bar page lists all six source sections. The EAT captures open `three-finger-toxins` by its `?dataset=` link, coloured by `toxin_class`, and the connectors capture steps the pointer off each clicked protein, since the hover tooltip had covered the source line; the four `eat.md` images show 429 observed and 659 transferred values, the EAT and STATS badges, one source fanning out to its 7 dependants, and the rings thinning at 40, 70 and 90 % (626, 124 and 29 left). The landing page needed no copy change: the preview draws the 7,831 venom proteins, and A4FS04 (acidic phospholipase A2 natratoxin), P0DQE3 (no curated EC number) and its source P20005 hold what the landing page says in the new demo.
- [ ] 7.12 Full verification:
  - `pnpm test:ci`, `pnpm format:check`, `pnpm precommit`;
  - `CI=1 pnpm test:e2e` (all default projects);
  - `pnpm examples:fetch && RUN_EXAMPLES_E2E=1 pnpm test:e2e --project=examples-live`;
  - `pnpm docs:examples:check`, `pnpm docs:annotations:check`, `pnpm docs:build`;
  - `pnpm perf:fetch && PERF_DATASETS=venom_eat_stats,573K_swissprot pnpm perf`;
  - `uv run pytest apps/protspace/tests`, `uv run ruff check`.
- [ ] 7.13 Reread `proposal.md`/`design.md` against the final diff and update them; update the `example-datasets` Purpose line to say "curated and documented"; `openspec validate curated-example-datasets --strict`; archive as the last commit before the merge.

## 8. Owner-only steps (prepared by scripts; not executed by this change)

- [x] 8.1 Create the `perf-datasets` release and upload the staged assets plus `SHA256SUMS` (task 4.13); check `pnpm perf:fetch` against it.
  - Result: published with the owner's approval (14 assets); `pnpm perf:fetch` downloaded and verified all 13 bundles from it into a scratch directory.
- [x] 8.2 Create the `showcase-2026_03` release and upload the staged assets (task 7.6); check `pnpm examples:fetch` and the CI manifest job.
  - Result: published on 2026-10-02 with the owner's approval, `--latest=false` (v4.15.0 stays Latest): the four release bundles and `SHA256SUMS`, staged without `--force` after every gate passed. `pnpm examples:fetch --with-retained` downloaded and verified all four, `write_manifest.py --refresh --check` found the manifest up to date, and CI's "Example bundles match the manifest" job passed against the release.
- [ ] 8.3 Zenodo "paper companion" deposit: the frozen paper files (all eleven old bundles, the 113K, the 832 with its query input and ProtT5 H5, the venom 811 H5) plus the new showcase files and the three-finger toxins' inputs (accession list, label CSV, mature-chain H5). Record its DOI with `write_manifest.py --refresh --examples-dir <fetched files> --zenodo-doi <doi>` (later runs keep it while the files are unchanged, so the CI check passes; no re-stamping of the bundles), then regenerate the docs page.
- [ ] 8.4 Cloudflare cache rule for `/examples/*` (cache everything, long edge TTL, **and a Browser TTL**, since Pages sends `max-age=600`). Verify `cf-cache-status: HIT` on a second request, before the Swiss-Prot link is announced.
- [ ] 8.5 Staging GitHub Pages deploy with a file over 100 MB (G19). It was due before 7.2 finished; 7.2 is done and the swap commits the catalog to the 135,853,395-byte `swissprot` asset, which `deploy.yml` uploads with `upload-pages-artifact`, so it now blocks the merge. If it fails, fall back to Cloudflare R2 on `data.protspace.app` with CORS.
- [ ] 8.6 After deploying: `curl -sI https://protspace.app/examples/<file>` returns 200; time a Swiss-Prot load on the reference laptop and record its heap.
- [ ] 8.7 Add the PR (closing #443) to Project #2 (the issues #500 and #501 are on it). Coordinate the stack with t03i (PR #494), and merge with a **merge commit**.

## 9. Manuscript follow-up (`protspace_publication`, separate repository; out of scope)

- [ ] 9.1 Sweep the roughly 38 lines coupled to the shipped bundles ("eleven datasets distributed with ProtSpace", `public/data`, "across all eleven shipped bundles") across the front matter, results, methods and extended data, and point them at the Zenodo and `perf-datasets` copies.
- [ ] 9.2 Add `https://protspace.app/explore?dataset=<id>` links per figure, and fill in the Zenodo DOI in the end matter.
- [ ] 9.3 Name the `phosphatase_eat` fixture (the `perf-datasets` asset and Zenodo file of that name, no longer a catalog entry), with its 91.5 % / 98.1 % gate, as the NM code checklist's "demo dataset with expected output".
- [ ] 9.4 Before submission, re-check the Swiss-Prot Pfam statistics that the InterPro duplicate-sequence bug affected (the multi-family share, and the Pfam cardinality in the size model).
- [ ] 9.5 Numbers the linked examples no longer show: 1,703 shared protein kinases (the example has about 2,000, mostly new automatic TrEMBL family annotations); class C's +0.32 silhouette (about +0.17 refreshed); Fig. 2A's Monodnaviria (now Floreoviria). Footnote or update them, and point the manuscript scripts that read `apps/web/public/data` at the `perf-datasets` release before 7.8. Optionally redraw Fig. 4 d–f from the three-finger toxins bundle.

## 10. Second lineup (owner decisions R2-D1 to R2-D4, 2026-09-30)

- [x] 10.1 Amend the proposal, design (Decisions 1, 9, 12, 14–18), the spec deltas and these tasks for the five-entry lineup; `openspec validate curated-example-datasets --strict`.
- [x] 10.2 Unit tests stop indexing the product catalog: `example-catalog.fixtures.ts` is a two-entry test catalog swapped in with `vi.mock`, and the fetch mocks carry headers.
- [x] 10.3 `FINAL_EXAMPLE_SPECS` (the five final entries with the owner's default views) and the `FINAL_CATALOG_IS_LIVE` switch in `example-datasets.ts`; tests for the id format (1.7), the order, the default views, a UMAP and a PCA per final entry, and the prepared 4.10 assertion.
- [x] 10.4 `apps/web/tests/fixtures/derive-example-role-fixtures.py` derives the four role fixtures (small, other, slow, eat), each holding its interim and final example's view names; the role table maps to `human-fly`, `beta-lactamase`, `swissprot` and `three-finger-toxins` behind the switch; E2E for (d) and for the EAT example's bundled threshold.
- [x] 10.5 Docs: the five cards (the three-finger toxins story, mature chains, caveats and `‹…›` counts; the refreshed human + fly, β-lactamase and Swiss-Prot numbers and their reasons; no Biocentral on the three large sets), the generator's intro (the non-paper example, why UMAP and PCA), its machine-path and post-swap placeholder checks, and `eat.md`/`importing-data.md` pointing at `three-finger-toxins`.
- [x] 10.6 Call the separation panel's embedding value a reference, not a ceiling, in the app and the docs.
