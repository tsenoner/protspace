## Context

Startup (`startup.ts`) runs the perf-suite override, then `loadPersistedOrDefaultDataset()`: restore the OPFS import, or fetch `./data.parquetbundle`. The control bar has one "Load demo" item (`load-demo-dataset`); `currentDatasetIsDemo` disables it. URL sync (`use-url-state-sync.ts`) only handles view params (`annotation`, `projection`, `tooltip`); the dataset is not in the URL.

Ten more bundles already deploy with the app under `apps/web/public/data/`, listed in `datasets.json`, which only the perf harness reads.

## Goals / Non-Goals

**Goals:** every shipped example is one click away in the Import menu and has a shareable `?dataset=` link; a failed load is visible to the user.

**Non-Goals:** external hosting (Zenodo, DOI), moving or deleting bundles, a catalog dialog with search or filters, per-example settings, changes to the perf harness.

## Decisions

**Catalog is a TS module, separate from `datasets.json`.** `apps/web/src/explore/example-datasets.ts` exports `EXAMPLE_DATASETS` and `findExampleDataset(id)`. The perf list includes `573K_swissprot`, which is not an example, and the two lists serve different purposes, so they are allowed to differ. A static import also avoids a runtime fetch. Rejected: turning `datasets.json` into objects shared by both, which would couple perf-harness changes to the user-facing menu.

**One loader for all examples.** `loadDefaultDataset()` becomes `loadExampleDataset(entry)` and the default load is `loadExampleDataset(demo)`. It keeps `registerFileLoad(file, 'default')` so `handleDataLoaded` keeps its reset semantics. On failure it calls `notify.error`, dismisses the overlay and returns `false`, so the caller decides the fallback. `setCurrentDatasetIsDemo(bool)` becomes `setCurrentExampleId(id | null)`. The runtime's `DEFAULT_DATASET_NAME` is replaced by the catalog label.

**Menu choice and deep link differ only in whether they clear OPFS.** `loadExampleDatasetAndClearPersistedFile(id)` (menu) keeps today's demo semantics. A deep-link load calls `loadExampleDataset` directly and never touches OPFS, so opening a shared link cannot delete the user's data.

**`@protspace/core` stays unaware of the catalog.** The control bar gets `exampleDatasets: {id, label, description}[]` and `currentExampleId: string | null`, and emits `load-example-dataset` with `{ id }`. The package is unpublished, so there is no compatibility shim for the removed `load-demo-dataset`.

**URL is the source of truth for which example to show; the controller reports what loaded.**

- `url-state.ts` gains `getDatasetParam` / `setDatasetParam` helpers.
- `ExploreController` gains `subscribeToDatasetChanges(cb: (exampleId: string | null, source: 'menu' | 'url' | 'user' | 'startup') => void)` and `setRequestedDataset(id | null)`.
- The hook pushes `dataset=<id>` on a `menu` load and deletes the parameter with `replace` on a `user` load. A `startup` load and a failed or unknown `url` load delete it with `replace`.
- The startup read happens in the hook's `attachController`, next to `setRequestedView`. It replaces the direct OPFS/default call for this case; the perf-suite override still runs first.
- Back/Forward changes `searchParams`, and the hook calls `setRequestedDataset`. A known id loads that example; `null` runs the normal startup load (stored import or demo).

Rejected: reading `window.location` inside `startup.ts`. That would split URL handling across two places and wouldn't handle Back.

**Back after a menu choice can't restore a user file.** The menu choice cleared OPFS, so Back to a URL without the parameter loads the demo. This is accepted and documented, and matches what a reload would show.

### Catalog

Protein counts and sizes come from the bundles. Descriptions were drafted from annotation columns and projections and approved by the author.

| id                                        | label                              | description draft                                                                                      |
| ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `demo`                                    | Demo · 7.8K · 0.9 MB               | Mixed UniProt sample with ESM2 and ProtT5 projections, taxonomy, Pfam/CATH and EC.                     |
| `venom_eat_stats`                         | Venom EAT · 811 · 0.2 MB           | Venom proteins with EAT-transferred EC and protein-family predictions, GO terms and cluster labels.    |
| `phosphatase`                             | Phosphatases · 1.6K · 0.4 MB       | Phosphatases with rich domain annotations (Pfam, SMART, CDD, PANTHER, TED) and predicted localisation. |
| `5K`                                      | Swiss-Prot 5K · 5.2K · 0.2 MB      | Small Swiss-Prot subset with a 3D PCA projection and length bins.                                      |
| `7K_toxprot`                              | ToxProt · 7.4K · 0.6 MB            | Animal toxins from UniProt ToxProt with taxonomy, domains and signal peptides.                         |
| `35K_ec_brenda`                           | EC (BRENDA) · 35K · 4.5 MB         | Enzymes with BRENDA EC numbers.                                                                        |
| `beta_lactamase_ec`                       | β-lactamases (EC) · 36K · 2.1 MB   | β-lactamases selected by EC number.                                                                    |
| `40K`                                     | Swiss-Prot 40K · 40K · 1.8 MB      | Swiss-Prot subset with a 3D PCA projection.                                                            |
| `105K_homoSapiens_drosophilaMelanogaster` | Human + fly · 106K · 10.1 MB       | Human and _Drosophila melanogaster_ proteomes.                                                         |
| `127K_beta_lactamase`                     | β-lactamases · 127K · 8.7 MB       | β-lactamase family, broad selection.                                                                   |
| `beta_lactamase_pn`                       | β-lactamases (PN) · 248K · 12.2 MB | Large β-lactamase set for stress-testing at 248K points.                                               |

## Risks / Trade-offs

- [The 12 MB and 10 MB examples are slow on mobile] → the size in each label warns before the click; the loading overlay already shows progress.
- [Mocked `fetch` in unit tests doesn't prove the real deep-link flow works] → the Playwright spec covers the deep link, Back and user import against the real bundles.
- [Descriptions go stale when a bundle is regenerated] → the catalog sits next to the code; a bundle PR edits both.
