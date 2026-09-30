# Showcase example datasets

`build_showcase.py` builds the six bundles behind the Import menu's **Examples** on
protspace.app: the startup demo plus the manuscript's datasets. `showcase.toml` holds
one recipe per dataset, and `styles/` holds their curated legends. The design is in the
OpenSpec change `openspec/changes/curated-example-datasets` (Decisions 1 and 9–13, tasks §6–§7).

`write_manifest.py` writes the web app's example manifest
(`apps/web/src/explore/example-manifest.ts`) from the bundle files; `build_showcase.py
stage-release` calls it. `generate.py` and `datasets.toml` in this directory are
unrelated: they build the Colab notebooks' `examples` release.

## What the build does (strategy R)

Each paper dataset keeps its protein set and its published coordinates. Every annotation
source is fetched again with the **fixed** CLI at the current UniProt release. The two EAT
examples keep the paper's EAT inputs and outputs. Nothing is re-embedded and no UMAP is re-run.

| id                | Kind            | N       | Source of the layout                                     | Refreshed                                  | Paper                                              |
| ----------------- | --------------- | ------- | -------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `demo`            | `demo-refresh`  | 7,831   | the current demo (4 projections, mature peptides)        | every column, from full-length sequences   | the mature-peptide `length`                        |
| `venom-eat`       | `eat-graft`     | 811     | `venom_eat_stats` (Fig. 4)                               | InterPro, TED, Biocentral are added        | every existing column, the statistics part         |
| `phosphatase-eat` | `eat-graft`     | 832     | the `phosphatase_eat` fixture                            | every column except the EAT ones           | `ec`, `protein_families`, `eat_split`, `*__pred_*` |
| `human-fly`       | `paper-refresh` | 105,562 | `nm_2026/data/joint_proteome_105k_stats` (Fig. 2B)       | every column but Biocentral (D4)           | (none)                                             |
| `beta-lactamase`  | `paper-refresh` | 113,015 | `nm_2026/data/beta_lactamase_2026_stats` (Fig. 3)        | every column but Biocentral (D4)           | (none)                                             |
| `swissprot`       | `paper-refresh` | 573,649 | `nm_2026/data/swissprot_573k_stats` (Fig. 2A), UMAP, PCA | every column except Biocentral (opt-in)    | (none)                                             |

The build steps for each dataset are:

1. **check-inputs.** Checks the sha256 and size pins, the H5 files and the source bundle.
   It stops if the CLI checkout lacks the prerequisites (`annotate --cache-dir` from
   `fix/annotation-retrieval`, and PR #452's faithfulness ceiling for sets over 20K). It
   notes which release UniProt serves.
2. **fetch.**
   - `paper-refresh` runs staged `protspace prepare -m pca2 -a …` calls that reuse the
     per-source cache. Each stage adds sources, so a failure costs only its own stage.
   - The other kinds fetch full-length UniProt FASTA and run one `protspace annotate`.
   - Paper rows without a UniProt vector (146 in human + fly) are annotated from FASTA and
     keep their paper position.
   - A fetch step does not start while UniProt serves another release than `--release`.
   - **A fetch step is done only when every requested source was fully retrieved.** The CLI
     exits 0 when a source (InterPro, TED, Biocentral, …) was only partly fetched; it
     leaves that source out of its cache and says so in a warning. The build reads the
     CLI's output (kept in `work/logs/<step>.log`) for those warnings and runs the step
     again, which fetches only what is missing (`[build] incomplete_retries`, default 1,
     after `incomplete_retry_wait_s`). If a source is still incomplete, the step fails
     without a marker, so the next `build` tries again.
   - Each fetch step records the UniProt release its data came from, as the CLI recorded
     it: `run.log`'s `uniprot_release:` line for `prepare`, the cache's release stamp for
     `annotate --cache-dir`, and UniProt's response headers for the FASTA.
3. **assemble.**
   - The rows are the paper's membership, with the default annotation as the first column.
   - `sequence`, `organism_id` and the legacy length bins are dropped.
   - A v1 source is re-encoded to v2 before new columns join it (G9).
   - For `phosphatase-eat`, the refreshed `ec` and `protein_families` of the 213 queries
     become `ec_withheld` and `protein_families_withheld`. A guard fails the build if any
     query row regains a value in the withheld columns (G6).
4. **projections.** Keeps, renames and reorders the paper projections, UMAP first, named
   `ProtT5 — UMAP 2`. The coordinates are copied unchanged.
5. **stats.**
   - Runs `protspace stats --cluster-selection both` with an **explicit**
     `--stats-annotation` list (G12).
   - `venom-eat` keeps the paper's statistics part byte-for-byte.
   - The demo gets none.
6. **bundle, style, finalize.**
   - `protspace bundle`, then `protspace style` with `styles/<id>.json`. Style entries for
     values the data lacks are dropped first.
   - Carried-over legends and the cluster legends are merged in afterwards, because
     `style` would reorder a manual legend.
   - The EAT examples get the settings envelope, with `eatConfidenceThreshold` 0 for venom
     and 0.5 for phosphatase (D6).
   - Provenance goes into the annotations' parquet metadata (G15): `example_id`,
     `protspace_version`, `git_sha`, `builder_git_sha`, `uniprot_release` per column
     group (G10, `{group: {release, columns}}`), `membership_release`, `built_at`,
     `command`, `pipeline` and `zenodo_doi`. The refreshed groups' release is the one the
     fetch steps recorded for their data. It must be a single release and equal
     `--release`; what UniProt serves later does not matter, so a finished build can be
     finalized after UniProt moves on.
7. **verify.** Runs the gates and writes `verify.json`, with the sha256 of the file it
   checked. The build exits non-zero if a gate fails or is pending.
8. **report.** Writes the clustering report and thumbnails for the default-view choice (see below).

Every step writes a marker under `work/.steps/`, keyed on a digest of everything the step
reads: its CLI command, the recipe keys it uses, the size and modification time of its
input files, the contents of its style file, and the CLI checkout's commit. A rerun skips a
step while that digest is unchanged, and runs a step whose inputs changed plus everything
after it. So editing an author fact (`membership_release`) or `[build] zenodo_doi` re-runs
only `finalize`, a style file re-runs `style` and `finalize`, and a new CLI commit re-runs
the fetch steps (quickly, from the cache) and everything after them. Changes to
`build_showcase.py` itself do not re-run finished steps: use `--redo STEP` (or `--redo all`).

## Prerequisites

- The **fixed CLI** checkout: `fix/annotation-retrieval` merged, and PR #452 (faithfulness
  ceiling) merged. Pass its root as `--cli-root`. The script runs
  `uv run --frozen --project <cli-root> protspace …`, so it does not matter which branch
  the script itself comes from.
- The read-only inputs named in `showcase.toml`: `[paths]` (`suite`, `nm_data`, `cli_data`)
  or `--path NAME=VALUE`. They live in `protspace_publication/nm_2026/data/` and in the
  gitignored `apps/protspace/data/` of the author's checkout. The build only reads them,
  and refuses an output root inside the repository or an input directory.
- Network access to rest.uniprot.org, the InterPro and AlphaFold DB APIs, and Biocentral.
- Author facts still to collect (tasks 7.1): the venom 811 query and release; the
  Swiss-Prot and human + fly membership releases (2025_04 is inferred); how the 113,015
  β-lactamases were selected. Until a stated release is `YYYY_MM`, the `provenance` gate
  is pending and the bundle cannot be staged. Fill them in before the D2 measurement: the
  re-run `finalize` changes the file, and the measurement is tied to its bytes.

Run everything with `uv run` from the repository root. Outputs go to
`~/protspace-showcase/2026_03/<id>/`, or to `--out-root`:

```
<id>/<id>_2026_03.parquetbundle   the bundle
<id>/verify.json                  gate results, with the checked file's sha256
<id>/d2_measurement.json          swissprot: the browser measurement (record-load)
<id>/report/report.md, report.json, thumbs/*.png
<id>/build.log
<id>/work/                        intermediates, CLI caches, step markers, logs/, facts.json
```

## Usage per dataset

Set up once:

```bash
S=apps/protspace/scripts/generate_examples/build_showcase.py
CLI=/path/to/checkout-with-the-fixed-cli
```

Preview any build first. The dry run prints every step and the exact `uv run … protspace`
command, and runs and writes nothing:

```bash
uv run python $S build --only swissprot --dry-run --cli-root $CLI
```

Build in this order. Swiss-Prot's TED stage is the critical path, so start it first and
run it alone: two large TED fetches at once invite 429s.

```bash
# swissprot: 1.5–3 days, mostly TED (18–40 h). UMAP only; Biocentral is opt-in.
uv run python $S build --only swissprot --cli-root $CLI
uv run python $S build --only swissprot --cli-root $CLI --enable-stage biocentral   # after the operators' OK
# D2 gate: load the bundle in a browser on the reference laptop, then record it
# (tied to the file's sha256; a rebuilt file must be measured again):
uv run python $S record-load --only swissprot --seconds 28 --heap-mb 1310 --machine "MacBook Pro M1, Chrome 140"
# over budget: build the web copy without GO and TED (the full file is kept as
# *_full.parquetbundle), then measure the cut file. The decision is kept for later
# builds until --no-web-cut.
uv run python $S build --only swissprot --cli-root $CLI --web-cut

# beta-lactamase: 5–10 h. Gates: the Fig. 3 legend counts within 2 %, Q02940 still class C and away from the other class-C proteins.
uv run python $S build --only beta-lactamase --cli-root $CLI

# human-fly: 5–14 h, including the 146 vector-less rows. Gates: kinases shared, MHC I/II, β-defensin and CC chemokines human-only, PBP/GOBP fly-only.
uv run python $S build --only human-fly --cli-root $CLI

# venom-eat: minutes. Gates: 244 of 384 transfers at reliability ≥ 0.5, P0DPU8 ← F5CPF0 (0.583), the frozen columns and statistics unchanged.
uv run python $S build --only venom-eat --cli-root $CLI

# phosphatase-eat: minutes. Gates: 91.5 % over 213 and 98.1 % over 160 at ≥ 0.5 against the withheld truth, no refilled query row.
uv run python $S build --only phosphatase-eat --cli-root $CLI

# demo: 30–60 min (TED about 20 min). Gates: Pfam coverage ≥ 50 % (was 26.9 %), full-length inputs, the mature length kept.
uv run python $S build --only demo --cli-root $CLI
```

Other commands:

```bash
uv run python $S verify --all                  # re-run every gate on the built bundles
uv run python $S report --only beta-lactamase  # the clustering report and thumbnails again
uv run python $S stage-release --staging /tmp/showcase-2026_03   # release assets, the manifest, the owner's commands
uv run python $S stage-perf --out /tmp/perf-datasets             # perf-datasets assets, perf/datasets.manifest.json, the owner's commands
```

`stage-release` and `stage-perf` copy files and print the `gh release create` commands.
They never upload anything: creating releases is an owner step (tasks §8).

## Choosing the default view (G2, tasks 7.5)

`showcase.toml`'s `default_view` entries are **provisional**. The web catalog
(`apps/web/src/explore/example-datasets.ts`) owns the final pick, and once it has a
`defaultView` for an id, the build and the gates use the catalog's.

`report/report.md` scores every candidate annotation × projection:

- by kNN label agreement in the 2D layout (k = 15), chance-corrected as κ;
- both on the legend view (top 10 + Other, what the legend colours) and on all labels;
- next to the silhouettes that the separation-score strips will show.

`report/thumbs/` has a PNG for each candidate for the author to review. Where figure
fidelity wins over the score (for example Swiss-Prot `domain`, whose silhouette is
negative), the docs card says why the view is informative anyway.

## Gates

A gate passes, warns, fails or is **pending** (a measurement or an author fact still to
come). Pending blocks the release like a failure.

**Every bundle:**

- the protein count and the paper membership;
- no `sequence`, `organism_id` or legacy length bins;
- the v2 format stamp;
- no `(TC n` or "In the … section" family values (a warning only in a frozen paper column);
- `xref_pdb` has both values, and `reviewed` is plausible;
- the obsolete-accession count (rows empty in `reviewed` and `protein_name`), to state on
  the docs card (G17); a table with neither column fails rather than counting zero;
- no refreshed source (UniProt, taxonomy, InterPro, TED, Biocentral) empty on every row;
- the `defaultView` names are present;
- the settings envelope (EAT);
- the statistics name existing projections, and every projection has a faithfulness score;
- the coordinates equal the paper's;
- provenance is written, and every release it states is a `YYYY_MM` UniProt release.

**Story gates** are set per dataset in `showcase.toml` (`[[datasets.<id>.gates]]`). An
unknown gate type fails. If a story gate fails after the refresh, that dataset ships
frozen (strategy F) and is labelled so (design Decision 9). Swiss-Prot's `pfam_duplicates`
fails when the annotation cache lacks `pfam` or `sequence`, and its `browser_load` (D2) is
pending until `record-load` has measured exactly the built file.

## Staging the release and the manifest

`stage-release` stages every dataset (or `--only` ones) whose `verify.json` passed — no
`fail`, no `pending` — on exactly the built file's bytes; `--force` stages the others with a
warning. Into the staging directory it writes:

- the release assets `<id>_2026_03.parquetbundle` and their `SHA256SUMS`, and the demo as
  `data.parquetbundle` (it stays in the repository);
- `example-manifest.ts`, written by `write_manifest.py` from the staged files, with the
  committed `apps/web/src/explore/example-manifest.ts` as the previous manifest (so the
  previous release's files are retained for one cycle and a recorded Zenodo DOI is kept
  for unchanged files);
- `RELEASE_NOTES.md`.

It prints the owner's commands: `gh release create showcase-2026_03 …`, the copies of the
demo and the manifest into the repository, and the check (`pnpm examples:fetch` and
`write_manifest.py --refresh --check`).

`stage-perf` stages the `perf-datasets` release: the eleven former `apps/web/public/data/`
bundles from their pinned git blobs, the manuscript's 113K β-lactamase bundle (from
`--nm-dir`, default the parent of `[paths] nm_data`, checked against its sha256) and the
832-protein phosphatase EAT bundle. It rewrites `perf/datasets.manifest.json`
(`{release, datasets: [{id, file, bytes, sha256, default, source}]}`), which
`pnpm perf:fetch` verifies against (`--no-manifest` leaves it alone).

## Tests

```bash
cd apps/protspace
uv run pytest tests/test_build_showcase.py -m "not slow"   # pure helpers, offline
uv run pytest tests/test_build_showcase.py -m slow         # venom-eat and phosphatase-eat end to end, network faked
```
