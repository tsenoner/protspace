## Why

Issue #443 asks for "all datasets we are using in the publication" to be easy to open. PR #494 built the mechanism (an Import-menu "Examples" section and a `?dataset=<id>` link), but the catalog it lists is test and perf data: nine of its eleven files arrived in one 2026-01 perf-testing commit, four are mislabelled (the demo, `5K`, `40K` and `35K_ec_brenda`), one is a retired β-lactamase build the manuscript says must not be quoted, and every non-demo entry opens on its first column (usually `annotation_score`) and, in nine of ten cases, on PCA. Of the manuscript's five case-study datasets, two are in the menu (both as pre-v4 builds), Swiss-Prot ships but is hidden, and the β-lactamase 113K set and the 832-protein phosphatase EAT benchmark behind the abstract's 98.1 % are absent.

The project owner's goal: the Import-menu examples are the manuscript's datasets plus one curated example of annotation transfer, each opens on a curated projection and annotation that shows structure at once, the data is current and carries every feature, and a linked docs page says briefly what each dataset is and how it was built.

The manuscript's own annotation-transfer (EAT) sets turned out to make poor showcases (owner decision D1, 2026-09-30). They are benchmarks and test fixtures: the 811-protein venom set behind Fig. 4 began as a UI fixture, and 307 of its 384 EC transfers borrow from one 101-residue fragment, mostly putting snake-enzyme EC numbers on arthropod non-enzymes; the 832-protein phosphatase benchmark holds out masked Swiss-Prot entries in an essentially two-class EC task that a sequence search (MMseqs2) solves at least as well. So the menu shows annotation transfer on a real case instead: snake three-finger toxins, where UniProt's unreviewed venom-gland sequences have no functional class and the reviewed ones do.

## What Changes

- **Catalog.** Replace the eleven entries with five, in this order: `demo` (the ToxProt startup demo, re-annotated and relabelled "Venom toxins (demo)"), `three-finger-toxins` (the curated EAT showcase, not a manuscript dataset), `human-fly` (Fig. 2B), `beta-lactamase` (Fig. 3) and `swissprot` (Fig. 2A, marked Large). Ids are final and permanent, since the paper will print `?dataset=` links; none has ever been public, so no alias map is needed. The manuscript's EAT sets (the Fig. 4 venom set and the 832-protein phosphatase benchmark) leave the menu; their frozen files stay as test fixtures, `perf-datasets` assets and Zenodo files for the paper.
- **Data (strategy R).** Keep each paper dataset's membership and published coordinates, and refresh every annotation at UniProt 2026_03 with the released CLI (PR #495, protspace 4.14.0). Every example is rebuilt once on that release before anything is published. `three-finger-toxins` is built fresh: UniProt's snake three-finger toxins, embedded as mature chains with ProtT5-XL-U50, labelled with a curated toxin class, with a recorded hold-out of a fifth of the reviewed entries, and transferred by EAT (k = 1, Euclidean). Every example keeps a PCA next to the UMAP it opens on, Swiss-Prot included (the paper's PCA); Swiss-Prot ships with all features provided it loads in about 35 s with at most about 1.5 GB of heap, re-measured with the PCA, and otherwise the web copy drops the GO and TED columns. `human-fly`, `beta-lactamase` and `swissprot` ship without Biocentral predictions, which need per-residue embeddings (10–25 h per set on the public server), and their cards say so. The paper's exact files go to a Zenodo deposit and a `perf-datasets` release.
- **Curated default view.** Every catalog entry carries a required `defaultView` (projection, colour-by annotation, optional tooltip annotations). It applies whenever the URL names no view, and replaces the first-column fallback for a missing or invalid `annotation`/`projection`. Changing a default is a one-line catalog edit; a unit test pins every default name against the bundle manifest.
- **Behaviour decisions (a)–(e) for the example flow:**
  - (a) A failed Back/Forward keeps the current plot and URL and offers Retry; the fallback load runs only when nothing is displayed yet.
  - (b1) A view-only history step during a pending URL-driven switch is applied by that switch; Back/Forward cancels a pending menu load.
  - (b2) User-initiated requests win over app-initiated loads that began earlier (a request epoch, and a new `preempted` outcome that shows no banner).
  - (c) A menu choice resets annotation, projection and tooltip to the example's `defaultView` and pushes just `?dataset=<id>`.
  - (d) Examples always reopen in their curated state, and the app and docs now say so.
  - (e) Swiss-Prot is in the menu, with a Large badge, streamed download progress measured against the manifest size, and a Cancel button.
- **Import menu.** An "About these examples" link, a hint that examples open curated, a per-example info popover (description, insight, "Learn more") and a Large badge.
- **Hosting.** Showcase bundles leave git. They are published as assets of a versioned GitHub release; `deploy.yml` downloads them into the site under `/examples/` and fails if any sha256 differs from a committed, generated manifest (`apps/web/src/explore/example-manifest.ts`). The previous release's files stay deployed for one cycle. Only the startup demo stays in git. `pnpm examples:fetch` serves local development, and a development build falls back to `https://protspace.app/examples/` when a file is missing.
- **Tests and perf decoupled from the product.** Test-relied bundles become fixtures in `apps/web/tests/fixtures/`. E2E pins its startup dataset through an environment variable set by the Playwright web server, and routes each example it loads to a fixture that contains that entry's default-view names; those role fixtures are derived from the pinned fixtures by a committed script. Unit tests run on a catalog of their own. The perf harness reads its eleven datasets (plus the 113K and the 832 fixture) from a `perf-datasets` release under their original file names (`pnpm perf:fetch`).
- **Docs.** A new generated page `docs/explore/example-datasets.md`, with one anchored section per id stating what the dataset is, what the default view shows and how it was built. `pnpm docs:examples:check` runs in CI next to the existing `docs:annotations:check`. The stale pages are updated.
- **Build tooling.** `apps/protspace/scripts/generate_examples/build_showcase.py` builds, verifies and stages each bundle, writing provenance into the bundle and the manifest.
- **BREAKING (site URLs).** `https://protspace.app/data/*.parquetbundle` stops being served. No manuscript file or docs page links to it; the perf harness moves to the `perf-datasets` release.

### Archived non-goals this change reverses

The archived `example-datasets` design (`openspec/changes/archive/2026-09-26-example-datasets/design.md`, "Non-Goals") excluded four things this change now does, deliberately:

1. **Per-example settings.** Each entry now carries a curated `defaultView`, and its bundle carries curated legend and EAT settings.
2. **External hosting.** Showcase bundles are published as GitHub release assets and archived on Zenodo. They are still served same-origin from protspace.app, but they no longer live in the repository.
3. **Moving or deleting bundles.** Test-relied bundles move to `apps/web/tests/fixtures/`, and every other file under `apps/web/public/data/` is deleted from the tree.
4. **Changes to the perf harness.** The harness now reads its datasets from the `perf-datasets` release instead of `apps/web/public/data/`.

## Capabilities

### New Capabilities

None. The new behaviour extends `example-datasets`.

### Modified Capabilities

- `example-datasets`:
  - MODIFIED "Example catalog", "Choosing an example from the Import menu", "Dataset deep link" and "Example load failure".
  - ADDED "Examples open in their curated state", "Request precedence", "Example download progress and cancel", "Example datasets documentation" and "Example bundle manifest".
- `e2e-validation`: ADDED "E2E scenarios do not depend on the product example catalog"; MODIFIED "Heavyweight and live suites are explicit" (the opt-in `examples-live` project, and the large-bundle fixture from `perf-datasets`).
- `webgl-perf-harness`: ADDED "Benchmark datasets come from a pinned release".

## Impact

- **`apps/web/src/explore/`:**
  - `example-datasets.ts` (the catalog and its types);
  - new `example-manifest.ts` (generated);
  - `url-state.ts`, `view-state.ts`, `view-controller.ts`, `dataset-controller.ts`, `persisted-dataset.ts`, `startup.ts`, `runtime.ts`, `use-url-state-sync.ts`, `types.ts`, `notifications.ts`, `loading-overlay.ts`;
  - `apps/web/src/lib/notify.ts`, `apps/web/src/tour/product-tour.ts`.
- **`packages/core`:** the control bar's Import menu (new `examplesDocsUrl` property; `ExampleDatasetSummary` gains optional `insight`, `docsUrl` and `large`). This is additive; the package is unpublished.
- **Tests:**
  - unit tests across the files above, plus `control-bar.import-menu.test.ts`;
  - E2E: `example-datasets.spec.ts`, the specs that abort or fetch the startup URL, the fixture path users, and a new opt-in `examples-live` project;
  - `bundle-roundtrip.test.ts`.
- **Perf:** `perf/webgl-perf.spec.ts`, `perf/README.md`, `perf/plot_perf_results.py`, `apps/web/src/perf/webgl-perf-suite.ts`, and a new `perf/datasets.manifest.json`.
- **Tooling and CI:**
  - new `scripts/examples/` (fetch and verify) and `docs/scripts/generate-examples.mts` plus `example-details.ts`;
  - root `package.json` scripts (`examples:fetch`, `perf:fetch`, `docs:examples`, `docs:examples:check`);
  - `.gitignore`;
  - `.github/workflows/deploy.yml` (fetch and verify the examples);
  - `ci.yml` (the docs checks, and a manifest fetch check on PRs that touch it);
  - `apps/web/tests/playwright.config.ts`.
- **Python (dev tooling only, `chore:` commits, no release):** `apps/protspace/scripts/generate_examples/` and `generate_toxprot_demo.py`.
- **Docs:**
  - the new page, its sidebar entry and `sitemap.xml`;
  - `index.md`, `explore/control-bar.md`, `importing-data.md`, `eat.md`, `explore/index.md`, `guide/index.md`, `guide/faq.md`, `developers/api/index.md`, `explore/images/README.md`;
  - `CONTRIBUTING.md`.
- **Repository and site size:** about 83 MB of bundles leaves every checkout and every Pages deploy (history is unchanged). The deployed site becomes about 44 MB of app and docs plus about 150 MB of examples.
- **Owner-only steps:** the GitHub releases, the Zenodo deposit and the Cloudflare cache rule are prepared as scripts and a checklist (tasks §8), and are not executed by this change.
- **Depends on:** the CLI fixes on `fix/annotation-retrieval` (PR #495, released as protspace 4.14.0, including the `root` and TMbed fixes and the cache refresh that makes a rebuild apply them) and PR #452 (the faithfulness statistics, merged), for the data build (tasks §7) only. It is stacked on PR #494 (`feat/example-datasets`, t03i), so the stack is merged with a merge commit. Closes #443.
