## Context

PR #494 (`feat/example-datasets`, unmerged) added the example catalog (`apps/web/src/explore/example-datasets.ts`), the Import-menu "Examples" section and the `?dataset=<id>` deep link (spec `openspec/specs/example-datasets/spec.md`). Its eleven entries are the startup demo plus ten bundles under `apps/web/public/data/`. Those bundles came from a perf-testing commit, and two of them are the manuscript's figure data in pre-v4 builds.

Five facts about the current code shape this design:

- **No curated view exists.** With no view parameters in the URL, `resolveExploreView` (`url-state.ts`) falls back to the bundle's first annotation column and first projection. A menu push copies the previous `annotation`, `projection` and `tooltip` parameters into the new entry, and they apply whenever the names also exist in the new bundle.
- **Example state is wiped on every load.** Every example load is `kind: 'default'`, which wipes that dataset's saved legend and tooltip state (`dataset-controller.ts`).
- **The bundle can only switch the EAT overlay off.** The overlay is on by default, and its reliability threshold defaults to 0 ("show all"). A settings envelope can switch the overlay off or set a threshold. A stored threshold reopens as a real "Hide below" filter, and while any filter is active the separation-score strips hide themselves.
- **Failures and races.**
  - A failed Back/Forward falls back to the stored import or the demo (`startup.ts`).
  - Back during a pending menu load does not cancel it.
  - An app-initiated restore can override a click made while it runs.
- **Tests and perf depend on the product files.**
  - Every bundle is a git blob, deployed with the app (`deploy.yml` uploads `apps/web/dist`), and Cloudflare does not cache `.parquetbundle` (`cf-cache-status: DYNAMIC`).
  - E2E specs, a core unit test and the docs captures read these bundles by path or URL.
  - The perf harness fetches `/data/<id>.parquetbundle`.

The research behind this change (catalog audit, data currency, the default-view mechanism, the open behaviour decisions, hosting, docs) was consolidated into a plan and an independent critique. The owner's final decisions (D1–D10) are applied below. Where the plan and a decision differ, the decision wins.

## Goals / Non-Goals

**Goals:**

- The Import menu lists the startup demo plus the manuscript's datasets, and nothing else.
- Every example opens on a curated projection, annotation and tooltip, and changing that choice is a one-line catalog edit that a test guards against drift.
- The data is current: the paper's membership and coordinates, annotations refreshed at UniProt 2026_03, all features.
- A generated, CI-checked docs page explains each dataset, and the app links to it.
- Behaviour decisions (a)–(e) are settled, specified and tested.
- The tests and the perf harness no longer depend on what the product ships.

**Non-Goals:**

- A full rebuild at 2026_03 (new membership and new UMAP: strategy C). Human + fly would grow to 169K proteins, most of them unreviewed; Swiss-Prot's UMAP needs a machine with 64 GB or more; and the layouts would stop matching the figures.
- A bundle-side `settings.defaultView` read by the app and written by `protspace style`. The web hook added here is shaped so it can plug in later, with the precedence URL > catalog > bundle > first column, in a separate change.
- A catalog dialog with search, a "From the paper" group, or story ordering. The spec's order rule (demo first, then ascending protein count) stays.
- Folding the request epoch into the load queue as origin-tagged reservations. That refactor changes no behaviour and is left for a later PR.
- The pre-existing bug where a failed user import marks the previous healthy stored import as `error`. It is filed as its own issue.
- Cloudflare R2 hosting. It is the fallback only if Pages limits bind.
- Manuscript text changes (separate repository; tasks §9).

## Decisions

### 1. Catalog: six entries, final ids (D3, D4)

| id                  | Menu name                    |       N | Paper                                   | Provisional `defaultView` (projection / annotation / tooltip)                      | Bundle settings                                                          |
| ------------------- | ---------------------------- | ------: | --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `demo`              | Venom toxins (demo)          |   7,831 | JMB 2025 lineage, not in the manuscript | `ProtT5 — UMAP 2` / `protein_families` / `species`, `ec`                           | Curated `protein_families` legend (top 13 + Other)                       |
| `venom-eat`         | Venom toxins · EAT           |     811 | Fig. 4 a, d, e, f                       | `ProtT5 — UMAP 2` / `ec` / `protein_families`, `species`                           | EAT threshold **0**; the four cluster legends plus a curated `ec` legend |
| `phosphatase-eat`   | Phosphatases · EAT benchmark |     832 | Abstract, Results                       | `ProtT5 — UMAP 2` / `ec` / `eat_split`, `ec_withheld`, `protein_families_withheld` | EAT threshold **0.5**                                                    |
| `human-fly`         | Human + fly proteomes        | 105,562 | Fig. 2B                                 | `ProtT5 — UMAP 2` / `species` / `protein_families`, `reviewed`                     | Fig. 2B species colours; named families pinned                           |
| `beta-lactamase`    | β-lactamases                 | 113,015 | Fig. 3                                  | `ProtT5 — UMAP 2` / `protein_families` / `ec`, `species`                           | Fig. 3 Kelly colours, class C painted on top                             |
| `swissprot` (Large) | Swiss-Prot                   | 573,649 | Fig. 2A, abstract                       | `ProtT5 — UMAP 2` / `domain` / `protein_families`, `species`                       | Fig. 2A domain colours                                                   |

- **Order.** The demo comes first, then the rest by ascending protein count, which puts `swissprot` last.
- **Ids.** They are lowercase and letter-leading, and they double as the `?dataset=` value and the docs anchor. PR #494's ids were never public, so there is no alias map.
- **Labels.**
  - Each label is derived: `<name> · <N> · <MB>`, from the entry's manifest record (Decision 11), so the count and size cannot drift from the file.
  - `sizeBytes` also comes from the manifest.
  - `docsUrl` is `/docs/explore/example-datasets#<id>`.
  - `insight` is the one-line "what to look at" shown in the info popover and as the first line of the docs card.
- **Projection names.** The paper's Swiss-Prot and human + fly bundles name the projection `UMAP_2`. The build renames it to `ProtT5 — UMAP 2`, so every example uses one naming convention.
- **Startup default (D3).** It stays the small ToxProt demo, re-annotated. At about 2.3–2.8 MB raw it allows roughly 40–65k first visits a month under the Pages soft bandwidth limit, and it is never a 10 MB+ paper dataset.
  - 790 of `venom-eat`'s 811 proteins are also in the demo. This is accepted: `venom-eat` exists to show EAT and the separation scores, the demo to show a fast, clustered first view.
- **Provisional defaults (D5).** The table's values are provisional, and the final picks are made after the data build (tasks §7).
  - Three of them currently have near-zero or negative whole-annotation silhouettes, which the `--stats` legend strips will display next to the default: Swiss-Prot `domain` −0.32, β-lactamase `protein_families` −0.45, human + fly `species` +0.03.
  - The final choice follows a stated criterion (kNN label agreement or the per-category silhouette of the categories the story names; alternatives are β-lactamase `ec` and human + fly `protein_families`) plus the author's review of the `examples-live` thumbnails. Where figure fidelity wins over the criterion, the card says why the view is informative anyway (for example, Archaea +0.24, class C +0.32).
- **EAT thresholds (D6).**
  - `venom-eat` opens at threshold 0, so both the transferred-value rings and the separation strips are visible. Its insight line says "drag reliability to 0.5 to keep 244 of 384".
  - `phosphatase-eat` opens at 0.5 (the abstract's 98.1 % story is about that threshold, so hiding the strips there is accepted). It carries withheld-truth columns, surfaced in the tooltip, so a reader can check each transfer in the app. The column names are provisional and fixed by the build.

### 2. Curated default view: resolved at view time, reset on a menu choice (D5, D7c)

`ExampleDataset` gains a **required** `defaultView: ExampleDefaultView` (`{ projection; annotation; tooltip? }`); being required makes curation a compile-time obligation. The mechanism touches only `apps/web/src/explore`:

1. `view-state.ts` adds `ExploreViewDefaults`.
2. `resolveExploreView(requested, annotations, projections, defaults = {})`:
   - A **landing request** (no `annotation`, `projection` or `tooltip` at all: a menu choice after the reset, a bare `?dataset=`, the startup demo, Back to a bare entry) resolves to the whole `defaultView`, tooltip included, and writes nothing to the URL.
   - Otherwise a valid requested value wins. A missing or invalid `annotation`/`projection` falls back to the default rather than to `[0]`, and an invalid value is normalized in the URL as today. An absent `tooltip` in a non-landing URL means the user cleared it, so the default tooltip is not applied.
   - A default name missing from the bundle falls back to `[0]` (tooltip names are dropped), with a development-mode `console.warn`.
   - With `defaults = {}` the behaviour is exactly today's, so user imports, OPFS restores and perf loads are unchanged.
3. `view-controller.ts` gains `setDatasetDefaults(defaults | null)`, used by both resolve calls. Resolving there (not injecting at load time) is what makes Back to a bare entry of the same dataset land on the curated view, because that path never reloads.
4. `dataset-controller.ts` `handleDataLoaded`, after the supersede checks and before `loadData`:
   - it calls `setDatasetDefaults(loadMeta.example?.entry.defaultView ?? null)` for every load;
   - for `source === 'menu'` it also calls `recordRequestedView(createEmptyExploreViewRequest())`.
   - A failed menu load never reaches this point, so the old request, plot and URL survive.
5. `getDatasetSearchParamsUpdate(…, 'menu')` sets `dataset=<id>` and deletes `annotation`, `projection` and `tooltip`, keeping unrelated parameters. The previous entry keeps its own, so Back restores them.

**Bundle side (belt and braces).** The build puts the insight annotation first and UMAP first, and embeds the curated legend, so a downloaded example opens sensibly elsewhere too.

**Drift guard.** A unit test asserts, for every entry, that the `defaultView` annotation and tooltip names are in its manifest record's `columns`, and the projection in its `projections`. It also asserts that the annotation is colourable (not tooltip-only, not an EAT `__pred_*` companion) and that the tooltip has no duplicates and does not repeat the annotation. It runs in CI without downloading anything.

Rejected:

- Option (b), bundle `settings.defaultView`, as the primary mechanism. A change would need a bundle regeneration, and names would be hidden in binary.
- Option (c), bundle column order alone. It cannot express a tooltip and still needs the menu reset.

### 3. (a) A failed Back/Forward keeps the current plot (D7a)

- **Outcome of the load.**
  - `loadRequestedDatasetOrFallback(controller, id, { keepCurrentOnFailure })` returns its outcome, and `runtime.ts` passes `keepCurrentOnFailure: datasetController.hasDisplayedDataset()` (true once a load has succeeded).
  - When something is displayed, a `'failed'` load runs no fallback and does not touch the URL. The history entry keeps naming the failed example, so Retry and a reload can re-attempt it.
  - Rewriting the URL was rejected: an asynchronous replace after a failure can overwrite a different entry if the user pressed Back again meanwhile, and it destroys the entry Retry needs.
- **The notification.**
  - `NotifyAction` becomes `{ label, href } | { label, onClick }`, and `NotifyOptions` gains `secondaryAction` (mapped to sonner's `action`/`cancel`).
  - A fetch failure's toast offers **Retry** (primary) and **Report** (secondary).
  - A parse failure (a corrupt bundle) keeps Report only.
- **The view request after a failure (G11).** The view controller's recorded request still holds the failed entry's parameters. After the failure it is re-recorded from the **displayed** view, so a later file import or view change does not inherit them.
  - Retry after a failed Back/Forward re-reads the parameters of the entry the URL still names, records them, and calls `setRequestedDataset(entry.id)`, which now returns `Promise<void>`. Retry after a failed menu choice repeats that menu choice.
  - Retry for a URL-driven load goes through the URL sync hook (`subscribeToExampleRetries`), since only the hook knows the entry. When the URL no longer names the example (a failed startup deep link has fallen back and removed the parameter, or the user has moved on), Retry pushes a new entry naming it, which loads it like a link: on its curated view, leaving the stored import alone.
  - Using any toast action forgets the toast's dedupe key, so a Retry that fails again is shown again.
- **Mismatch hardening.** The hook tracks the displayed dataset id. The next history entry the app writes for a user view change names the displayed dataset, so any link copied after further interaction is accurate.
- **When nothing is displayed** (a startup deep link), a failure falls back to the stored import or the demo and replace-removes the parameter, as today.

### 4. (b1) History steps during a pending switch (D7b1)

- **A pure decision function.** `decideUrlChange({ datasetParam, currentDatasetId, switchPending })` in `url-state.ts` returns `'switch-dataset' | 'record-view' | 'apply-view'`. It is pure because `apps/web` runs vitest in Node without React rendering, so the hook itself cannot be rendered in a test.
- **The switch token.** The hook keeps a token for the in-flight URL-driven switch, settled by `setRequestedDataset`'s promise. While it is pending, a view-only change is recorded, and that load's `applyLatestViewForDatasetLoad` applies it. It is not resolved against the dataset still on screen.
- **Sibling race.**
  - A POP navigation (`useNavigationType() === 'POP'`) while a **menu** load is pending cancels that load through `cancelPendingExampleLoad()`, which supersedes the request, aborts the fetch and hides the overlay.
  - Without this, the menu load finishes and pushes over the entry the user went back to.
  - The same primitive serves the Cancel button (Decision 7).

### 5. (b2) User requests win: a request epoch (D7b2)

- **The epoch.** `persisted-dataset.ts` replaces the example request counter with a request epoch.
  - User-initiated requests call `beginUserRequest()` and take a new epoch: a menu choice, Back/Forward (including to an entry without `dataset=`), a file import, a recovery-banner button, Retry and Cancel.
  - App-initiated flows capture the epoch current when they began, and check `isCurrentRequest(epoch)` before each step that would start a load: the startup OPFS restore, the startup demo, the corrupt-store recovery load, and the deep-link fallback.
  - Taking a new epoch also aborts the download of the example load it supersedes (one `AbortController` per download), so a superseded download stops using bandwidth. An aborted download settles as `'superseded'`, silently.
- **The `preempted` outcome.** `PersistedLoadOutcome` gains `{ kind: 'preempted' }`, which shows no recovery banner. A corrupt restore preempted by a click only clears the store.
- The loader's `'loaded' | 'failed' | 'superseded'` outcome and the `requestId` checks in `handleDataLoaded`/`handleDataError` keep their meaning.
- The queue's `reserveSequence`/`isLatestSequence` encodes "newest wins", not "user wins", so it is not the fix.

### 6. (d) Examples always reopen curated, and say so (D7d)

- **Keep the reset.** Every example load discards that dataset's saved legend and tooltip state and applies the bundle's settings. This makes "every open shows the curated view" deterministic, and the sender of a link sees what recipients see.
- **Make it visible** in four places:
  - a muted hint under the Import menu's "Examples" heading;
  - the docs page intro;
  - `importing-data.md` (whose "settings persist per dataset" bullet currently says the opposite);
  - the spec.
- **How to keep changes:** export the example with its settings and import the copy.
- **Edge case (documented, not changed).** An imported byte-identical copy of an example shares the example's content-derived storage key. Opening the example therefore discards the copy's saved state.

### 7. (e) Download progress and Cancel (D7e)

- **Progress.**
  - `loadExampleDataset` streams `response.body`, and the overlay shows received ÷ `entry.sizeBytes`, capped at 100 %, plus "12.3 / 44.9 MB".
  - `Content-Length` is **not** used: Pages serves gzip, so it is the compressed size (36.8 MB for a 44.9 MB file), while the stream yields decoded bytes.
  - The `File` is built from a `Blob` of the chunks, which also drops the extra `arrayBuffer` copy.
  - The overlay ranges are re-mapped so the download gets a real share of the bar: it fills the first 40 %, and for an example load the decode and render phases' own 0–100 scale is mapped onto the remaining 60 % (`progressAfterExampleDownload`, `loading-overlay.ts`), so the bar never runs backwards. User imports and OPFS restores keep today's scale.
  - The overlay is updated only when the "x / y MB" text changes (every 0.1 MB), not on every chunk.
- **Cancel.**
  - During the download, the overlay offers "Cancel download" (`setCancelHandler`), backed by an `AbortController`. Cancel is a user request: it takes a new epoch and calls `cancelPendingExampleLoad()`.
  - It is offered for menu, URL and Retry downloads, not for `'startup'` ones (the startup demo, or the demo a recovery button loads): those are what a cancel on an empty screen would fall back to.
  - When a dataset is displayed, Cancel leaves it and the URL unchanged and shows no toast. `registerFileLoad` is never called. After a cancelled Back/Forward the entry still names the example, so, as after a failed one (G11), the recorded view is re-recorded from the screen.
  - The handler is cleared when decoding starts, because the data loader offers no way to abort a decode (it runs in a worker, or on the main thread as a fallback, and takes no signal).
  - The overlay has one Cancel slot, which the FASTA upload also uses. `beginUserRequest` withdraws an example's button synchronously, so a newer request's own button is never cleared by a superseded download settling later.
  - `persisted-dataset.ts` only aborts. What follows is `handleCancelledExampleLoad` (`startup.ts`), reached through `onExampleLoadCancelled` (`runtime.ts`), because only that module runs the full startup flow with its recovery banner.
  - **Nothing displayed yet** (a startup `?dataset=swissprot` link): D7e's "no fallback" would leave an empty page. Consistent with Decision 3, Cancel there runs the normal startup load under the cancel's epoch and replace-removes the parameter, without a toast. This extends D7e to a case it does not name, and is flagged for confirmation.
- **Large.** A catalog entry's `large: { memory, loadTime }` becomes the summary's `large: true`, which renders a "Large" badge, and `toExampleDatasetSummary` (`example-datasets.ts`) appends "Large: a ‹size› download that needs ‹memory› of browser memory and takes ‹loadTime› to load." to the popover's description. For `swissprot` that is about 1 GB and 15–35 s, confirmed by the D2 gate measurement (task 7.2).

### 8. Import menu UI (`@protspace/core`, catalog-agnostic)

- **Data passed in.**
  - `ExampleDatasetSummary` becomes `{ id, label, description, insight?, docsUrl?, large? }`. All new fields are optional, so the change is additive.
  - The host sets a new `examplesDocsUrl` property (`examples-docs-url`) to `/docs/explore/example-datasets`.
- **What the menu renders.**
  - The "Examples" heading row gains "About these examples ↗" and the hint line.
  - Each item becomes a row: the button plus a `protspace-info-popover` (description, insight, "Learn more ↗" to `docsUrl`), following the `annotation-select.ts` pattern, since an interactive popover must not sit inside the `<button>`. The popover gains an optional `detail` property, a second paragraph that also describes its trigger, which carries the insight.
  - The popover uses side placement, so it floats beside the menu instead of being clipped by the menu's scroll container.
  - The native `title=` is dropped, because it duplicates the popover.
  - The same info control appears next to the current-dataset name when an example is loaded.
  - Opening the popover never dispatches `load-example-dataset`.

### 9. Data strategy R (D1, D2)

The paper's protein set and published coordinates are kept, and every annotation source is re-fetched at UniProt 2026_03 with the fixed CLI:

- the InterPro duplicate-sequence fan-out;
- the family parser's `(TC …)` and "In the … section" cases;
- Biocentral batching;
- a per-source cache;
- a release line in `run.log`;
- PR #452's faithfulness ceiling, which is a hard prerequisite, since without it every set over 20K proteins gets no faithfulness score.

Statistics and clusters are recomputed on the paper coordinates with **explicit** `--stats-annotation` lists, because `auto` would also score EAT companions.

Per-dataset recipes and gates live in the build script (tasks §6 and §7):

- **`swissprot`: UMAP only, all features.**
  - It ships only if it loads in ≤ ~35 s with ≤ ~1.5 GB of heap on the reference laptop. Otherwise the web copy drops the GO and TED columns, and the full-feature file stays on Zenodo.
  - Biocentral is added only after batching lands and with the Rostlab operators' agreement.
- **`human-fly`.** The 146 paper rows without a UniProt vector keep their paper position and are annotated from FASTA. PCA is kept.
- **`beta-lactamase`.** Coordinates come from the paper's `beta_lactamase_2026_stats` bundle; PCA is kept.
- **`venom-eat` (R-EAT).**
  - Frozen: the coordinates, the statistics part, and `ec`, `protein_families` and `*__pred_*`, so the Fig. 4 values reproduce.
  - `sequence` and `organism_id` are dropped.
  - InterPro, TED and Biocentral are added from full-length sequences.
- **`phosphatase-eat` (R-EAT).** The graft path follows the bundle's format version:
  - Re-encode the v1 fixture's columns first (it has no format stamp, and `protspace bundle` stamps v2 on the whole table), or rebuild it at release `2026_03` and graft only the `eat_split` column and the EAT prediction columns (`*__pred_*`).
  - **No step may refill `ec` or `protein_families` for the 213 query rows.**
  - Add the withheld truth as separate columns.
  - The gate recomputes accuracy against the fetched truth: k = 1 exact EC 91.5 % over 213, and 98.1 % over the 160 transfers with reliability ≥ 0.5.
- **`demo`.** It keeps its four projections, so the docs captures' layout stays valid, and gains every annotation column. Sequence-based sources (InterPro, Biocentral) must see **full-length** sequences: the demo is embedded on mature peptides, and local FASTA overrides UniProt sequences in `_build_sequence_map`, which today leaves 73 % of `pfam` empty.

**Provenance travels with the file (G15).** Each bundle gets key/value metadata on its annotations table:

- `example_id`;
- `protspace_version` plus the git SHA when that is a dev version;
- `uniprot_release` **per column group** (the EAT examples mix paper-era and 2026_03 columns: G10);
- `membership_release`;
- `built_at`;
- `command`;
- `zenodo_doi`.

Readers ignore unknown keys. The same fields go into the manifest.

**Gates common to every bundle:**

- the protein count;
- no `sequence`/`organism_id`, no legacy length bins, no "In the … section" or `(TC n` values;
- `xref_pdb` has both values, and `reviewed` is plausible;
- the v2 stamp, and settings that parse as an envelope;
- the `defaultView` names are present;
- the obsolete-accession count (rows left with an empty `protein_name`/`reviewed`), which is stated on the card.

**Story gates:**

- the kinases, MHC, β-defensins and CC chemokines, and PBP/GOBP for `human-fly`;
- Q02940 still class C, and Fig. 3 counts within 2 %, for `beta-lactamase`;
- 244 transfers at ≥ 0.5 and P0DPU8 ← F5CPF0 for `venom-eat`;
- 91.5 % / 98.1 % for `phosphatase-eat`;
- Fig. 2A domain counts within 1 % for `swissprot`.

If a story gate fails, that dataset ships frozen (strategy F) and is labelled so.

### 10. Hosting: release assets, deployed same-origin, verified (D8)

- **Why same-origin from a release.** Browser `fetch()` from GitHub release URLs fails CORS. jsDelivr caps files at 20 MB. Zenodo is slow and gives each version a new URL. Git would add about 70 MB of history per regeneration, and a full-feature Swiss-Prot could exceed GitHub's 100 MB per-file limit.
- **Publishing.** The showcase files are published as assets of a versioned release `showcase-<uniprot release>` (for example `showcase-2026_03`), with versioned file names (`swissprot_2026_03.parquetbundle`), byte-identical to the Zenodo "paper companion" deposit.
- **Deploying.** After `pnpm build`, `deploy.yml` runs `pnpm examples:fetch --out apps/web/dist/examples --with-retained`:
  - it downloads every release-hosted file in the manifest from `https://github.com/tsenoner/protspace/releases/download/<release>/<file>`;
  - it checks the byte count and sha256, and **fails the deploy** on a mismatch or a missing asset;
  - it also checks the in-repo demo against its record.
  - Editing the manifest touches `apps/web/`, so it triggers a deploy.
- **Checking a pull request.** A PR that changes the manifest (or the fetch script or the writer) runs the `example-bundles.yml` workflow: the same fetch into a scratch directory, then `write_manifest.py --refresh --check` against the fetched files, so the committed columns, projections and counts are proven to be the files'. It is a workflow of its own because a path filter scopes a whole workflow, not a job in `ci.yml`.
- **Retention (G14).** The manifest lists the previous release's files under `retained`, and the deploy keeps serving them for one cycle. Open tabs still running the old catalog, and docs or Zenodo links to old file names, keep working. The build script drops the entry at the next regeneration.
- **Local development.**
  - `pnpm examples:fetch` downloads into the gitignored `apps/web/public/examples/`.
  - In a development build (`import.meta.env.DEV`), when the same-origin file is missing (a non-OK response, or an HTML fallback), the loader retries from `https://protspace.app/examples/<file>`. protspace.app sends `access-control-allow-origin: *`.
  - Production builds never leave the origin.
- **Caching.** A Cloudflare cache rule for `/examples/*` sets a long edge TTL **and** a Browser TTL, since Pages sends `max-age=600`. Files are immutable by name, so they need no purge. The rule is an owner step (tasks §8), required before the Swiss-Prot link is announced.
- **The demo** stays in git at `apps/web/public/data.parquetbundle`, so the app and dev need no fetch for startup.

### 11. The manifest is a generated TypeScript module

- **Why TypeScript.** `apps/web/tsconfig.app.json` does not set `resolveJsonModule`, and no app code imports JSON, so the manifest is `apps/web/src/explore/example-manifest.ts`. It is loadable from the app, from vitest, and from tsx docs and fetch scripts.
- **Who writes it.** `apps/protspace/scripts/generate_examples/write_manifest.py`, using pyarrow, reads each bundle, so `columns` and `projections` are the file's real names, not a hand-typed list. Provenance comes from the key/value metadata the build writes on the annotations table (Decision 9; a file without it records `null`), and a file stamped with another `example_id` is refused.
- **Shape of the module.** The data is a JSON object literal assigned to `export const EXAMPLE_MANIFEST: ExampleManifest`, and the file is in `.prettierignore`, so the writer can read the previous manifest back (for `--retain-previous` and `--refresh`) and `--check` can compare it byte for byte. It is typed with an annotation rather than `as const`, because a literal type such as `hosting: 'repo'` makes consumers' `=== 'release'` checks fail to compile while the interim manifest has no release-hosted entry.
- **Top level:** `release` (the tag, or `null` while every entry is repo-hosted) and `retained[]` (`{ release, file, bytes, sha256 }`).
- **Per id:**
  - `file`;
  - `hosting` (`'repo' | 'release'`);
  - `bytes` (decoded) and `sha256`;
  - `proteins`, `columns[]` and `projections[]`;
  - `statistics` (whether the file carries a statistics part, so the docs page can say it has separation scores);
  - `releases` (membership, plus annotations per column group);
  - `protspaceVersion`, `gitSha?`, `command` and `builtAt`;
  - `zenodoDoi`.
- **Catalog fields derived from it.** `url` is `./<file>` for repo-hosted entries and `./examples/<file>` for release-hosted ones; the label numbers and `sizeBytes` come from the same record.
- **knip** runs with `ignoreExportsUsedInFile: false` and `treatConfigHintsAsErrors: true`. The generated module therefore exports only the manifest constant; its types stay unexported.
- **tsx.** `example-datasets.ts` must stay loadable by tsx, so any `import.meta.env` read is optional-chained (`import.meta.env?.…`), because Node has no `import.meta.env`.

### 12. Tests stop depending on the catalog (D9)

- **Fixtures.** The five bundles tests rely on become fixtures under `apps/web/tests/fixtures/` with descriptive names:

  | Old path                             | Fixture                             |
  | ------------------------------------ | ----------------------------------- |
  | `apps/web/public/data.parquetbundle` | `demo_toxprot_7831.parquetbundle`   |
  | `data/5K.parquetbundle`              | `toxprot_5181_pca3d.parquetbundle`  |
  | `data/40K.parquetbundle`             | `pe1_40026_pca3d.parquetbundle`     |
  | `data/phosphatase.parquetbundle`     | `phosphatase_1587.parquetbundle`    |
  | `data/venom_eat_stats.parquetbundle` | `venom_eat_stats_811.parquetbundle` |
  - The same blobs are reused, so history does not grow.
  - The 5K and 40K fixtures are the only 3D (`PCA_3`) bundles and are kept for that reason.
  - Path users are repointed through `apps/web/tests/helpers/fixtures.ts`. `dataset-recovery.spec.ts` stops fetching the served `/data/5K.parquetbundle` and passes fixture bytes into `page.evaluate`.

- **Startup pin (G4).**
  - `playwright.config.ts` sets `webServer.env.VITE_STARTUP_DATASET_URL` to the demo fixture, served by Vite's dev-only `/@fs/<absolute path>` route (inside the default `server.fs.allow` workspace root).
  - The catalog's demo `url` is `import.meta.env?.VITE_STARTUP_DATASET_URL || './data.parquetbundle'`.
  - This replaces an auto-fixture that would have meant rewriting all 18 spec imports.
  - The few hard-coded `'**/data.parquetbundle'` aborts and fetches (`numeric-binning.spec.ts` ×5, `eat-visualization.spec.ts`, `url-view-state.spec.ts`) switch to a `STARTUP_URL_GLOB` helper. If they did not, they would silently stop matching and the tests would turn flaky instead of failing.
  - The docs-capture projects in the root config are deliberately **not** pinned, because they photograph the product demo.
  - A guard scenario asserts that the startup load requested the fixture URL and nothing else, so a dev server reused without the variable fails with that cause named rather than as scattered count mismatches.
  - Fallback if `/@fs/` proves brittle: copy the fixture into a gitignored `apps/web/public/__e2e__/` in global setup.
- **Catalog routing (G3).**
  - `apps/web/tests/helpers/example-fixtures.ts` maps each catalog id the suite loads to a fixture that contains that entry's `defaultView` names (`demo` → the demo fixture, `venom-eat` → the venom fixture, `phosphatase-eat` → `phosphatase_eat`), and the spec routes the entry's URL to it.
  - The spec names examples by the role they play (`small`, `other`, `slow`), so a catalog change edits the helper's table and not the scenarios; the annotation names a scenario picks belong to its role's fixture.
  - A held request passes on with `route.fallback()`, so it reaches the fixture route rather than the network, and protspace.app's copies are refused, so a development build's fallback can never download a real example.
  - The spec asserts that no default-view drift warning is logged.
  - The history and race tests use explicit `annotation=`/`projection=` parameters, so any fixture serves them.
  - The large entry's Cancel test gates the fetch and never completes it, so its content does not matter.
- **Unit tests.**
  - "The file exists under `public/`" becomes "every catalog id has a manifest record, and the only bundle under `public/` is the demo".
  - `bundle-roundtrip.test.ts` reads the 5K fixture.

### 13. Perf datasets move to a `perf-datasets` release (D8, W4/G18)

- **Contents.** The release keeps **all** eleven current `apps/web/public/data/` bundles plus the manuscript's 113K β-lactamase (`beta_lactamase_2026_stats.parquetbundle`, named after its directory, because its own file name is `data.parquetbundle`) and the 832-protein `phosphatase_eat.parquetbundle`. The files keep their original names, so `PERF_DATASETS=venom_eat_stats,…,573K_swissprot` and the manuscript's perf protocol keep working.
- **Integrity.** `perf/datasets.manifest.json` (`{ id, file, bytes, sha256, default, source }`) is the committed checksum list, written by `build_showcase.py stage-perf` from pinned git blobs and the manuscript path. It replaces `apps/web/public/data/datasets.json`: `default` marks the ten of the former default sweep, and `source` says where the bytes were staged from. The `example-bundles.yml` workflow runs `pnpm perf:fetch` on a PR that changes it.
- **Local copy.** `pnpm perf:fetch` downloads into the gitignored `perf/datasets/` and verifies the checksums.
- **Serving.** `perf/webgl-perf.spec.ts` routes `**/data/<id>.parquetbundle` and `**/data/datasets.json` to those local files. The in-app fallback list in `webgl-perf-suite.ts` is removed, because the routed list is authoritative; a missing list is recorded under `failures` and the results file is still emitted. A missing file is recorded as that dataset's error, naming `pnpm perf:fetch` (the suite carries the 404 body into the error).
- `load-large-bundle.spec.ts` reads `perf/datasets/573K_swissprot.parquetbundle`, so it can run again (still opt-in).

### 14. Docs page generated from catalog + manifest + prose (D10)

- **Generator.** `docs/scripts/generate-examples.mts` (tsx) reads the catalog, the manifest and a docs-only `docs/scripts/example-details.ts` (title, tagline, what to look at, try next, source and query, embedding, projection parameters, figure, notes, thumbnail). It writes `docs/explore/example-datasets.md`.
- **`--check`** fails when:
  - the page is stale;
  - a catalog id has no details, or details exist for an id outside the catalog;
  - a thumbnail named in the details is missing;
  - the demo file disagrees with its manifest record.
- **Scripts and CI.** `docs:examples` and `docs:examples:check` join `precommit`, and the `ci.yml` `build-docs` job runs both `docs:examples:check` and the existing `docs:annotations:check`, which runs in no workflow today.
- **Page layout.**
  - Cards use `## Title {#id}`.
  - "Open in ProtSpace" and "Download" are raw `<a href>`, because markdown links to `/explore?…` or to a bundle fail `docs:build`.
  - A `::: details How this bundle was built` block holds the exact command.
  - Citation text is journal-neutral: the 2026 preprint DOI `10.64898/2026.05.04.722720` and the FAQ citation anchor. UniProt is credited under CC BY 4.0.
- **Anchor pin.** VitePress never checks anchors, so `example-datasets-docs.test.ts` is retargeted from `control-bar.md`'s table to this page and asserts `{#<id>}` for every catalog id.
- **Thumbnails.** An opt-in `examples-live` Playwright project (`RUN_EXAMPLES_E2E=1`, after `pnpm examples:fetch`) opens each `?dataset=<id>`, asserts the curated view with no URL write and no drift warning, and captures the thumbnail.

### 15. Sequencing: machinery first, catalog swap last

- **Tasks §1–§6** land on this branch while the CLI fixes proceed elsewhere. They run against the **interim** catalog (today's eleven entries, repo-hosted), each given a provisional `defaultView` naming columns and projections that its current file really has. An interim manifest written from those files keeps the drift test meaningful.
- **Fixture copies.** §4 adds the fixtures as byte-identical copies (same blobs) and repoints every test. §7 deletes the `apps/web/public/data/` originals, so for the four non-demo fixtures the branch diff is a plain `git mv` (D9). The demo fixture is a copy, because the product demo keeps its path with new content.
- **Docs.** §5 lands the generator, the prose for the final six ids and the CI wiring of `docs:annotations:check`. The generated page, the retargeted pin test and the `docs:examples:check` wiring land at the swap (§7), because the catalog↔details check can only pass against the final catalog.
- **The swap (§7)** replaces the catalog and the manifest, deletes the old bundles, updates the E2E routing table's ids, and regenerates the docs page, thumbnails and the demo's docs images.
- **Commits.** Every commit keeps `pnpm test:ci`, `pnpm format:check`, `pnpm precommit` and the E2E suite green.

## Risks / Trade-offs

- **Swiss-Prot size and memory** (77–112 MB, over 1 GB of heap). Mitigations:
  - the D2 gate and its GO/TED web-cut fallback;
  - streamed progress and Cancel;
  - the Large badge and the stated memory.
- **A file over 100 MB on Pages is untested** (the largest served today is 44.9 MB). A staging deploy test is an owner step (§8). The fallback is R2 on `data.protspace.app` with CORS.
- **Bandwidth.** Pages allows 100 GB/month and bundles are uncached today, so the cache rule must be live before the Swiss-Prot link is announced.
- **Refreshed annotations could weaken a figure's story.** The story gates catch it, and the dataset then ships frozen with an honest label.
- **Mixed releases inside a bundle** (the EAT examples). The manifest and the cards record the release per column group; "annotations UniProt 2026_03" is never claimed for a whole EAT bundle.
- **The defaults do not cluster by silhouette** (Decision 1). The criterion, the author review and the card text address it. It is a presentation choice, not a code risk, because a change is one line.
- **The deploy depends on GitHub release downloads.** A release outage fails the deploy loudly, which is intended, and never ships a site with missing examples.
- **A reused dev server loses the E2E startup pin.** Locally, `reuseExistingServer` can attach to a dev server started without `VITE_STARTUP_DATASET_URL`. Specs that assert the demo count then fail loudly rather than flake. CI never reuses a server, and CONTRIBUTING says to stop a running dev server first.
- **The manuscript is coupled to the frozen files.** Its perf numbers, bundle sizes, Extended Data Table 2 and Fig. 4 stay tied to the frozen files through the `perf-datasets` release and Zenodo. About 38 manuscript lines need a sweep (§9, separate repository).
- **Multi-day external fetches** (TED at Swiss-Prot scale takes 18–40 h). The fixed CLI's per-source cache makes runs resumable. Large builds are staggered to avoid 429s. Whether TED's bulk downloads can seed the cache is still open.

## Migration Plan

1. Merge order: PR #494, then this change stacked on it, merged with a **merge commit** (never squash; stacked-PR rule). The owner steps (§8) must complete **before** the merge. Otherwise the deploy's sha256 step, and the PR check on the manifest, fail by design.
2. First deploy after the merge: `/examples/*` appears and `/data/*.parquetbundle` disappears. No known link uses the old paths: none from the manuscript, and none from the docs.
3. Rollback: revert the merge commit. The old bundles come back from history, and the release assets can stay where they are.

## Open Questions

- **Author facts** to collect before the data build:
  - the venom 811 query and release (Peyman);
  - the Swiss-Prot and human + fly membership releases, inferred as 2025_04;
  - how the 113,015 β-lactamases were selected from about 120K query hits.
- Whether Cancel on an empty screen (Decision 7) is confirmed, or D7e's literal "no fallback" is wanted even there.
- The final withheld-truth column names for `phosphatase-eat` (the build decides; the drift test pins them).
- Whether `?webglPerf=1` should be compiled out of production builds. Once `/data/*` is gone it only records dataset errors there.
