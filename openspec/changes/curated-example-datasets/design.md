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

A second round of research (2026-09-30: the manuscript's use of its EAT sets, EAT candidates, CLI transfer, the PCA policy, per-residue embeddings, the open issues and the catalog swap) ended in four more owner decisions, cited here as R2-D1 to R2-D4: the lineup (Decisions 1 and 17), fix everything and rebuild once on the released CLI (Decision 9), PCA in every example (Decision 16), and no Biocentral predictions for the three large sets (Decision 18).

## Goals / Non-Goals

**Goals:**

- The Import menu lists the startup demo, the manuscript's datasets and one curated EAT showcase, and nothing else.
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

### 1. Catalog: five entries, final ids (D3, D4, R2-D1)

| id                    | Menu name                       |       N | Paper                                   | `defaultView` (projection / annotation / tooltip)                                  | Bundle settings                                      |
| --------------------- | ------------------------------- | ------: | --------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `demo`                | Venom toxins (demo)             |   7,831 | JMB 2025 lineage, not in the manuscript | `ProtT5 — UMAP 2` / `protein_families` / `species`, `ec`                           | Curated `protein_families` legend (top 13 + Other)   |
| `three-finger-toxins` | Snake three-finger toxins (EAT) |  ≈1,089 | Not in the manuscript (Decision 17)     | `ProtT5 — UMAP 2` / `toxin_class` / `toxin_class_withheld`, `species`, `eat_split` | EAT threshold **0**; a curated `toxin_class` palette |
| `human-fly`           | Human + fly proteomes           | 105,562 | Fig. 2B                                 | `ProtT5 — UMAP 2` / `species` / `protein_families`, `reviewed`                     | Fig. 2B species colours; named families pinned       |
| `beta-lactamase`      | β-lactamases                    | 113,015 | Fig. 3                                  | `ProtT5 — UMAP 2` / `protein_families` / `ec`, `species`                           | Fig. 3 Kelly colours, class C painted on top         |
| `swissprot` (Large)   | Swiss-Prot                      | 573,649 | Fig. 2A, abstract                       | `ProtT5 — UMAP 2` / `domain` / `protein_families`, `species`                       | Fig. 2A domain colours                               |

- **Order.** The demo comes first, then the rest by ascending protein count, which puts `swissprot` last.
- **Ids.** They are lowercase and letter-leading, with words joined by single hyphens (so `3ftx-eat` would be refused), and they double as the `?dataset=` value and the docs anchor. PR #494's ids were never public, so there is no alias map. Neither were the first lineup's `venom-eat` and `phosphatase-eat`, so dropping them breaks no link.
- **Labels.**
  - Each label is derived: `<name> · <N> · <MB>`, from the entry's manifest record (Decision 11), so the count and size cannot drift from the file.
  - `sizeBytes` also comes from the manifest.
  - `docsUrl` is `/docs/explore/example-datasets#<id>`.
  - `insight` is the one-line "what to look at" shown in the info popover and as the first line of the docs card.
- **Projection names.** The paper's Swiss-Prot and human + fly bundles name the projection `UMAP_2`. The build renames it to `ProtT5 — UMAP 2`, so every example uses one naming convention.
- **Startup default (D3).** It stays the small ToxProt demo, re-annotated. At about 2.3–2.8 MB raw it allows roughly 40–65k first visits a month under the Pages soft bandwidth limit, and it is never a 10 MB+ paper dataset.
  - The demo holds 536 proteins of the three-finger toxin family, most of them also in `three-finger-toxins`. This is accepted: the demo shows a fast, clustered first view, the EAT example shows transfer and the separation scores.
- **Default views (D5).** The table's views are the owner's picks, made after the data build (task 7.5), all on the UMAP.
  - Three of them have near-zero or negative whole-annotation silhouettes, which the `--stats` legend strips display next to the default: on the refreshed data Swiss-Prot `domain` about −0.25, β-lactamase `protein_families` about −0.39, human + fly `species` about +0.04.
  - Figure fidelity wins over the criterion there, and each card says why the view is informative anyway.
- **EAT threshold (D6).** `three-finger-toxins` opens at threshold 0, so both the transferred-value rings and the separation strips are visible, and the docs say "drag reliability to 0.5". Its tooltip carries the withheld class, so a reader can check each held-out transfer in the app.
- **Values from the build.** The final entries are written before their bundles exist (Decision 15). A value only the built file can give, such as the three-finger toxins' hold-out accuracy or Swiss-Prot's memory and load time, is a `‹…›` placeholder, which `docs:examples:check` refuses after the swap.

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
5. `getDatasetSearchParamsUpdate(…, 'menu')` sets `dataset=<id>` and deletes `annotation`, `projection`, `tooltip` and `density`, keeping unrelated parameters. The previous entry keeps its own, so Back restores them. The pushed entry must name exactly the view the reset in step 4 resolves to: the URL sync applies it right after the load, so a `density=on` left in it would switch the contours that the reset turned Off straight back on. An example therefore opens with contours Off from the menu, as from its bare link; a unit test resolves the pushed entry and the reset request to the same view.

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
- **The commit point.** Once `handleDataLoaded` has checked that an example load is still current, it calls `commitExampleLoad`: from there the load clears the stored import and swaps the plot's data, so `cancelPendingExampleLoad` returns `'committed'` and leaves it to finish (a newer user request still supersedes it). Cancelling it there would leave its data on screen under the previous dataset's name and URL, with the stored import already deleted. The hook ignores the view of a view-only POP that meets a committed menu load: the example finishes on its curated view and pushes its own entry, and resolving the landed-on entry's view against the example's data could otherwise write that normalization over it. Reloading the entry's dataset instead was rejected: the stored import it showed is already gone.

### 5. (b2) User requests win: a request epoch (D7b2)

- **The epoch.** `persisted-dataset.ts` replaces the example request counter with a request epoch.
  - User-initiated requests call `beginUserRequest()` and take a new epoch: a menu choice, Back/Forward (including to an entry without `dataset=`), a file import, a recovery-banner button, Retry and Cancel.
  - App-initiated flows capture the epoch current when they began, and check `isCurrentRequest(epoch)` before each step that would start a load: the startup OPFS restore, the startup demo, the corrupt-store recovery load, and the deep-link fallback.
  - Taking a new epoch also aborts the download of the example load it supersedes (one `AbortController` per download), so a superseded download stops using bandwidth. An aborted download settles as `'superseded'`, silently.
- **The `preempted` outcome.** `PersistedLoadOutcome` gains `{ kind: 'preempted' }`, which shows no recovery banner. A corrupt restore preempted by a click only clears the store.
- **Loads already under way.** The epoch check also covers loads that have started:
  - The OPFS restore carries the epoch it began under, and a user import the one its request took (`runtime.ts` registers the load with it). `handleDataLoaded` skips a superseded one before rendering, after the import's save and after `loadData`: no render, no save, no emit, so it cannot replace-remove `dataset=` from the entry a Back/Forward went to. A superseded restore that decoded still marks its status `'success'`.
  - A startup flow that runs while a superseded restore is still in flight (a Back to an example that fails, before anything is on screen) waits for it before reading the stored status, which would still say `'pending'`, and then restores the import itself. The alternative, keeping the in-flight restore as "the plot on screen", would leave an empty page once the restore is skipped.
  - A restore preempted after it marked the load `'pending'` writes the previous status back (`restoreLastLoadStatus`), since nothing was attempted.
  - A FASTA preparation runs through `beginImportPreparation`: the next user request aborts it, like an example download, and the overlay's single Cancel slot is owned per request, so a newer request's button is never replaced or removed by the preparation. Without the abort, an example requested by Back/Forward would wait in the load queue behind a preparation of several minutes, whose result would then land and remove `dataset=`.
  - The toast of a failed download is deduped per request kind (`example-load-error:<source>:<id>`), so a menu failure cannot swallow a Back failure's toast and leave the menu's Retry in its place.
  - A Back to an entry without `dataset=` whose startup demo fails reports `'default-failed'`, so the displayed view is re-recorded as after any failed Back.
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

### 9. Data strategy R (D1, D2, R2-D2)

The paper's protein set and published coordinates are kept, and every annotation source is re-fetched at UniProt 2026_03 with the fixed CLI:

- the InterPro duplicate-sequence fan-out;
- the family parser's `(TC …)` and "In the … section" cases;
- Biocentral batching;
- a per-source cache;
- a release line in `run.log`;
- PR #452's faithfulness statistics, a hard prerequisite, since without them every set over 20K proteins gets no faithfulness score;
- `root` as the first lineage element rather than the deepest unranked clade, and TMbed's "no TM segment" rather than `none`, which the app reads as missing;
- a cache-semantics bump for those two columns, so a cache-assisted rebuild refetches them instead of reusing the wrong values.

**Rebuild once, then publish (R2-D2).** All of it lands in PR #495, released as protspace 4.15.0, and every example is rebuilt on that release before the first publish. A release file name can never carry different bytes, so fixing a published file would mean new names; one rebuild also replaces provenance no public commit could reproduce (a local CLI commit, a scratch path in the build command).

Statistics and clusters are recomputed on the paper coordinates with **explicit** `--stats-annotation` lists, because `auto` would also score EAT companions.

Per-dataset recipes and gates live in the build script (tasks §6 and §7):

- **`swissprot`: UMAP and the paper's PCA, all features.**
  - It ships only if it loads in ≤ ~35 s with ≤ ~1.5 GB of heap on the reference laptop, measured again on the rebuilt file with its PCA (Decision 16). Otherwise the web copy drops the GO and TED columns, and the full-feature file stays on Zenodo.
  - No Biocentral predictions (Decision 18).
- **`human-fly`.** The 146 paper rows without a UniProt vector keep their paper position and are annotated from FASTA. PCA is kept. No Biocentral predictions.
- **`beta-lactamase`.** Coordinates come from the paper's `beta_lactamase_2026_stats` bundle; PCA is kept. No Biocentral predictions.
- **`three-finger-toxins`** is built fresh, not from a paper bundle (Decision 17).
- **`demo`.** It keeps its four projections (both models' UMAP and PCA), so the docs captures' layout stays valid, and gains every annotation column. Sequence-based sources (InterPro, Biocentral) must see **full-length** sequences: the demo is embedded on mature peptides, and local FASTA overrides UniProt sequences in `_build_sequence_map`, which today leaves 73 % of `pfam` empty.

**Provenance travels with the file (G15).** Each bundle gets key/value metadata on its annotations table:

- `example_id`;
- `protspace_version` plus the git SHA when that is a dev version;
- `uniprot_release` **per column group** (a bundle can mix releases, as the demo's 2026_01 membership and 2026_03 annotations do: G10), as JSON `{group: {release, columns}}` with a null release for computed columns; `write_manifest.py` keeps each group's release, leaves out groups with none, and still reads the flat `{group: release}` form of older bundles;
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
- Fig. 2A domain counts within 1 % for `swissprot`;
- the gates of Decision 17 for `three-finger-toxins`;
- after the rebuild, every `root` value is a top-level taxonomy node (cellular organisms, Viruses, other entries or unclassified entries) and `predicted_transmembrane` holds no literal `none`, so a stale cache cannot pass.

If a story gate fails, that dataset ships frozen (strategy F) and is labelled so.

**What makes a build trustworthy:**

- **Complete sources.** The CLI exits 0 when a source was only partly fetched (a partial result beats none for its users) and says so only in warnings. A fetch step counts as done only when none of those warnings appeared; otherwise it runs again, which fetches just what the CLI left out of its cache, and then fails without a marker.
- **The release the data came from.** Provenance takes the release the CLI recorded for its data (`run.log`'s `uniprot_release:` line, the annotation cache's release stamp, UniProt's FASTA response headers). What UniProt serves at a probe only stops a fetch from starting on another release, so a finished build can still be finalized after a rollover.
- **Resumable, not stale.** Step markers are keyed on a digest of everything a step reads: the recipe keys it uses, style file contents, input file fingerprints, the CLI commit and its command.
- **Shipping.** The D2 measurement is recorded against the file's sha256, and the web-cut decision is kept for later builds. `stage-release` ships only files whose last `verify` passed (no failed or pending gate) on exactly their bytes, and writes the manifest through `write_manifest.py`, the one writer (Decision 11).

### 10. Hosting: release assets, deployed same-origin, verified (D8)

- **Why same-origin from a release.** Browser `fetch()` from GitHub release URLs fails CORS. jsDelivr caps files at 20 MB. Zenodo is slow and gives each version a new URL. Git would add about 70 MB of history per regeneration, and a full-feature Swiss-Prot could exceed GitHub's 100 MB per-file limit.
- **Publishing.** The showcase files are published as assets of a versioned release `showcase-<uniprot release>` (for example `showcase-2026_03`), with versioned file names (`swissprot_2026_03.parquetbundle`), byte-identical to the Zenodo "paper companion" deposit.
- **Deploying.** After `pnpm build`, `deploy.yml` runs `pnpm examples:fetch --out apps/web/dist/examples --with-retained`:
  - it downloads every release-hosted file in the manifest from `https://github.com/tsenoner/protspace/releases/download/<release>/<file>`;
  - it checks the byte count and sha256, and **fails the deploy** on a mismatch or a missing asset;
  - it also checks the in-repo demo against its record.
  - Editing the manifest touches `apps/web/`, so it triggers a deploy.
- **Checking a pull request.** A PR that changes the manifest (or the fetch script or the writer) runs the `example-bundles.yml` workflow: the same fetch into a scratch directory, then `write_manifest.py --refresh --check` against the fetched files, so the committed columns, projections and counts are proven to be the files'. It is a workflow of its own because a path filter scopes a whole workflow, not a job in `ci.yml`.
- **Retention (G14).** The manifest lists the previous release's files under `retained`, and the deploy keeps serving them for one cycle. Every file lands in one `examples/` directory, so a retained file may not share a name with a current file unless their bytes are identical (then it is simply dropped from `retained`): the writer refuses it, and the fetch fails before downloading, since otherwise a re-release under the same name could deploy stale bytes under the current name. Open tabs still running the old catalog, and docs or Zenodo links to old file names, keep working. The build script drops the entry at the next regeneration.
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
  - `zenodoDoi`: from the bundle when the build stamped one, else from `--zenodo-doi`, since the deposit is made after the build; later runs keep a recorded DOI while the file's sha256 is unchanged, so the CI `--refresh --check` passes without re-stamping (and re-releasing) the bundles.
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
  - `apps/web/tests/helpers/example-fixtures.ts` maps each catalog id the suite loads to a fixture that contains that entry's `defaultView` names, and the spec routes the entry's URL to it.
  - The spec names examples by the role they play (`small`, `other`, `slow`, `eat`), so a catalog change edits the helper's table and not the scenarios; the annotation names a scenario picks belong to its role's fixture. The roles map to settled final ids: `small` → `human-fly`, `other` → `beta-lactamase`, `slow` → `swissprot`, `eat` → `three-finger-toxins`.
  - The role fixtures (`example_role_*`) are derived from the pinned fixtures by a committed script, `apps/web/tests/fixtures/derive-example-role-fixtures.py` (uv, pyarrow pinned, `--check` for a stale file). Until the swap each role also stands for an interim example, so each fixture holds both examples' view names: the final projection name is a copy of an existing layout, and the added view columns are synthetic. The `eat` fixture relabels the venom fixture's transferred EC numbers as toxin classes, holds every eighth reference out, and stores a threshold of 0.5, so a scenario can tell the bundled threshold from the default.
  - A held request passes on with `route.fallback()`, so it reaches the fixture route rather than the network, and protspace.app's copies are refused, so a development build's fallback can never download a real example.
  - The spec asserts that no default-view drift warning is logged.
  - The history and race tests use explicit `annotation=`/`projection=` parameters, so any fixture serves them.
  - The large entry's Cancel test gates the fetch and never completes it, so its content does not matter.
- **Unit tests.**
  - "The file exists under `public/`" becomes "every catalog id has a manifest record, and the only bundle under `public/` is the demo".
  - `bundle-roundtrip.test.ts` reads the 5K fixture.
  - No unit test indexes the product catalog or depends on its size: the suites that exercise its consumers swap in a two-entry test catalog (`example-catalog.fixtures.ts`, through `vi.mock`), and their fetch mocks carry headers, since a development build checks a release-hosted example's content type.

### 13. Perf datasets move to a `perf-datasets` release (D8, W4/G18)

- **Contents.** The release keeps **all** eleven current `apps/web/public/data/` bundles plus the manuscript's 113K β-lactamase (`beta_lactamase_2026_stats.parquetbundle`, named after its directory, because its own file name is `data.parquetbundle`) and the 832-protein `phosphatase_eat.parquetbundle`. The files keep their original names, so `PERF_DATASETS=venom_eat_stats,…,573K_swissprot` and the manuscript's perf protocol keep working.
- **Integrity.** `perf/datasets.manifest.json` (`{ id, file, bytes, sha256, default, source }`) is the committed checksum list, written by `build_showcase.py stage-perf` from pinned git blobs and the manuscript path. It replaces `apps/web/public/data/datasets.json`: `default` marks the ten of the former default sweep, and `source` says where the bytes were staged from. The `example-bundles.yml` workflow runs `pnpm perf:fetch` on a PR that changes it.
- **Local copy.** `pnpm perf:fetch` downloads into the gitignored `perf/datasets/` and verifies the checksums.
- **Serving.** `perf/webgl-perf.spec.ts` routes `**/data/<id>.parquetbundle` and `**/data/datasets.json` to those local files. The in-app fallback list in `webgl-perf-suite.ts` is removed, because the routed list is authoritative; a missing list is recorded under `failures` and the results file is still emitted. A missing file is recorded as that dataset's error, naming `pnpm perf:fetch` (the suite carries the 404 body into the error).
- `load-large-bundle.spec.ts` reads `perf/datasets/573K_swissprot.parquetbundle`, so it can run again (still opt-in).

### 14. Docs page generated from catalog + manifest + prose (D10)

- **Generator.** `docs/scripts/generate-examples.mts` (tsx) reads the catalog, the manifest and a docs-only `docs/scripts/example-details.ts` (title, tagline, how to read the view, try next, source and query, embedding, projection parameters, paper figure, notes). It writes `docs/explore/example-datasets.md`, formatted with the repository's prettier settings so `format:check` never fights it.
- **Who owns which fact.** The catalog owns what the app shows (insight, `defaultView`, the large-download note); the manifest owns everything that depends on the build (protein count, size, columns and their sources, separation scores, EAT columns, releases per column group, ProtSpace version, command); the prose owns the rest. The card's "how to read the view" must name the entry's colour-by annotation as inline code, so a `defaultView` change cannot leave the prose describing another view. The thumbnail is `docs/explore/images/examples/<id>.png` by convention.
- **`--check`** fails when:
  - the page is stale;
  - a catalog id has no prose, or prose exists for an id outside the catalog;
  - a card's thumbnail is missing;
  - a repo-hosted file (the demo) disagrees with its manifest record;
  - a label's count or size disagrees with the manifest, or the prose does not name the colour-by annotation.
- **Interim state (until the swap).** The page, the check and the anchor pin land with §5, before the final catalog exists, so `example-details.ts` carries three transitional lists that the check keeps honest:
  - `INTERIM_CATALOG_IDS`: the ten test and perf entries, which get no card. The check fails when a listed id leaves the catalog, so the list empties with the swap.
  - The final examples not served yet: their cards take the insight, `defaultView` and large-download note from the catalog's `FINAL_EXAMPLE_SPECS` (Decision 15), and the check fails while one of them has no prose. (A first version kept these fields as `beforeSwap` in the prose; with the second lineup they moved into the catalog, so they are written once.)
  - `THUMBNAILS_PENDING`: cards without a thumbnail. The check fails when a listed thumbnail exists.
  - A value still to come renders as `‹…›` (a build value from a missing manifest record, or an author fact in the prose or the catalog), flagged by a warning at the top of the page. Once `INTERIM_CATALOG_IDS` is empty, the check refuses any `‹…›` (on the page, and in `eat.md` and `importing-data.md`, which quote the EAT example's numbers), any entry left in `THUMBNAILS_PENDING`, and any stated release that is not `YYYY_MM` (a note such as "inferred; confirm" stamped into a bundle is no `‹…›`). At any time it refuses a manifest build command that names a path of the build machine.
- **Scripts and CI.** `docs:examples` and `docs:examples:check` join `precommit`, and the `ci.yml` `build-docs` job runs both `docs:examples:check` and the existing `docs:annotations:check`, which runs in no workflow today.
- **Page layout.**
  - Cards use `## Title {#id}`.
  - "Open in ProtSpace" and "Download" are raw `<a href>`, because markdown links to `/explore?…` or to a bundle fail `docs:build`.
  - A `::: details How this bundle was built` block holds the exact command.
  - Citation text is journal-neutral: the 2026 preprint DOI `10.64898/2026.05.04.722720` and the FAQ citation anchor. UniProt is credited under CC BY 4.0.
- **Anchor pin.** VitePress never checks anchors, so `example-datasets-docs.test.ts` is retargeted from `control-bar.md`'s table to this page and asserts `{#<id>}` for every catalog id (outside `INTERIM_CATALOG_IDS`), that every `docsUrl` points at its id's section, and that no section names an id outside the catalog (other than a final example not served yet).
- **Thumbnails.** An opt-in `examples-live` Playwright project (`RUN_EXAMPLES_E2E=1`, after `pnpm examples:fetch`) opens each `?dataset=<id>`, asserts the curated view with no URL write and no drift warning, and captures the thumbnail.

### 15. Sequencing: machinery first, catalog swap last

- **Tasks §1–§6** land on this branch while the CLI fixes proceed elsewhere. They run against the **interim** catalog (today's eleven entries, repo-hosted), each given a provisional `defaultView` naming columns and projections that its current file really has. An interim manifest written from those files keeps the drift test meaningful.
- **Fixture copies.** §4 adds the fixtures as byte-identical copies (same blobs) and repoints every test. §7 deletes the `apps/web/public/data/` originals, so for the four non-demo fixtures the branch diff is a plain `git mv` (D9). The demo fixture is a copy, because the product demo keeps its path with new content.
- **Docs.** §5 lands the generator, the prose for the final ids, the generated page, the retargeted pin test and the CI and precommit wiring of both docs checks. The interim lists in `example-details.ts` (Decision 14) let the catalog↔prose check pass against the interim catalog; the swap (§7) empties them, and from then on the check enforces every rule for every id.
- **The final catalog is written before the swap.** `example-datasets.ts` holds `INTERIM_EXAMPLE_SPECS` and `FINAL_EXAMPLE_SPECS`, and `FINAL_CATALOG_IS_LIVE` (false until the swap) picks the one the app serves. The final entries cannot be served early (an entry without a manifest record throws at import), but the docs page renders their cards, the unit tests check them (id format, order, colourable default views), the build script's `verify` reads their `defaultView` from the catalog, and the E2E role table names their ids.
- **The swap (§7) is one commit, and everything the docs check needs is in it.** `docs:examples:check` runs in `precommit`, in the commit hook and in CI, and every rule applies from the moment the switch flips: the interim ids leave the served catalog, so `INTERIM_CATALOG_IDS` must be empty (the check refuses an id that is no longer in the catalog), and an empty list makes it refuse every `‹…›`, every `THUMBNAILS_PENDING` entry and every release that is not `YYYY_MM`. Filling the values and capturing the thumbnails after the flip would leave a red commit. So the swap commit holds, together:
  - 7.6's manifest records and `FINAL_CATALOG_IS_LIVE = true`;
  - `apps/web/public/data/` removed and the new demo at `apps/web/public/data.parquetbundle` (the interim entries' files live in that directory, and the "only the demo under `public/`" assertion runs once the switch is flipped);
  - `INTERIM_CATALOG_IDS` emptied;
  - every `‹…›` filled in the catalog (the three-finger toxins' accuracy, Swiss-Prot's `large` note), the prose, `eat.md` and `importing-data.md`, including the author facts, which are therefore a hard prerequisite (task 7.1);
  - the five thumbnails, captured by the `examples-live` project from the flipped working tree with the staged release files copied into `apps/web/public/examples/`, and `THUMBNAILS_PENDING` emptied;
  - the regenerated page.

  A unit test (`example-datasets.test.ts`) refuses a `‹` in any served entry's description, insight or large note once the switch is flipped. The demo's docs images (7.11) may follow in a later commit, and a cleanup commit deletes the interim catalog, the switch and the role fixtures' interim names.

- **Commits.** Every commit keeps `pnpm test:ci`, `pnpm format:check`, `pnpm precommit` and the E2E suite green.

### 16. Every example carries a UMAP and a PCA (R2-D3)

Every example opens on a UMAP and also carries a PCA of the same embedding: the demo keeps all four of its projections (ProtT5 and ESM2, each as UMAP and PCA), `three-finger-toxins` gets both, `human-fly` and `beta-lactamase` keep theirs, and `swissprot` adds the paper's PCA as `ProtT5 — PCA 2`.

- **Why a PCA everywhere.**
  - One rule a reader can rely on. UMAP draws clusters most clearly, which is why every example opens on it (UMAP scores higher kNN label agreement in 21 of the 23 PCA/UMAP pairs of the build reports, the other two being a tie and a random split). PCA is linear and keeps the coarse geometry UMAP distorts, so switching between the two shows what a picture owes to the layout. The docs page says this in one sentence.
  - The paper reports PCA numbers for Swiss-Prot, human + fly and β-lactamase (the Extended Data faithfulness and statistics tables), which the examples reproduce only with their PCA.
  - PCA shows what UMAP cannot: identical sequences stack on one point (2,185 stacks in β-lactamase, the largest 240; the demo's duplicate badge in the docs), and a projection can separate an annotation better than its embedding (β-lactamase `signal_peptide`), which is why the separation panel calls the embedding value a reference, not a ceiling.
  - The EAT docs show provenance connectors surviving a projection switch, which needs a second projection in the EAT example.
- **Rejected: a PCA only where it earns its place.** The research recommended dropping the demo's ESM2 PCA (−102 KB, 9.8 % of the file every visitor downloads) and keeping Swiss-Prot UMAP-only, since a PCA costs it at least 7.4 MB, about 190 ms of parsing and 93 MB of heap against a load gate it already came close to (32.3 s of 35 s). The owner chose the simpler rule. The Swiss-Prot D2 gate is therefore measured again on the rebuilt file, and the web-cut fallback (Decision 9) still applies. The larger byte lever, dictionary-encoding `projection_name` in the CLI (about −1.1 to −1.3 MB on each large file), is left to a CLI change.

### 17. The EAT showcase: `three-finger-toxins` (R2-D1)

The Import menu shows annotation transfer with one example built for the purpose, not with the paper's EAT sets.

- **Why not the paper's sets.** They are benchmarks and fixtures, not showcases:
  - The 811-protein venom set (Fig. 4) was added as a UI fixture for the statistics dropdown. Its transfer rule (arthropod queries, non-arthropod references) puts snake-enzyme EC numbers on arthropod proteins, 376 of its 384 transfers onto proteins without an enzyme keyword, and 307 of them come from one 101-residue fragment, P20005.
  - The 832-protein phosphatase benchmark (the abstract's 98.1 %) holds out masked Swiss-Prot entries in an essentially two-class EC task, which MMseqs2 solves at least as well (94.4 % against 91.5 %).
  - setHARD, DeepLoc 2.0 and the low-identity EC sets have few confident transfers or unreadable legends.
- **Their frozen files stay.** `venom_eat_stats_811` and `phosphatase_eat` remain E2E fixtures, `perf-datasets` assets and files of the paper's Zenodo deposit, so the manuscript's numbers stay reproducible; the manuscript's scripts read them from the `perf-datasets` release.
- **Why three-finger toxins.** It is a real use case: the unreviewed entries, mostly venom-gland transcripts, have no functional class, and the reviewed ones carry a curated one. A held-out fifth of the reviewed entries gives the transfers a ground truth the reader can check in the tooltip; the labels are short and readable; and three-finger toxins are the lab's own subject (Koludarov et al., 2023; the ProtSpace JMB 2025 paper shows them clustering by function). It is the UniProt query set, not the unpublished set of the domain-loss manuscript, so the example is reproducible from public data and pre-empts no paper.
- **Membership.** UniProtKB `(xref:interpro-IPR003571 OR family:"three-finger toxin family") AND (taxonomy_id:8570)`, about 1,089 entries at 2026_03 (verified at build time; IPR003571 alone gives 1,042 and misses 47 curated three-finger toxins). The accession list is pinned.
- **Mature chains (G1).** The embedding is ProtT5-XL-U50 on each entry's mature chain, as the demo does, cut by one rule for references and queries. UniProt's Chain feature decides where there is one; but SignalP's Chain on a TrEMBL precursor keeps any propeptide, so an unreviewed chain that starts with a propeptide a reviewed entry of the set has curated (nine colubrid toxins, within 5 of 15 residues) loses it too, and an entry UniProt gives no feature at all (16 unreviewed ones carry signal-peptide residues) is cut after the signal peptide's conserved end. Without that, the 71 colubrid queries formed an island of their own. The mature-inputs gate checks each vector's residue digest against its chain, and fails on a query that keeps a curated propeptide or a row used as deposited that is predicted to carry a signal peptide. In the pilot on full-length vectors, 525 of the 552 unreviewed entries carried a signal peptide against 264 of the 490 reviewed ones, 97.7 % of each protein's 15 nearest neighbours shared its signal-peptide status, and every precursor query took its label from a precursor: the rings could only sit in precursor islands, and the mature-only references never donated. UniProt's precomputed per-protein vectors are full-length, so the example is embedded by the build (minutes for about 1,089 short sequences). The sequence-based annotation sources (InterPro, Biocentral) still run on the full-length sequences, the demo's lesson (G8).
- **Labels.** `toxin_class` groups the subfamily and sub-subfamily UniProt curators record for each reviewed entry into functional classes. The automatic TrEMBL labels ("Boigatoxin") are blanked, so every unreviewed entry is a query.
- **Hold-out.** A fifth of the reviewed entries, drawn within each class with a recorded seed and the classes taken in sorted order (the pilot's draw depended on Python's hash seed: G4). The realised split ships as `eat_split` (`reference`, `holdout`, `trembl`) and the truth as `toxin_class_withheld`; `toxin_class` is blank on the held-out rows, and the no-refill gate applies.
- **Transfer.** EAT with k = 1 and the Euclidean distance (`protspace transfer -t toxin_class --k 1 --metric euclidean`), whose goPredSim transform makes a 0.5 threshold mean what the docs say; under the cosine default every score is high and the slider filters little.
- **Gates (tolerances, since the accuracy depends on the draw: 0.89–1.0 over 200 seeds in the pilot).** Hold-out accuracy ≥ 0.88 overall and ≥ 0.90 at reliability ≥ 0.5; unreviewed transfers at reliability ≥ 0.5 within ±5 % of the built value; no reference donating to more than 40 queries; the family parser a hard failure; no all-N/A column. The card's numbers are read from the built file.
- **Caveats on the card.** The classes are curator subfamilies; holding out whole genera instead of a random fifth drops the accuracy (pilot: 68.5 %, 85.3 % at reliability ≥ 0.5); _Naja_ supplies about a third of the reviewed entries; about a fifth of the unreviewed ones are fragments.

### 18. No Biocentral predictions on the three large sets (R2-D4)

`human-fly`, `beta-lactamase` and `swissprot` ship without the four `predicted_*` columns; the demo and `three-finger-toxins` keep them.

- **Why they cost so much.** The columns come from LightAttention (subcellular location, membrane) and TMbed (signal peptide, transmembrane), which read the L × 1024 per-residue ProtT5 matrix. Biocentral's predict API accepts only sequences, and UniProt publishes only mean-pooled per-protein vectors, which cannot be un-pooled, so every protein would be embedded again per residue: 10–25 h per set on the public server for β-lactamase (109,092 unique sequences, 45 M residues) or human + fly (103,947, 44 M), several times that for Swiss-Prot, with 90–190 GB of per-residue data landing in the operators' database.
- **What the cards say.** Each of the three cards states that it has no Biocentral predictions and why, and that the Phobius `signal_peptide` column (present on nearly every protein) still covers signal peptides.
- **Later.** An operator batch run or a lab GPU (about 2–4 h per set) can add the columns in a later refresh, under new file names. The build configuration commits the skip with its reason.

## Risks / Trade-offs

- **Swiss-Prot size and memory** (135.9 MB; 27.4 s and a 1,192 MiB peak JS heap in the D2 measurement on an Apple M4 Pro, which leaves out ArrayBuffer and GPU memory). Mitigations:
  - the D2 gate and its GO/TED web-cut fallback;
  - streamed progress and Cancel;
  - the Large badge and the stated memory.
- **A file over 100 MB on Pages is untested** (the largest served today is 44.9 MB). A staging deploy test is an owner step (§8). The fallback is R2 on `data.protspace.app` with CORS.
- **Bandwidth.** Pages allows 100 GB/month and bundles are uncached today, so the cache rule must be live before the Swiss-Prot link is announced.
- **Refreshed annotations could weaken a figure's story.** The story gates catch it, and the dataset then ships frozen with an honest label.
- **Mixed releases inside a bundle** (the demo's membership is 2026_01, its annotations 2026_03). The manifest and the cards record the release per column group.
- **The EAT showcase is not a paper dataset.** The spec's principle becomes "the manuscript's datasets plus one curated EAT showcase", which reviewers of the first lineup did not see. Its labels are curator subfamilies, and its hold-out accuracy depends on the random draw (0.89–1.0 over 200 seeds in the pilot), so the gates are tolerances and the card's number is read from the built file.
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
  - the Swiss-Prot and human + fly membership releases, inferred as 2025_04 from the data;
  - how the 113,015 β-lactamases were selected from about 120K query hits.
  - (The venom 811 query was reconstructed and matches 811/811 at 2026_02; the venom set no longer ships in the menu.)
- Whether Cancel on an empty screen (Decision 7) is confirmed, or D7e's literal "no fallback" is wanted even there.
- The three-finger toxin class vocabulary and its palette (the build decides from UniProt's subfamily notes; the docs name only classes every version has).
- Whether `?webglPerf=1` should be compiled out of production builds. Once `/data/*` is gone it only records dataset errors there.
