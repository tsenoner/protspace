Sequencing (design Decision 15): tasks §1–§6 run against the interim catalog (today's eleven repo-hosted entries), while the CLI fixes proceed on `fix/annotation-retrieval`. §7 swaps in the six final entries after those fixes merge. §8 is for the owner. §9 happens in the manuscript repository.

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
- [ ] 1.7 `example-datasets.test.ts` (the colourable-annotation and tooltip checks landed with §1; the manifest-name check and the protein-count order landed with 4.1; only the id format waits for the final ids, task 7.7): assert, for every entry,
  - that each `defaultView` name is in the entry's manifest `columns`/`projections`;
  - that the annotation is colourable (not tooltip-only, not `__pred_*`);
  - that the tooltip has no duplicates and does not repeat the annotation;
  - that ids are unique, lowercase and letter-leading, and the demo is first;
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
- [ ] 2.10 E2E in `example-datasets.spec.ts`, using fixtures routed per task 4.9 (the (c) cases landed with §1, and the (a), (b1) and (b2) cases with §2; since 4.9 they run on fixtures by role; only the (d) case remains):
  - (c) from `?annotation=<a>&tooltip=<t>`, a menu choice gives `?dataset=<id>` and the control bar shows `defaultView`; Back restores `<a>` and `<t>`;
  - (c) `?dataset=<id>`, pick an annotation, Back → `defaultView`; explicit deep-link parameters beat the defaults;
  - (a) a fixture routed to 500 on Back keeps the plot, the URL and `history.length`, and Retry recovers after `unroute`;
  - (a) a deep link that fails at startup still falls back;
  - (b1) a gated fetch plus two `goBack()` calls keeps the second entry's `annotation`; Back during a pending menu load leaves the previous dataset with no `dataset=` pushed;
  - (b2) Back to an entry without `dataset=` while an example is pending shows the startup load, not the example;
  - (d) change a legend colour on `?dataset=demo`, reload, and the curated colour is back; the same steps on a user import keep the change.
- [ ] 2.11 File a separate issue for the pre-existing bug where a failed user import marks the healthy stored import as `error`, and add it to Project #2.

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
  - per id: `file`, `hosting`, `bytes`, `sha256`, `proteins`, `columns`, `projections`, `releases`, `protspaceVersion`, `gitSha?`, `command`, `builtAt` and `zenodoDoi`.
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
- [ ] 4.10 `example-datasets.test.ts`: replace "the file exists under `public/`" with "every catalog id has a manifest record" and "the only `.parquetbundle` under `public/` is the demo" (the latter enabled at 7.8; the former landed with 4.1, plus "every repo-hosted record's file ships under `public/`").
- [x] 4.11 Perf datasets:
  - `perf/datasets.manifest.json` (`{ id, file, bytes, sha256 }`) for the eleven current `public/data` bundles plus `beta_lactamase_2026_stats` (113K) and `phosphatase_eat` (832), under their original names;
  - `pnpm perf:fetch` (the same fetch script, perf mode; `--only` for a subset) into `perf/datasets/`.
  - Each record also carries `default` (the ten of the former `datasets.json`, the default sweep) and `source` (the git blob or manuscript path it was staged from). The `example-bundles.yml` workflow runs `pnpm perf:fetch` on PRs that change the list, so it stays red until the owner publishes the release (8.1).
- [x] 4.12 `perf/webgl-perf.spec.ts` routes `**/data/<id>.parquetbundle` and `**/data/datasets.json` to `perf/datasets/`; a missing file is recorded as a dataset error naming `pnpm perf:fetch`.
  - Remove the fallback list in `apps/web/src/perf/webgl-perf-suite.ts`.
  - Update `perf/README.md` and `perf/plot_perf_results.py` (the plotter needed no change: the release keeps the original ids its ordering list names).
  - A missing or malformed `datasets.json` is recorded under `failures` (the results file is still emitted), and a failed dataset fetch carries the response body (the spec's `pnpm perf:fetch` hint) into its error.
  - Point `load-large-bundle.spec.ts` and its `playwright.config.ts` comment at `perf/datasets/573K_swissprot.parquetbundle`.
- [x] 4.13 A staging script (`build_showcase.py stage-perf`, task 6.6) collects the `perf-datasets` assets from git blobs and the NM paths into a local directory with `SHA256SUMS`, and prints the owner's `gh release create` command without running it (only the `stage-perf` subcommand exists so far; §6 adds the others).
- [x] 4.14 `CONTRIBUTING.md`: fixtures vs examples, `pnpm examples:fetch`, `pnpm perf:fetch`, and stopping a running dev server before E2E so the startup pin applies.

## 5. Docs tooling and prose

- [ ] 5.1 `docs/scripts/example-details.ts` holds docs-only prose for the six final ids: title, tagline, what the default view shows, what to try next, source and query, membership release, embedding, projection parameters, paper figure, notes and thumbnail path. Use journal-neutral citation text (preprint DOI `10.64898/2026.05.04.722720` plus the FAQ citation anchor) and credit UniProt under CC BY 4.0.
- [ ] 5.2 `docs/scripts/generate-examples.mts` writes `docs/explore/example-datasets.md`:
  - `## Title {#id}` cards;
  - raw `<a href>` "Open in ProtSpace" and "Download (size)" links;
  - a `::: details How this bundle was built` block with the manifest command;
  - release per column group;
  - an intro stating that examples reopen curated, how to keep changes, and the imported-copy storage edge case.
  - `--check` fails on a stale page, a catalog/details id mismatch, a missing named thumbnail, or a demo/manifest mismatch.
- [ ] 5.3 Scripts `docs:examples` and `docs:examples:check`. Add `docs:annotations:check` to the `ci.yml` `build-docs` job now; `docs:examples:check` joins it and `precommit` at the swap (7.10).
- [ ] 5.4 Opt-in `examples-live` Playwright project (`RUN_EXAMPLES_E2E=1`, after `pnpm examples:fetch`), with a `projects[]` entry: every catalog id opens on its `defaultView` with no URL write and no drift warning, and writes `docs/explore/images/examples/<id>.png`.
- [ ] 5.5 Sidebar entry "Example Datasets" after "Importing Data" in `docs/.vitepress/config.mts`; `/docs/explore/example-datasets` in `apps/web/public/sitemap.xml`.
- [ ] 5.6 `docs/explore/control-bar.md` §9 (the ⓘ, the Large badge, "About these examples" and Cancel landed with §3): shrink it to behaviour (menu vs link; the curated reset (c); failure keeps the plot plus Retry (a); the Large badge, progress and Cancel (e); the "About these examples" link), move the id table to the new page, and drop "every bundle that ships". Fix the stale demo alt text and the "NOT phospholipase A2" example (the lines at 137 and 192).
- [ ] 5.7 `docs/explore/importing-data.md` (the (d) exception, with the export-and-import route and the imported-copy edge case, and "Starting fresh" landed with §2):
  - the "Settings persist per dataset" bullet gains the example exception (d) with the export-and-import route;
  - "Starting fresh" for an example;
  - the demo name;
  - drop "eleven";
  - replace the Venom EAT sentence with a pointer to the new page.
- [ ] 5.8 `docs/explore/eat.md` "Trying It": `venom-eat` (threshold 0, strips visible, and "drag to 0.5 → 244 of 384"), the `?dataset=venom-eat` link, a link to its card, and a fix for "nearly half the dataset is a ring". Keep the venom numbers in `separation-scores.md` and `scatterplot.md`, since the frozen statistics part keeps them valid.
- [ ] 5.9 `docs/index.md` (drop "eleven", link the page), `docs/explore/index.md`, `docs/guide/index.md` (link `#swissprot`), `docs/guide/faq.md` (optional Swiss-Prot link), `docs/explore/images/README.md` (the venom fixture path).
- [ ] 5.10 Product tour step 2 (`product-tour.ts`) mentions **Examples** and uses the extensionless docs link; check `product-tour.spec.ts`.

## 6. Showcase build script (Python dev tooling, `chore:` commits)

- [ ] 6.1 `apps/protspace/scripts/generate_examples/build_showcase.py` plus `showcase.toml` hold per-dataset recipes (design Decision 9), with subcommands `build <id>`, `verify <id>`, `manifest`, `stage-release` and `stage-perf`. Every step runs through `uv run`.
- [ ] 6.2 Helpers:
  - `split_bundle`, `select_proj` (keep, rename `UMAP_2` → `ProtT5 — UMAP 2`, UMAP first), and `extract_ann` (part 0 only);
  - drop `sequence`/`organism_id`;
  - put the insight annotation first;
  - explicit `--stats-annotation` lists (G12);
  - envelope settings with the curated legend and the EAT threshold (venom 0, phosphatase 0.5).
- [ ] 6.3 EAT specifics:
  - venom: freeze coordinates, statistics, `ec`, `protein_families` and `*__pred_*`, and add InterPro, TED and Biocentral from full-length sequences;
  - phosphatase: re-encode the v1 columns before grafting (or rebuild and graft `eat_split` plus `*__pred_*`), add the withheld-truth columns, and **refuse** any step that refills `ec`/`protein_families` on the 213 query rows.
- [ ] 6.4 Provenance key/value metadata on the annotations table: `example_id`, `protspace_version`, `git_sha`, `uniprot_release` per column group, `membership_release`, `built_at`, `command` and `zenodo_doi`.
- [ ] 6.5 `verify <id>` gates:
  - the common gates and each dataset's story gates (design Decision 9);
  - the obsolete-accession count;
  - `defaultView` names present, read from the catalog;
  - the phosphatase accuracy against fetched truth (91.5 % over 213; 98.1 % over n = 160 at reliability ≥ 0.5);
  - the Swiss-Prot load time and heap (the D2 gate, measured in a real browser).
- [ ] 6.6 `stage-release` writes `<id>_<release>.parquetbundle` files plus `SHA256SUMS` into a staging directory, calls `write_manifest.py`, and prints the owner's `gh release create`/`upload` commands; `stage-perf` does the same for task 4.13.
- [ ] 6.7 `generate_toxprot_demo.py`:
  - all annotation columns, keeping the mature `length`;
  - InterPro and Biocentral run on **full-length** sequences (G8);
  - the default settings source becomes the demo fixture.
- [ ] 6.8 pytest for the pure helpers (projection rename and order, provenance metadata, the no-refill guard, gate predicates) under `apps/protspace/tests/`. Run `uv run pytest` and `uv run ruff check`.

## 7. Data build and catalog swap (after the CLI fixes merge)

- [ ] 7.1 Prerequisites:
  - `fix/annotation-retrieval` merged (InterPro fan-out plus retry, the family parser, Biocentral batching, the per-source cache and `annotate --cache-dir`, and the `run.log` release line);
  - PR #452 (the faithfulness ceiling) merged;
  - author facts collected: the venom 811 query and release; the Swiss-Prot and human + fly membership releases (2025_04 is inferred); how the 113,015 were selected.
- [ ] 7.2 Build `swissprot` first (the TED critical path, 18–40 h; run alone). Gates: N = 573,649, no `(TC n`/"In the … section", the Pfam empty rate on duplicate-sequence rows ≈ unique rows, domain counts within ±1 % of Fig. 2A. Then apply the **D2 gate** (≤ ~35 s, ≤ ~1.5 GB heap), or produce the GO/TED-free web copy.
- [ ] 7.3 Build `beta-lactamase`, then `human-fly`, staggered after Swiss-Prot's TED run:
  - `beta-lactamase`: Q02940 still class C; the Fig. 3 legend counts within 2 %; `xref_pdb` has both values;
  - `human-fly`: kinases about 1,700 and shared; MHC I/II, β-defensins and CC chemokines human-only; PBP/GOBP fly-only; species 83,598 / 21,964; the 146 vector-less rows annotated.
- [ ] 7.4 Build `venom-eat` (244 transfers at ≥ 0.5; P0DPU8 ← F5CPF0 at RI 0.583), `phosphatase-eat` (91.5 % / 98.1 % against fetched truth; no refilled query rows) and `demo` (7,831; coordinates unchanged; `pfam` coverage checked).
- [ ] 7.5 Final `defaultView` picks: score the candidates by the stated criterion (kNN label agreement, or the per-category silhouette of the story's categories); capture the `examples-live` thumbnails; **the author reviews them**; set each final pick in one catalog line. Where figure fidelity wins over the criterion, the card explains why.
- [ ] 7.6 `build_showcase.py stage-release` for `showcase-2026_03`, writing the manifest with `release: 'showcase-2026_03'` and `hosting: 'release'` for the five paper entries and `'repo'` for the demo. Record the release per column group.
- [ ] 7.7 Catalog swap:
  - replace the interim entries with `demo`, `venom-eat`, `phosphatase-eat`, `human-fly`, `beta-lactamase` and `swissprot` (`large`, with the memory and load time measured at the D2 gate);
  - final names, descriptions and insights (with the numbers from the built files);
  - relabel the demo "Venom toxins (demo)";
  - fix `docs/explore/eat.md`'s `?dataset=` link.
- [ ] 7.8 Remove `apps/web/public/data/` entirely (including `datasets.json`); this makes the four non-demo fixtures `git mv`s in the branch diff. Replace `apps/web/public/data.parquetbundle` with the new demo. Enable the "only the demo under `public/`" assertion.
- [ ] 7.9 Update `apps/web/tests/helpers/example-fixtures.ts` to the final ids, each routed to a fixture that contains its `defaultView` names.
- [ ] 7.10 Generate `docs/explore/example-datasets.md`; retarget `example-datasets-docs.test.ts` to it (`{#id}` for every catalog id); wire `docs:examples:check` into `ci.yml` `build-docs` and `precommit`; add the thumbnails.
- [ ] 7.11 Re-run `pnpm docs:images` against the new demo; check the PLD/Kunitz overlay coordinates and the demo-dependent alt texts.
- [ ] 7.12 Full verification:
  - `pnpm test:ci`, `pnpm format:check`, `pnpm precommit`;
  - `CI=1 pnpm test:e2e` (all default projects);
  - `pnpm examples:fetch && RUN_EXAMPLES_E2E=1 pnpm test:e2e --project=examples-live`;
  - `pnpm docs:examples:check`, `pnpm docs:annotations:check`, `pnpm docs:build`;
  - `pnpm perf:fetch && PERF_DATASETS=venom_eat_stats,573K_swissprot pnpm perf`;
  - `uv run pytest apps/protspace/tests`, `uv run ruff check`.
- [ ] 7.13 Reread `proposal.md`/`design.md` against the final diff and update them; update the `example-datasets` Purpose line to say "curated and documented"; `openspec validate curated-example-datasets --strict`; archive as the last commit before the merge.

## 8. Owner-only steps (prepared by scripts; not executed by this change)

- [ ] 8.1 Create the `perf-datasets` release and upload the staged assets plus `SHA256SUMS` (task 4.13); check `pnpm perf:fetch` against it.
- [ ] 8.2 Create the `showcase-2026_03` release and upload the staged assets (task 7.6); check `pnpm examples:fetch` and the CI manifest job.
- [ ] 8.3 Zenodo "paper companion" deposit: the frozen paper files (all eleven old bundles, the 113K, the 832) plus the new showcase files. Write its DOI into the manifest (`zenodoDoi`) and the docs.
- [ ] 8.4 Cloudflare cache rule for `/examples/*` (cache everything, long edge TTL, **and a Browser TTL**, since Pages sends `max-age=600`). Verify `cf-cache-status: HIT` on a second request, before the Swiss-Prot link is announced.
- [ ] 8.5 Staging GitHub Pages deploy with a file over 100 MB, before 7.2 finishes (G19). If it fails, fall back to Cloudflare R2 on `data.protspace.app` with CORS.
- [ ] 8.6 After deploying: `curl -sI https://protspace.app/examples/<file>` returns 200; time a Swiss-Prot load on the reference laptop and record its heap.
- [ ] 8.7 Add the PR (closing #443) and the issue from 2.11 to Project #2. Coordinate the stack with t03i (PR #494), and merge with a **merge commit**.

## 9. Manuscript follow-up (`protspace_publication`, separate repository; out of scope)

- [ ] 9.1 Sweep the roughly 38 lines coupled to the shipped bundles ("eleven datasets distributed with ProtSpace", `public/data`, "across all eleven shipped bundles") across the front matter, results, methods and extended data, and point them at the Zenodo and `perf-datasets` copies.
- [ ] 9.2 Add `https://protspace.app/explore?dataset=<id>` links per figure, and fill in the Zenodo DOI in the end matter.
- [ ] 9.3 Name `phosphatase-eat` (with its 91.5 % / 98.1 % gate) as the NM code checklist's "demo dataset with expected output".
- [ ] 9.4 Before submission, re-check the Swiss-Prot Pfam statistics that the InterPro duplicate-sequence bug affected (the multi-family share, and the Pfam cardinality in the size model).
