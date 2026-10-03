# Showcase example datasets

`build_showcase.py` builds the five bundles behind the Import menu's **Examples** on
protspace.app: the startup demo, one curated EAT example and the manuscript's datasets.
`showcase.toml` holds one recipe per dataset, `styles/` holds their curated legends and
`inputs/` the pinned inputs the repository owns (the EAT example's accession list). The
design is in the OpenSpec change `openspec/changes/curated-example-datasets` (Decisions 1
and 9–13, tasks §6–§7).

Every bundle is written as **parquetbundle v3** (the container protspace 4.16 writes; v1/v2
files are still read, but reading them is deprecated). The 2026_03 files were first
built on protspace 4.15.0 and published as v2 under `<id>_2026_03.parquetbundle`; those
assets stay as they are. The v3 files were rebuilt on 4.16.0 from the same caches and are
published next to them in the same release as `<id>_2026_03_v3.parquetbundle`
(`[build] file_pattern`), since a release file name never carries other bytes.

`write_manifest.py` writes the web app's example manifest
(`apps/web/src/explore/example-manifest.ts`) from the bundle files, of any container
version; `build_showcase.py stage-release` calls it. `generate.py` and `datasets.toml` in
this directory are unrelated: they build the Colab notebooks' `examples` release.

## What the build does (strategy R)

Each paper dataset keeps its protein set and its published coordinates, UMAP and PCA
(D3). Every annotation source is fetched again with the **fixed** CLI at the current
UniProt release; nothing of theirs is re-embedded and no UMAP is re-run. The EAT example
has no source bundle (`embed-build`): the build makes all of it from a pinned accession
list.

| id                    | Kind            | N       | Source of the layout                                        | Annotations                                                        |
| --------------------- | --------------- | ------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `demo`                | `demo-refresh`  | 7,831   | the current demo (4 projections, mature peptides)           | every source, from full-length sequences; the mature `length` kept |
| `three-finger-toxins` | `embed-build`   | 1,089   | built here: ProtT5 of the mature chains, UMAP 2 and PCA 2   | every source (full-length sequences), labels, hold-out, EAT        |
| `human-fly`           | `paper-refresh` | 105,562 | `nm_2026/data/joint_proteome_105k_stats` (Fig. 2B)          | every source but Biocentral (D4)                                   |
| `beta-lactamase`      | `paper-refresh` | 113,015 | `nm_2026/data/beta_lactamase_2026_stats` (Fig. 3)           | every source but Biocentral (D4)                                   |
| `swissprot`           | `paper-refresh` | 573,649 | `nm_2026/data/swissprot_573k_stats` (Fig. 2A), UMAP and PCA | every source but Biocentral (D4)                                   |

Biocentral's models read the per-residue ProtT5 matrix, which UniProt's mean-pooled
vectors cannot give back, so the three large sets would need 10–25 h of embedding on the
public server each. Their recipes skip that stage (`enabled = false`, with the reason);
the docs cards say so. The former `venom-eat` and `phosphatase-eat` examples are gone
from the menu; their frozen files stay test fixtures, `perf-datasets` assets
(`stage-perf`) and Zenodo files for the paper.

### `embed-build`: the EAT example

`three-finger-toxins` is every snake three-finger toxin at 2026_03,
`(xref:interpro-IPR003571 OR family:"three-finger toxin family") AND (taxonomy_id:8570)`,
pinned in `inputs/three-finger-toxins.accessions.txt` (sha256 in `membership_sha256`).
Swiss-Prot curators name each one's class in `cc_similarity`; the TrEMBL entries,
venom-gland transcripts, carry none. The steps:

1. **entries.** The pinned entries' sequences, features (`ft_signal`, `ft_propep`,
   `ft_chain`, `ft_peptide`), names and similarity text from UniProt, batched; a missing
   entry fails the step (the list needs a new release, not a silent gap).
2. **sequences.** Each entry's **mature chain** (`mature.tsv` records start, end, length
   and how it was found), cut by one rule for references and queries: the annotated
   Chain (Peptide without one; the longest when there are several), else the sequence
   without its signal peptide and terminal propeptide. An entry with none of these
   features is cut after `[mature] signal_motif` (the signal peptide's conserved end)
   when it occurs in its first `motif_window` residues, else used as deposited. An
   unreviewed chain (SignalP's, which keeps any propeptide) that starts with a
   propeptide a reviewed entry of the set has curated, within
   `propeptide_max_mismatches`, loses it too (`propeptide_from` names that entry).
   Swiss-Prot often holds the mature chain sequenced from venom and TrEMBL the
   precursor, so embedding full-length sequences would put the two in separate islands
   (CRITIQUE2 G1); the colubrid queries that kept their propeptide formed an island of
   their own too. `full_length.fasta` keeps the whole sequences.
3. **embed.** `protspace embed --backend local -e prot_t5`: ProtT5-XL-U50 per protein
   from the half-precision encoder UniProt uses (`Rostlab/prot_t5_xl_half_uniref50-enc`),
   run here rather than on a remote service. `embed.vectors_sha256` and `embed.sha256`
   pin the result; `embed.input` may name a copy of the pinned file (the Zenodo one),
   which a rebuild then uses instead of embedding again.
4. **fetch.** Staged `protspace prepare -i <mature H5> -f full_length.fasta -m umap2,pca2
   --n-neighbors 25 --min-dist 0.1 --random-state 42 -a …`: the projections are kept, and
   InterPro (with Phobius), TED and Biocentral read the full-length sequences.
5. **assemble.** `toxin_class` (8 classes) and `toxin_subfamily` (3) from the similarity
   text (`[labels]` rules, first match wins); TrEMBL's automatic rule label goes to
   `toxin_class_uniprot_rule`. `[holdout]` draws a stratified 20 % of the Swiss-Prot
   entries (classes and ids sorted, seed 7), blanks their labels and keeps the truth in
   `<column>_withheld`; `eat_split` is `reference`, `holdout` or `trembl`. The labels are
   also written to `work/labels.csv` for the Zenodo deposit. The `holdout_split` gate
   pins which rows are held out (a NumPy upgrade may draw others under the same seed),
   and the bundle's provenance records the fraction, seed, stratum, transfer metric and
   where the vectors came from.
6. **transfer.** `protspace transfer --k 1 --metric euclidean` from the references to the
   held-out and TrEMBL rows (`bundle` first, since `transfer` reads a bundle). The guard
   fails the step if a query row regains a label.
7. **stats, style, finalize** as for every dataset, with the EAT settings envelope
   (`eatConfidenceThreshold` 0).

The build steps for each dataset are:

1. **check-inputs.** Checks the sha256 and size pins, the H5 files and the source bundle.
   It stops if the CLI checkout is older than protspace 4.16.0 (`annotate --cache-dir`
   from `fix/annotation-retrieval`, no faithfulness ceiling since PR #452, and
   parquetbundle v3). It notes which release UniProt serves.
2. **fetch.**
   - `paper-refresh` runs staged `protspace prepare -m pca2 -a …` calls that reuse the
     per-source cache. Each stage adds sources, so a failure costs only its own stage.
   - `embed-build` runs the same stages on its own embeddings (above).
   - `demo-refresh` fetches full-length UniProt FASTA and runs one `protspace annotate`.
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
   - `fill_missing_taxonomy` (human-fly): a row whose UniProt entry is gone takes the
     paper's species and that species' refreshed lineage instead of literal `"None"`
     strings (W18).
4. **projections.** Keeps, renames and reorders the paper projections, UMAP first, named
   `ProtT5 — UMAP 2`. The coordinates are copied unchanged.
5. **stats.**
   - Runs `protspace stats --cluster-selection both` with an **explicit**
     `--stats-annotation` list (G12).
   - The demo gets none.
6. **bundle, style, finalize.**
   - `protspace bundle`, then `protspace style` with `styles/<id>.json`. Style entries for
     values the data lacks (that `style` would refuse) are dropped first.
   - Carried-over legends and the cluster legends are merged in afterwards, because
     `style` would reorder a manual legend.
   - The EAT example gets the settings envelope, with `eatConfidenceThreshold` 0 (D6).
   - Provenance goes into the annotations' parquet metadata (G15): `example_id`,
     `protspace_version`, `git_sha`, `builder_git_sha`, `uniprot_release` per column
     group (G10, `{group: {release, columns}}`), `membership_release`, `built_at`,
     `command`, `pipeline` and `zenodo_doi`. `command` and `pipeline` carry no machine
     path: `--cli-root $CLI`, `--out-root $OUT`, `$WORK`, `$NM_DATA`, `~` (W12;
     `write_manifest.py` redacts older stamps the same way). The refreshed groups' release is the one the
     fetch steps recorded for their data. It must be a single release and equal
     `--release`; what UniProt serves later does not matter, so a finished build can be
     finalized after UniProt moves on.
   - `finalize` writes the shipped file as **v3**, with this repository's protspace package
     (`protspace.data.io.bundle`: `replace_annotations_in_bundle`, then
     `replace_settings_in_bundle`), not with the CLI checkout. A v2 input from the CLI is
     encoded exactly as `protspace convert` encodes one (the same bytes as converting the v2
     file the build wrote before); a v3 input keeps its projection parts as stored. The
     statistics part keeps its bytes either way. `builder_git_sha` names the commit whose
     protspace wrote the container; `protspace_version` and `git_sha` remain the CLI's.
7. **verify.** Runs the gates and writes `verify.json`, with the sha256 of the file it
   checked. The build exits non-zero if a gate fails or is pending.
8. **report.** Writes the clustering report and thumbnails for the default-view choice
   (see below). An EAT column's thumbnail draws its transfers as rings.

Every step writes a marker under `work/.steps/`, keyed on a digest of everything the step
reads: its CLI command, the recipe keys it uses, the size and modification time of its
input files, the contents of its style file, and the CLI checkout's commit. A rerun skips a
step while that digest is unchanged, and runs a step whose inputs changed plus everything
after it. So editing an author fact (`membership_release`) or `[build] zenodo_doi` re-runs
only `finalize`, a style file re-runs `style` and `finalize`, and a new CLI commit re-runs
the fetch steps (quickly, from the cache) and everything after them. `finalize`'s inputs
also hold `[build] file_pattern` and the container version it writes, so a `build` with
the `_v3` names and the same `--cli-root` re-runs only `finalize` (then verify and
report): the v3 file is written next to the v2 one, which stays. Other changes to
`build_showcase.py` itself do not re-run finished steps: use `--redo STEP` (or
`--redo all`).

## Prerequisites

- A checkout of a **released CLI**, protspace 4.16.0 or later (tag `v4.16.0`): it has
  `fix/annotation-retrieval` (PR #495, released in 4.15.0), PR #452's faithfulness fix
  (4.13.1) and parquetbundle v3. The 2026_03 v2 bundles were built on `v4.15.0` and the
  v3 ones on `v4.16.0`; the manifest records the version and commit of the CLI that
  built each file. Pass its root as `--cli-root`. The script runs
  `uv run --frozen --project <cli-root> protspace …`, so the data does not depend on
  which branch the script itself comes from. The shipped file's container does not
  depend on the CLI either: the script writes it with the protspace package of the
  checkout it runs from (`uv run` from the repository root), which must write v3.
- The read-only inputs named in `showcase.toml`: `[paths]` (`suite`, `nm_data`, `cli_data`)
  or `--path NAME=VALUE`. They live in `protspace_publication/nm_2026/data/` and in the
  gitignored `apps/protspace/data/` of the author's checkout. The build only reads them,
  and refuses an output root inside the repository or an input directory.
- Network access to rest.uniprot.org, the InterPro and AlphaFold DB APIs, and Biocentral.
- For `embed-build`: the CLI's `local` extra (torch, transformers), which the build asks
  `uv run --extra local` for, and the ProtT5 checkpoint from Hugging Face (cached after
  the first run).
- The membership facts, recorded per recipe in `showcase.toml` (`membership`,
  `membership_release`) and derived from the paper's data, each with its reasoning in a
  comment: Swiss-Prot and human + fly are 2025_04; the 113,015 β-lactamases are every hit
  of `family:"beta-lactamase"` at 2026_02, unfiltered. Until a stated release is
  `YYYY_MM`, the `provenance` gate is pending and the bundle cannot be staged. Change one
  before the D2 measurement, not after: the re-run `finalize` changes the file, and the
  measurement is tied to its bytes.

Run everything with `uv run` from the repository root. Outputs go to
`~/protspace-showcase/2026_03/<id>/`, or to `--out-root`:

```
<id>/<id>_2026_03_v3.parquetbundle   the bundle (v3)
<id>/verify.json                     gate results, with the checked file's sha256
<id>/d2_measurement.json             swissprot: the browser measurement (record-load)
<id>/report/report.md, report.json, thumbs/*.png
<id>/build.log
<id>/work/                           intermediates, CLI caches, step markers, logs/, facts.json
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
# swissprot: 1.5–3 days, mostly TED (18–40 h). The paper's UMAP and PCA; no Biocentral (D4).
uv run python $S build --only swissprot --cli-root $CLI
uv run python $S build --only swissprot --cli-root $CLI --enable-stage biocentral   # a later refresh, after an operator batch run
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

# three-finger-toxins: about 10 min (2 min of CPU embedding, 4 min of Biocentral).
# Gates: the pinned 1,089 rows, embeddings and held-out rows, every row embedded as
# its mature chain by one rule (the 47 family-only Swiss-Prot entries too; no query
# keeping a curated propeptide or a predicted signal peptide; each vector's residue
# digest), hold-out accuracy ≥ 88 % (≥ 90 % at reliability ≥ 0.5), a transfer for
# every TrEMBL row and rings at ≥ 0.5 within 5 % of 312, no donor above 40, ≥ 85 %
# agreement with the class a query's name states, no refilled query row.
uv run python $S build --only three-finger-toxins --cli-root $CLI

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

`stage-release` and `stage-perf` copy files and print the `gh release create` commands,
with `--latest=false` so a data release never becomes the repository's "Latest" (W33).
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
- the format (`format-v3`): a v3 container whose cells decode in the v2 grammar; a legacy
  (v1/v2) file fails;
- no `(TC n` or "In the … section" family values;
- `xref_pdb` has both values, and `reviewed` is plausible;
- **informative columns** (W10, G13): no column the legend could only show as N/A or
  as one value, counted with the web's N/A rules (`MISSING_VALUE_TOKENS` in
  `packages/utils/src/visualization/missing-values.ts`, trimmed and case-insensitive; a
  test pins the two). Nothing is dropped: the gate lists them, and the recipe either
  leaves them out of its fetch or keeps them in `keep_uninformative` (a documented
  column whose one value is the fact, such as "all Swiss-Prot"). The default view's
  annotation and tooltip are kept implicitly; `fragment` (`yes` or empty) is a flag;
- every `root` value is a top-level taxonomy node (cellular organisms, Viruses, other
  entries, unclassified entries), never a deeper clade ("… group", "… subgroup"), and
  `predicted_transmembrane` holds no literal `none`, which the web shows as N/A (G2).
  Both fail on bundles built before the CLI fixes, so a rebuild on a cache that kept the
  old values cannot pass;
- the obsolete-accession count (rows empty in `reviewed` and `protein_name`), to state on
  the docs card (G17); a table with neither column fails rather than counting zero;
- no refreshed source (UniProt, taxonomy, InterPro, TED, Biocentral) empty on every row;
- the `defaultView` names are present;
- the settings envelope (EAT);
- the statistics name existing projections, and every projection has a faithfulness score;
- the coordinates equal the paper's (for `embed-build`, its own projections');
- provenance is written, and every release it states is a `YYYY_MM` UniProt release;
- `embed-build` only: the rows are the pinned list, and the embeddings are the pinned
  vectors (`pending` until pinned; other vectors fail, the same vectors in another file
  layout warn).

**Story gates** are set per dataset in `showcase.toml` (`[[datasets.<id>.gates]]`). An
unknown gate type fails. If a story gate fails after the refresh, that dataset ships
frozen (strategy F) and is labelled so (design Decision 9). Swiss-Prot's `pfam_duplicates`
fails when the annotation cache lacks `pfam` or `sequence`, and its `browser_load` (D2) is
pending until `record-load` has measured exactly the built file.

## Staging the release and the manifest

`stage-release` stages every dataset (or `--only` ones) whose `verify.json` passed — no
`fail`, no `pending` — on exactly the built file's bytes; `--force` stages the others with a
warning. A file whose name the committed manifest already publishes in this release with
other bytes is refused, even with `--force`: give it a new name (`[build] file_pattern`).
The re-pinned manifest no longer lists the v2 names, so it also reads the release itself
(`gh release view`, read-only; a warning when `gh` cannot): a name the release holds as an
asset with another sha256 (its `digest`) is refused too, and a file it holds with the same
bytes is left out of the upload. Into the staging directory it writes:

- the release assets `<id>_2026_03_v3.parquetbundle` and their checksums
  (`[build] checksums_file`, `SHA256SUMS_v3`: the release's `SHA256SUMS` lists the v2
  files), and the demo as `data.parquetbundle` (it stays in the repository, so its bytes
  change there);
- `example-manifest.ts`, written by `write_manifest.py` from the staged files, with the
  committed `apps/web/src/explore/example-manifest.ts` as the previous manifest (so the
  previous release's files are retained for one cycle and a recorded Zenodo DOI is kept
  for unchanged files);
- `RELEASE_NOTES.md`: for a new release, every file; for a published one, its published
  notes with the added files appended (`gh release upload` leaves the notes as they are).

It prints the owner's commands: `gh release create showcase-2026_03 …` for a new release,
or, when the committed manifest already names the release or GitHub has it (as for the v3
files), `gh release upload showcase-2026_03 …` without `--clobber`, followed by
`gh release edit showcase-2026_03 --notes-file …/RELEASE_NOTES.md`; then the copies of the
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
uv run pytest tests/test_build_showcase.py -m slow         # three-finger-toxins end to end: UniProt, embed and prepare faked
```
