# CHANGELOG


## v4.7.2 (2026-07-14)

### Documentation

* docs(ci-migration): protlabel is a separate PyPI project needing its own trusted publisher (#326)

Confirmed both `protspace` and `protlabel` are distinct PyPI projects (both at
4.7.1); the publish job uploads both wheels, so each needs an identical PyPI
trusted-publisher entry. Corrects the earlier "ships under the protspace release" note.

Co-authored-by: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`10a6dd5`](https://github.com/tsenoner/protspace/commit/10a6dd55606e1771ee5b6091be40365d0c9ae3ed))

### Fixes

* fix: point the PyPI README "ProtSpace Web" source link to tsenoner/protspace (#327)

The web source link still targeted the pre-rename tsenoner/protspace_web repo.
Update it to the canonical tsenoner/protspace (monorepo). User-facing link on
the published PyPI project page.

Co-authored-by: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`773cd81`](https://github.com/tsenoner/protspace/commit/773cd812a4978116435181b993eeeaf8666d93db))

### Unknown

* Merge pull request #325 from tsenoner/chore/reconcile-4.7.1

chore(release): reconcile protspace to 4.7.1 + stop tag-triggered prep builds ([`4ed9879`](https://github.com/tsenoner/protspace/commit/4ed9879d9dabc0bfd8ec31e44d3df122c1c27f46))


## v4.7.1 (2026-07-14)

### Breaking

* fix(ci)!: use GitHub App token for repository-dispatch to trigger publish workflow

The trigger-publish job was using the default GITHUB_TOKEN, which cannot
trigger other workflows due to GitHub's anti-recursion protection. Generate
a GitHub App token in the job and pass it to peter-evans/repository-dispatch.

BREAKING CHANGE: CLI flags changed in v3.3.1→v4.0.0 release cycle —
--no-scores replaced by --scores/--no-scores (default: scores enabled),
--non-binary removed (legacy JSON output dropped, only Parquet remains),
--half-precision removed (not implemented in Biocentral server).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5d8a3e5`](https://github.com/tsenoner/protspace/commit/5d8a3e54e1b02cb15b9412c2b99a3a60b87e5ae4))

* feat(data)!: add comprehensive feature extraction and output restructuring

BREAKING CHANGE: Restructure output directory organization

- Add enhanced UniProt feature retrieval with batch processing and validation
- Implement comprehensive taxonomy feature extraction with proper error handling
- Add InterPro domain feature retrieval with MD5-based sequence matching
- Restructure output paths with intermediate file management (_tmp, _intermediate)
- Add support for bundled Parquet files (.parquetbundle) and Apache Arrow format
- Implement length binning features for protein size classification
- Add protein family classification with top-9 filtering
- Enhance error handling and logging throughout data processing modules
- Add comprehensive type hints and documentation
- Modernize code with PEP 585/604 type annotations

This represents a major architectural improvement to ProtSpace's data
processing pipeline, significantly enhancing feature extraction capabilities
while maintaining backward compatibility for the legacy JSON format. ([`fce6931`](https://github.com/tsenoner/protspace/commit/fce69312605fd0b4acfa3b75895c2c3baf154548))

* fix(ui): dropdown direction and color synchronization

This commit addresses two UI-related issues:

1. Download Format Dropdown:
- fix: make dropdown menu open upwards by wrapping in div with drop-up class
- style: prevent dropdown from being obscured by elements below

2. Color Management:
- fix: synchronize colors between scatter plot, legend and color picker
- feat: add default color generation for JSON files without styling
- fix: properly handle color conversion between rgba and hex formats
- fix: ensure consistent color display for NaN values

BREAKING CHANGE: None ([`db23f5f`](https://github.com/tsenoner/protspace/commit/db23f5fbd2331eed4fabd0aee59c9765cbb92efb))

* fix: format README

BREAKING CHANGE: release ([`6199de8`](https://github.com/tsenoner/protspace/commit/6199de87c1102d77eb8f6ce18caf1e192bd01fe1))

* refactor: rename 'feature' to 'annotation' throughout codebase

BREAKING CHANGE: All 'feature' references renamed to 'annotation' for clarity.

- Renamed component properties: selectedFeature → selectedAnnotation, hiddenFeatureValues → hiddenAnnotationValues
- Updated data structures: features → annotations, feature_data → annotation_data
- Changed events: feature-change → annotation-change
- Updated documentation and API references
- Improved export filenames: add projection and annotation name & removed dimension suffix (PCA_2 → PCA) and simplified timestamp to date-only (YYYY-MM-DD) ([`4d493a1`](https://github.com/tsenoner/protspace/commit/4d493a14838af1e3e3400d05c367f546b5681d42))

### Build System

* build(protspace): root-context Dockerfile for the workspace image

protspace is now a uv workspace member: `uv sync --locked` needs the root
uv.lock (outside apps/protspace) and the protlabel member source, so the image
must build from the repo root. Mirror the apps/prep two-layer pattern:
- layer 1: bind-mount root lock + member pyprojects, `uv sync --no-install-
  workspace --extra frontend --package protspace` (external deps only)
- layer 2: COPY members, `uv sync --no-editable` → protspace + protlabel in venv
- runtime copies only the venv + the demo data json. Dropped the legacy
  /app/assets copy: assets ship inside the wheel (verified 9 files under
  protspace/assets), and the app resolves them via Path(__file__).parent/assets.
- publish workflow docker job: context apps/protspace → repo root + explicit
  file: apps/protspace/Dockerfile.

Layer-1 frozen sync dry-run validated locally; a live image build is task 3.4.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`23a4922`](https://github.com/tsenoner/protspace/commit/23a492259e56feb07cbdc3bdb07667cc4809efbd))

* build(monorepo): Dockerfiles + build contexts for the uv workspace (3.2)

- apps/prep/Dockerfile: rebuild from the REPO ROOT context (was apps/prep). prep
  is now a workspace member source-pinned to sibling protspace, so the image needs
  the root lock + both member sources. Two-layer uv pattern (deps via
  --no-install-workspace, then --no-editable --package protspace-prep) per uv docs;
  runtime copies only the venv. GPL-3.0 image label.
- apps/protspace/Dockerfile: repoint image.source label to the monorepo (build stays
  standalone from apps/protspace context; it has no workspace-sibling deps).
- docker-compose.yml + publish-images.yml: prep build context → root, -f apps/prep/Dockerfile.
- .dockerignore (new): keep the root build context small (.venv, node_modules, .git…).
- drop apps/prep/uv.lock (superseded by the workspace root lock); keep
  apps/protspace/uv.lock for the standalone protspace image + PyPI reproducibility.
- apps/protspace/package.json: bridge now exposes only `test` — dropping `build`/`lint`
  keeps `turbo build`/`turbo lint` (web CI's `pnpm build`/`quality:ci`) TS-only and
  uv-free; protspace's build/lint run in its own workflow. `turbo test` still spans both.

Dry-runs: `uv build --package protspace` produces the 4.5.0 wheel+sdist (PyPI path) ✓;
`pnpm build` green 3/3. The prep IMAGE build could not run locally — this sandbox has
no docker.io egress (BuildKit frontend/base pulls fail); needs a networked run (3.4).

OpenSpec merge-protspace-monorepo task 3.2.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`77bcbc8`](https://github.com/tsenoner/protspace/commit/77bcbc8482357c30c28c963ef7a507d88f31b6c0))

* build: migrate to dependency-groups.dev from deprecated tool.uv.dev-dependencies

Replace deprecated [tool.uv] dev-dependencies with the new [dependency-groups]
syntax to comply with uv latest standards and remove deprecation warnings. ([`663a98f`](https://github.com/tsenoner/protspace/commit/663a98fc4674410e9abdafc9b40453a4b24e7c62))

* build(protspace-prep): reproducible multi-stage image from frozen lockfile

The build copied only pyproject.toml and installed against floating ranges,
ignoring the committed uv.lock. Switch to a multi-stage build that installs
from the frozen lockfile (uv sync --frozen) and ships a slim runtime stage
without build-essential; pin base images by digest. Keep non-root appuser,
curl for the healthcheck, and the unchanged CMD.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`39185d3`](https://github.com/tsenoner/protspace/commit/39185d3a01d68ce9b4e689bf5602689626444015))

* build(protspace-prep): add slowapi for in-app rate limiting ([`da5254b`](https://github.com/tsenoner/protspace/commit/da5254b981a132945cdeddf853feb20cbe20ad79))

### Chores

* chore(release): reconcile protspace to 4.7.1 + stop tag-triggered prep builds

The CLI-help/styling work (#67, #68, PR #313) shipped as 4.7.1 from the old
standalone repo and is already on PyPI. Align the monorepo to that so its own
release pipeline doesn't try to re-publish 4.7.1:
- bump protspace + protlabel to 4.7.1 (pyproject x2, __init__.py, CLAUDE.md),
  regenerate uv.lock.
- publish-images.yml: drop the `tags: ['v*']` trigger. protspace now pushes
  `v*` release tags to this repo; the prep image deploys by digest on main and
  must not build/publish on those tags (a `v4.7.1` tag would otherwise mint a
  mislabeled protspace-prep:4.7.1 image).

A `v4.7.1` tag is created at this commit as the semantic-release anchor, so the
next protspace change releases 4.7.2+.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`a759ba2`](https://github.com/tsenoner/protspace/commit/a759ba2dfbe821df2458aa1427f44881ec41bfa3))

* chore(repo): update self-references for the protspace_web -> protspace rename

The GitHub repo was renamed protspace_web -> protspace (old standalone repo ->
protspace-legacy, archived). Update active URLs/labels to the new name:
- README/CONTRIBUTING/AGENTS, app UI links (Footer, support, Privacy),
  docs site (vitepress config + guide/developer pages), package.json name,
  and the apps/protspace Dockerfile image.source label.
- Fix two adjacent doc-rot items: a stale "Apache 2.0" license claim (now MIT)
  and a data-folder link still pointing at the pre-move app/public/data path.
- Rewrite the CI secrets-migration runbook for the rename
  (protspace-legacy -> protspace).

Historical CHANGELOG/planning-doc references to protspace_web are left as-is;
GitHub redirects old URLs to the new name.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`52c23c0`](https://github.com/tsenoner/protspace/commit/52c23c05bbb39d3e1bbaa5c84b300e289339b2bf))

* chore(license): relicense the Python apps to MIT (repo-wide MIT)

The Python side (apps/protspace, apps/prep, protlabel) was GPL-3.0 on the
premise that protspace's pymmseqs import linked a GPL mmseqs2. That premise
is wrong: both pymmseqs (heispv/pymmseqs) and mmseqs2 (soedinglab/MMseqs2)
publish MIT license metadata, so no copyleft dependency is linked. The whole
repo is now uniformly MIT.

- LICENSE: apps/prep + apps/protspace now MIT (matching the root).
- license fields: apps/prep, apps/protspace, protlabel pyproject → MIT.
- image labels: both Dockerfiles org.opencontainers.image.licenses=MIT.
- docs: protspace README badge + CLAUDE.md; protlabel README; and the
  merge-protspace-monorepo OpenSpec D4 decision/proposal/tasks corrected
  from the split-license (GPL) rationale to repo-wide MIT.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`361f901`](https://github.com/tsenoner/protspace/commit/361f901c49827da71ed92c2b6e1e87003a015d5c))

* chore(ci): drop redundant .dockerignore entry and duplicate uv-tools restore-key

From a /simplify pass over the monorepo-merge integration glue:
- .dockerignore: `docs/.vitepress/dist` is already covered by `**/dist`.
- protspace-release.yml: the first `restore-keys` entry duplicated the exact
  cache `key`, so it could never restore anything the primary key didn't.

Both are behavior-preserving cleanups.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ddd34c9`](https://github.com/tsenoner/protspace/commit/ddd34c9cf987e4353f929112a385c595271cb712))

* chore(transfer): sync protlabel to 4.5.0 for lock-step release

protlabel/pyproject.toml was initialized at 4.4.0 while protspace is at
4.5.0. CLAUDE.md requires the two distributions to version in lock-step
(python-semantic-release manages both via version_toml). Bump protlabel
to 4.5.0 and regenerate uv.lock to match.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`8f7bbd3`](https://github.com/tsenoner/protspace/commit/8f7bbd35fde006e8dc61b394faba75e3aa9f67f1))

* chore(transfer): drop unused MagicMock import in test_base_data_processor

Leftover from main's mock-based test_save_output_bundled variant, which the
merge resolution discarded in favour of this branch's real-bundle integration
test. No remaining reference to MagicMock in the file.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`7bfebc6`](https://github.com/tsenoner/protspace/commit/7bfebc6556a32210f55b9e0f90ccc5a79ce71223))

* chore(transfer): drop lingering scipy mentions from protlabel after dependency removal

The scipy dependency was removed earlier; backends.py and a test comment still
named scipy.cdist as the comparison baseline. Reword to neutral phrasing so no
scipy reference remains in the tree (the kNN path is pure numpy).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`5e8bfed`](https://github.com/tsenoner/protspace/commit/5e8bfede264a899e99f20e9d6886fafa5dc8ff0f))

* chore(docs): remove EAT build plan + superseded draft; keep design spec ([`6e868e1`](https://github.com/tsenoner/protspace/commit/6e868e18444f268f171f5f9cf97337df702e0c47))

* chore(protlabel): scaffold EAT engine package + scipy dep

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`abd8fc5`](https://github.com/tsenoner/protspace/commit/abd8fc551a7832d076dc0deead33f380ae5d0803))

* chore(docs): add EAT annotation-transfer design spec + backend implementation plan ([`46e11b3`](https://github.com/tsenoner/protspace/commit/46e11b39dd87e8c8128663f2ad6dabbff8a0b979))

* chore(license): set Python side to GPL-3.0, correcting upstream AGPL mismatch (4.1)

Per owner decision: protspace is GPL-3.0, not AGPL. Upstream shipped an AGPL-3.0
LICENSE file while its pyproject declared GPL-3.0 — the AGPL file was the error.
This keeps design D4's firewall intact (arm's-length GPL, not network-copyleft AGPL,
so nothing reaches the MIT frontend).

- apps/protspace/LICENSE: AGPL-3.0 → verbatim GPL-3.0 (matches its pyproject license)
- apps/prep/LICENSE: new GPL-3.0 (prep imports protspace → derivative)
- apps/prep/pyproject.toml: add license = "GPL-3.0"

Still pending on 4.1: image-label license (Phase 3 Dockerfiles) and the legal
sanity-check on the pymmseqs GPL linkage before any published label.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`81f6c3a`](https://github.com/tsenoner/protspace/commit/81f6c3a05a7ff9fab486a3125987d15ee7d1f77a))

* chore(data): add 3FTx raw data spreadsheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`dfd5d9a`](https://github.com/tsenoner/protspace/commit/dfd5d9af8707b3928810d39b8da1f81750fa17a7))

* chore(data): trim JMB toxprot archive to embedding-based files

Drop the sequence-similarity projection JSONs (toxins_seq_sim*.json) and
the supplementary toxins_all.csv. The archive keeps the ProtT5
embedding-based ProtSpace JSONs, toxins.csv (accessions + curated
protein_category), and the reconstructed FASTAs. README updated to match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`c2cdec7`](https://github.com/tsenoner/protspace/commit/c2cdec7a1de180a2af2a4c17f3a4311bb1e5dc8c))

* chore(data): stop tracking JMB toxprot embeddings .h5

Keep the 22 MB ProtT5 .h5 out of git (it's reproducible from the mature
FASTA via `protspace embed`). The rebuild script now reads the accession
list from the tracked toxins.csv instead of the .h5, so the archive stays
self-contained without the embeddings. README clarifies the .h5 is
untracked and documents the toxins.csv vs toxins_all.csv column split.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`b464fad`](https://github.com/tsenoner/protspace/commit/b464fadba3f9031b88e20446296710818ca75144))

* chore(data): archive original JMB 2025 toxprot dataset

Restore the venom-toxin (ToxProt) dataset behind the original ProtSpace
JMB 2025 figures (from commit 1faabf8, removed in the Oct 2025 cleanup)
into data/jmb_2025/toxprot/ for backwards compatibility: ProtSpace JSONs
(embedding + sequence-similarity projections), ProtT5 embeddings, and
annotation CSVs.

The input FASTA was never committed, so rebuild_mature_fasta.py
reconstructs both full and signal-peptide-stripped sequences by
re-fetching the 5,181 accessions from UniProt (5,179 recovered; 2 now
obsolete). README documents the dataset and the exact DR parameters used.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`4847d83`](https://github.com/tsenoner/protspace/commit/4847d83de2595c93fbd286906dcbb4cf9bae70b0))

* chore(toxprot-demo): track regenerated demo bundle

Add the regenerated 7,831-protein toxprot demo bundle (ProtT5 + ESM2-650M,
mature peptides) to the repo. data/toxins/ is whitelisted in .gitignore
for exactly this purpose, matching the precedent of the legacy bundle
files we deleted in the previous commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`de684bd`](https://github.com/tsenoner/protspace/commit/de684bd0f520eae94ea64def82ce38455ae0172c))

* chore(toxprot-demo): swap ESMC→ESM2-650M, drop extras, restyle top-9

- Use prot_t5 + esm2_650m as the two embedders (was prot_t5 + esmc_300m).
- Trim the bundle to the original demo's 18 annotation columns: drop
  signal_peptide (sequence was stripped in this pipeline so the SP
  annotation no longer applies) plus the InterPro/taxonomy auxiliaries
  brought in by the `interpro` and `taxonomy` annotation groups.
- Reorder columns so protein_families is the first non-id column — the
  web app picks the first non-id column as the default annotation.
  Bundle also keeps ProtT5 — UMAP 2 as the first projection so it loads
  by default.
- Recompute the manual top-9 + __NA__ categories for pfam, ec,
  superfamily, and cath from the new dataset (split on `;`, drop the
  trailing `|score` / `|EVIDENCE`); preserve the hand-curated
  protein_families styling byte-for-byte from the existing web bundle.
- Drop stale tracked data/toxins legacy artifacts left over from the
  pre-regeneration layout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`f56dd74`](https://github.com/tsenoner/protspace/commit/f56dd74eadb4f2e777070499d8d9491db96063d0))

* chore(toxprot-demo): align main with project logging convention

Apply code-review feedback on Task 6:
- Use protspace.cli.app.setup_logging instead of logging.basicConfig.
  This caps urllib3/requests at WARNING (else they spam DEBUG with
  -v) and routes through the tqdm-aware handler so subprocess
  progress bars don't get garbled.
- Switch -v to action="count" for parity with `protspace prepare`'s
  verbosity convention; default behaviour is unchanged (INFO).
- Use shlex.join when logging the prepare invocation so the printed
  command is copy-paste safe (METHODS contains a `;`).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`0cd7224`](https://github.com/tsenoner/protspace/commit/0cd72240200948fdf5bd5cedff558b8714d0fe63))

* chore(toxprot-demo): wire main orchestration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`a8731ff`](https://github.com/tsenoner/protspace/commit/a8731ffd95824b064d40015cf108b4baa9464e5c))

* chore(toxprot-demo): clarify postprocess_bundle id-mapping + error msg

Address code-review nits on Task 5:
- Comment why we map mature lengths by protein_id rather than zipping
  positionally — the prepare pipeline can reorder rows during
  EmbeddingSet merging and dedup, so positional mapping would silently
  corrupt lengths.
- Enrich the missing-key error to include the bundle filename, the
  size of the mature_lengths map, and the first 5 missing IDs — makes
  the live-run debug path much shorter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`12f6940`](https://github.com/tsenoner/protspace/commit/12f69404fe68c13574069656f6e85d683c2a9579))

* chore(toxprot-demo): post-process bundle with mature length + settings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`e9458c4`](https://github.com/tsenoner/protspace/commit/e9458c496d82ebc8219e2c63817581c528fd6836))

* chore(toxprot-demo): tighten fetch_toxprot_tsv polish

Address code-review nits on Task 4:
- Document that the cache key is out_path only.
- Use splitlines() instead of count("\n") so the empty-payload guard
  doesn't fire spuriously if UniProt ever returns the data row without
  a trailing newline.
- Pass encoding="utf-8" explicitly to write_text for symmetry with the
  decode step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`46f2e84`](https://github.com/tsenoner/protspace/commit/46f2e8492d7aca434e849f446b22af9ca21043aa))

* chore(toxprot-demo): stream UniProt TSV with sequence + signal_peptide

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`05b9b2c`](https://github.com/tsenoner/protspace/commit/05b9b2c612f3557711534d8cb6a0a6aee0d00cc6))

* chore(toxprot-demo): write mature FASTA with SPs cleaved

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`9dc734e`](https://github.com/tsenoner/protspace/commit/9dc734ecd53b7b0bc2b817f675317a16b41b2e3b))

* chore(toxprot-demo): scope ?<> uncertainty check to SIGNAL bounds

Previously the uncertainty check ran against the entire Signal peptide
field, so a cleanly-bounded SP with a /note or /evidence containing
`?`, `<`, or `>` would be incorrectly skipped. Use the regex hit/miss
itself as the uncertainty signal: SIGNAL_RE only matches digit bounds,
so 0 hits + a SIGNAL keyword in the field == uncertain bounds. Also
guard against blank Entry rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`5784ad1`](https://github.com/tsenoner/protspace/commit/5784ad138fc3e06ab70e19d9261a678543915716))

* chore(toxprot-demo): parse signal peptides from UniProt TSV

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`e509e39`](https://github.com/tsenoner/protspace/commit/e509e39daac1791d0deb5ea3a66c8fb2ae770bc7))

* chore(scripts): scaffold generate_toxprot_demo

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`7966aeb`](https://github.com/tsenoner/protspace/commit/7966aeb12f2615a859c6dea4485172b4539ac52e))

* chore(scripts): add bundle inspector, fix h5 entry counter

count_h5_rows previously summed len() across all datasets, which
returned total residues (or entries × embedding_dim) instead of the
number of proteins. Replaced with a single-sample inspection that
reports entries, dimension, and dtype.

inspect_bundle is a new helper that prints rows/cols/schema and a
short preview for each table in a .parquetbundle, plus the settings
keys when present. Reuses read_bundle from data.io.bundle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`d5a87ab`](https://github.com/tsenoner/protspace/commit/d5a87abc1d267e76839b736152705348a5f1f0d1))

* chore: clean up scripts/, examples/, and .gitignore

Remove redundant scripts (biocentral/, figures_script/, check_version_bump.sh,
download_foldcomp.sh, plotly_markers.py, probe_hf_models.py), stale example
visualizations (examples/out/, ~60MB tracked), unused assets (annotate.py),
and bin/foldcomp. Move Workflow.svg to docs/publication/.

Trim .gitignore from 182-line GitHub template to 42 lines of project-relevant
rules. Add missing ignores (.playwright-mcp, .ruff_cache). Un-ignore scripts/
now that only useful scripts remain. Fix stale CLAUDE.md reference to removed
biocentral_embed.py.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`16f0ce9`](https://github.com/tsenoner/protspace/commit/16f0ce962435b2dd70634f320235465698ee449f))

* chore: remove dead code and redundant logging.basicConfig calls

- Remove 6 redundant logging.basicConfig() calls from library modules
  (only the CLI entry point setup_logging() should configure logging)
- Remove duplicate logger assignment in reducers.py
- Replace bare print(e) with logger.error() in reducers.py
- Remove commented-out dead code in local_data.py

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`b0bc896`](https://github.com/tsenoner/protspace/commit/b0bc8963584241c6e8d30910940e2302d60dd1ba))

* chore(data): update toxins dataset

- Update toxins.json with latest data
- Add toxins.parquetbundle for testing ([`b1f6c5d`](https://github.com/tsenoner/protspace/commit/b1f6c5d65b6785a038a14e31f30a18de4f195131))

* chore(data): untrack files now ignored by .gitignore

Remove from git tracking (files remain locally):
- All .h5 embedding files (large files)
- gfp, phages, sub_loc, nuclease, ec, cath, sizes directories
- Keep only 3FTx, Pla2g2, and toxins in version control ([`761d37b`](https://github.com/tsenoner/protspace/commit/761d37ba25f9f67b354820767b97f24b2d221ee0))

* chore(data): clean up obsolete toxins data files

Remove old processed data, protspace outputs, and scripts that are no
longer needed or should be regenerated ([`cfdb828`](https://github.com/tsenoner/protspace/commit/cfdb8285701161909f301bb548694e8666db5d50))

* chore(data): simplify .gitignore data rules

- Ignore all /data/* except 3FTx, Pla2g2, and toxins directories
- Always ignore pdb/, tmp/ subdirectories and .h5 files everywhere
- Reduces gitignore complexity from 30+ lines to 7 lines ([`661eea7`](https://github.com/tsenoner/protspace/commit/661eea798b882230113a047d13832fa51d9a6618))

* chore: remove matplotlib dependency ([`29f805b`](https://github.com/tsenoner/protspace/commit/29f805bfc5dc697873e6d79fc669968eaa71a9cf))

* chore: Making matplotlib an optional dependency

Creating a new optional dependency category "scripts"

Signed-off-by: Sebastian <sebastian.franz@tum.de> ([`096a297`](https://github.com/tsenoner/protspace/commit/096a2973690c2012db6c3644a6cde28b1aca9bb3))

* chore: configure ruff to ignore pytest fixture redefinition warnings

- Add F811 to per-file-ignores for tests/* directory
- Pytest fixtures intentionally redefine module-level fixtures
- This prevents false positive warnings in test files ([`aa1eb82`](https://github.com/tsenoner/protspace/commit/aa1eb8217d8d6a36dea07133941337b0e9a04205))

* chore: replace pylint with ruff

- Remove pylint from dev dependencies
- Add comprehensive ruff configuration
- Configure linting rules for unused variables, imports, and arguments
- Set up per-file ignores for test files ([`02defb9`](https://github.com/tsenoner/protspace/commit/02defb935cb7fd7bc66b327ab18d844f3a50bfb6))

* chore: update Dockerfile and improve script formatting in protspace_local.py

- Added curl installation to Dockerfile to work for pymmseqs2.
- Reformatted command arguments in run_prepare_json_script for better readability in protspace_local.py. ([`e8e85ec`](https://github.com/tsenoner/protspace/commit/e8e85eca1f49b6abdb1993efaad4074d1cabe18b))

* chore: update notebooks to install protspace[frontend] ([`cd88e2c`](https://github.com/tsenoner/protspace/commit/cd88e2cce72a423a826e244902639b59150471b2))

* chore: update example file ([`1b761a7`](https://github.com/tsenoner/protspace/commit/1b761a72e101b1da86f681e163d9993ec5dd2af3))

* chore: update example file ([`c4b7c3f`](https://github.com/tsenoner/protspace/commit/c4b7c3f62572dae8ae07da02168626884ba320b9))

* chore: fix docker container version tagging ([`0e31d90`](https://github.com/tsenoner/protspace/commit/0e31d907384fc35b1839c6080d94632668e49975))

* chore: improve uv caching ([`69d55a5`](https://github.com/tsenoner/protspace/commit/69d55a58c0e577b25cb1521274c00aac038a5006))

* chore: update uv.lock file [skip ci] ([`4f1c271`](https://github.com/tsenoner/protspace/commit/4f1c271330114ed842ddbd6de72517710a15ef34))

* chore: fix build process ([`9e340ed`](https://github.com/tsenoner/protspace/commit/9e340eddf7280e40bf9de3450e7bd913eef2b9f6))

* chore(license): relicense root/TS to MIT (D4)

Settle the TS/root side on MIT, resolving the pre-existing mismatch where the
root LICENSE was Apache-2.0 while @protspace/core and @protspace/utils already
declared MIT. Holder: The ProtSpace contributors.

- root LICENSE: Apache-2.0 full text → MIT (placeholder holder was never filled)
- apps/web/package.json: add "license": "MIT"

Python-side copyleft (apps/prep, apps/protspace) deliberately NOT touched here:
upstream protspace ships an AGPL-3.0 LICENSE file while its pyproject and design
D4 say GPL-3.0 — that GPL-vs-AGPL discrepancy must be resolved with the legal
sanity-check D4 already requires before labelling those dirs.

OpenSpec merge-protspace-monorepo task 4.1 (partial: TS/root only).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`90116e1`](https://github.com/tsenoner/protspace/commit/90116e14f76ead63035ff01e32a8c874cbc3f532))

* chore: archive route-biocentral-down-to-colab and sync spec

Move the completed change to openspec/changes/archive/ and create the
canonical openspec/specs/prep-failure-routing/ capability spec from its
delta.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`1e86d7d`](https://github.com/tsenoner/protspace/commit/1e86d7df7e5c6cbccb0d437d178cb448a8ae5b28))

* chore(deps): upgrade Vite 6 → 8 (+ plugin-react-swc 4, vite-plugin-dts 5)

Vite 8 needs plugin-react-swc >=4 (3.x caps at vite 7) and vite-plugin-dts
5; vitest 4.1 already supports vite 8. All packages build, type-check,
1479 unit tests pass, and the dev server + app (explore route, WebGL
canvas, legend) verified in the browser with no console errors.

Note: Vite 8 (Rolldown) suggests @vitejs/plugin-react over -swc for perf;
left as plugin-react-swc for now (functional, no swc plugins in use).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`80387e2`](https://github.com/tsenoner/protspace/commit/80387e25219be8be2e7464b36b6aac279348f675))

* chore(deps): upgrade TypeScript 5.9 → 6.0

The deprecated baseUrl/downlevelIteration options TS 6 would hard-error
on were already removed, and typescript-eslint 8.61 supports TS <6.1.
Full type-check, lint, and all 1479 unit tests pass under 6.0.3 with no
new type errors.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`bc523f7`](https://github.com/tsenoner/protspace/commit/bc523f7806db62d06c96a960561d0cb546fb3a29))

* chore(deps): upgrade ESLint 9 → 10

typescript-eslint 8.61 already declares ESLint 10 support
(peer ^8.57 || ^9 || ^10). Flat config unchanged; lint passes with the
same 21 pre-existing no-console warnings and 0 errors across all packages.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`af68ccb`](https://github.com/tsenoner/protspace/commit/af68ccb01a1790df296947a395fa13f260b41eef))

* chore(tsconfig): drop deprecated baseUrl/downlevelIteration options

TypeScript 5.9 flags `baseUrl` and `downlevelIteration` as deprecated
(removed in TS 7.0). `paths` resolve relative to each tsconfig since TS
5.0, so `baseUrl` is unnecessary; `downlevelIteration` is a no-op at the
ES2020 target. Removing both clears the warnings with no behavior change
(type-check + composite declaration build still pass).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`103fa7c`](https://github.com/tsenoner/protspace/commit/103fa7c1724bc84a16da5fbdacff51b01f62c364))

* chore(lint): clear unused-import warnings in tests

Removes 4 genuinely-unused test imports (ViewController, LEGEND_VALUES
x2, SizeMode) and enables `ignoreRestSiblings` on no-unused-vars so the
intentional `const { x, ...rest }` discard idiom stops warning. That also
makes an inline eslint-disable in bundle-roundtrip.test.ts redundant, so
it's removed.

Workspace no-unused-vars warnings drop from 7 to 1 (the remaining one is
a pre-existing load-bearing import in export-handler.ts). The intentional
no-console debug logs are left untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`10c5ddb`](https://github.com/tsenoner/protspace/commit/10c5ddb73a51bee2be503a6d4b3717201297b9e3))

* chore(deps): bump safe minor/patch deps and align app to Vite 6

Updates low-risk minor/patch deps to latest within their majors: lit,
@radix-ui/react-{tooltip,slot}, sortablejs, postcss, prettier,
autoprefixer, tsx, @typescript-eslint/*, @playwright/test, turbo,
vitest, lovable-tagger, hyparquet.

vitest 4.1 requires Vite >=6 (it imports vite/module-runner), which the
app's Vite 5.4 doesn't export — so the app moves from Vite 5.4 to 6.3,
matching core/utils and clearing the version split. plugin-react-swc
(^3.11, vite 4-7) and lovable-tagger (^1.3, vite 5-8) already support 6.

All 1479 unit tests pass; app builds and type-checks on Vite 6.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`63b5e9a`](https://github.com/tsenoner/protspace/commit/63b5e9ad056e25098d45be6358f93b2ef56447ac))

* chore(control-bar): polish — docs, dead code, and intent-pinning tests

- docs(explore): replace the removed XY/XZ/YZ plane-selector tip with a note
  that 3D projections render as their X/Y view (completes the #196 removal).
- test(scatter-plot): drop z:0 from style-getters mock points; PlotDataPoint.z
  was removed in this PR.
- refactor(query-types): stop seeding createGroup with a leading logicalOp:'AND'
  so a first-position group can't carry a spurious operator (mirrors
  createCondition; the builder sets the op for non-first groups).
- test(control-bar): pin the flat left-to-right operator precedence
  ((A OR B) AND C) so the known limitation stays an intentional choice. ([`174ba3a`](https://github.com/tsenoner/protspace/commit/174ba3a7aefc896faf448d2cc38a02219dc18a03))

* chore(scatter-plot): drop stale 'z' from x/y/z fast-path comment

Commit 7ae6f74 removed the optional z field from PlotDataPoint. The
fast-path comment in _updatePlotDataCoordinates still claimed
'overwrite x/y/z on existing PlotDataPoints' — it now correctly says
'overwrite x/y'. Comment-only; no behavior change.

Part of refactor for issue #196. ([`7e37db7`](https://github.com/tsenoner/protspace/commit/7e37db793cce514034d4b41f037467ac714dea39))

* chore(data): regenerate phosphatase demo with all annotations

Regenerates app/public/data/phosphatase.parquetbundle via the protspace
backend (uv-locked env) from the phosphatase FASTA with `-a all`: 1587
proteins, esm2_650m, pca2+umap2. Replaces the legacy bundle's pre-binned
`length_fixed`/`length_quantile` with numeric `length` and adds the full
annotation set (UniProt, InterPro, Taxonomy, TED, and the four predicted_*
Biocentral columns). Doubles as an end-to-end check of the new lockfile.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`4dfe515`](https://github.com/tsenoner/protspace/commit/4dfe515766f5c9a8064c004f370eae4a87ba7416))

* chore(data): restore pre-showcase default bundle

Reverts the temporary toxprot-2025 showcase default (5792fa4) back to the
regenerated ToxProt 2025 export with numeric `length` (948bbd3), now that
the showcase window has ended.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`5982913`](https://github.com/tsenoner/protspace/commit/59829139f9665bc3838b9e8685786e85fd34e0d9))

* chore(protspace-prep): drop comment duplicating setup_logging docstring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`fe53615`](https://github.com/tsenoner/protspace/commit/fe53615db0448a13ae0b84371cf32d1e3ed238a8))

* chore: update fastapi for local dev ([`60314ea`](https://github.com/tsenoner/protspace/commit/60314ea97ade92d4d18e9a95ca0002a5fa29a2fb))

* chore: remove inner Caddy and stale VM deploy artifacts ([`84aa861`](https://github.com/tsenoner/protspace/commit/84aa8610cd5608c2f35b962a07fe3c85e6884757))

* chore: pin prettier 3.8.3 and reformat for consistency

CI enforced prettier 3.6.2 (from pnpm-lock.yaml) while legend.ts and
openspec/config.yaml had been formatted with a newer 3.8.x locally,
breaking format:check. Bump prettier to 3.8.3 across package.json and the
lockfile, then reformat the files 3.8.x changes (interface extends-clause
wrapping) so the whole repo is consistent under one pinned version.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`8ea2329`](https://github.com/tsenoner/protspace/commit/8ea2329df201a368fc9fdb2afd8588716f7739fb))

* chore: remove deployment elements ([`fff2ef9`](https://github.com/tsenoner/protspace/commit/fff2ef9912fb5607e363076aefd8d7afaf32658d))

* chore: ignore docs/superpowers/ and exclude it from vitepress build

The superpowers/ subtree holds local planning/spec notes that aren't part
of the user-facing docs site. Untracking + srcExclude keeps these files
local without breaking the docs:build pre-commit hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`3ccc421`](https://github.com/tsenoner/protspace/commit/3ccc421a10dfabca44d9fb82705ceba82682612a))

* chore: drop test:ci from precommit

Type-check, knip, and the docs build still run on every commit; the
test suite now runs in CI only. Keeping `test:ci` in the precommit hook
made every commit a multi-minute wait, which encouraged --no-verify
detours that defeat the rest of the gate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`1550378`](https://github.com/tsenoner/protspace/commit/155037847fe0783ca9837c9618dd234a76b1d816))

* chore(infra): add backend Caddy reverse proxy for cross-origin dev

Mirrors the prod topology where the SPA and prep backend are hosted on
separate origins. The new compose service builds a custom Caddy image
with caddy-ratelimit baked in, fronts protspace-prep on
http://localhost:9090, and applies CORS headers, an OPTIONS preflight
short-circuit, a 9 MB submit body cap, and a 5-per-15min submit rate
limit so dev behavior matches what users will hit in prod.

Also adds PREP_SEQUENCE_MIN_COUNT=20 to the prep service env so the
floor enforced by the validator is configured at the deployment layer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`d3c9ee3`](https://github.com/tsenoner/protspace/commit/d3c9ee34803e4139eed6d83fd9cc55b4fd98e3a0))

* chore(prep): add Dockerfile, compose service, Caddy example, README

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`6add137`](https://github.com/tsenoner/protspace/commit/6add13770b019b6eee8d1a2da7b2950c8f136c10))

* chore(openspec): adopt OpenSpec as default spec-driven workflow

Add root AGENTS.md as the shared source of truth directing all coding
agents (Claude Code, Codex, etc.) to plan non-trivial changes in
openspec/changes/ instead of ad-hoc docs. Commit the openspec/ structure
(specs + changes). Per-tool skills/commands are CLI-generated locally via
`openspec init` and gitignored, like build output. Retires the
docs/superpowers planning docs.

Closes #262

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`fc294fb`](https://github.com/tsenoner/protspace/commit/fc294fb2a3053e54977fde17520fac6e54b6b65f))

* chore(data): swap default bundle to toxprot 2025 demo

Temporary default for a ~1 week showcase; will revert via
git checkout once the showcase window ends.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`5792fa4`](https://github.com/tsenoner/protspace/commit/5792fa4e220d73e57bcbf4f5c7b27c7d694de203))

* chore(scatterplot): fix stale shapeMapping JSDoc after includeShapes removal ([`cd2e290`](https://github.com/tsenoner/protspace/commit/cd2e290b8352f1710da7efed1cdbea597201bbd1))

* chore(legend): drop stale SHAPES reference in conversion.ts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`85eceae`](https://github.com/tsenoner/protspace/commit/85eceae25a78e346781d38ea76b401851d05b222))

* chore(legend): update stale comment referencing removed includeShapes ([`e053216`](https://github.com/tsenoner/protspace/commit/e0532169c3be8df37a3da89befa9bd964828d0c2))

* chore(docs): remove unused opfs-private-browsing-toast.png

Image was added in commit 2772510 for a PR description, never referenced
in docs or source, and not produced by the screenshot pipeline. ([`aeef4e4`](https://github.com/tsenoner/protspace/commit/aeef4e423b3a2b69aa2e94d78285528c256828ac))

* chore: register perf playwright specs as knip entry ([`c98e3d7`](https://github.com/tsenoner/protspace/commit/c98e3d7633e922b9f520d6ea5f208af5ad522389))

* chore(utils): re-format export-utils.test.ts to satisfy prettier ([`4077626`](https://github.com/tsenoner/protspace/commit/40776269c037567a2ab38d33bee6c5a25567e600))

* chore(dx): silence dev console — router future flags, HMR-safe customElement

- BrowserRouter opts into v7_startTransition + v7_relativeSplatPath to
  drop two React Router deprecation warnings.
- New safe-custom-element wrapper no-ops @customElement when the tag is
  already registered, preventing the NotSupportedError that Vite HMR
  emits on every file save. All 13 Lit components in @protspace/core
  now import customElement from this wrapper. ([`c407937`](https://github.com/tsenoner/protspace/commit/c407937c3843bf693bdd5d67f648ff4977b85c58))

* chore(scatter-plot): clear style cache on annotation refresh; cover Int32Array storage ([`02813fc`](https://github.com/tsenoner/protspace/commit/02813fcaf1256fc4a0f8a57b5b020d03ef54e78e))

* chore(docs): remove shipped superpower plans

Both the query-builder-filter design spec and implementation plan were
shipped in earlier work; the markdown artifacts no longer reflect
current state. Deleting to avoid stale-doc drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`d2b661a`](https://github.com/tsenoner/protspace/commit/d2b661a639a01812c47d4f6da23935f709e2ad5d))

* chore: remove superpowers plan and spec files

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`9359a10`](https://github.com/tsenoner/protspace/commit/9359a10ae680e075bc9617ff39817d2b6319aaea))

* chore(core): add lazy-loadable publish entry point

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`a024f80`](https://github.com/tsenoner/protspace/commit/a024f8029379dfea3a6cebc4bd54c46d65e9eabc))

* chore(scripts): simplify root command surface ([`fcfd682`](https://github.com/tsenoner/protspace/commit/fcfd682606a30b9c7af78c2403642b1ed17682de))

* chore(ci): separate quality from test and build ([`9eea1d5`](https://github.com/tsenoner/protspace/commit/9eea1d5cf42ad839934bd504cfb8b40252a3be5a))

* chore(explore): harden runtime review follow-ups ([`cca5768`](https://github.com/tsenoner/protspace/commit/cca57684f2bd633719520914076a5bf3c0769eb2))

* chore(quality): align ts and knip checks ([`a8047bb`](https://github.com/tsenoner/protspace/commit/a8047bb4eebbcaa3452fc62fb59e54ad4dcdbf68))

* chore: trim messaging guardrails ([`77e336d`](https://github.com/tsenoner/protspace/commit/77e336dc441eb4e940c60230f9debe7e4e3566f1))

* chore: remove unused @changesets/cli (#197) ([`4ce2514`](https://github.com/tsenoner/protspace/commit/4ce25148561c3bcb2439debfa971763ee465f5a1))

* chore: resolve merge conflicts with main and fix pre-commit ordering

Merge main (PR #191 OPFS persistence) into knip branch:
- Combine both sides of app/package.json (keep lint script + vitest)
- Regenerate pnpm-lock.yaml
- Reorder pre-commit hook: type-check before knip (matches CI)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7a1d18e`](https://github.com/tsenoner/protspace/commit/7a1d18ef1a05a0c5d21239e026c259dab4cd134c))

* chore(knip): rm unused exports

Signed-off-by: Elias Kahl <contact@elias.works> ([`f677fd5`](https://github.com/tsenoner/protspace/commit/f677fd5774d0d62b9fcab9fea4b648f22dfbc845))

* chore(knip): rm empty react-bridge package

Signed-off-by: Elias Kahl <contact@elias.works> ([`f175faa`](https://github.com/tsenoner/protspace/commit/f175faa0871e213a94ddb504144e44cfdf20b030))

* chore(lint): integrate app lint with global lint config

Signed-off-by: Elias Kahl <contact@elias.works> ([`0d1481c`](https://github.com/tsenoner/protspace/commit/0d1481c3932fb997a46e7efa5d64b2890e436031))

* chore(knip): rm unused code and depndencies detected by knip

Signed-off-by: Elias Kahl <contact@elias.works> ([`52dc7a6`](https://github.com/tsenoner/protspace/commit/52dc7a6a5a2cf50b7475eeeff76bbf8d82583f3c))

* chore(product-tour): remove the icon from the "Take a tour" button

Signed-off-by: Elias Kahl <contact@elias.works> ([`9d3e5c2`](https://github.com/tsenoner/protspace/commit/9d3e5c2eb124ed4f03b6a8f8b19e250e88234f47))

* chore(perf): remove swissprot from datasets used for perf

Signed-off-by: Elias Kahl <contact@elias.works> ([`f8e7042`](https://github.com/tsenoner/protspace/commit/f8e704228b9e9b6398e64985f2d2ed1bdf7d7722))

* chore: add logo ([`2429e4b`](https://github.com/tsenoner/protspace/commit/2429e4b4c691268625393b19ec35bb4044be2dd3))

* chore: add favicon ([`e486fc5`](https://github.com/tsenoner/protspace/commit/e486fc5a9ca6bec164003e8d714da8501b253e68))

* chore(data): update parquetbundle with new data ([`8094c9d`](https://github.com/tsenoner/protspace/commit/8094c9d89de1870a38134f75045f3223d18b27a1))

* chore(dependencies): add 'sortablejs' and its type definitions to package.json ([`73a183b`](https://github.com/tsenoner/protspace/commit/73a183b808ea268266db301e82d6a487ae1ad4a2))

* chore(dependencies): remove unused dependencies '@simonwep/pickr', 'core-js@3.37.0', and 'nanopop@2.4.2' from pnpm-lock.yaml ([`72ebcd1`](https://github.com/tsenoner/protspace/commit/72ebcd1a30938d87106ea8d48b5720412df9b3f6))

* chore(demo): reduce console logging verbosity

Remove excessive debug logs including hover events, event listener setup,
and verbose object dumps. Simplify remaining logs to concise messages. ([`cc88c42`](https://github.com/tsenoner/protspace/commit/cc88c4239831ddf50c26e230e474c4742da923da))

* chore: add git hooks with husky for automated pre-commit checks

Configure husky to run format, lint, type-check, and tests before each commit ([`1f73632`](https://github.com/tsenoner/protspace/commit/1f7363264b68770403d8b014d21ad3e0a74c93ca))

* chore(react-bridge): update test script to indicate absence of tests and provide guidance for future implementation ([`1b85973`](https://github.com/tsenoner/protspace/commit/1b859735dbfdde9a354d87a71483b6e38680988c))

* chore: update gitignore for Playwright artifacts ([`363e5b8`](https://github.com/tsenoner/protspace/commit/363e5b8243352c22d7e4502a305f34d5e4ff4c52))

* chore(docs): remove deprecated documentation files

- Remove old api/ folder (moved to developers/api/)
- Remove old examples/ folder
- Remove integration guides (consolidated in developers/embedding)
- Remove developer-guide, installation (moved to developers/)
- Remove getting-started, user-guide (replaced by explore section) ([`3680965`](https://github.com/tsenoner/protspace/commit/3680965d608ef2ed8af82d011c6637541ff29a04))

* chore(dev): remove proxy and unify docs configuration

- Remove Vite proxy and use separate dev servers
- Centralize DOCS_URL configuration
- Update README with new dev workflow
- Fix Header navigation and layout positioning ([`647deec`](https://github.com/tsenoner/protspace/commit/647deec382bf6e72f99de47078bba47656878db1))

* chore(css): remove redundant overflow-y property in right-panel

- Remove duplicate overflow-y: hidden declaration
- Keep overflow-y: scroll as the effective property ([`7f8402f`](https://github.com/tsenoner/protspace/commit/7f8402f198ba6f6aa2cd94e1f47ab23c9cd02bdd))

* chore: finalize project configuration and documentation updates

- Add /publication to .gitignore
- Update app metadata in index.html and 404.html
- Update Header, Footer, and Hero components
- Update documentation guides and API docs
- Update package.json and workspace config
- Setup deployment workflow (add deploy.yml, remove example)
- Clean up build configuration ([`96fd247`](https://github.com/tsenoner/protspace/commit/96fd2472c2329956f8ef5bc096d6a270f8b01f8c))

* chore(lint): remove --fix flag from default lint commands

Remove --fix flag from package-level lint scripts to make them safe for CI.

- 'pnpm lint' now checks without modifying files (CI-safe)
- 'pnpm lint:fix' at root level still available for local development

Affected packages: core, utils, react-bridge ([`cc3ef62`](https://github.com/tsenoner/protspace/commit/cc3ef629e45808564046ca461fd2da2fb80a3f37))

* chore(scripts): remove duplicate docs:dev script

The docs:dev script was duplicated (lines 10 and 18).
Kept the first occurrence at line 10, removed the duplicate. ([`2036f01`](https://github.com/tsenoner/protspace/commit/2036f017a011d10b45bc171beca4d502fdf36664))

* chore(deps): update dependencies

Added VitePress ^1.6.4 as dev dependency for documentation site.

Updated pnpm-lock.yaml with all related dependency changes. ([`da43f5f`](https://github.com/tsenoner/protspace/commit/da43f5f60a268cc3c7715471922a7ea160f3675e))

* chore(config): update project configuration

Updated app vite.config.ts with lovable-tagger plugin for development.

Enhanced vite-env.d.ts with comprehensive type definitions.

Added app/src/config/constants.ts for centralized configuration values.

Updated Hero component to use centralized constants.

Updated GitHub workflow to deploy example app correctly. ([`5feb7f9`](https://github.com/tsenoner/protspace/commit/5feb7f95a7d862a481f91e4e1ae6fab866fb9525))

* chore: apply prettier ([`ed08343`](https://github.com/tsenoner/protspace/commit/ed08343f63c3c2d74904a5581e9839e4db38e27f))

* chore(deploy): migrate to custom domain protspace.app

- Configure vite base path for root domain deployment
- Update CNAME and routing for GitHub Pages
- Replace all URLs from github.io to protspace.app ([`d672aec`](https://github.com/tsenoner/protspace/commit/d672aec68ce39e7e4eca2ef3121acc6c580efa42))

* chore(dependencies): update pnpm lock ([`5824baa`](https://github.com/tsenoner/protspace/commit/5824baa56ea8db973cd787fcbe8b9e30115493e4))

* chore(dependencies): update pnpm lock ([`350e4e6`](https://github.com/tsenoner/protspace/commit/350e4e64cd045a31ed30024b2fc600362402b1bb))

* chore: remove storybook

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`b2c88b6`](https://github.com/tsenoner/protspace/commit/b2c88b65c4320aa4f88feedfa34093094036b06c))

* chore: upgrade storybook

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`289fa69`](https://github.com/tsenoner/protspace/commit/289fa6977389c34ff3aeb392c74fa41fee8591dc))

* chore: remove compact legend as not relevant

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`b99486f`](https://github.com/tsenoner/protspace/commit/b99486f8e1d7836a64a8105d5d102355cb5ef250))

* chore: remove dataset label from stories

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`c6c969b`](https://github.com/tsenoner/protspace/commit/c6c969bd0062b29769a6675bba76ead54798499c))

* chore: remove incorrect titles from stories

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`beb818a`](https://github.com/tsenoner/protspace/commit/beb818a61bebbb94f0b0a77b60016e8e17361d54))

* chore: update lockfile

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`034825c`](https://github.com/tsenoner/protspace/commit/034825c047e2dfea9ca58ee90951e2bb353b8496))

* chore: fix organism not working

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`42ff11b`](https://github.com/tsenoner/protspace/commit/42ff11b38600242718a3ee3c826726eeb9005309))

* chore: consolidate structures

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`82b6145`](https://github.com/tsenoner/protspace/commit/82b6145c47db01d16c0347e363032ec411f044f8))

* chore: fix action plugin

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`3802b97`](https://github.com/tsenoner/protspace/commit/3802b97c17a8de4c0fe6f8ef716b731a3537dcc8))

* chore: fix outdated deps

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`dd51949`](https://github.com/tsenoner/protspace/commit/dd51949994e6b3c3e6b18d67962253b19293778b))

* chore: fix data import and overlap test ([`6be7757`](https://github.com/tsenoner/protspace/commit/6be7757d8a91fda0199746be08d3498da68e7a55))

* chore: fix storybook and provide basic component stories. ([`618d6e6`](https://github.com/tsenoner/protspace/commit/618d6e6b89d1bd8274929030783a6fce0daa3cab))

* chore(dependencies): use old one to resolve conflicts ([`583f6b0`](https://github.com/tsenoner/protspace/commit/583f6b0ee6e30bc3bf2b0e717c115844c87bfca2))

* chore(package): remove unused dev script and update workspace packages ([`431a3ad`](https://github.com/tsenoner/protspace/commit/431a3ad39c5d13d801fd6a9d86a1c6a9a5e360d1))

* chore(dependencies): update @typescript-eslint packages to version 8.46.0 and remove deprecated packages ([`1cc1625`](https://github.com/tsenoner/protspace/commit/1cc16257b6ee4a78e9d2e10892d9cc6814816b06))

* chore: run prettier ([`5af01a5`](https://github.com/tsenoner/protspace/commit/5af01a5b786051b043d3d89e0a0c735480accf3b))

* chore(data-loader): remove bundle inspection popup feature

- Remove createInspectionFiles function (~70 lines)
- Simplify extractRowsFromParquetBundle signature
- Eliminate automatic popup after loading parquet bundles

Removes intrusive popup that required manual dismissal after each file load,
improving user experience during data import workflow. ([`b1be98c`](https://github.com/tsenoner/protspace/commit/b1be98c6fd9f9887395a7aa66661f77eb73c5328))

* chore(data): update parquet bundle for scatterplot example ([`f88e762`](https://github.com/tsenoner/protspace/commit/f88e762fb609e86b3f1e814dacd00218f27afde8))

* chore: remove unused path entry from tsconfig.json ([`f414979`](https://github.com/tsenoner/protspace/commit/f41497930f239b5bb0aedf496ce63bbfc2a91152))

* chore: apply lint and prettier ([`a7c1aa9`](https://github.com/tsenoner/protspace/commit/a7c1aa97e2f83e59cf4030a22ab5b9a3880b142d))

* chore: remove CLAUDE.md file and update README with code style guidelines

- Deleted CLAUDE.md as it was redundant.
- Added Prettier and ESLint code style guidelines to README for better code quality and consistency. ([`f05c5d7`](https://github.com/tsenoner/protspace/commit/f05c5d7d81819911170189bde3ef9ec7fbcf4e1f))

* chore: applied prettier and lint on all the codebase

- Add configs to be able to use prettier and lint ([`4a292ba`](https://github.com/tsenoner/protspace/commit/4a292baf85d099dd37a6bf1469ec08faa5194ae9))

* chore(dependencies): add html2canvas-pro package to enhance rendering capabilities ([`d403621`](https://github.com/tsenoner/protspace/commit/d40362187e5680c38178b96220dcdee550df258a))

* chore(dependencies): update package versions in pnpm-lock.yaml ([`fdc3e45`](https://github.com/tsenoner/protspace/commit/fdc3e456bc587d87a1105e8748f347e34e2557b3))

* chore(package): downgrade @eslint/eslintrc to version 3.3.0 ([`4e45edf`](https://github.com/tsenoner/protspace/commit/4e45edf6e06c9ba4468c6930dddc7ef9a5f852f9))

* chore: add initial component version ([`4e8c868`](https://github.com/tsenoner/protspace/commit/4e8c8680b602b6fa6ce57e19291b430b73644726))

* chore: initial turborepo structure ([`e370b33`](https://github.com/tsenoner/protspace/commit/e370b339e32100e98186c95dfeba44a55da72780))

* chore: remove old unneeded vite config ([`02695b6`](https://github.com/tsenoner/protspace/commit/02695b6785d2ba1a7d2f899b30175cc1c77a22d6))

* chore(deps): pin dependency versions to exact semver

- Update package.json and pnpm-lock.yaml to use exact versions instead of caret ranges
- Change from ^x.0.0 to ^x.y.z format for all dependencies ([`0176c2f`](https://github.com/tsenoner/protspace/commit/0176c2fc70614aeccb6c63375e7bf310c2dfe83e))

* chore(assets): clean up unused images in public directory ([`83fa3a5`](https://github.com/tsenoner/protspace/commit/83fa3a5cdb76ff2197d6bd2ebd59d9cd73656c1e))

### Code Style

* style(stats): CI ruff format check rejected an over-long _merge_annotations_with_columns call; wrap it to satisfy ruff format

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`7064982`](https://github.com/tsenoner/protspace/commit/70649821581e7e5db106dae65a2d6553ac8ec3ca))

* style: apply ruff format to projection-statistics files

CI's `ruff format --check` flagged 9 files that were committed without
running `ruff format` (`ruff check` lint passed, but the formatter check
is a separate CI step). Pure formatting — no behavior change.
Stats suite still 30 passed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`996b53a`](https://github.com/tsenoner/protspace/commit/996b53a66ba13f404c6f79c1eae47e1d386fb6f6))

* style: fix ruff formatting in arrow_reader.py and reducers.py

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`a899cb8`](https://github.com/tsenoner/protspace/commit/a899cb8d8f7faaa282b5d0d5a068705b019c7073))

* style: apply ruff fixes and update notebooks for current CLI

Run ruff lint and format across the codebase. Add notebook-specific
per-file-ignores to ruff config for common Jupyter patterns (E402,
F811, ARG001, F841). Fix B904, C414, I001, UP012 lint issues.

Update Run_ProtSpace and PfamExplorer notebooks for current CLI:
replace removed -f/--features with -a/--annotations, change methods
from space-separated to comma-separated, and remove pinned commit
hash from install URL.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`52bb8cc`](https://github.com/tsenoner/protspace/commit/52bb8cc90f1663e452357b825bad0ef104e82f69))

* style: apply code formatting to utils module

- Format add_feature_style.py (quotes, line wrapping)
- Format arrow_reader.py (quotes, line wrapping)

No functional changes. ([`e52609b`](https://github.com/tsenoner/protspace/commit/e52609b1feb656c2e9b1390004e57673a6e0df79))

* style: update help menu ([`f42c0af`](https://github.com/tsenoner/protspace/commit/f42c0af262aa1331e5f4db695f628d71c77746b6))

* style: reformat for prettier 3.8 (post-merge dependency bump)

The merge of main bumped prettier ^3.6 -> ^3.8.3, which formats
interface-extends clauses and multi-line boolean chains differently.
These six branch-side files were last written under 3.6 and failed
format:check in CI. ([`d431117`](https://github.com/tsenoner/protspace/commit/d431117ef16015630c505b895caf5d52935b519e))

* style(scatter-plot): match point-count chip to top-left hover buttons

Restyle .plot-indicator from solid var(--primary) to the white card look
of the projection-metadata and tips triggers (tooltip bg/border/shadow
tokens, slate text, 2rem height) so plot overlays share one visual family. ([`48d63cc`](https://github.com/tsenoner/protspace/commit/48d63cce58f9abb7e801151937a4c4e009362e15))

* style(control-bar): match operator select chevron to logical-op select ([`b7f7e3b`](https://github.com/tsenoner/protspace/commit/b7f7e3be31f47fc7b8c73d6cd7249a9811964ddd))

* style(legend): reformat with prettier 3.8.3 to satisfy CI

A prior commit's lint-staged ran stale prettier 3.6.2, which left a
multi-line && block indented in the 3.6.x style that CI's pinned 3.8.3
rejects. No behavior change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`5f28ef3`](https://github.com/tsenoner/protspace/commit/5f28ef3cf2a197769f5a36975c8fb59aba31269f))

* style: prettier format multi-annotation-tooltip spec

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`ddf821e`](https://github.com/tsenoner/protspace/commit/ddf821ef086e75abf489e8b0ed5987de47acb637))

* style(core): update query builder styles and button integration

Refactor query builder styles for improved consistency and spacing, including adjustments to button styles using the new button mixin. Replace hardcoded colors with CSS variables for better theming support. Update button classes in the query builder component to utilize the new styles. ([`e20cd2b`](https://github.com/tsenoner/protspace/commit/e20cd2bf8426cce4fb709fd1c8cd09609868a518))

* style(core): fix prettier formatting in control-bar files ([`ba88c26`](https://github.com/tsenoner/protspace/commit/ba88c26c685081ca499d3891737aa039dc708e9e))

* style(export): enhance export menu styles with scroll handling ([`dd62458`](https://github.com/tsenoner/protspace/commit/dd62458d54e21de17b92e0384cce45ecdbbccab1))

* style(conrol-bar): slightly increase spacing between select and other buttons

Signed-off-by: Elias Kahl <contact@elias.works> ([`002286d`](https://github.com/tsenoner/protspace/commit/002286d0c95eb9f07b166067e2dbd1ccd97289d5))

* style: make header slightly smaller. ([`90b8984`](https://github.com/tsenoner/protspace/commit/90b8984e88f2c5e3b6a40fce732e29be3d1edb0c))

* style: add logo to README ([`eb7d201`](https://github.com/tsenoner/protspace/commit/eb7d201f75570b9f3e35def767aa43bef8b6b368))

* style: add logo to docs ([`bfb863b`](https://github.com/tsenoner/protspace/commit/bfb863b58938272c80a980082630b802b62db3bd))

* style(scatter-plot): update protein tooltip dimensions and improve text handling ([`47b1265`](https://github.com/tsenoner/protspace/commit/47b1265c4430334b3b13d70e30559e921727bbb9))

* style(ci): use single quotes in workflow file ([`05c105f`](https://github.com/tsenoner/protspace/commit/05c105f54097661e9bfa5840ba32ba0039354a10))

* style: apply consistent formatting across all files

Auto-format files with Prettier to fix CI format:check failures.

Changes:
- Convert double quotes to single quotes (per .prettierrc)
- Normalize line endings and remove trailing blank lines
- Collapse short arrays to single line
- Format 12 files that were not following project standards

Also add VSCode workspace settings:
- Enable format-on-save with Prettier
- Configure ESLint auto-fix on save
- Set Prettier as default formatter for all file types
- Recommend required extensions (Prettier, ESLint)

This ensures all contributors use consistent formatting and prevents
CI failures for format:check. ([`afbaf5a`](https://github.com/tsenoner/protspace/commit/afbaf5a8bc201eb50b782789ffd54cd072b14e1e))

* style(config): align ESLint and Prettier configurations

Changes:
- Update Prettier trailingComma from 'es5' to 'all' for consistency
- Remove formatting rules from ESLint (Prettier handles all formatting)
- Keep only code quality rules in ESLint

This prevents conflicts between the two tools and follows best practices
where Prettier handles formatting and ESLint handles code quality. ([`12ccdda`](https://github.com/tsenoner/protspace/commit/12ccddaf1a73f370f190a76e08e3758d923ababa))

* style(control-bar): adjust padding and alignment for improved layout for the filter list ([`8e6c064`](https://github.com/tsenoner/protspace/commit/8e6c064d36992f5e381d113dd17b5a222d0eae9b))

* style(control-bar): update filter menu styles to have a scroll bar ([`c7e1e75`](https://github.com/tsenoner/protspace/commit/c7e1e75d4e03dbea46a1c5b4a0f1d7667b455a5f))

### Continuous Integration

* ci: exclude imported python subtree from web prettier pass

The Code Quality job's prettier check tripped on the imported apps/protspace/
subtree (Python app with its own ruff toolchain, re-synced verbatim from
upstream via filter-repo) and reflowed data JSON. Excluding it keeps re-syncs
byte-for-byte and conflict-free; also ignore local .venv/.pytest_cache caches so
`format:check` matches CI. Reformat the two web-authored openspec docs to pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`6cc3cde`](https://github.com/tsenoner/protspace/commit/6cc3cdeea8613a988b34dd5e953daca85f87c37a))

* ci(protspace): reconcile publish/CI for the consolidated workspace

Post-merge fixes after protspace joined the single monorepo uv workspace:
- publish: build ONLY protspace + protlabel (lock-step), not `uv build
  --all-packages`. --all-packages also builds the private apps/prep member and
  writes dist/ to the workspace root, leaving packages-dir apps/protspace/dist
  empty. Verified locally: two `uv build --package … --out-dir dist` runs land
  exactly the two wheels+sdists in apps/protspace/dist.
- cache-dependency-glob: apps/protspace/uv.lock → uv.lock. The member lock is
  gone; the root lock is the single lock.
- bridge package.json 4.5.0 → 4.7.0 to match protspace/protlabel.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`d88e2b6`](https://github.com/tsenoner/protspace/commit/d88e2b61f4ce0e49cf36c0c6e0a502d62aebf34a))

* ci(monorepo): reconcile protspace release + publish workflows (3.1, 3.3)

Bring protspace's release/publish live in the monorepo (they were dead nested).

- semantic-release (apps/protspace/pyproject.toml): assets=[] and build_command=""
  — in the uv workspace `uv lock` only writes the ROOT lock, so semantic-release no
  longer manages a lock; it just bumps the version. Runs from apps/protspace so
  version_toml/version_variables stay relative (3.1). Keeps apps/protspace/uv.lock
  for the standalone protspace image (owner decision).
- .github/workflows/protspace-release.yml: on push main, paths apps/protspace/**,
  working-directory apps/protspace, semantic-release → repository_dispatch.
- .github/workflows/protspace-publish.yml: PyPI build + Dash image. packages-dir
  apps/protspace/dist; docker context apps/protspace; image kept as
  ghcr.io/<owner>/protspace (not the repo name).
- delete the dead nested release.yml/publish.yml.

Path-filtered set now: web ci/deploy (paths-ignore Python), protspace-ci (Python),
protspace-release/publish (apps/protspace), publish-images (apps/prep). All 7 YAMLs parse.

NOT locally verifiable — no Actions runner. Needs the task 3.4 dry-run (PyPI + prep
image) on this branch AND these repo secrets before archiving (4.3): RELEASE_APP_ID,
RELEASE_APP_PRIVATE_KEY, PyPI trusted publishing for `protspace`.

OpenSpec merge-protspace-monorepo tasks 3.1, 3.3.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`9c34c29`](https://github.com/tsenoner/protspace/commit/9c34c29e42712bcc3150091bbcb26fd4e283e6cd))

* ci(monorepo): move protspace CI to root, path-filter web CI (3.3 partial)

GitHub only runs workflows from the root .github/workflows, so the imported
apps/protspace/.github/workflows/* were dead. Bring the Python CI live:

- new .github/workflows/protspace-ci.yml: lint + test matrix (py 3.10-3.12),
  working-directory: apps/protspace, path-filtered to apps/protspace/**. Run
  commands verified locally in workspace context (uv sync --group dev, ruff check
  → clean, pytest collects 610 tests).
- delete the dead nested apps/protspace/.github/workflows/ci.yml.
- web ci.yml + deploy.yml: paths-ignore apps/protspace/** and apps/prep/** so
  web quality/build/deploy don't run on Python-only changes.

HELD (needs decisions + a live Actions dry-run, task 3.4): the release + publish
workflows. release.yml's semantic-release build_command "uv lock" updates the
ROOT lock in a workspace, colliding with its assets=["uv.lock"] and the kept
apps/protspace/uv.lock; plus it needs RELEASE_APP_ID / PyPI trusted-publishing
configured on this repo. Left inert at apps/protspace/.github/workflows/ until
reconciled. OpenSpec task 3.1 + rest of 3.3.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`aa22b78`](https://github.com/tsenoner/protspace/commit/aa22b78aaf6eccb9aed62ec4fb99a1d4582b89e7))

* ci: re-trigger release after corrupted merge event for PR #41

The merge commit (5cb91a4) landed on main but GitHub never processed
the push event due to a network issue, so CI, release, and issue
auto-close were all skipped. ([`6462a80`](https://github.com/tsenoner/protspace/commit/6462a80f6f22c52f9a3242e894837acfdbf2fada))

* ci: add ruff lint + pytest workflow on push/PR

Runs ruff check (blocking) and ruff format --check (advisory) plus
pytest with fast tests on push/PR to main and stage branches.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`88f7e2b`](https://github.com/tsenoner/protspace/commit/88f7e2b5109186c5ea69320d987de28f789f50b3))

* ci: modularize build process ([`d82b401`](https://github.com/tsenoner/protspace/commit/d82b40191bc0d93c9d02261b8aa165e994c77232))

* ci: write digest to image.env instead of rewriting compose.yaml

Pairs with deploy-repo change: the deploy job now overwrites image.env with
PREP_IMAGE_DIGEST rather than shelling out to the yq-based set-image-digest.sh
(now deleted in the deploy repo).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`58ec383`](https://github.com/tsenoner/protspace/commit/58ec3835a2e73b97b6e35fcab5f1cc4a4a31f337))

* ci: pin publish-images actions to SHAs and add provenance/SBOM

Pin all third-party actions to commit SHAs (version in trailing comment), add
provenance + sbom attestations to the image build, and scope the GHA cache so a
fork/PR build cannot poison the trusted main cache. Permissions and PR/deploy
trigger fencing unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`7819979`](https://github.com/tsenoner/protspace/commit/7819979bf4dc9211a6fc3ab228c168e975069508))

* ci: pin published digest into deploy repo to trigger doco-cd ([`a69c1a7`](https://github.com/tsenoner/protspace/commit/a69c1a78e291e927336ffde94cbf060ddc2b20d0))

* ci: expose protspace-prep image digest as build job output ([`972a6ec`](https://github.com/tsenoner/protspace/commit/972a6ec0857839d8b4834f26d2b69d5877581142))

* ci: stop building the caddy-ratelimit image ([`c6966df`](https://github.com/tsenoner/protspace/commit/c6966dfa897a688741ba279cbac596274bb334fc))

* ci: run Playwright e2e on PR and dedupe push/PR triggers

- Add e2e-tests job that auto-starts the dev server via Playwright's
  webServer block and uploads the HTML report on failure.
- Drop branches:['**'] push trigger so feature pushes don't run twice
  (once for push, once for the PR).
- Gate fasta-prep-live behind RUN_LIVE_E2E so the default e2e run
  doesn't try to hit the real prep backend. ([`ae3b1a3`](https://github.com/tsenoner/protspace/commit/ae3b1a343d35a2bb25606a196a76ba03da41cfb4))

* ci: add knip to pre-commit

Signed-off-by: Elias Kahl <contact@elias.works> ([`8f662e5`](https://github.com/tsenoner/protspace/commit/8f662e5bcbce56817e6e2cd76d9d0fb01e62bf88))

* ci: run tests in CI/CD workflows

Update CI and deploy workflows to run test:ci instead of test in watch mode ([`94ab5ff`](https://github.com/tsenoner/protspace/commit/94ab5ff23707d1191c62115de00274d4191de5b2))

* ci: add automated code quality checks

Add GitHub Actions workflow to run quality checks on all PRs:
- Code formatting (Prettier)
- Linting (ESLint)
- Type checking (TypeScript)
- Build compilation
- Test execution
- Documentation build

Runs on push to main and feature branches, plus PRs to main. ([`a2279b8`](https://github.com/tsenoner/protspace/commit/a2279b86d42a311a3336ce545520d4c85caede15))

* ci: remove outdated build

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`06e969b`](https://github.com/tsenoner/protspace/commit/06e969b68b26a71605250764c15a03d5f0ea5a19))

* ci: bump node version

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`f1fce8d`](https://github.com/tsenoner/protspace/commit/f1fce8d8bdbc55c974a01b45ebc943a24fa891b3))

* ci: use step outputs instead of env vars in workflow

Resolves linter warning for STORE_PATH context access ([`f633c47`](https://github.com/tsenoner/protspace/commit/f633c47b7daa3f0bca81883b3bdfa1306ef80790))

* ci: use turbo for example building (#45)

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`5adf6ec`](https://github.com/tsenoner/protspace/commit/5adf6ecc17383958d852b2162342f13aedad8327))

* ci: add GitHub auto deploy (#42)

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`352e387`](https://github.com/tsenoner/protspace/commit/352e387663615cb47548f847b515652b17a251db))

### Documentation

* docs: surface stats & transfer/EAT, bump version prose to 4.7.0 (#68)

README now lists all five annotation sources (adds TED domains + Biocentral
predictions), a transfer/EAT feature bullet + power-user example + Colab badge.
protspace/CLAUDE.md version 4.3.1 -> 4.7.0 and adds the transfer notebook.
(protspace/protlabel are already lock-step at 4.7.0 in code; the suite-level
CLAUDE.md, which lives outside this repo, was updated in place.)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`a37f52d`](https://github.com/tsenoner/protspace/commit/a37f52d0dcd7f94f30ce2c7e658abe02aedf3a16))

* docs(spec): CLI help restructure & docs refresh design (#67, #68)

Design for regrouping the protspace CLI help into intent-based panels
(prepare as entry point; stages/refine/view), crisper command summaries,
a quick-start block steering users to the web app (protspace.app/explore),
and per-command help consistency. 3D is de-advertised in help only
(pca3/umap3 stay functional). Folds in the numeric-styling docs/warning
(#67) and the README/CLAUDE.md refresh (#68).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`ae32e3d`](https://github.com/tsenoner/protspace/commit/ae32e3d78d02e7ecca532a05c4fef3cd02622fcf))

* docs(e2e): plan issue 249 suite optimization ([`b5a0cee`](https://github.com/tsenoner/protspace/commit/b5a0cee140b3bb5cfc69135cc5004dabd81beee4))

* docs: clarify comma role in v2 encoding contract ([`7dd3a74`](https://github.com/tsenoner/protspace/commit/7dd3a743e9f0861128e2ae0023cce42d8bddf579))

* docs: document bundle format v2 annotation encoding contract

Added v2 encoding subsection to data-format.md detailing:
- Reserved character percent-encoding (%/%25, ;/%3B, |/%7C, control chars)
- Literal characters that stay readable (comma, parens)
- Version detection via parquet metadata (protspace_format_version)
- v1 fallback for legacy bundles
- Note on unnamed CATH superfamily formatting (#57)

Updated docs/scripts/generate-annotations.mts to include per-column
grammar section in annotations.md explaining encoding rules upfront,
with cross-reference to detailed format doc. Section appears before
per-source descriptions, providing context for all annotation columns.

Verified docs build passes successfully.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ed5e49c`](https://github.com/tsenoner/protspace/commit/ed5e49cc9b066817b0b5cb967ae8ead5500fec66))

* docs(openspec): CI secrets/settings migration runbook

Document the release/publish secrets and settings that must move from the old
protspace repo into protspace_web before cutover: RELEASE_APP_ID /
RELEASE_APP_PRIVATE_KEY, the GitHub App installation, the `pypi` environment,
PyPI trusted-publishing config, and GHCR package access. Note the web/prep
secrets (DEPLOY_APP_*) are already present and must not be re-created.

Also close task 1.4: the carried branches (#66, #55, #60) landed on the old
main and rode through the deterministic re-sync merge, so no monorepo re-open
is needed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`06bd75b`](https://github.com/tsenoner/protspace/commit/06bd75b8b39889b6e3cbf87e5710a5dc4ff51e4a))

* docs(transfer): broaden kNN benchmark to 5 pLM dims (ESMC-300M/600M, ESM2-650M)

Add the embedding sizes ProtSpace actually serves so the scaling study is
representative rather than anchored on two dims: grid dim is now
{960, 1024, 1152, 1280, 2560} = ESMC-300M, ProtT5, ESMC-600M, ESM2-650M, ESM2-3B.

Re-ran bench_knn.py on the same Apple M4 Pro and rewrote the research doc's
results table (30 rows) and every derived figure: build-repayment (~40k queries
to repay the 37.5 s build at 100K x 1024), scaling (0.046 -> 0.117 -> 1.093 ms
at 1024; 0.116 -> 0.202 -> 1.720 at 2560; the mid dims interpolate), Swiss-Prot
extrapolation (~6 ms at 1024, ~10 ms at 2560), per-query speedup (~6-7x at 100K),
and the ef=64 recall range (0.02-0.93). Conclusion is unchanged: exact
brute-force wins end-to-end at every grid point with recall 1.0.

Also fixes two stale figures the re-review verification flagged: the recall
range and the "~5-6x" speedup were left over from the earlier dim set.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`a30ab74`](https://github.com/tsenoner/protspace/commit/a30ab74c27a19271401e7122a0da327ca586fa72))

* docs: slim the protlabel uv-workspace section in CLAUDE.md

Compress the EAT-engine section from ~24 lines (full ASCII tree + verbatim
[tool.uv.sources] snippet + prose) to a tight paragraph that keeps the
navigational essentials: it's a numpy-only workspace member, the boundary is
test-enforced, the module map, and the protspace-side glue files. Addresses
the review note that the section was context bloat.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`70317ce`](https://github.com/tsenoner/protspace/commit/70317ceef8b724efe6a527e716502d33246a505a))

* docs(transfer): benchmark pLM-relevant dims (1024/2560), drop ESM2-8M's 320

The kNN scaling study benched dim 320 (ESM2-8M), a model too small to be used
for real annotation transfer, which diluted the results. Swap the grid to
1024 (ProtT5, the transfer default) and 2560 (ESM2-3B, the large-model /
memory-ceiling case the doc already reasons about).

Re-ran bench_knn.py on the same Apple M4 Pro and refreshed the research doc:
the results table, the build-repayment and scaling numbers, and the recall
caveat (fresh 10K x 1024 ef-sweep: recall@1 0.33 -> 0.69 -> 0.98; 1st-2nd gap
~0.008). Conclusion is unchanged: exact brute-force wins end-to-end at every
grid point, recall stays 1.0, and it fits the 4 GB target at dim 1024.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`8b28064`](https://github.com/tsenoner/protspace/commit/8b28064b07080eba21992fe3d9aca40214712d73))

* docs(transfer): design for EAT visualization — source overlay + frontend spec

Captures the Wed 2026-07-01 EAT UX decisions: re-add COL__pred_source as
provenance (dashed connector line + tooltip, not a colour feature), keep
predictions inline under a reserved __pred_ namespace (no bundle-format
change), confidence as a selectable numeric annotation, and the answer to
the DR question (queries are part of the joint DR). Doubles as the source
for the protspace_web issues (#277 update + new provenance-lines issue).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ba43938`](https://github.com/tsenoner/protspace/commit/ba439383d13b8c8fd7a332d83df4cf18ab3ee1ad))

* docs(transfer): add usearch-vs-brute-force kNN scaling study + reproducible benchmark

Substantiates the brute-force-default decision (PR #55 review): an empirical
benchmark (packages/protlabel/benchmarks/bench_knn.py) of protlabel's exact
chunked-GEMM kNN vs usearch HNSW across n_refs {1K,10K,100K} x dim {320,1024},
plus literature context and a recommendation.

Finding: brute-force wins end-to-end for protspace transfer's one-shot/batch
usage (exact, no build, sub-ms to low-ms/query through Swiss-Prot scale). usearch
only pays off for a persisted index reused across tens of thousands of queries,
or as a memory lever (i8/f16 quantization) at full Swiss-Prot on a 4GB box.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`0528fdc`](https://github.com/tsenoner/protspace/commit/0528fdc864ce2ad6af80f9b164e7f35e0d276e65))

* docs: correct transfer --metric options (euclidean, cosine only) ([`ee937f9`](https://github.com/tsenoner/protspace/commit/ee937f954344e6374660a705ab7978ef8dfdf7c3))

* docs: document protspace transfer + prediction overlay columns

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`2efa098`](https://github.com/tsenoner/protspace/commit/2efa09856a8512d22f34d0f0ad5ffe3296fc8263))

* docs(annotations): document bundle format v2 encoding contract ([`34392c0`](https://github.com/tsenoner/protspace/commit/34392c0951ee032c235e87d36196738b92a49f67))

* docs(annotations): implementation plans for bundle format v2 (backend + frontend)

TDD, task-by-task plans covering the shared percent-codec, all backend emit
sites, #57 unnamed-superfamily fix, version stamp/detection, frontend v2 decode
branch, and the cross-repo golden-fixture proof.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`4634ee7`](https://github.com/tsenoner/protspace/commit/4634ee7a80326fa451c6cb459f3c862ccf912f88))

* docs(annotations): resolve v2 spec open items (version location + lossy export)

- §5: format_version lives in parquet file-level key-value metadata; verified
  end-to-end on pyarrow 20.0.0 (write) + hyparquet 1.26.0 (read).
- §7: pre-existing lossy frontend export filed as protspace_web#303 (project
  status Ready), out of scope for this change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`42724f4`](https://github.com/tsenoner/protspace/commit/42724f4c452fffa9f30444c2fb695d0d1b62b70d))

* docs(annotations): design for bundle format v2 name encoding (#56/#57/#58)

Percent-encode a minimal reserved set (% ; | + control chars) inside a
versioned flat STRING annotation cell; drop the fragile paren-depth/pipe
heuristics; label unnamed CATH superfamilies by bare code (drop parent-
topology inheritance). Backed by a deep-research pass + corpus scan +
cross-repo code maps.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`4242597`](https://github.com/tsenoner/protspace/commit/4242597a4036bb7d8b52fea0c4e484614ec23f69))

* docs(openspec): mark Phase 1 history import complete (1.1-1.3, 1.5)

filter-repo import of protspace under apps/protspace/ merged onto refactor/monorepo
(merge commit 30c2922a; 173 files, 603 carried commits, blame resolves to 2024).
1.4 (push carried branches + re-open PRs) held — outward-facing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`1d13ad1`](https://github.com/tsenoner/protspace/commit/1d13ad10756b7666186d22f2dd58866b005518c2))

* docs(stats): document annotation-based cluster-validity + --stats-annotation

Update CLAUDE.md, docs/cli.md, README.md, and the prepare-bundle Colab
notebook to describe the shipped feature: silhouette/DBI/CH validity is
now scored per user-selected annotation on both the embedding and each
projection (space_kind embedding|projection, annotation column in
statistics.parquet), auto-clustering is no longer self-scored but
instead reports ARI/NMI agreement with each annotation, and the new
--stats-annotation (auto|comma-list) flag picks which columns to score
on prepare and stats. Refresh the stats/ package-structure tree and the
test-file table with current test counts (grep -c '^def test_'),
including the new test_annotation_select.py and test_annotation_validity.py.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`dfe8f43`](https://github.com/tsenoner/protspace/commit/dfe8f434a0b1c027a7a733034a6e42a48de16aab))

* docs(stats): implementation plan for annotation-based cluster-validity

8 TDD tasks: annotation dimension in the data model, suitability filter +
label builder, AnnotationValidityStatistic (embedding + projection), ARI/NMI
agreement folded into ClusterValidityStatistic, driver once-per-embedding
pass, --stats-annotation on stats + prepare, docs.

Refs: #31, #64, protspace_web#296

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`d528c93`](https://github.com/tsenoner/protspace/commit/d528c939600c31f6fd0d7e01a957ba78b225c409))

* docs(stats): design spec for annotation-based cluster-validity

Rework cluster-validity to score user-selected annotations (silhouette/DBI/CH
on both the embedding and each projection) + ARI/NMI vs the auto-clusters,
replacing the circular auto-KMeans self-validity. Keeps the group-detection
membership columns. Gap/BIC k-selection deferred to #64.

Refs: #31, #64, protspace_web#296

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`dc37a52`](https://github.com/tsenoner/protspace/commit/dc37a5202c5011c4db4f97610cc4c6f54ddb2d96))

* docs(stats): document projection statistics (CLI, README, notebook)

- docs/cli.md: add the `protspace stats` command, the `prepare --stats` flag,
  `bundle -s/--settings`, and a "Projection Statistics" concept section.
- README.md: quality-metrics feature bullet + stats step in the power-user workflow.
- CLAUDE.md: stats command + usage, stats/ package tree, cli/stats.py, the 5-part
  bundle layout (statistics part + settings in unbundled output), and stats
  test-file rows.
- ProtSpace_Preparation.ipynb: a "Quality statistics" cell pointing to the CLI
  (the notebook installs from PyPI, so live-wiring the toggle waits for a release).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`a02443f`](https://github.com/tsenoner/protspace/commit/a02443f30f663aa9cc689fd9aad12f163a3df027))

* docs(plan): use chore: prefix for toxprot demo commits

The script is dev tooling, not user-facing package functionality;
chore: avoids triggering a minor bump from semantic-release.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`cba14e3`](https://github.com/tsenoner/protspace/commit/cba14e3e6490df0760c5d3b1b8f289cbb299d7bd))

* docs(plan): toxprot demo bundle regeneration implementation plan

Seven-task TDD plan that scaffolds the orchestration script, builds
parse_signal_peptides / write_mature_fasta / fetch_toxprot_tsv /
postprocess_bundle with unit tests where they make sense, wires up
main(), and finishes with a wipe + end-to-end verification step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`f88cbad`](https://github.com/tsenoner/protspace/commit/f88cbadd5d2ffde32c96080f187a8b47e0c4a9d2))

* docs(spec): toxprot demo bundle regeneration design

Design for recreating the demo .parquetbundle shipped at
protspace_web/app/public/data.parquetbundle with two new behaviours:
strip signal peptides before embedding, and add ESMC-300m alongside
ProtT5. A standalone scripts/generate_toxprot_demo.py orchestrates
fetch → strip → protspace prepare → length+settings post-process.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`30f2b0a`](https://github.com/tsenoner/protspace/commit/30f2b0a52aa3c41592e33cf8f8d4365c8ea93f11))

* docs: clarify multi-DR-params syntax and notebook gap

Follow-up to PR #48 review feedback.

- docs/cli.md: rewrite -m flag description to spell out the
  comma-vs-semicolon rule explicitly, add an "Overridable parameters"
  subsection listing the 11 valid override keys with their abbreviations
  and types, and extend "Projection Naming" with an example of the
  parameter-suffix disambiguation behavior.
- notebooks/ProtSpace_Preparation.ipynb: insert an informational markdown
  cell pointing power users at the CLI for parameter sweeps, since the
  toggle UI runs each method only once.

No code or behavior changes; release-bot will not bump the version.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`65bf612`](https://github.com/tsenoner/protspace/commit/65bf61205d4665320a47838a85e8612625777921))

* docs: document multi-input merging behavior (union vs intersection)

Document the fix from #44 — when multiple -i inputs share the same
embedding name, proteins are unioned; different names still intersect.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`20df47e`](https://github.com/tsenoner/protspace/commit/20df47e5b8409a9ce99abcefcc1e8add2e77468f))

* docs: add git workflow convention to CLAUDE.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`e4bf975`](https://github.com/tsenoner/protspace/commit/e4bf975188ec5aa3802735cea3e3877cbcb518d6))

* docs: cache FASTA and embeddings in Colab notebook

Pass embedding_cache to embed_fasta() and cache UniProt query FASTA
to output/tmp/ so re-runs skip expensive API calls. Also clean up
unused imports flagged by ruff.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`6c55c73`](https://github.com/tsenoner/protspace/commit/6c55c7341456a61a603a747516b861a55200c2e5))

* docs: update CLI caching section, test table, and UniProt ID handling

- Expand docs/cli.md caching section to document all 5 cached items
  (FASTA, embeddings, annotations, similarity, DR projections)
- Add 3 new test files to CLAUDE.md test table (pfam_clan, ted, biocentral)
- Update UniProt ID handling docs: identifiers must be bare accessions
- Update test counts (uniprot_retriever: 29→24 after _manage_headers removal)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`c2b7678`](https://github.com/tsenoner/protspace/commit/c2b76789fdf4b0f5211c58ff930688e0776e4888))

* docs: update annotations.md with all five data sources and groups

Fix header (three → five sources), add TED and Biocentral rows to
summary table, update InterPro count (9 → 10 for pfam_clan), add
ted and biocentral to group presets table, add CLI example.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b257d68`](https://github.com/tsenoner/protspace/commit/b257d68685e93df56d58373236c6e470bd9882d5))

* docs: update Colab notebook with new annotation sources

Add pfam_clan, TED Domains, and Biocentral prediction annotations
to the ANNOTATIONS dict in the preparation notebook.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d998b73`](https://github.com/tsenoner/protspace/commit/d998b73b51ff4c28f8738b0b0d2637e52ba55132))

* docs: remove legacy Dash frontend link from README

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`df59b7e`](https://github.com/tsenoner/protspace/commit/df59b7ed3707ba7da388e84fbfaae5f5ed968c70))

* docs: update notebook examples to use parquetbundle release assets

Point ProtSpace_Preparation.ipynb to the new `examples` release tag
with pre-generated .parquetbundle files instead of old H5 embeddings.

- URL: releases/download/v3.3.1/ → releases/download/examples/
- Replace 4 old H5 datasets with 5 new parquetbundles:
  three_finger_toxin, beta_lactamase, globin, phosphatase, snake_toxin

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`a17c6c8`](https://github.com/tsenoner/protspace/commit/a17c6c8267b09c8fd6fd853171e0935556fba285))

* docs: rewrite CLI reference — concise, complete, with colon syntax guide

Tighten all sections, add detailed prepare description with input
types, add model name resolution section explaining -i file.h5:name
colon syntax for external HDF5 files. Document --no-log and --keep-tmp.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`4a4b9e3`](https://github.com/tsenoner/protspace/commit/4a4b9e3d216a95e39bed84b8e7bca85aa58a6a55))

* docs: remove Explore_ProtSpace.ipynb (legacy Dash frontend)

Downloads pre-generated JSON and launches old Dash UI in Colab.
Replaced by protspace.app/explore for .parquetbundle visualization.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`3d574f4`](https://github.com/tsenoner/protspace/commit/3d574f4896b955ef5b6d5dc3065044ce7da8efd0))

* docs: remove Run_ProtSpace.ipynb (legacy Dash frontend)

The notebook launched the old Dash frontend inline in Colab.
Users should use ProtSpace_Preparation.ipynb to generate a
.parquetbundle and upload it at protspace.app instead.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`69f7c71`](https://github.com/tsenoner/protspace/commit/69f7c71d90a445ae3898971fadedf44717605930))

* docs: update Colab notebooks for new CLI

Update all 3 affected notebooks for the v4.0.0 CLI:
- ProtSpace_Preparation.ipynb: protspace-local → protspace prepare,
  update n_neighbors range (2-500, default 25), perplexity range (5-5000),
  eps default (1e-6)
- Run_ProtSpace.ipynb: protspace-local → protspace prepare,
  parameter names with hyphens
- PfamExplorer_ProtSpace.ipynb: protspace-local → protspace prepare,
  parameter names with hyphens, n_neighbors range updated

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`426127a`](https://github.com/tsenoner/protspace/commit/426127a95555827ec78757438611d155c86518a8))

* docs: update Colab notebooks for new CLI

Update all 3 affected notebooks for the v4.0.0 CLI:
- ProtSpace_Preparation.ipynb: protspace-local → protspace prepare,
  update n_neighbors range (2-500, default 25), perplexity range (5-5000),
  eps default (1e-6)
- Run_ProtSpace.ipynb: protspace-local → protspace prepare,
  parameter names with hyphens
- PfamExplorer_ProtSpace.ipynb: protspace-local → protspace prepare,
  parameter names with hyphens, n_neighbors range updated

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`4e4b733`](https://github.com/tsenoner/protspace/commit/4e4b73352538ad7bbda1a6cba77fce03daa07326))

* docs: update CLI reference, README, and CLAUDE.md for new typer CLI

- Rewrite docs/cli.md with all 7 subcommands (prepare, embed, project,
  annotate, bundle, serve, style), model name resolution, projection
  naming, and annotation caching documentation
- Update README.md quick start with new CLI commands and power-user
  workflow examples
- Update CLAUDE.md: CLI commands table, package structure (loaders,
  pipeline), usage examples

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7a6cbcc`](https://github.com/tsenoner/protspace/commit/7a6cbcc3183f9a80a65be748e53f3be20466c16b))

* docs: add CLAUDE.md with full project reference

Merge the previously split .claude/CLAUDE.md (untracked, comprehensive)
and CLAUDE.md (untracked, slim pointer) into a single tracked CLAUDE.md.
Includes package structure, DR methods, implementation details, testing,
conventions, and uv run instructions.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`3f7283a`](https://github.com/tsenoner/protspace/commit/3f7283afb9f3f30cbe1d329281c049363b40cf0e))

* docs(notebook): overhaul Colab UI with interactive widgets

Replace basic SelectMultiple widgets with a polished interactive UI:
- Annotation selection: checkboxes in 2-column CSS grids per category
  (UniProt/InterPro/Taxonomy) with per-group and global preset buttons
- DR method selection: ToggleButtons with color feedback and tooltips
- Method parameters: bordered cards in responsive flex-wrap grid with
  shared params merged (n_neighbors for UMAP/PaCMAP/LocalMAP, etc.)
- Dynamic show/hide of parameter groups based on selected methods
- Remove gene_name from selectable annotations (always auto-included)
- Add /.claude to .gitignore

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`97f120c`](https://github.com/tsenoner/protspace/commit/97f120c70effaafb99d3f96673516b970b01f72d))

* docs: polish README, add annotation and CLI reference docs

De-emphasize 3D in favor of 2D/ProtSpace Web focus, slim README by
moving detailed content to docs/annotations.md and docs/cli.md, update
example image with ProtSpace Web screenshot, and fix minor inconsistencies.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`1fbc465`](https://github.com/tsenoner/protspace/commit/1fbc465673f6c3c715dd62da413884f20d6134fb))

* docs: remove redundant poster landing page ([`b126b0e`](https://github.com/tsenoner/protspace/commit/b126b0e8b5b1764b7b1394d510c8cc5aaaa37bb8))

* docs(README): clarify method parameters section

- Change section title from 'Method Parameters' to 'Method Default Parameters'
- Add clarifying text about overriding defaults for fine-tuning ([`22ec44f`](https://github.com/tsenoner/protspace/commit/22ec44f7424e701d58a56dfb3901e40a4a36a630))

* docs(features): add 'xref_pdb' and remove 'sequence' from feature list

- Add 'xref_pdb' and remove 'sequence' from README.md UniProt features
- Remove 'sequence' from CLI help text in common_args.py
- Sequence is used internally but not exposed to users ([`7a29b94`](https://github.com/tsenoner/protspace/commit/7a29b9499c723c5d4f048615ba95f9c79e7af2b5))

* docs(cli): update features help text with new UniProt properties

- Update --features help to show annotation_score (not annotation)
- Add xref_pdb to list of available UniProt features
- Reflect changes from new unipressed-based retriever ([`3a33033`](https://github.com/tsenoner/protspace/commit/3a33033578eec9ac2a56a631c06bfe7060912f18))

* docs: update README with improved feature documentation

- Fix JavaScript frontend URL from protspace_d3 to protspace_web
- Add cc_subcellular_location and sequence to UniProt features list
- Enhance feature documentation with more comprehensive examples
- Improve command-line usage documentation
- Update feature extraction examples with better clarity ([`2d45e8c`](https://github.com/tsenoner/protspace/commit/2d45e8cd44ae68ac6401cdebb578044e7c499667))

* docs: Update README and CLI help to enhance feature extraction guidance

- Added a new section in README for the JavaScript frontend
- Revised the "Quick Start" section for clarity and updated usage examples for querying UniProt and processing local data.
- Expanded help text in CLI for feature extraction to include available UniProt, InterPro, and Taxonomy features. ([`c5be61f`](https://github.com/tsenoner/protspace/commit/c5be61f42d7bdcf5d7ea012ec61a13a830573e6a))

* docs: Update README examples to clarify usage of protein features ([`cdb0725`](https://github.com/tsenoner/protspace/commit/cdb072567c8bbc3cf9dc71ac085cb4e0bbb94a5f))

* docs: update README and add new CLI scripts for protspace-query and protspace-local ([`e41ac77`](https://github.com/tsenoner/protspace/commit/e41ac77ddc77f4a54b7106af4724b88fa06d1d5b))

* docs: update README to include detailed usage instructions for protspace-query and local data processing commands

- Added examples for `protspace-query` to search proteins from UniProt.
- Clarified required and optional arguments for both `protspace-query` and `protspace-local`.
- Enhanced descriptions for input types and method-specific parameters. ([`3fbd834`](https://github.com/tsenoner/protspace/commit/3fbd8346973a06e74db972b9952e424b9da3fcd9))

* docs: add image of the different 2D markers ([`a3eb914`](https://github.com/tsenoner/protspace/commit/a3eb9141260d81a15c365824823a7f157b2a41e4))

* docs: add note that external mode only works on Google Chrome ([`306791f`](https://github.com/tsenoner/protspace/commit/306791f0be8e024e2733fd6ae617429a3c70e5a5))

* docs: add PfamExplorer notebook ([`06564fb`](https://github.com/tsenoner/protspace/commit/06564fbd6fad945ed2e672dec342338b7b718b2b))

* docs: update the README to reflect the changes in frontend dependencies ([`fbd6edd`](https://github.com/tsenoner/protspace/commit/fbd6edd7638878ffa092ab482510d3e2113f7a27))

* docs: clearify the file upload in the embedding jupyter notebook ([`b9b4d98`](https://github.com/tsenoner/protspace/commit/b9b4d9889f263523136a042bedd5f6994e11c157))

* docs: Add citation, web-service URL, fix parameter typo ([`edf4ca1`](https://github.com/tsenoner/protspace/commit/edf4ca16cc420aa3b227d5c8c89d3dd6e87196fd))

* docs: add citation links to help menu ([`3ce540b`](https://github.com/tsenoner/protspace/commit/3ce540be24d2b97aeac584c71d83a51862d8034e))

* docs: Add full path to toxin 2D example ([`1ef2b8f`](https://github.com/tsenoner/protspace/commit/1ef2b8fcde48577e1f77a73de1308ace772b0eb2))

* docs(openspec): decouple cutover from v2 (D5)

Cut over first (plumbing only, blocks on no PR); filter-repo carries #66 in and
#306 stays in-repo, so v2 lands as the first monorepo PR that also debuts the
bundle-contract schema+fixtures. Verified conflict surface: #306/#233 are
packages-only; only #295 needs trivial path-move fixups. Rejected land-first
(slow) and pre-cutover cross-repo unify (needless choreography).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`5c2373f`](https://github.com/tsenoner/protspace/commit/5c2373f2320672251180665f5729ec417d63d582))

* docs(openspec): add merge-protspace-monorepo change proposal

Plan for merging the protspace Python backend into this repo as a monorepo:
git filter-repo import to apps/protspace, uv workspace with prep source-pinned
to protspace, shared bundle-contract (schema + golden fixtures, bidirectional
tests), PyPI publish gated on Python changes, and open-PR/cutover sequencing.

Decisions: prep -> apps/prep; split-license per directory (GPL-3.0 Python via
pymmseqs/mmseqs2 linkage, MIT TS) rather than a repo-wide relicense.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`74aef4a`](https://github.com/tsenoner/protspace/commit/74aef4af4b010a25b20ac9456898ec3417f0bc5b))

* docs(openspec): sync support-contact capability into main specs

Apply the support-mailto-integration delta as the baseline spec for the
new support-contact capability.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`d8ad46a`](https://github.com/tsenoner/protspace/commit/d8ad46a14bba3263054aa24be00256462151a0df))

* docs(scatter-plot): document visibility-model memo invariants ([`225bdd2`](https://github.com/tsenoner/protspace/commit/225bdd2cb465389a34f2b539873ff6c202448799))

* docs(openspec): propose unified point-visibility model ([`d8c7b62`](https://github.com/tsenoner/protspace/commit/d8c7b626bafb526bd9e85368ac8a2518713bf3b7))

* docs(app): drop Caddy references from prep client and live spec ([`dfe1e7a`](https://github.com/tsenoner/protspace/commit/dfe1e7ac718c310625ce81045808b0a15bdd14bf))

* docs: mention drag-and-drop FASTA prep on supported deployments

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`b850ff1`](https://github.com/tsenoner/protspace/commit/b850ff19faf32226633f3239037e181558e67111))

* docs: add duplicate badges gif ([`68c3bd9`](https://github.com/tsenoner/protspace/commit/68c3bd914bb3d018a6a6a04f273a40b3b43fe5c9))

* docs(chore): gitignore superpowers ([`47e47bd`](https://github.com/tsenoner/protspace/commit/47e47bda3bce3281d67c97921e1b202bd61a1fcd))

* docs: remove Include shapes toggle from legend + API docs ([`692e8f3`](https://github.com/tsenoner/protspace/commit/692e8f372a6bc2cc90327b15ea95157cfcabaa4c))

* docs(plans): add implementation plan for include-shapes toggle removal

12-task TDD plan tracking issue #252. Each task ends with a working
build and tests passing; commits are frequent and scoped. ([`b4c345d`](https://github.com/tsenoner/protspace/commit/b4c345db6b724589ecd7b2cb0e39567c9dfeb4b1))

* docs(specs): add design for removing include-shapes toggle

Spec for issue #252 — eliminate the global toggle, default all categories
to circles, rely on the per-item shape picker for shape encoding. ([`1b0b11b`](https://github.com/tsenoner/protspace/commit/1b0b11bc87190d8f1f2bd5943b02964eef308f23))

* docs(explore): refresh overlay/inset captures with re-tuned editor coords

Now that exports are deterministic, the user re-tuned overlays in the
real editor against the fixed renderer. Replaces the previous coords
with the verbatim values from that session:

- Overlays: tighter PLD ellipse + label below the cluster, arrow into
  the Kunitz cluster (width 4 for visibility), Kunitz label below the
  arrow tail. Reordered as circle / PLD / Kunitz / arrow.
- Zoom inset: source rect re-tuned over the small mid-plot cluster;
  target rect lifted slightly into lower-left whitespace; pointSizeScale
  bumped to 2.3 for sharper magnified dots.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`83363c4`](https://github.com/tsenoner/protspace/commit/83363c44344a02dcebd168677d9341e1bf230f89))

* docs(explore): use exact editor-session coords for overlay/inset captures

Replaces the rounded "anchored" placeholders with the verbatim normalised
coordinates from a hand-tuned editor session:

- Overlays: rotated ellipse + rotated "PLD" label on the right-side PLD
  cluster, plus an arrow + "Kunitz" label pointing into the upper-left
  Kunitz cluster (4 overlays total, 24px font).
- Zoom inset: source rect bounds a small mid-plot cluster; target rect
  drops the magnified view into the lower-left whitespace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`3502f88`](https://github.com/tsenoner/protspace/commit/3502f888e2b83df59820595325f4a0cfa563886e))

* docs(explore): anchor figure-editor overlay/inset captures on a real cluster

- Recolor the demo circle from red to black (matches the editor's actual
  default; users can't change overlay color from the UI today).
- Move the circle/arrow/label to the small blue cluster at (0.90, 0.68)
  and aim the arrow + "Cluster A" label at it, instead of placing them
  over empty plot regions.
- Re-anchor the zoom inset's source rect on that same cluster and put
  the magnified target in the upper-left whitespace, so the screenshot
  visibly demonstrates what zoom-inset does.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`8fe27f4`](https://github.com/tsenoner/protspace/commit/8fe27f4e72c88019d67cbccb59c29ccc09c7641e))

* docs(explore): add Figure Editor preset/overlay/zoom-inset and filter screenshots

Adds 4 captures generated by capture-static.spec.ts:
- figure-editor-presets.png — sidebar close-up of journal presets and dimensions
- figure-editor-overlays.png — editor with circle/arrow/label overlays placed
- figure-editor-zoom-inset.png — editor with a zoom inset (source dashed + target solid)
- filter-query-builder.png — filter modal populated with a multi-value condition

Embeds them under the relevant sections of figure-editor.md and control-bar.md.
The capture spec gains a small openFigureEditor helper and pre-populates the
filter query from the loaded dataset's first annotation so the test stays
dataset-agnostic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`53497da`](https://github.com/tsenoner/protspace/commit/53497dadff0e2a0e32bd08aba40f407cd4c2106e))

* docs(explore): add Figure Editor overview screenshot ([`38d9293`](https://github.com/tsenoner/protspace/commit/38d9293c0cdf3a35dfbe9e95eacf8c692f1ccdc7))

* docs(explore): document product tour and recovery banner ([`7dbc466`](https://github.com/tsenoner/protspace/commit/7dbc4661549b3998c6dcef4399fac73b09627cda))

* docs(tour): clarify Esc, Filter query builder, and Cmd/Ctrl+Click toggle ([`15745f5`](https://github.com/tsenoner/protspace/commit/15745f501583b2d084d1cdbf3f3024090952d225))

* docs: drop 3D mention from landing copy (web app is 2D-only per #196) ([`020ccc9`](https://github.com/tsenoner/protspace/commit/020ccc939fc8fe86b608f5d1ed47bb5bf6dbadd6))

* docs: include LocalMAP in projection lists; tidy AlphaFold phrasing in guide ([`005d955`](https://github.com/tsenoner/protspace/commit/005d955ee0009278185615b6b18845cd32cfb6b0))

* docs: fix outdated projection list, AlphaFold fetch path, and dev port ([`da9d55d`](https://github.com/tsenoner/protspace/commit/da9d55d97a4685623b5e37aeac15cf92647883c0))

* docs(plans): archive publish-editor review-fixes plan ([`15a8e15`](https://github.com/tsenoner/protspace/commit/15a8e1506575c7f44191a2ce51416f95a2e7fdc9))

* docs(tour): note demo restore in Import description ([`1c1c1dd`](https://github.com/tsenoner/protspace/commit/1c1c1dd169c04c11737c37ac3fb76a9d680632fd))

* docs(tour): mention Figure Editor in Export step ([`0c858e2`](https://github.com/tsenoner/protspace/commit/0c858e2aa347459709e457462d8615422412c55d))

* docs(figure-editor): cover dimensions panel, geometric inset zoom, click-select

Rewrites the figure-editor guide for everything added in this PR:
Photoshop-style Dimensions panel (Resample, unit toggle, aspect-lock
chain), preset constraints (width pinned, height clamped to maxHeight,
aspect-lock disabled), legend font pt/px toggle, geometric inset zoom
with per-inset Dot size slider, click-to-select sidebar items,
Delete/Backspace to remove + Escape to clear, PNG pHYs DPI metadata,
mm-accurate PDF page sizing. ([`39d138e`](https://github.com/tsenoner/protspace/commit/39d138e04d8c9157514cb0edae6fba9c9e604942))

* docs(figure-editor): implementation plan for dimensions panel rework

Eight-task TDD-style plan covering the new Resample-aware helpers, PNG
pHYs DPI metadata, mm-accurate PDF, and the Photoshop-style Dimensions
section UI. Closes the gap from the 2026-05-03 spec. ([`e6dadbd`](https://github.com/tsenoner/protspace/commit/e6dadbdb19dd236aa55ab11eab5426711f76497c))

* docs(figure-editor): Photoshop-style dimensions panel design

Spec for reworking the publish modal's dimensions section with an
explicit Resample toggle, real PNG DPI metadata, and mm-accurate PDF
page sizes — fixing the three reasons users see no quality gain when
turning DPI up. ([`1b92f99`](https://github.com/tsenoner/protspace/commit/1b92f9970e6038c94f3bf16f4608b7724e1dd7c6))

* docs(load-reliability): delete shipped plans; specs retain design rationale ([`4645276`](https://github.com/tsenoner/protspace/commit/464527654bf46a6b1b599b67ad055d42521577ae))

* docs(load-reliability): mark Phase 2.5 implementation complete

Playwright spec for sprot_50 (573,649 proteins) passes — render-side
OOM fixed. Manual heap-snapshot verification pending before PR-2. ([`bad1df5`](https://github.com/tsenoner/protspace/commit/bad1df5bee04520e4386e68e145570c4f16cd805))

* docs(load-reliability): Phase 2.5 implementation plan + spec touchups

5 tasks, ~3-4 hours LLM-assisted: new accessor module, migrate
style-getters, migrate tooltip + hover, strip Records from
PlotDataPoint, restore sprot_50 Playwright spec. ([`7657f8d`](https://github.com/tsenoner/protspace/commit/7657f8dfdb84923518082294bc9eafaf77bb5cca))

* docs(load-reliability): Phase 2.5 render-side lazy-materialization design

Strip annotation Records from PlotDataPoint; consumers look up via
new plot-data-accessors module. Targets 3.4 GB → ~50 MB at render. ([`4cafc3e`](https://github.com/tsenoner/protspace/commit/4cafc3ed690b693b5ff6f803825edc891ec4da59))

* docs(load-reliability): record Phase 2 status + Phase 2.5 carve-out

Updates spec with post-implementation status header, references PR
#240, adds §11 documenting the render-layer OOM discovered during
Task 14 verification. Updates plan with task → commit-SHA table and
notes Task 14 stash + Phase 2.5 dependency before PR-2 can open.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`f11360e`](https://github.com/tsenoner/protspace/commit/f11360ee3ae3788f7a5ddc143ce9f8432a4f0b97))

* docs(plan): load reliability implementation plan (phases 1+2)

14-task plan covering OPFS lastLoadStatus + crash-loop recovery banner
(Phase 1, 6 tasks) and Int32Array storage + spread-merge drop +
pair-aware color/shape generator + null-selection gate fix
(Phase 2, 8 tasks). Two-PR sequencing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`ca9f713`](https://github.com/tsenoner/protspace/commit/ca9f7138203f32fd5367abd11f071b8e44df31aa))

* docs(spec): load reliability design (phases 1+2)

Crash-loop guard via OPFS lastLoadStatus + memory wins for sprot_50
(Int32Array storage, drop projection×annotation spread, pair-aware
color/shape generation, fix null-selection materialization gate).
Phase 3 (worker-based decode) deferred to its own issue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`8894664`](https://github.com/tsenoner/protspace/commit/889466492b3a5705db164232f09feb69f1e3dca0))

* docs(issue-226): add implementation plan ([`66996f0`](https://github.com/tsenoner/protspace/commit/66996f079e0ab3d23f7c823be90fcd9a100432a0))

* docs(issue-226): specify annotation type inference ([`534d07e`](https://github.com/tsenoner/protspace/commit/534d07e7c784007504483419d9a4c56dcc05fd07))

* docs(issue-218): drop shipped plan

Per docs/superpowers convention (commit 4645276): keep specs,
delete plans once shipped. ([`43cdd9b`](https://github.com/tsenoner/protspace/commit/43cdd9b9bff05355d242e4ae0f61742281a3c192))

* docs(issue-218): remove spec trailing whitespace ([`2e7f339`](https://github.com/tsenoner/protspace/commit/2e7f339fbc9ab848f1b779921a3849955d55736a))

* docs(embedding): show structure errors as inline-owned ([`4c73221`](https://github.com/tsenoner/protspace/commit/4c732210a44499b6f9f0dec4ded1416a2e0aab52))

* docs(issue-218): add structure error notification plan ([`cc6ff2e`](https://github.com/tsenoner/protspace/commit/cc6ff2e71c0c4ca8d00a01fe92b47bac68edfb6f))

* docs(issue-218): plan structure error notification cleanup ([`90052bf`](https://github.com/tsenoner/protspace/commit/90052bf776fa19f0ad91540d7d6820ccf47b7876))

* docs: update CLI guide, data prep docs, and regenerate screenshots (#200)

Rewrite python-cli.md around `protspace prepare` (replaces old
`protspace-query`/`protspace-local`), fix -f → -a annotation flag, add
LocalMAP, annotation groups, inline params, and embedder models section.
Update data-preparation.md with TED, Biocentral sources and LocalMAP.
Dismiss product tour in Playwright screenshot scripts so captures are
clean. Regenerate all 14 documentation images.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5f0c0c6`](https://github.com/tsenoner/protspace/commit/5f0c0c61ead3352ae3346e4f233a8b44495c2682))

* docs: add query builder filter design spec and implementation plan

Design spec and implementation plan for issue #161 — reworking
the filter from a checkbox-based approach to a UniProt-style
query builder with AND/OR/NOT logic and isolation. ([`32b2cb2`](https://github.com/tsenoner/protspace/commit/32b2cb2fa8b0b02ce7837ff5b6def30b1cce238c))

* docs(scatter-plot): document lasso selection and selection-tool API

- Add lasso selection to scatterplot quick reference and selection guide
- Update control bar docs: rename "Select Button" to "Selection Tools"
- Add selection-tool attribute, selectionTool property, and
  selection-tool-change event to API reference
- Update product tour step 5 to mention rectangle/lasso tool switcher
- Update explore index to reflect new selection tool options

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d8827dd`](https://github.com/tsenoner/protspace/commit/d8827ddfe54d56249277172a5f400e985731803d))

* docs(pr): add OPFS toast screenshot ([`2772510`](https://github.com/tsenoner/protspace/commit/2772510d57988c1b3b82e5280a67742f6f3f3168))

* docs: document data & settings persistence for users

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`9a8f159`](https://github.com/tsenoner/protspace/commit/9a8f159a9249f3ac26f25eef4e79dc616ab69f43))

* docs(data-format): document missing values / N/A handling

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`6b3d243`](https://github.com/tsenoner/protspace/commit/6b3d243a6779b920e4db2e6c18781c0e856dfd6f))

* docs(perf): update perf readme

Signed-off-by: Elias Kahl <contact@elias.works> ([`0e7ee79`](https://github.com/tsenoner/protspace/commit/0e7ee79d31108d54e5be877cd5d169f142e24918))

* docs: rename Color By dropdown to Annotation dropdown

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`1a56a9d`](https://github.com/tsenoner/protspace/commit/1a56a9dd011a1806c806fa8d8b47112b9d1c6411))

* docs: update documentation content, screenshots, and animation scripts

- Update documentation text for ToxProt 2025 dataset references
- Increase viewport from 1280×720 to 1536×864 to fix control-bar
  wrapping and structure-viewer cutoff
- Rename control-bar-colorby.png to control-bar-annotation.png
- Fix zoom.gif and select-box.gif to target specific protein family
  clusters using MAD outlier filtering
- Fix legend-others.gif to use Others dialog with CRISP family extract
- Fix legend-reorder.gif to drag via handle, legend-toggle.gif to
  toggle N/A/Other and isolate three-finger toxin
- Delete orphaned GIFs from old test runs
- Regenerate all screenshots and GIFs with ToxProt 2025 dataset

Closes #155

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`f854a36`](https://github.com/tsenoner/protspace/commit/f854a36f2b17973abe25c43ef50a4f269ad7447a))

* docs: update wordmark ([`4f65e4b`](https://github.com/tsenoner/protspace/commit/4f65e4bfec67fb1ea353b6381c91bffe4b8ec852))

* docs: add assets ([`3222300`](https://github.com/tsenoner/protspace/commit/3222300582b10430393a49f99b498d390a60b00e))

* docs: Update the current issue templates
Fixes #114 ([`8b009ba`](https://github.com/tsenoner/protspace/commit/8b009ba245a9e2c3c348f20048441b7be9581abe))

* docs: clarify PDF export format as raster image ([`b8b9da9`](https://github.com/tsenoner/protspace/commit/b8b9da92ed4012c2822bb80b9842f60a8bc39df5))

* docs(legend): update documentation for settings persistence feature ([`12a0aeb`](https://github.com/tsenoner/protspace/commit/12a0aeb531900997e929b037360a4c87c7ff5684))

* docs: improve documentation clarity and consistency

- Fix typos and grammar errors throughout docs
- Standardize "canvas" to "scatterplot" terminology
- Condense verbose sections for better readability
- Clarify Filter vs Isolate feature distinction
- Remove unused animation files
- Reorganize data-preparation guide for better scannability ([`ce3cc6b`](https://github.com/tsenoner/protspace/commit/ce3cc6bdf682e6f52e7261b4d419317cbc7944a9))

* docs: add cmd/ctrl+k and escape keybard shortcuts ([`4ed897c`](https://github.com/tsenoner/protspace/commit/4ed897c7d8b89336ef07a06af84692b2d08e81a8))

* docs: update images README with generation instructions ([`32e5033`](https://github.com/tsenoner/protspace/commit/32e50334047d66299947ee4edb1567eb8a1adf57))

* docs: update documentation with image references ([`8140d8e`](https://github.com/tsenoner/protspace/commit/8140d8ee8dd4aed5d96a049c9974bab157f73fab))

* docs: add generated documentation images ([`a2a71b6`](https://github.com/tsenoner/protspace/commit/a2a71b6febf2372c567735d9b5dc729a2c8e3bbb))

* docs: update contributing guide with image generation instructions ([`11bb98f`](https://github.com/tsenoner/protspace/commit/11bb98fe59fad659d1be7affdf03d3e02aa876fc))

* docs(readme): simplify and remove unpublished npm content

- Remove web component embedding examples (npm not published yet)
- Simplify code quality section to use precommit script
- Update documentation link to protspace.app/docs ([`e28e4e9`](https://github.com/tsenoner/protspace/commit/e28e4e9b259748c93d43a9e998b4ad1bbed41ee1))

* docs(guide): remove developer references from user docs

- Remove 'For Developers' FAQ section
- Remove developer link from 'What is ProtSpace' next steps
- Update contributing link to point directly to GitHub ([`d967a86`](https://github.com/tsenoner/protspace/commit/d967a8687abf9242adebea46c49e9e2204a55c96))

* docs: restructure sidebar and simplify quick start

- Reorganize sidebar: Introduction, Preparing Data, Explore Page, Help
- Hide developer section until npm package is published
- Simplify quick start to focus on web app usage
- Fix Resources dropdown handling for VitePress ([`7e36184`](https://github.com/tsenoner/protspace/commit/7e36184fbed08712bf2061e4a17fdd1f68b00b94))

* docs(guide): update guide content for accuracy

- Fix data-preparation to clarify .h5 input requirement
- Update data-format with correct parquet table structure
- Revise FAQ with current export formats and features
- Update "What is ProtSpace" with privacy info and correct exports ([`1a706bf`](https://github.com/tsenoner/protspace/commit/1a706bf9d84145a0e552d4fbc6481604dd437deb))

* docs(guide): add Python CLI usage guide

- Document protspace-query and protspace-local commands
- Explain projection method naming (pca2, umap2, etc.)
- Add annotation options via names or CSV file ([`9a8e005`](https://github.com/tsenoner/protspace/commit/9a8e00597de58ee1eaa89c01b004b37446ca3315))

* docs(developers): consolidate developer documentation

- Add installation guide for npm/CDN/dev setup
- Add embedding components guide with React/Vue examples
- Add API reference for all web components
- Add contributing guide with architecture overview ([`71ca804`](https://github.com/tsenoner/protspace/commit/71ca8048f8107d23690b5c53fc7887f75dc1bd1e))

* docs(explore): add user-focused explore page documentation

- Add interface overview, importing data, scatterplot navigation
- Add legend usage, control bar features, structure viewer docs
- Add exporting results guide with correct formats (PNG, PDF, JSON, IDs)
- Include image placeholders README for screenshots needed ([`0b789d1`](https://github.com/tsenoner/protspace/commit/0b789d11bbf383c43b3cc1334cf45f1097c88292))

* docs: add Home link to landig page, disable logo link\n\n- Disable logo link by removing link/target props in config\n- Add explicit 'Home' link pointing to dynamic HOME_URL\n ([`b7ebcc9`](https://github.com/tsenoner/protspace/commit/b7ebcc9547dc79aeb9407679ffff235463aaa67c))

* docs(content): replace ProtSpace Web with ProtSpace throughout ([`9f66534`](https://github.com/tsenoner/protspace/commit/9f665341d372598b8b02870fda5ead6fc07b6dd1))

* docs(config): rebrand from ProtSpace Web to ProtSpace ([`d8795ff`](https://github.com/tsenoner/protspace/commit/d8795ff18e95d70322caeea605d19709d12eeb3e))

* docs(contributing): streamline and modernize contribution guide

Major updates:
- Reduce from 371 to 307 lines (21% more concise)
- Update from yarn to pnpm (current package manager)
- Document new CI workflow and quality checks
- Add 'precommit' script usage
- Explain monorepo structure
- Simplify bug/feature request templates
- Update all repository URLs from protspace2 to protspace_web
- Add VSCode recommended settings

Content is now more scannable with better hierarchy and actionable
instructions while retaining all essential information. ([`427dceb`](https://github.com/tsenoner/protspace/commit/427dceb3aa7946baea7cd352d34e0f939c7a5a65))

* docs: cleanup redundant text and add point selection

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`97f5eee`](https://github.com/tsenoner/protspace/commit/97f5eeead3fbf921cfeb087bd32c1901f8d7d9df))

* docs: fix storybook build

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`ca3ef8c`](https://github.com/tsenoner/protspace/commit/ca3ef8c2bdf1aa93a5e03a175ea0d487a0625bda))

* docs: fix linting issue

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`87f0740`](https://github.com/tsenoner/protspace/commit/87f0740f7a20af4fee8a637a552840767d351c40))

* docs: change to console logging of events

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`1c3b7e6`](https://github.com/tsenoner/protspace/commit/1c3b7e65252ac115fec0d62ec8c474b7161d18a6))

* docs: fix feature comparison visual bug

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`6b4f9ce`](https://github.com/tsenoner/protspace/commit/6b4f9ceac71a069fa31f4c56c2f2e3f55da3a659))

* docs: fix text in multiple projections

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`0073765`](https://github.com/tsenoner/protspace/commit/007376524c85603e986378619dc3db6fe180d84e))

* docs: remove default story

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`98e81f2`](https://github.com/tsenoner/protspace/commit/98e81f222dd0b1456ed33a007422139de954053d))

* docs(README): replace embed section with Storybook tutorial ([`194aca6`](https://github.com/tsenoner/protspace/commit/194aca6aed50c56448b3c5d1ba1fb0f6cc8e3620))

* docs: add styling story

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`10e8f49`](https://github.com/tsenoner/protspace/commit/10e8f4905b89d756255bd8f98e2533dc65bf546d))

* docs: remove outdated documentation files ([`a796778`](https://github.com/tsenoner/protspace/commit/a796778f00f984a98f9653f0b2fed01d493ea9a1))

* docs(notebook): improve data collection and installation instructions

- Update installation to use pip install protspace instead of git URL
- Reorganize data collection section with clearer structure
- Add multiple upload method options for embedding files
- Enhance upload widget UI and instructions ([`d735eb3`](https://github.com/tsenoner/protspace/commit/d735eb3c845c0fa6267f0c16f2794b334144a235))

* docs(notebooks): update Colab link to point to main branch ([`9b6ec43`](https://github.com/tsenoner/protspace/commit/9b6ec43fb566e0021bc097a940ae5374c075d738))

* docs(notebooks): add README for ProtSpace notebooks with data preparation instructions ([`ffde97e`](https://github.com/tsenoner/protspace/commit/ffde97e47bf813c367b71818e9a82a856357b083))

* docs(README): remove citation section for clarity ([`cba180e`](https://github.com/tsenoner/protspace/commit/cba180e75248392b402e038f82f52ea46afb28a8))

* docs(README): simplify and restructure README

- Add Apache 2.0 license and DOI badges
- Expand introduction covering all key features
- Highlight demo URL and Google Colab preparation
- Update repo name to protspace_web
- Remove redundant sections for clarity ([`5b9b246`](https://github.com/tsenoner/protspace/commit/5b9b2467d93bfc2440ac77e9407c14b9819ee9c8))

* docs(README): add contributing section ([`c37967d`](https://github.com/tsenoner/protspace/commit/c37967de21d5b7ce39c09e0699ce77067d5ce893))

* docs(example): Update Pla2g2.json to modify visibility settings for features ([`cc0201e`](https://github.com/tsenoner/protspace/commit/cc0201e1c8c2255d630af3a4ac223ee7dcc103ef))

* docs(issues): add additional found bugs ([`0f64f8c`](https://github.com/tsenoner/protspace/commit/0f64f8c62655a9573edfdeffa66490e843636ced))

* docs(schema): redefine the schema to track legend state ([`492c099`](https://github.com/tsenoner/protspace/commit/492c099aca39c684eff84a2e2fcfe150f0d0b880))

* docs(issues): update into actionable steps ([`42432d9`](https://github.com/tsenoner/protspace/commit/42432d92941ee69a5e610a5fb1e617b821e6a2d9))

* docs: add review ([`65f71d8`](https://github.com/tsenoner/protspace/commit/65f71d8aaa31cb27f5507e625a482f085b54a509))

* docs(issues): rename bug.md to issues.md ([`dc25c8b`](https://github.com/tsenoner/protspace/commit/dc25c8bd9c88b95fcba276739ba3cca001af8fcb))

* docs(bugs): add known issues and enhancement requests documentation ([`1a737ce`](https://github.com/tsenoner/protspace/commit/1a737ce085985513dabbf1936c28dcea90b31cfa))

* docs(mockup2): add a second mockup ([`e8f2d35`](https://github.com/tsenoner/protspace/commit/e8f2d3553e9b7b7e9c84ae90b11fefea4d17519d))

* docs(todo): add list of next todos ([`1c909f5`](https://github.com/tsenoner/protspace/commit/1c909f550fe362c7ee4f4a9fc13660dfc69eee60))

* docs(features): align feature list with technical specification ([`511d96f`](https://github.com/tsenoner/protspace/commit/511d96f3833b94bc19c085c21e6ab63cd5b4d75b))

* docs: improve formatting ([`c4c12c0`](https://github.com/tsenoner/protspace/commit/c4c12c0545e993e186e98ff3d0e355f220ea7964))

* docs: add session sharing documentation ([`61f9de8`](https://github.com/tsenoner/protspace/commit/61f9de8dada429cea6e73d5df5879c3b0eecd4de))

* docs(overview): add features list and architecture diagram

- Add Features.md with detailed feature list and roadmap
- Create basic_overview.svg showing system architecture ([`37b1999`](https://github.com/tsenoner/protspace/commit/37b19995738917489b438bb90434388469124c9b))

* docs(readme): update project documentation ([`1b42cf2`](https://github.com/tsenoner/protspace/commit/1b42cf20f51add90542ac3e350619dd22b6db40a))

* docs: add issue templates ([`2ca5582`](https://github.com/tsenoner/protspace/commit/2ca5582687a6e0a3450939555af4f046b4bdb913))

* docs: add standard documents ([`9a62f1d`](https://github.com/tsenoner/protspace/commit/9a62f1df8fb62a7eb8ab449d588aa0425b8ad16a))

### Features

* feat(core): detect bundle format_version and thread v2 decode through conversion

Read the `protspace_format_version` parquet key-value metadata from the
annotations part (part 1) of a .parquetbundle via hyparquet's `parquetMetadata`,
and thread that version (default 1) through the whole conversion call chain so
v2 bundles decode percent-encoded annotation names while v1/absent bundles keep
byte-identical legacy behavior.

- bundle.ts: add readFormatVersion(part1) (guarded try/catch -> 1) and a
  `formatVersion` field on BundleExtractionResult, read from the same buffer
  parquetReadObjects decodes.
- conversion.ts: add `formatVersion = 1` to convertBundleFormatData,
  convertBundleFormatDataOptimized(+Separated), convertLegacyFormatData,
  extractAnnotationsByProtein (incl. the memoized parseCell), and the two
  optimized adapters; pass it to every parseAnnotationValue /
  splitCategoricalAnnotationValues call. Both the worker and main-thread bundle
  paths thread the version via the returned BundleExtractionResult object; raw
  plain-.parquet reads pin v1.
- conversion-numeric.test.ts: end-to-end test proving formatVersion 2 reaches
  the optimized path (encoded ';' name decodes to one category, not shattered).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`56bf550`](https://github.com/tsenoner/protspace/commit/56bf550cf3a3a36064b1231ae2d41142d05bd40c))

* feat(core): version-branch annotation parsing (v2 decode, v1 unchanged) ([`203d67a`](https://github.com/tsenoner/protspace/commit/203d67ab89af7c4191afe827a498a583ca6c2270))

* feat(core): add v2 annotation percent-codec (mirror of backend) ([`bacb793`](https://github.com/tsenoner/protspace/commit/bacb7937892a03fb8c1ba35d530f121e865fe909))

* feat(transfer): emit COL__pred_source provenance column in EAT overlay

Re-add the reference protein id each label was transferred from
(Prediction.source_id) as a third per-cell overlay column, COL__pred_source,
alongside COL__pred_value and COL__pred_confidence. PR #55 review dropped it as
"noise for colouring"; the web EAT UX (connector line to the source, "transferred
from <neighbour>" tooltip) needs it back as provenance — explicitly not a colour
feature. The frontend reserves the __pred_ namespace and keeps these columns out
of the annotation dropdown.

- predictions.add_overlay_columns: write COL__pred_source (str, null for
  non-predicted), replaced-not-duplicated on re-run.
- tests: assert source present + aligned to the reference id (was: absent).
- docs (annotations.md, cli.md), transfer notebook, and the EAT design spec
  updated to describe three overlay columns.

Design: docs/superpowers/specs/2026-07-04-eat-visualization-overlay-design.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`f8b55d4`](https://github.com/tsenoner/protspace/commit/f8b55d4846b3a899829d4839140480c34c66a1c4))

* feat(transfer): warn on zero transfers; validate --metric/--k early

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`e4ec0a2`](https://github.com/tsenoner/protspace/commit/e4ec0a2ecf3640ee7d6466cfd18f08e330b86092))

* feat: add 'protspace transfer' annotation-transfer subcommand

Implements Task 9: the EAT orchestration core (run_transfer) and the
'protspace transfer' Typer CLI command, wiring classification, nearest-
neighbour lookup (protlabel.eat), and overlay-column writing into a single
pipeline for filling missing annotation values from pLM embedding space.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`64538cc`](https://github.com/tsenoner/protspace/commit/64538cc07608aa217b4a35edbcfe22013e3b4b3b))

* feat: replace annotations part of a parquetbundle in place

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`e607a54`](https://github.com/tsenoner/protspace/commit/e607a546b0488cef9128e3b662f0c71746b3a0bf))

* feat: build per-cell prediction overlay columns

Add `add_overlay_columns()` in `src/protspace/data/io/predictions.py`
that appends three aligned Arrow columns (`COL__pred_value`,
`COL__pred_confidence`, `COL__pred_source`) from a list of
`protlabel.Prediction` objects, leaving the curated column untouched.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`02a5354`](https://github.com/tsenoner/protspace/commit/02a5354ab4f57c75c8da54f2c3c3d6053574ff8b))

* feat: query/reference classifier for annotation transfer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`76504ee`](https://github.com/tsenoner/protspace/commit/76504eea5a4ab4fa731113392afbbc55f6ba9e03))

* feat(protlabel): persistable Lookup sidecar + public API

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`db73466`](https://github.com/tsenoner/protspace/commit/db7346659d66da9a37f70cf0588272e9ac463b3c))

* feat(protlabel): kNN label transfer with reliability index

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`829e924`](https://github.com/tsenoner/protspace/commit/829e924ff065d8fac0239e7edccfc1b01c1dced1))

* feat(protlabel): chunked brute-force kNN backend

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`d196d8a`](https://github.com/tsenoner/protspace/commit/d196d8a148020a88e2c5ab09712a10531f579053))

* feat(protlabel): goPredSim reliability index transform

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`1d9ac58`](https://github.com/tsenoner/protspace/commit/1d9ac58f3aff5555060f1c492a911a5c44bfa0d1))

* feat(style): decode v2-encoded names for backend display

_to_display_value now decode_field()s each ;-split/|-trimmed part so
percent-encoded characters (%3B, etc.) from bundle format v2 render as
literal text in the Dash style/serve display path. The bundle on disk
stays encoded; only display decodes. compute_value_frequencies already
delegates to _to_display_value so it picks up decoding for free.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`c49d388`](https://github.com/tsenoner/protspace/commit/c49d38804d40e68cd62f90531310759eded8c429))

* feat(bundle): stamp format_version=2 in annotations parquet key-value metadata

Wraps BaseProcessor._create_protein_annotations_table's output and the
standalone `protspace bundle` subcommand's annotations table with
stamp_format_version() so both write paths emit protspace_format_version=2 /
protspace_encoding=pct as parquet footer key-value metadata.

Found and fixed along the way: pa.Table.rename_columns() drops schema
metadata, so in cli/bundle.py the stamp must be applied after the
identifier->protein_id rename, not before. ([`10a9870`](https://github.com/tsenoner/protspace/commit/10a9870cf71c1a614fdf46270c52dc69cd883700))

* feat(annotations): percent-encode EC + Pfam-clan names at emit

Wrap EC enzyme names and Pfam clan names in encode_field() at their
emit sites to percent-encode reserved structural chars (;|%) that would
corrupt the bundle cell grammar. Tests verify that pipes and semicolons
are encoded (e.g., "Name|with;reserved" → "Name%7Cwith%3Breserved").

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`449916c`](https://github.com/tsenoner/protspace/commit/449916cd8fd0042be024bea10787ee47a18dba06))

* feat(annotations): percent-encode UniProt keyword/subcellular/family/GO names

Reserved chars (%;|control) inside free-text keyword names, subcellular
locations, protein family descriptions, and GO term labels corrupted the
`;`/`|`-delimited cell grammar. Wrap each emit point in UniProtEntry with
encode_field so names round-trip losslessly via decode_field. ([`9234155`](https://github.com/tsenoner/protspace/commit/92341550c4d8588bad8867365ab91396e03254b6))

* feat(annotations): percent-encode TED domain names at emit

Wrap the TED domain human-readable `name` in `encode_field` before assembling
`ted_domains` cells, matching Task C1's InterPro CATH fix. Names from the CATH
names file can contain `;` (the domain hit-separator), which corrupted the
`;`-joined cell grammar without encoding.

Test drives the real fetch_annotations -> _format_domains -> _resolve_cath_name
path with get_cath_names mocked to return a `;`-bearing name, asserting the
emitted string encodes it (%3B present, no raw `;`) and decode_field restores
the original — a bare encode_field() call would not catch a reverted wrap. ([`e789919`](https://github.com/tsenoner/protspace/commit/e789919db825e016c490810d7cbaa87aa04bbb69))

* feat(annotations): percent-encode InterPro entry names at emit (#56/#58)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`0e0d1cf`](https://github.com/tsenoner/protspace/commit/0e0d1cf259d014e086bbac280e21bd3a46d589c6))

* feat(annotations): add v2 percent-encoding codec + version stamp helper ([`68354ff`](https://github.com/tsenoner/protspace/commit/68354ff547a0a7563f2dd962a098a17be38f637f))

* feat(monorepo): uv workspace with prep source-pinned to protspace (2.4-2.7)

Close cross-repo contract #2: prep was pinned to protspace>=0.6 from PyPI while
protspace is at 4.5.0. Put them in one uv workspace, in lockstep, tested together.

- root pyproject.toml: virtual [tool.uv.workspace] members=[apps/protspace, apps/prep]
  (perf/ excluded per D3 — not a member)
- apps/prep: drop protspace>=0.6 pin → [tool.uv.sources] protspace={workspace=true}
- root uv.lock: protspace now resolves as editable=apps/protspace (261 pkgs)
- apps/protspace/package.json: thin turbo bridge (@protspace/backend); test scoped to
  "not slow and not integration" so the monorepo test task skips torch/selenium/e2e
  (deviation from design's bare `uv run pytest` — those markers exist for this)
- pnpm-workspace + knip: add apps/protspace; ignoreWorkspaces it in knip (Python, no JS graph)

Verified: turbo test scope = {app, backend, core, utils}; uv sync resolves;
`from protspace.data.loaders.h5 import parse_identifier` and the `protspace` CLI
both resolve from the workspace venv at version 4.5.0.

Stale member uv.locks (apps/{protspace,prep}/uv.lock) kept for now — removed in
Phase 3 with the Dockerfile fixes that still reference them.

OpenSpec merge-protspace-monorepo tasks 2.4-2.7.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`6b491fc`](https://github.com/tsenoner/protspace/commit/6b491fc5c983a932fa655ecf7c839270f6e9af03))

* feat(stats): prepare --stats-annotation flows selection into the pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`582aa77`](https://github.com/tsenoner/protspace/commit/582aa7747038cb5787fbef21a44bbdd07da74186))

* feat(stats): stats --stats-annotation scores selected annotations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`a2289af`](https://github.com/tsenoner/protspace/commit/a2289af23fc50de80b71febd57c12bf330b60593))

* feat(stats): driver runs annotation-validity on embedding + projections

Threads an `annotations` kwarg through `compute_statistics` into every
projection's StatContext, registers AnnotationValidityStatistic in the
statistics registry, and adds a once-per-embedding pass that runs any
statistic opting in via `embedding_space` (currently just
annotation-validity) against the raw embedding as a separability
ceiling. Also patches faithfulness.py's StatRow constructions with the
now-required `annotation` field, and fixes the Task-1 test debt this
exposed (_statrow helper + the 8→9 column schema assertion).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`d7c449f`](https://github.com/tsenoner/protspace/commit/d7c449f52de68172ff80dbcf480e7c7d6fb5a1ce))

* feat(stats): AnnotationValidityStatistic (silhouette/DBI/CH per annotation)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`f7208fd`](https://github.com/tsenoner/protspace/commit/f7208fd35e4f2d0c287f5467c77f8385d66b9e0c))

* feat(stats): annotation selection + suitability filter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`5b8be79`](https://github.com/tsenoner/protspace/commit/5b8be79e73fd2f62c0db30e41c08b59d89a57d53))

* feat(stats): add annotation dimension to StatRow + StatContext

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`4f4554a`](https://github.com/tsenoner/protspace/commit/4f4554ad1e4317c4b9d654765dca1d85b1057724))

* feat(stats): cluster-selection (elbow/silhouette/both), silhouette-as-score, global faithfulness

Sub-branch of feat/projection-statistics for separate review.

- --cluster-selection elbow|silhouette|both (prepare + stats): emit the elbow
  clustering (`cluster_<proj>`), the max-silhouette-K clustering
  (`cluster_silhouette_<proj>`), or both; validity rows carry the matching
  label_kind (kmeans_elbow / kmeans_silhouette). kmeans_elbow optionally returns
  the silhouette-optimal K + labels (computed only on request).
- Per-point silhouette is now attached to the membership value as `cluster N|<sil>`
  (the UniProt-ECO / InterPro-bit-score convention) instead of a separate
  silhouette_<proj> column; gated by --no-scores. Legend builder strips the
  suffix to recover the bare category.
- Two global faithfulness metrics: random_triplet (relative-ordering accuracy
  over random triplets) and spearman_distance (rank correlation of all pairwise
  distances). Rows tagged scope=local|global.

Tests updated for the single-column format; added cases for cluster-selection,
score gating, global metrics, and silhouette-K selection. 572 fast tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ed9896a`](https://github.com/tsenoner/protspace/commit/ed9896acf14908bbe4f6a58ded73f94a64387334))

* feat(stats): auto-style cluster-membership columns (legend settings)

Phase 2A.4 of route-projection-statistics. Generate a full LegendPersistedSettings
envelope per cluster-membership column so clusters are colored when selected with no
manual styling step.

- carriage.build_cluster_legend_settings: for each categorical AnnotationColumn build
  a complete envelope the frontend's sanitizeLegendSettingsEntry accepts —
  maxVisibleValues / shapeSize / sortMode / hiddenValues / enableDuplicateStackUI /
  selectedPaletteId + categories keyed by the exact label with a Kelly-palette
  color, zOrder and shape. Numeric (silhouette) columns keep the default ramp.
- prepare path: BaseProcessor.save_output gains settings=; the pipeline builds the
  cluster styles from the report and writes them into the bundle's settings part.
- prep path: `protspace stats --settings-out <json>` writes the styles; `protspace
  bundle --settings <json>` folds them into the settings part.

Tests: envelope validity (every required field/type + distinct palette colors);
end-to-end stats --settings-out -> bundle --settings styles clusters in the settings
part.

Deferred (follow-up): preserving the generated cluster styles across a later
`protspace style` rewrite (replace_settings_in_bundle) — a rare re-style path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`6209a51`](https://github.com/tsenoner/protspace/commit/6209a51de5ced609a5e295cde1d94f1542f6f72f))

* feat(stats): per-protein cluster membership + silhouette as annotation columns

Phase 2A of route-projection-statistics (tsenoner #61 review bullets 1-2): surface
the elbow-K labelling and per-point silhouette as per-protein annotation columns
so the frontend color-by control renders them with no new UI.

- New AnnotationColumn output type (name, kind categorical|numeric, values keyed by
  identifier); StatsReport carries an annotation_columns channel and add() routes
  mixed StatRow / AnnotationColumn lists.
- ClusterValidityStatistic emits `cluster_<projection>` (non-numeric "cluster N"
  labels → categorical inference) and `silhouette_<projection>` (per-point
  silhouette_samples over the full labelled set → numeric). Per-point silhouette is
  O(n^2) with no subsample path, so it has its own hard-ceiling skip guard; both are
  gated by the cluster_annotations param and emitted only for a genuine (>=2)
  clustering with aligned ids.
- carriage.merge_annotation_columns joins the columns onto the annotations frame by
  identifier (absent proteins get no value); wired into the prepare pipeline before
  create_output's .astype(str) so typing survives.
- `protspace stats` gains -a/--annotations: enriches the annotations parquet in
  place with the computed columns (stringified to match the prepare path), so the
  prep `project -> stats -a -> bundle -a` flow carries them. Without -a the
  expensive per-protein computation is skipped.

Tests: validity per-protein outputs + ceiling guard + disable; carriage join +
annotations-table typing; stats -a enrichment; end-to-end stats -a -> bundle -a
ships cluster_/silhouette_ columns in the bundle's annotations part. Auto-styling
(colored-without-manual-step) is the next increment; columns already color via the
default palette when selected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`cf7027f`](https://github.com/tsenoner/protspace/commit/cf7027f9a7abfebef004913d24e455c14408bfca))

* feat(stats): standalone `stats` enriches projection metadata with faithfulness

The deployed prep pipeline builds bundles via standalone `protspace project` +
`stats` + `bundle` subprocesses, not the in-process `prepare` pipeline. After the
Phase-1A routing, `protspace stats` wrote faithfulness nowhere (only aggregate
validity → statistics.parquet), so the prep path lost it.

`protspace stats` now folds faithfulness into `projections_metadata.parquet` in
place (parses each row's info_json, injects `quality`, preserves all other columns
and the reducer's existing info, re-serialises). The existing `protspace bundle -p`
then carries the enriched metadata into the bundle's 2nd part with no bundle/prep
code change. statistics.parquet stays aggregate-only.

This matches the spec scenario "the standalone stats path recomputes and merges it
into projections_metadata" and makes Phase 1 deliver faithfulness end-to-end in the
production prep flow.

Tests: stats rewrites metadata.info_json.quality (columns/rows preserved, reducer
info kept); end-to-end `stats` → `bundle -p` ships a bundle whose
projections_metadata carries quality while the fifth part stays validity-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`4a06264`](https://github.com/tsenoner/protspace/commit/4a06264b51123f5af2d135ecc363b2d809b04237))

* feat(stats): route faithfulness to projection metadata (info_json.quality)

Phase 1A of route-projection-statistics: carry each statistic in the bundle
part whose existing frontend consumer matches its granularity, instead of one
opaque fifth part.

- StatRow gains a `destination` (default "statistics_part", not a tidy-table
  column); StatsReport.partition() groups rows by destination and to_arrow()
  serialises only the statistics_part bucket -- the fifth part is now aggregate
  cluster-validity only.
- Faithfulness rows (kNN-overlap / trustworthiness / continuity, incl. the skip
  row) are marked destination="projection_metadata".
- New stats/carriage.py route_faithfulness_to_metadata() folds those rows into
  each projection's info_json.quality (per-metric value + k/metric/sampling
  provenance; NaN skip value -> null so info_json stays valid JSON). Wired into
  ReductionPipeline._compute_statistics before create_output serialises info_json.
- `protspace stats` stays a pure aggregate-only producer (faithfulness no longer
  written to statistics.parquet); the prep stats+bundle path is unaffected.

Tests: destination/partition/to_arrow restriction; faithfulness routing incl.
skip row; carriage router (provenance, NaN->null, info_json round-trip,
multi-embedding); end-to-end `protspace stats` aggregate-only. Existing
fifth-part tests updated to the narrowed contract.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`5f1c9b1`](https://github.com/tsenoner/protspace/commit/5f1c9b139d4ac5f6788ad60bf5c5f43254d1cfb6))

* feat(stats): add projection statistics (cluster-validity + faithfulness)

Add a protspace.stats package computing per-projection statistics, baked
into the .parquetbundle as an optional fifth part:

- cluster_validity: KMeans + distance-to-chord elbow -> silhouette,
  Davies-Bouldin, Calinski-Harabasz on the projection coordinates.
- faithfulness: kNN-overlap + trustworthiness/continuity vs the source
  embedding (high-dim metric from the reducer; large-n sampling guard).

Tidy long-format table (8 cols: space_kind, space_name, stat_family,
label_kind, metric, metric_kind, value, extra_json) — new statistics add
rows, not columns. Registry mirrors the lazy REDUCERS pattern; sklearn
imports stay function-local to preserve CLI startup.

Bundle I/O carries an optional 5th statistics part (core+settings?+stats?)
with a zero-byte settings slot keeping it unambiguous; read_bundle keeps
its 2-tuple shape (new read_statistics_from_bundle accessor) and
replace_settings_in_bundle preserves a trailing stats part so
`protspace style` is non-lossy.

Wiring: ReductionPipeline computes stats (best-effort, never fatal) behind
prepare --stats/--no-stats; new `protspace stats` subcommand for the
discrete path; `bundle -s/--statistics` folds a stats parquet in.

Refs tsenoner/protspace_web#219

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`a627a18`](https://github.com/tsenoner/protspace/commit/a627a18dbdc1e39ad071465ad36bf6350dbc9fc2))

* feat: support multiple DR parameter sets in a single prepare run (#46)

Allow inline per-method parameter overrides in the -m flag using colon
syntax with semicolon-separated params. This enables comparing the same
DR method with different parameters in a single run without re-running
the full pipeline.

Example: -m "umap2:n_neighbors=15" -m "umap2:n_neighbors=50" -m pca2

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`e202344`](https://github.com/tsenoner/protspace/commit/e202344c4b806e56110e2afbdd0b0bf4ff273bdd))

* feat: replace --force-refetch with granular --refetch <stages>

Replace the all-or-nothing --force-refetch boolean with --refetch
accepting comma-separated stage names for selective cache invalidation:
query, embed, similarity, projections, uniprot, taxonomy, interpro,
ted, biocentral. Shorthands: all, annotations.

Also fixes a bug where --force-refetch skipped TED and Biocentral
annotations, and suppresses the biocentral API length warning.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`4b85e38`](https://github.com/tsenoner/protspace/commit/4b85e38667667acdd01b7d26f29a545ff7a9c4a4))

* feat: use official CATH names file for all-level code resolution

Replace InterPro XML-based CATH name lookup with the authoritative
cath-names-v4_4_0.txt file (393 KB vs 90 MB). This provides names at
all 4 CATH hierarchy levels (Class, Architecture, Topology, Superfamily),
fixing resolution of partial codes like 2.60.40 from the AlphaFold API.

- New shared module: cath_names.py (download, cache 30 days, parse)
- TED retriever: direct lookup at any level, no G3DSA: prefix needed
- InterPro retriever: CATH names from CATH file, SSF/PANTHER still from
  InterPro XML
- Unnamed superfamilies inherit parent topology name as fallback

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ab37d7f`](https://github.com/tsenoner/protspace/commit/ab37d7fdbf824ba5f8931ccbd1f7c20bd3f15168))

* feat: cache FASTA downloads, MMseqs2 similarity, and DR projections

When keep_tmp is active (default), all intermediate results are now
cached under {output}/tmp/ and reused on subsequent runs:

- FASTA: skip re-download if tmp/sequences.fasta exists
- Similarity: save/load similarity_matrix.npy + similarity_headers.npy
- DR projections: save/load .npz files keyed by (embedding, method,
  dims, params_hash) so different parameters produce separate caches

All caches are bypassed with --force-refetch (help text updated to
reflect its broader scope). Cache hits log a WARNING for visibility.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`a030370`](https://github.com/tsenoner/protspace/commit/a0303707ffbf8f4812a16621a282dec6639080de))

* feat: add Biocentral prediction annotations (subcellular location, membrane, signal peptide, transmembrane)

Fetch per-protein predictions from the Biocentral API:
- predicted_subcellular_location (LightAttention, 10 classes)
- predicted_membrane (LightAttention, Membrane/Soluble)
- predicted_signal_peptide (TMbed-derived, True/False)
- predicted_transmembrane (TMbed-derived, none/alpha-helical/beta-barrel)

Closes #40

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`f6c1c94`](https://github.com/tsenoner/protspace/commit/f6c1c94d3addaabc84fcaefd1734efde8749615b))

* feat: add TED domain annotations via AlphaFold Database API

Query alphafold.ebi.ac.uk/api/domains/{acc} per protein to get TED
(The Encyclopedia of Domains) structural domain annotations. Resolves
CATH superfamily codes to names using the existing InterPro CATH-Gene3D
name map.

Output format: "2.60.40.720 (Immunoglobulin-like)|95.1;3.40.50.300|88.3"

Closes #22

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`e79c8db`](https://github.com/tsenoner/protspace/commit/e79c8dbbed705241d0187c973aa142f09d41e8e6))

* feat: add pfam_clan annotation — maps Pfam families to CLANS

Downloads Pfam-A.clans.tsv from EBI FTP (cached 30 days), maps Pfam
accessions from InterPro annotations to clan IDs with names.
Output format: "CL0023 (P-loop_NTPase);CL0192 (HAD)"

Closes #38

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b204daa`](https://github.com/tsenoner/protspace/commit/b204daaad016f189a49a1699165eb3f8f56e31b8))

* feat: replace unipressed with direct UniProt REST API calls

Replace the unipressed library (community UniProt API wrapper) with
direct HTTP calls to rest.uniprot.org. Adds _fetch_many_accessions()
and _search_sec_acc() helpers using the same Link-header pagination
pattern as the taxonomy retriever.

Simplifies the sec_acc search fallback from 8 lines of page-parsing
to a single function call.

Closes #32

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ca854b7`](https://github.com/tsenoner/protspace/commit/ca854b77fab4ef059b6c9c0a6a01e0f90316e3ed))

* feat: replace taxopy with UniProt Taxonomy API for taxonomy lookups

Replace the taxopy-based taxonomy retriever (which required downloading
the full NCBI taxonomy database ~50 MB on first use) with the UniProt
Taxonomy API (/taxonomy/search). This eliminates the slow first-run
download, weekly cache refresh, and ~120 lines of cache management code.

Also fix typer[all] → typer (the [all] extra was removed) and add
requests as an explicit core dependency.

Closes #36

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`af4abc7`](https://github.com/tsenoner/protspace/commit/af4abc7a5a6a1e2b22b5474d7c36f8126d2a9374))

* feat: add pre-commit hook for auto ruff format and lint fix

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b753c72`](https://github.com/tsenoner/protspace/commit/b753c723c3e3bbc52541a2e12ba651b2c6213a41))

* feat: add CSV annotation support to protspace prepare pipeline

- _resolve_annotation_names() now detects .csv/.tsv file paths and
  separates them from annotation names
- _fetch_annotations() loads user CSV and merges with API annotations
  (CSV wins on column name collision)
- Update docs/annotations.md: protspace-local → protspace prepare
- Update docs/cli.md: mention CSV/TSV in -a flag description
- Update CLI help text to mention CSV/TSV file paths
- Add 3 tests for CSV path parsing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b49b8cf`](https://github.com/tsenoner/protspace/commit/b49b8cf8374c6b58bb0cdaab1cf8bc2bf3a88963))

* feat: add example dataset generation system

TOML-driven generation of reproducible example datasets that test the
full pipeline and serve as release assets. Each dataset adds complexity:

1. three_finger_toxin (536) — basic single-PLM
2. beta_lactamase (731) — multi-PLM comparison (prot_t5 + esm2_650m)
3. globin (1,200) — sequence similarity + MDS
4. phosphatase (1,587) — all annotations
5. cytochrome_p450 (~5,500) — includes unreviewed TrEMBL entries

- scripts/generate_examples/datasets.toml: dataset registry
- scripts/generate_examples/generate.py: CLI orchestrator wrapping
  `protspace prepare`, supports --dataset/--all/--skip-existing/--list
- .gitignore: allow scripts/generate_examples/ (was fully ignored)

Usage:
  uv run python scripts/generate_examples/generate.py --dataset three_finger_toxin
  uv run python scripts/generate_examples/generate.py --all

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`abebde8`](https://github.com/tsenoner/protspace/commit/abebde89c64a3f6814353aec7d98339917536aa5))

* feat(cli): add run.log for reproducibility, improve error messages

- protspace prepare now writes a run.log to the output directory
  capturing all parameters, timing, and version info. Appends with
  separator on re-runs. Disable with --no-log.
- Wrap input-loading + pipeline in try/except so ValueError and
  FileNotFoundError show clean messages without tracebacks.
- Improve missing model_name error with actionable fix command
  using the user's actual file path.
- Ruff format on changed files.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`0f3007b`](https://github.com/tsenoner/protspace/commit/0f3007bd7f60937c619f907875681c7b3c9764c0))

* feat(embed): add 7 new pLM embedders via Biocentral API

Expand supported models from 5 to 12 by adding ESM2-35M, ESM2-150M,
Ankh-Base, Ankh-Large, Ankh3-Large, and ESMC-300M/600M (via Synthyra
ESM++ reimplementation). Remove unsupported one_hot, blosum62,
aa_ontology, and random embedders.

New EXTRA_SHORT_KEYS dict maps short aliases directly to HuggingFace
model names for models not in the CommonEmbedder enum. resolve_embedder()
checks both dicts. Documentation updated with full model table including
embedding dimensions and licensing info (Ankh/ESMC-600M are non-commercial).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`366e74f`](https://github.com/tsenoner/protspace/commit/366e74f720982aebba5ca42c0b103bc47425c13d))

* feat(cli): add individual step commands (embed, project, annotate, bundle)

Add power-user subcommands for running each pipeline step independently,
similar to mmseqs2's composable design.

- protspace embed: FASTA → HDF5 via Biocentral API (repeatable -e)
- protspace project: HDF5 → projection parquets (DR on embeddings)
- protspace annotate: HDF5/FASTA → annotation parquet (API fetch)
- protspace bundle: projections + annotations → .parquetbundle

All commands use the same loader infrastructure as `protspace prepare`.

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b0a75d3`](https://github.com/tsenoner/protspace/commit/b0a75d347e985e99acccf1c689f5058fef792e6f))

* feat(cli): add multi-embedding and multi-embedder support

Support multiple embedding sources and models in the prepare command.

- Make -e/--embedder repeatable: -e prot_t5 -e esm2_3b embeds FASTA
  with each model, producing separate EmbeddingSets
- Add -i colon syntax for model name override: -i file.h5:model_name
  (parsed by _parse_input_specs helper)
- Change -i from list[Path] to list[str] to support colon parsing
- Each -i flag creates a separate EmbeddingSet (multi-embedding)
- Pipeline prefixes each projection: "esm2_3b — PCA_2", "prot_t5 — UMAP_2"

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`66e0101`](https://github.com/tsenoner/protspace/commit/66e0101c02a1a7c49d42882c6e58b036f6005481))

* feat(pipeline): create unified ReductionPipeline, remove old processors

Replace LocalProcessor and UniProtQueryProcessor with a single
ReductionPipeline that composes loaders + annotation fetch + DR + output.

- Create data/processors/pipeline.py with PipelineConfig and ReductionPipeline
- Inline annotation fetching logic (from LocalProcessor._fetch_api_annotations)
- Wire cli/prepare.py to use ReductionPipeline + loaders directly
- Support -q/--query via query_uniprot loader + embed_fasta
- Support -s/--similarity via compute_similarity loader
- Always prefix projection names: "{source} — {METHOD}_{D}"
- Delete local_processor.py, uniprot_query_processor.py, common_args.py,
  local_data.py, uniprot_query.py (all replaced by new pipeline + loaders)
- Delete test_local_data_processor.py, test_uniprot_query_processor.py
  (test removed code)
- Update test_output_combinations.py to use BaseProcessor directly
- Update data/__init__.py and processors/__init__.py exports

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5aac56f`](https://github.com/tsenoner/protspace/commit/5aac56f0621b24abe7cb4a0b50235561b6a2fdac))

* feat(cli): add typer+rich and create CLI app with prepare/serve/style subcommands

Replace the four separate entry points (protspace, protspace-local,
protspace-query, protspace-annotation-colors) with a single typer-based
CLI app: `protspace {prepare,serve,style}`.

- Add typer[all] and rich as core dependencies
- Create cli/app.py with typer root app, shared utilities (logging, cache
  hash, output path computation), -h shorthand, and clean exception display
- Create cli/prepare.py with all options defined as Annotated type aliases
  (spaCy pattern), grouped into Input/Embedding/Projection/Annotations/Output
  panels via rich_help_panel. Boolean flags use explicit names to avoid the
  --flag/--no-flag toggle. Validates -i or -q required via typer.BadParameter
- Create cli/serve.py wrapping the Dash web frontend
- Create cli/style.py wrapping annotation style management
- Remove --delimiter option (CSV similarity input no longer supported)
- Update pyproject.toml to single entry point: protspace = protspace.cli.app:app

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d7af3db`](https://github.com/tsenoner/protspace/commit/d7af3db42a1f82a0ebba74ba8b83fd4d464aa4c5))

* feat(local): integrate Biocentral API embedding into protspace-local

FASTA files can now be passed directly to `protspace-local`, which
embeds sequences via the Biocentral API before running dimensionality
reduction. Supports deduplication, length-sorted batching, resume via
HDF5 cache, and all 9 pLM embedders (esm2_8m, prot_t5, etc.).

New CLI flags: --embedder, --batch-size, --half-precision,
--embedding-cache, --probe, --dry-run.

Example:
  protspace-local -i sequences.fasta --embedder esm2_8m -m pca2,umap2

Closes #30

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ed71906`](https://github.com/tsenoner/protspace/commit/ed719067cc1fe29650decf9d56f9bff92f55edf8))

* feat(uniprot,local): resolve inactive entries via UniParc and harden HDF5 loading

Inactive UniProt entries are now resolved using fetch_one() to detect
merged/deleted status, with sequence recovery from UniParc for deleted
entries and sec_acc: search as fallback. Per-entry diagnostics logged at
DEBUG; a one-line summary at WARNING.

HDF5 loader now handles grouped layouts, validates consistent embedding
dimensions, and rejects per-residue embeddings with a clear error.

Logging uses a tqdm-aware handler to avoid garbling progress bars, and
third-party loggers (urllib3, requests) are capped at WARNING even with
-vv. Redundant InterPro per-batch success logs removed.

CLI error handling improved with specific exception types and clean
sys.exit(1) instead of re-raising tracebacks.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`18eb126`](https://github.com/tsenoner/protspace/commit/18eb126cc4bc6fb24631c23b00078e953d0fb479))

* feat(reducers,notebook): add general DR params and seed all stochastic methods

Pass random_state to t-SNE, MDS, PaCMAP, and LocalMAP reducers (previously
only UMAP was seeded), enabling reproducible results across all stochastic
DR methods.

Notebook changes:
- Expose metric, random_state, and eps via interactive widgets
- Fix FloatSlider step bug that made fp_ratio slider non-functional
- Use responsive CSS Grid layout for parameter group boxes
- Suppress PaCMAP's informational "random state is set to" log message

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`7ade822`](https://github.com/tsenoner/protspace/commit/7ade8224318f51e98806cbe4fe8f31311752cb7d))

* feat(styling): add pinnedValues, __REST__ marker, and value preprocessing

Add legend ordering support to protspace-annotation-colors:
- pinnedValues for explicit control over legend order and visible categories
- __REST__ auto-fill marker to expand top values by frequency
- zOrderSort to decouple zOrder computation from stored sortMode
- Value preprocessing (pipe trimming, semicolon splitting) matching the
  ProtSpace web frontend
- Auto-assign Kelly's palette colors for pinned values, __NA__ key format
- Comprehensive docs in docs/styling.md, docs/cli.md, and CLI epilog

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`1e51455`](https://github.com/tsenoner/protspace/commit/1e514552a0388239ed38cee2155fc871643c0342))

* feat(styling): extend annotation styles with settings support and frequency-based zOrder

Add bundle I/O module and settings converter for parquetbundle 4-part
format. Extend protspace-annotation-colors to accept settings-level keys
(sortMode, maxVisibleValues, shapeSize, hiddenValues, selectedPaletteId)
alongside colors and shapes. Add --generate-template flag for scaffolding
styles JSON files. Fix selectedPaletteId default to "kellys", default
maxVisibleValues to 10, and assign zOrder by frequency when sortMode is
size-based. Normalize NA representations across data sources. Update
ALLOWED_SHAPES to the 6 shapes supported by protspace_web. Clean up 3FTx
example data and add styling documentation.

Closes #25

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`0da3e11`](https://github.com/tsenoner/protspace/commit/0da3e113c6f4cf1cdf054e0e0f0fe1f18dc88335))

* feat(notebook): add ProtSpace Preparation notebook and move notebooks to root

Move all notebooks from examples/notebook/ to notebooks/ at repo root.
Add ProtSpace_Preparation.ipynb (from protspace_web) with bug fixes:
- Fix -f flag to -a for annotation CLI argument
- Add CSV metadata upload widget for custom annotations
- Complete annotation lists (ec, gene_name, go_*, keyword, cdd, panther, prints, prosite, smart)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`2992722`](https://github.com/tsenoner/protspace/commit/2992722a6f3ff79735e1c7d3b83dec6ebb032427))

* feat(annotations): allow mixing custom CSV with database annotations

Support multiple -a flags so users can combine a CSV metadata file with
database annotations (e.g. -a metadata.csv -a pfam,kingdom). Columns are
merged on the identifier column with CSV values taking precedence on
collision. Only API-fetched annotations go into the parquet cache.

Closes #20, closes #23, closes #27

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`8536c65`](https://github.com/tsenoner/protspace/commit/8536c65e7a878bb10cbf4d19a44d554ba60ab28c))

* feat(annotations): add ECO evidence codes to UniProt annotations

Surface per-value evidence codes from the UniProt API inline using
the `value|CODE` format (same separator pattern as InterPro bit scores).

Affected fields: ec, cc_subcellular_location, protein_families, go_bp,
go_cc, go_mf. Keywords excluded (API never provides evidence on them).
GO source suffixes (e.g. IEA:UniProtKB-EC) are stripped to bare codes.
When multiple evidences exist, the highest-priority code is chosen.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`30a2940`](https://github.com/tsenoner/protspace/commit/30a29409c5e42014d39e0a64cc1dbc630836b3e9))

* feat(annotations): add named annotation groups (default, all, uniprot, interpro, taxonomy)

Replace the implicit "None means fetch everything" behavior with explicit
annotation groups. Users can now mix group names with individual annotations
(e.g. -a default,interpro,kingdom). When no annotations are specified, the
curated 'default' group (ec, keyword, length_quantile, protein_families,
reviewed) is used instead of fetching all annotations.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`ca36801`](https://github.com/tsenoner/protspace/commit/ca368016dad226e589555bfab187e23ec3b6ea73))

* feat(annotations): add EC, keyword, GO terms to UniProt annotations

Add 5 new annotations (ec, keyword, go_bp, go_cc, go_mf) to
UNIPROT_ANNOTATIONS, bringing the total from 13 to 18.

- EC numbers resolved with enzyme names via ExPASy ENZYME database
  (cached at ~/.cache/protspace/enzyme/, 7-day TTL)
- Keywords now include both ID and name: "KW-0418 (Kinase)"
- GO terms split by aspect (BP/CC/MF) with prefix stripping

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`aec7460`](https://github.com/tsenoner/protspace/commit/aec74606c25d891c6d52690cad6041f77e14b668))

* feat(interpro): resolve entry names via FTP XML download with local cache

Replace the slow paginated list API for name resolution (SUPERFAMILY ~2min,
CATH ~5min, PANTHER timeout) with a single download of interpro.xml.gz from
the EBI FTP server (~7s total). The XML is parsed via streaming ET.iterparse
and cached as JSON in ~/.cache/protspace/interpro/ with a 7-day TTL.

Also updates CLI help text and README with the full list of available
InterPro databases (cath, cdd, panther, pfam, prints, prosite,
signal_peptide, smart, superfamily).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`0e743e6`](https://github.com/tsenoner/protspace/commit/0e743e61d215aa92eab5da50c47ddd835d2fbac1))

* feat(tests): update tests to reflect always-included annotations in user-defined lists ([`bcd66d9`](https://github.com/tsenoner/protspace/commit/bcd66d9ec98886454e7b5b7959c3921588888937))

* feat(annotations): include always included annotations in user-defined lists ([`713d4fa`](https://github.com/tsenoner/protspace/commit/713d4fa2fc10dae3d77dbf1113718dd77c44c52f))

* feat(uniprot): add uniprot_kb_id and protein_name properties to UniProt retrieval ([`fbcf4a0`](https://github.com/tsenoner/protspace/commit/fbcf4a0a833bdbde67d9016fe1241f430e34df76))

* feat(local): support multiple embedding files and directories

Enable protspace-local to accept and merge multiple HDF5 files/directories
via the --input argument. Automatically handles duplicates (keeps first) and
filters NaN values. Streamlined input loading logic and added comprehensive
test coverage with reusable mock helpers. ([`7bfb4eb`](https://github.com/tsenoner/protspace/commit/7bfb4ebd3687d29b06e3bac244bdff9400b77df6))

* feat(annotations): add InterPro signature names and refactor test data

Include signature names in parentheses after accessions (e.g., PF00001 (7tm_1)|50.2).
Refactor test data using helper functions and constants for better maintainability. ([`341cc59`](https://github.com/tsenoner/protspace/commit/341cc59131481f661ea0557ba6bdbd049272d579))

* feat(annotations): store InterPro annotations with confidence scores in pipe-separated format

Store InterPro accessions and confidence scores in a single field using
pipe-separated format: accession|score1,score2;accession2|score1

- Collect all scores for duplicate accessions
- Add multidomain tests
- Update README documentation ([`8c92898`](https://github.com/tsenoner/protspace/commit/8c92898ffea1da84f4272a0ebde19129fbdc35f0))

* feat(annotations): refactor feature extraction to annotation extraction

- Replace all instances of "features" with "annotations" in the codebase
- Rename data/features/ directory to data/annotations/
- Update all module imports and class names
- Update CLI commands and documentation to reflect the terminology change
- Add comprehensive tests for annotation retrieval and processing

This change improves code clarity by aligning internal terminology with the actual data being processed. The JSON output format remains unchanged (still uses "features" key). ([`76d5f1b`](https://github.com/tsenoner/protspace/commit/76d5f1b76ee7e5dbc7da98c604e185cca6fecc1b))

* feat(uniprot): add gene_symbol feature to UniProt retrieval

Closes #21 ([`6e6c9f1`](https://github.com/tsenoner/protspace/commit/6e6c9f146f8c79056b4475072fe6b1f74c00cadc))

* feat(cli): use first CSV column as identifier regardless of name

Closes #10 ([`3421d02`](https://github.com/tsenoner/protspace/commit/3421d023e312331e83940adf30d96f3651969814))

* feat(cache): add incremental feature caching for --keep-tmp

Enable source-level caching that only fetches missing features from UniProt,
Taxonomy, or InterPro APIs. Previously, cache was all-or-nothing.

- Add feature categorization and source determination helpers
- Support cached data in ProteinFeatureManager
- Add --force-refetch flag to bypass cache
- Add comprehensive tests for caching behavior ([`eb4708b`](https://github.com/tsenoner/protspace/commit/eb4708b62f8fdd3c24f0b128db57cd27ef85df0c))

* feat(cache): add incremental feature caching for --keep-tmp

Enable source-level caching that only fetches missing features from UniProt,
Taxonomy, or InterPro APIs. Previously, cache was all-or-nothing.

- Add feature categorization and source determination helpers
- Support cached data in ProteinFeatureManager
- Add --force-refetch flag to bypass cache
- Add comprehensive tests for caching behavior ([`af56b3b`](https://github.com/tsenoner/protspace/commit/af56b3b18df81f780afd386397f174e18c93d1e8))

* feat(local-processor): add NaN handling and improve method API

- Add automatic detection and filtering of embeddings with NaN values
- Remove problematic entries with warning instead of failing
- Add strict=True to zip() for safer iteration
- Remove unused output_path parameter from load_data signature
- Rename private methods to public API (load_input_file, load_or_generate_metadata)
- Remove unused process_local() wrapper method

These changes simplify the API by exposing the actual working methods
that are used by the CLI, making the interface more honest and maintainable.

NaN handling prevents PCA failures when input data contains invalid embeddings,
automatically filtering them out with informative warnings. ([`6208769`](https://github.com/tsenoner/protspace/commit/6208769b5cd1b0fbd053f72cbe582cfc433e3d7c))

* feat(notebook): add regex-based UniProt ID extraction

- Extract UniProt IDs from FASTA headers using pattern recognition
- Remove old 2024_ClickThrough notebook version
- Improves ID parsing robustness ([`2a7181e`](https://github.com/tsenoner/protspace/commit/2a7181eb4f222c5204efe9c9689b994504a1c239))

* feat(data): replace bioservices with unipressed in UniProt retriever

- Replace bioservices.UniProt with unipressed.UniprotkbClient
- Use new UniProtEntry parser for data extraction
- Update UNIPROT_FEATURES to include organism_id and sequence
- Store raw UniProt data in tmp files with minimal processing
- Extract 10 features: annotation_score, cc_subcellular_location, fragment,
  length, organism_id, protein_existence, protein_families, reviewed,
  sequence, xref_pdb ([`0b03529`](https://github.com/tsenoner/protspace/commit/0b035299635756be924450806eb3a5b6afec52e1))

* feat(parser): add manual UniProt parser, to be independent of 'bioservices'

- Create new parsers module in src/protspace/data/parsers/
- Add UniProtEntry class for parsing UniProt REST API JSON responses
- Implement cc_subcellular_location property to extract location values
- Add fetch_uniprot_data() utility function for batch fetching
- Support 45 UniProt properties with comprehensive docstrings ([`116f490`](https://github.com/tsenoner/protspace/commit/116f490408e8674f36ca5d8db909cf7ce94984b2))

* feat(taxonomy): add root and domain features

Extended taxonomy features with root and domain to better support both
cellular and acellular organisms (viruses).

- Add 'root' feature: uses 'cellular root' or 'acellular root' rank values
- Add 'domain' feature: uses 'domain' rank (Bacteria, Archaea, Eukaryota)
  or falls back to 'realm' rank for viruses (e.g., Riboviria)
- Update documentation in README.md and CLI help text (common_args.py) ([`27c08b0`](https://github.com/tsenoner/protspace/commit/27c08b065955b1e6e2ced2490e8a88fa2f21adca))

* feat(cli): add shared argument parsing utilities

- Create common_args.py module with reusable CLI components
- Add CustomHelpFormatter for preserving newlines and showing defaults
- Implement modular argument group adders for all parameter types
- Include comprehensive help text with examples and parameter guidance
- Support both CSV metadata files and comma-separated feature lists ([`ad9bab7`](https://github.com/tsenoner/protspace/commit/ad9bab71b3ca28e485fe212da1ba1f7c593fa0e6))

* feat(umap): add random_state parameter for reproducibility

Add random_state parameter with default value of 42 to ensure
reproducible UMAP results across runs.

- Add random_state field to DimensionReductionConfig (default: 42)
- Update UMAPReducer to pass random_state to UMAP constructor
- Add --random_state CLI argument to protspace-local and protspace-query
- Update base_data_processor to include random_state in valid config keys
- All 53 tests passing

Fixes #16 ([`031a319`](https://github.com/tsenoner/protspace/commit/031a319874aa0abcaaec973ff842c6d6cb5b486a))

* feat: enhance taxonomy feature retrieval with error handling and cache management

- Added error handling in get_taxonomy_features to log and return an empty mapping on fetch errors.
- Improved _initialize_taxdb to support environment variable for cache directory and implemented a safe refresh strategy for the taxonomy database.
- Updated logic to handle first-time setup and cache refresh without losing existing data. ([`22e545c`](https://github.com/tsenoner/protspace/commit/22e545c3622a008ce5947295c787fb1fba179e13))

* feat: update all Jupyter notebooks for new protspace-local CLI interface

- Update protspace-local command to use -f (features) instead of -m (metadata)
- Update PfamExplorer, Explore_ProtSpace, and Run_ProtSpace notebooks
- Adapt notebook workflows to work with new JSON file generation method
- Update installation commands to use specific git commit for consistency
- Maintain backward compatibility with existing data processing pipeline ([`910ebab`](https://github.com/tsenoner/protspace/commit/910ebaba43f6532575283c02b2684af7e22ea818))

* feat: add -m as alias for --methods flag ([`0a41553`](https://github.com/tsenoner/protspace/commit/0a41553b60f5464f61fe7ba7df31a7495deac66a))

* feat: Update interpro feature retriever to include boolean signal peptide

- Update interpro_feature_retriever to accept `cath` instead of `cath-gene3d` making it easier for users to call it
- Modified example CLI scripts to include 'signal_peptide' in feature extraction (as well as modified `cath`)
- Adjusted tests to reflect changes in expected features. ([`64c6c63`](https://github.com/tsenoner/protspace/commit/64c6c639e7738807fc4b3597b40e120fda313b6e))

* feat: Add InterPro feature retrieval support

- Add InterProFeatureRetriever class for fetching domain annotations
- Support Pfam, SUPERFAMILY, and CATH-Gene3D features from InterPro6 API
- Integrate InterPro features into ProteinFeatureExtractor workflow
- Update CLI examples to include InterPro features
- Add comprehensive tests for InterPro functionality ([`39cd4b5`](https://github.com/tsenoner/protspace/commit/39cd4b51dce92c1529fae80a2021a956c20f8297))

* feat: add support for bundled parquet files in ProtSpace

- Enhanced data input handling in main.py to support .parquetbundle files.
- Introduced a new function to extract parquet files from bundled format.
- Updated CLI argument parser to include a flag for bundling parquet files.
- Modified save_output method in BaseDataProcessor to handle bundling logic. ([`bec9b1e`](https://github.com/tsenoner/protspace/commit/bec9b1e4043e45cba6bfc75bbda9b46b2c68fd94))

* feat(ci): update release workflow to handle protected branches

- Add support for SEMANTIC_RELEASE_TOKEN to bypass branch protection
- Improve error handling and output management in release workflow
- Add fallback to GITHUB_TOKEN if PAT not available
- Create setup guide for PAT configuration
- Enable fully automated releases with protected main branch ([`9dc5872`](https://github.com/tsenoner/protspace/commit/9dc58726acd7725f4be63252998cc99cb50c105d))

* feat: add support for Apache Arrow data format in ProtSpace

- Introduced ArrowReader class for reading and manipulating Arrow/Parquet files.
- Added new flags for protspace-query and protspace-local called --non-binary, if using this flag, everything is like before, otherwise using apache arrow format
- protspace cli has a new argument called --arrow, to pass a arrow files directory ([`0e48f5a`](https://github.com/tsenoner/protspace/commit/0e48f5a602c7fd4e30054526e451cf42846faa1d))

* feat: enhance metadata validation in protspace-query, not to accept csv files as metadata ([`6213472`](https://github.com/tsenoner/protspace/commit/6213472e5e54905111fd7021f37f4a0d61ff6304))

* feat: add UniProt query CLI tool and related data processing modules

This commit introduces a new CLI for querying UniProt, with several supporting modules for data retrieval and processing. Key additions include:
- `uniprot_query.py`: CLI for searching and processing proteins from UniProt.
- `uniprot_feature_retriever.py`: Renamed old `uniprot_fetcher.py` to this
- `uniprot_query_processor.py`: Handles query processing and data analysis.
- Updates in `generate_csv.py` to use the new feature retriever. ([`9325e5c`](https://github.com/tsenoner/protspace/commit/9325e5c26b04707483af95ae7fe42292a7683082))

* feat: implement length binning features in ProteinFeatureExtractor
- Now a csv file is created based on all available features and then we filter them based on user requested features ([`6ba24e8`](https://github.com/tsenoner/protspace/commit/6ba24e826a597598cb2bbf9f6dfddaa14e9481b1))

* feat: enhance CSV processing by adding protein families handling ([`e2d145c`](https://github.com/tsenoner/protspace/commit/e2d145c7f36601d20dfaefe8241b465e5119af90))

* feat: expand taxonomy features and implement cache refresh logic in TaxonomyFetcher ([`9dea896`](https://github.com/tsenoner/protspace/commit/9dea89697974cf6b94faa86de664feaf22e20989))

* feat: refactor DataProcessor with the new automated metadata generation logic ([`6610be1`](https://github.com/tsenoner/protspace/commit/6610be149e35c33c0209f4828d4ed55234db341a))

* feat(notebook): enhance ClickThrough_GenerateEmbeddings notebook with new model options and improved embedding generation logic

- Updated installation cell to include additional dependencies for ESM and Hugging Face.
- Added optional Hugging Face login cell for models requiring authentication.
- Improved model selection and embedding generation logic, including handling for different model types and sequence lengths.
- Enhanced error handling for invalid headers in the output dataset.
- Updated output file naming to include model type for clarity. ([`2c0370c`](https://github.com/tsenoner/protspace/commit/2c0370cb54931d5386d1c7463e697e29f6a4d242))

* feat(viewer): replace NGL Viewer with Molstar Viewer

- Replace NglMoleculeViewer with dash-molstar component
- Add molstar_helper.py for data handling and AlphaFold DB fetching
- Refactor styles from callbacks into centralized styles.py
- Remove obsolete NGL viewer code ([`4525fcd`](https://github.com/tsenoner/protspace/commit/4525fcddeb535e766ac5d58b24d49ec8ef50c8c4))

* feat(app): Overhaul plotting, styling, and UI interactivity

This commit introduces a comprehensive set of improvements, including major refactoring, new features, and numerous bug fixes to enhance user experience, code maintainability, and performance.

**Refactoring:**

- Separated style application from plot generation into distinct callbacks, improving performance and preventing unintended side-effects.
- Consolidated duplicated plotting logic into a single, centralized `create_plot` function.
- Unified the side-panel (Help and Settings) logic into a single, more robust callback.
- Streamlined marker shape configuration in `config.py` for better consistency and clarity.
- Refactored the `save_plot` function to write directly to an in-memory buffer, making downloads more efficient.
- Corrected the data access pattern in `data_loader.py` to prevent crashes and align with the actual data schema.

**Features & Enhancements:**

- **Plot & Legend:**
  - Decoupled legend size from the main marker size with a new, independent "Legend Size" input field for granular control.
  - The legend size now updates instantly on input change for a better user experience.
  - Re-implemented the custom legend trace logic to ensure markers are large, clear, and free of duplicates.
  - The marker shape dropdown now dynamically updates based on whether the plot is 2D or 3D.
- **Styling:**
  - Implemented default styling for `<NaN>` values and made their shape configurable.
  - Ensured all data points correctly default to a "circle" marker if no specific shape is defined.
  - The `<NaN>` option now only appears in the styling dropdown if the selected feature actually contains missing values.
- **Downloads:**
  - Expanded download options to include PNG, JPEG, WEBP, PDF, and HTML.
  - Enforced the correct filename format for all downloads: `<dim_reduction>_<feature>.<format>`.

**Bug Fixes:**

- **CRITICAL:** Fixed a style-bleeding bug where style changes for a value in one feature would incorrectly apply to other features.
- Fixed a `KeyError: 'annotations'` crash on application startup.
- Resolved multiple crashes and errors related to the download functionality.
- Fixed a crash when using 2D-only marker shapes in 3D plots.
- Fixed an `AttributeError` crash caused by scrambled callback parameters.
- Corrected various minor UI and data handling bugs. ([`b68f786`](https://github.com/tsenoner/protspace/commit/b68f786948426b42a7acdf446c154269bfc52487))

* feat(app): overhaul plotting, styling, and download functionality

This commit introduces a major overhaul of the application's core features, including significant refactoring, new functionality, and numerous bug fixes to improve user experience and code maintainability.

**Refactoring:**

- Consolidated all plotting logic into a single, centralized `create_plot` function in `plotting.py`, removing duplicated code from `callbacks.py`.
- Refactored the `save_plot` function to write directly to an in-memory buffer, making downloads more efficient and fixing several related bugs.
- Streamlined marker shape configuration by removing redundant variables in `config.py` and enforcing a consistent `MARKER_SHAPES_2D` and `MARKER_SHAPES_3D` structure across the application.
- Corrected the data access pattern in `data_loader.py` to prevent crashes and ensure correct feature value retrieval.

**Features & Enhancements:**

- **Legend:**
  - Resolved marker overlap in the legend for better readability.
  - Implemented a workaround using dummy traces to allow for larger legend markers.
  - Ensured the legend is always sorted alphanumerically.
- **Styling:**
  - Implemented default styling for `<NaN>` values (semi-transparent gray, circle shape) and made them configurable.
  - Ensured all data points default to a "circle" marker if no specific shape is defined, preventing inconsistent automatic shape assignment.
  - The marker shape dropdown now dynamically updates based on whether the plot is 2D or 3D.
- **Downloads:**
  - Expanded download options to include PNG, JPEG, WEBP, PDF, and HTML.
  - Implemented the correct filename format for downloads: `<dim_reduction>_<feature>.<format>`.
- **UI/UX:**
  - The `<NaN>` option now only appears in the styling dropdown if the selected feature contains missing values.

**Bug Fixes:**

- Fixed a critical bug where style changes for a value in one feature would incorrectly bleed into other features upon switching.
- Corrected a `KeyError: 'annotations'` crash on startup.
- Resolved multiple crashes related to the download functionality (`TypeError`, `ValueError: Invalid format ''`).
- Fixed an issue where the marker shape dropdown was not updating correctly.
- Prevented crashes when using 2D-only marker shapes in 3D plots. ([`f2abf14`](https://github.com/tsenoner/protspace/commit/f2abf14af72639d7146e94a2a009678a947f703d))

* feat(app): enhance plot controls and fix UI interactions

This commit introduces significant improvements to the user interface and adds new functionality for plot customization, while also resolving several bugs.

- **Marker Size Control:**
  - Adds a new input control allowing users to dynamically adjust the size of the scatter plot markers.
  - The plot now updates automatically when the marker size value is changed, providing immediate visual feedback.
  - The default marker size is now set to 10, and the previously hardcoded constant has been removed.

- **Plot Downloads:**
  - Fixes a critical bug that caused plot downloads to fail. The download callback now correctly handles different file formats by using `dcc.send_bytes` for PNGs and `dcc.send_string` for SVGs and HTML.

- **UI and Layout:**
  - The download format dropdown has been modified to open upwards, preventing it from being obscured by elements below it. This was achieved by removing an invalid property and using a custom CSS class.
  - The settings panel for marker styling now appears alongside the scatter plot instead of overlaying it. The scatter plot resizes to accommodate the panel, creating a more integrated and responsive layout.
  - The width of the settings panel has been adjusted to provide a better balance between the controls and the plot visualization.

- **Bug Fixes:**
  - Resolves a state management issue where applying a style to a feature would incorrectly reset the feature dropdown to its default value. The callback now preserves the user's selection.
  - Corrects an `AttributeError` that occurred due to a misordered function signature in a callback after a new input was added. ([`37aecdd`](https://github.com/tsenoner/protspace/commit/37aecdd893893297b774242f8d77709e1cd3ccd7))

* feat(localmap): add new LocalMAP redundancy reduction ([`9d1972b`](https://github.com/tsenoner/protspace/commit/9d1972bfb4a28da15c81638e3543f771c05667b2))

* feat: add help button ([`839382c`](https://github.com/tsenoner/protspace/commit/839382c7d6d04c4565dcf0a71953922db9eb70a4))

* feat: update datasets ([`7e71365`](https://github.com/tsenoner/protspace/commit/7e713653cd71f2d81ec506adb36895ec6dac282d))

* feat: test update ([`65a1049`](https://github.com/tsenoner/protspace/commit/65a1049482ddbe1e8d121ae6e578ece498664855))

* feat(utils): add JSON analyzer for data inspection

Add a CLI utility that provides insights into ProtSpace JSON files
with configurable detail levels. The tool helps inspect:
- Number of proteins and available features
- Dimensionality reduction methods
- Feature distributions
- Visualization settings ([`395ea39`](https://github.com/tsenoner/protspace/commit/395ea399c614cf56c522d625c24994b4d8f04087))

* feat: add PaCMAP as a DR method ([`1235f12`](https://github.com/tsenoner/protspace/commit/1235f125c83124edd2fd8912c5d9895b22d1e69b))

* feat: update uv caching strategy ([`0cc315a`](https://github.com/tsenoner/protspace/commit/0cc315a1936a1e9514e2ca5ad1b7a7259a8e5a6e))

* feat(errors): add trace id to bug reports and distinguish too-few sequences

Two improvements to backend error reporting on FASTA prep failures:

- The "Report this" email now embeds the backend trace id (the prep
  `job_id`) in its technical block, so a report can be correlated with
  server logs. The line is omitted for client-only failures that carry
  no trace id.
- Importing fewer than the 20-sequence minimum is now reported as
  "too few sequences" instead of "appears to be empty". The backend
  validator gains a distinct TOO_FEW_SEQUENCES code (separate from
  EMPTY_FASTA) and the client pre-check mirrors it; the message names
  the actual count and the floor.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`343a8b0`](https://github.com/tsenoner/protspace/commit/343a8b02571095ce2c5f091e9a4dd50bb07eece7))

* feat(deps): migrate React 18 → 19 (+ sonner 2)

Bumps react/react-dom and their @types to 19, and sonner to 2 (its React
19 peer). The app already used createRoot and had no defaultProps/
propTypes/findDOMNode/string-ref patterns, so the only code change is the
custom-element typings: React 19 scopes JSX under the react module's own
namespace, so custom-elements.d.ts now augments `declare module 'react'`
instead of the legacy global `JSX` namespace.

Verified: full type-check, 1479 tests, build, and a browser regression
(app mount via createRoot, web components mount/render, annotation switch
recolors the plot + syncs the URL, routing) — zero React console errors.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`9f97158`](https://github.com/tsenoner/protspace/commit/9f97158e20c01ec9232bf6f0f1b76a76feb978dd))

* feat(deps): migrate Tailwind CSS 3 → 4

Ran the official @tailwindcss/upgrade tool: CSS-first config inlined into
index.css (@theme/@plugin/@custom-variant/@utility), tailwind.config.ts
removed, postcss switched to @tailwindcss/postcss (autoprefixer dropped,
now built in), tailwindcss-animate kept via @plugin, and v4 utility
renames applied (shadow-sm→xs, backdrop-blur-sm→xs, outline-none→hidden).
The v3 default-border-color compat shim was added to avoid visual drift.

Knip can't see CSS-only @import/@plugin deps, so tailwindcss and
tailwindcss-animate are added to its ignoreDependencies for the app.

Verified: build, type-check, 1479 tests, and a full browser visual
regression (landing, feature cards, explore controls/legend/scatterplot,
dropdown popover + focus rings) — identical to v3, no console errors.
Clears the last 8 advisories → prod audit now reports zero.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`06a5a5d`](https://github.com/tsenoner/protspace/commit/06a5a5da17b332145c17692d51c149719bfba193))

* feat(deps): migrate React Router v6 → v7 (7.18.0)

Moves from the maintenance v6 line to the actively-developed v7 stable
release. The app already had the v7 future flags enabled
(v7_startTransition, v7_relativeSplatPath), so the migration is
mechanical: consolidate on the single `react-router` package (v7 drops
the separate `react-router-dom`), update all imports, and remove the now-
default future flags. v7.18.0 supports React 18 (peer react>=18), so no
React 19 prerequisite; it also supersedes the interim 6.30.4 bump.

Only stable SPA APIs are used (BrowserRouter, Routes, Route, Link,
useSearchParams). Verified: type-check, 128 unit tests, build, and in the
browser — Link nav, route rendering, useSearchParams URL sync, and the
catch-all 404, all with zero router console errors.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`b78ec1e`](https://github.com/tsenoner/protspace/commit/b78ec1e4ba6124dce1d400dfacd8cd06f4a00eb3))

* feat: add prominent Feedback CTA to header nav

Add a filled Feedback button to the desktop and mobile header
navigation, opening a prefilled mailto: to the support inbox via the
shared buildMailto helper. Update the support-contact spec with the
matching requirement.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`34146df`](https://github.com/tsenoner/protspace/commit/34146df600ff1bf7a25f207df9d624cfe7c4ad34))

* feat: surface support inbox (hello@protspace.app) across the interface

Add in-app paths to the support inbox for general contact, bug/error
reporting, and privacy requests.

- support.ts: single source for the address + pure link/body builders
  (mailto, prefilled GitHub issue, truncated bug-report context)
- notify: NotifyOptions gains an optional action, forwarded to sonner
- Explore import/export failures get a prefilled "Report this" action
- Footer contact link, Privacy contact email, NotFound broken-link line
- ErrorBoundary wrapping <App> with Reload / Email us / GitHub issue,
  replacing the blank-screen crash
- vitest.config: add @ alias so component tests resolve imports

Includes OpenSpec change artifacts, archived (support-mailto-integration).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`2b1d3bc`](https://github.com/tsenoner/protspace/commit/2b1d3bcc0d9e80157732521ee947355a18a13b27))

* feat(scatter-plot): always show visible point count in bottom-left chip

Generalize the isolation-only point counter into an always-on indicator
of what is actually drawn: _plotData (already culled by isolation and
query filters) minus legend-hidden points per the visibility model. The
count is memoized on the mask-relevant inputs only, so selection fading
never triggers an O(N) recount.

Rename .isolation-indicator to .plot-indicator (shared with the numeric
recompute notice), restyle it on var(--primary) to match .mode-indicator
and the filter badge, and update the export ignore list so the now
always-visible chip stays out of exported images. ([`8be3cf4`](https://github.com/tsenoner/protspace/commit/8be3cf444e14e9100efab574239cc460683600f1))

* feat(scatter-plot): add pure visibility-model module ([`e7bbae7`](https://github.com/tsenoner/protspace/commit/e7bbae763fdfb5d622adcb7c4ef6243f9960d467))

* feat(control-bar): render numeric input for numeric filter annotations ([`9fcc152`](https://github.com/tsenoner/protspace/commit/9fcc1527375f4b3d204f80712f118a9fa8fbd051))

* feat(control-bar): add query-numeric-input component ([`d8a6e7d`](https://github.com/tsenoner/protspace/commit/d8a6e7de5c3603580f36fc4a3691b741f0a9d10c))

* feat(control-bar): evaluate numeric filter conditions via discriminated union ([`d24f276`](https://github.com/tsenoner/protspace/commit/d24f2763143f56a762380071d13269b13d04cd7d))

* feat(control-bar): add numeric filter types and matching helpers ([`55bdc49`](https://github.com/tsenoner/protspace/commit/55bdc49f3364578ee3d7bc647e5995455338c24e))

* feat(annotations): mark de-novo predictions across sources, rank-order taxonomy docs

Traced each annotation's provenance in the protspace Python backend (which splits
purely by API source) and applied an evidence-based ⚡ Predicted mark:

- Mark the de-novo / structure predictors — Phobius `signal_peptide` and TED
  `ted_domains` — as predicted alongside Biocentral. Reference signature databases
  (Pfam, CATH-Gene3D, SUPERFAMILY, …) and curated/factual data (UniProt, Taxonomy)
  stay unmarked.
- Decouple the ⚡ flag from dropdown grouping: group strictly by source
  (Biocentral, InterPro, TED, Taxonomy, UniProt, Other) and render a per-row ⚡
  badge, so marking predictions no longer empties the InterPro/TED groups.
- Order the Taxonomy docs section by rank depth (general → specific) and state the
  rank ladder in its intro; share TAXONOMY_RANK_ORDER between dropdown and docs.
- Generalize the legend "predicted" wording to "computationally predicted".

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`8e5d0df`](https://github.com/tsenoner/protspace/commit/8e5d0df7bcf8f57892660e341ae61b146c4cd32b))

* feat(annotations): enrich docs with researched details, open info popover on hover

- Add docs-only annotation-details.ts: rich, source-linked prose per column plus
  expanded source intros, merged into the generated reference page by
  generate-annotations.mts. The brief popover text stays in the runtime registry,
  so the dropdown shows a short summary while the docs go deep; --check guards
  drift and rejects detail keys that don't match a column.
- Info popover now opens on hover and keyboard focus (hoverable, so you can move
  into it to click "Learn more"); click still pins, Escape/outside-click close.
  Covered by new unit tests.
- Drive the docs dev port from the single PORTS constant with strictPort, so a
  silent port bump can't break the app's /docs proxy and 404 the "Learn more"
  links.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`d28cea1`](https://github.com/tsenoner/protspace/commit/d28cea1d41459926b3fc1eecc1f609a39c02eb19))

* feat(annotations): mark predictions and surface per-annotation docs

Add a single annotation-metadata registry in @protspace/utils (label,
source, isPredicted, description, docsUrl) as the source of truth for
annotation presentation, replacing the hardcoded annotation-categories
map. It drives a dedicated "Predicted" dropdown group, a ⚡ Predicted
legend badge + note, friendly display labels, and an info-icon popover
with descriptions and "Learn more" links. The predicted_ prefix is the
robust fallback; unknown columns degrade gracefully.

Generate docs/guide/annotations.md from the registry (with a --check
mode wired into precommit) so inline text and the docs page cannot drift.

Resolves #221.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ee70706`](https://github.com/tsenoner/protspace/commit/ee7070642923713ba6a56ff8a949902e89d5ce83))

* feat(explore): client-side FASTA limits and error-code messaging

- Shared limit constants mirroring the backend; pre-upload size/count guards
  fail fast before spending a rate-limit token (advisory; backend stays source
  of truth).
- Map backend error codes to actionable messages and surface the job_id as a
  reference; fall back to the server message for unknown codes.
- Show the Colab note only when the sequence count exceeds the max.
- Stop the progress bar implying completion near the server pipeline timeout.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`494d3a0`](https://github.com/tsenoner/protspace/commit/494d3a0ead61f78017257492c354a0609dfea57a))

* feat(protspace-prep): bound pending jobs and harden FASTA validation

- Cap pending jobs (PREP_MAX_PENDING_JOBS, default 50): the concurrency
  semaphore gated execution but not submission, so unbounded uploads grew disk
  and memory without limit. submit() now rejects past the cap with HTTP 503 +
  Retry-After before writing any state.
- Dedup over parse_identifier(): the pipeline normalizes headers, so raw-token
  dedup let post-normalization duplicates slip through and break the join.
- Cap total residues (PREP_SEQUENCE_MAX_TOTAL_RESIDUES, default 1.5M): per-seq
  and count caps did not bound their product feeding the embedder.
- Warn when CORS is disabled so a blanked origins secret is visible in logs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`9a184c6`](https://github.com/tsenoner/protspace/commit/9a184c6c123a3a8d347dfac7d847230e9d1194f7))

* feat(protspace-prep): enforce CORS and per-IP rate limit in-app

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`8187f61`](https://github.com/tsenoner/protspace/commit/8187f61c429716043a0918a28c44436b35f8dbfb))

* feat(protspace-prep): add X-Forwarded-For-aware rate-limit key ([`93bcd78`](https://github.com/tsenoner/protspace/commit/93bcd7814620c0654c5bedda315a855efb449a8e))

* feat(protspace-prep): add CORS origins and rate-limit settings ([`7ed3117`](https://github.com/tsenoner/protspace/commit/7ed3117b15d6472df409e89170e24b772cd5651c))

* feat(protspace-prep): structured logging with job_id error references

Add structlog-based structured logging to the prep service and surface the
job_id to users as a reportable error reference.

- setup_logging(): console renderer in dev, JSON in prod (PREP_LOG_JSON_FORMAT);
  a root ProcessorFormatter routes existing stdlib logging through structlog
  with no call-site changes, and tames the uvicorn loggers.
- Bind job_id in contextvars at the top of JobRegistry._run (after clearing
  inherited submit-request context) so every pipeline log line — including the
  protspace library's — is correlated by job_id automatically.
- Invert error-detail flow: subprocess stderr and unexpected exceptions are
  logged server-side keyed by job_id; users receive a curated message and no
  longer see raw stderr. PipelineFailure gains an internal `detail` field
  (preserved through the TaskGroup re-raise) used for logs and Biocentral
  classification.
- Add job_id to all SSE error event payloads; FastaPrepError now carries jobId
  (from the payload, falling back to the held job id).

Capture the work as the prep-observability capability spec (synced from the
archived OpenSpec change).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`e4ec0b2`](https://github.com/tsenoner/protspace/commit/e4ec0b2293f0bf518a464e20addf1c4cc9c61611))

* feat(prep): embed-time estimates, queue position, and Biocentral down handling

Frontend:
- Estimate embedding time from sequence count and surface it as a sub-message.
- Smooth progress with an asymptotic creep between embedding/projecting stages.
- Show queue position when the job is waiting for a slot.
- Display a persistent "Got a larger dataset?" overlay note linking to the
  Colab notebook so users have a fallback when the lab service is busy or down.
- Wrap submit/SSE/download failures in a typed FastaPrepError that carries an
  optional server-supplied error code.

Backend:
- Tag the queued event with queue_position and running counts so the UI can
  show "Position N in queue" instead of a blank wait.
- Propagate an optional code on PipelineFailure into the SSE error payload.
- Classify Biocentral connection / 503 failures as BIOCENTRAL_UNAVAILABLE
  with a friendlier user-facing message that points at the Colab fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`63e956d`](https://github.com/tsenoner/protspace/commit/63e956df2987b385f5d99409c05cd34650fc4fb2))

* feat(explore): cancellable FASTA prep + cross-origin backend base URL

Wires an AbortController through prepareFastaBundle and renders a Cancel
button on the loading overlay while the prep job runs. The dataset
controller's data-error handler now special-cases AbortError so a user
cancel resolves the load queue cleanly instead of surfacing as a
toast/error UI. The button is removed once the bundle handoff completes
or the prep call rejects.

The runtime now also reads VITE_PREP_API_BASE so the SPA can target a
separate backend origin (the new Caddy in front of protspace-prep) in
both dev and prod, falling back to same-origin when unset.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`a0391c4`](https://github.com/tsenoner/protspace/commit/a0391c406eba3cb1685c93fde8c2bc81a0819745))

* feat(explore): friendlier FASTA prep submit error messages

The prep submit path returned bare "Upload failed (HTTP 429)" messages
on rate-limit, oversize, and backend-unavailable responses. Map 429,
413, 503, and 504 to user-readable strings, parse Retry-After (seconds
or HTTP date) into a "try again in N minutes" hint, and fall back to a
generic but still helpful message when the header is missing or the
body is non-JSON (e.g. Caddy's plain-text 429).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`d4814bc`](https://github.com/tsenoner/protspace/commit/d4814bc088b8b4215559c62e4d6749caccdbfbe1))

* feat(prep): split protspace prepare into per-step subprocesses

Replace the single `protspace prepare` invocation with explicit calls to
`protspace embed`, `annotate`, `project`, and `bundle`. Embed (Biocentral)
and annotate (UniProt) are network-bound and independent, so they run
concurrently inside an `asyncio.TaskGroup`; project and bundle run
sequentially afterward. The whole run shares a single wall-clock budget
via `asyncio.timeout` so the SSE contract still has a deterministic upper
bound.

Stage events are now driven by the pipeline orchestrator rather than
parsed out of stderr, so the regex-based stage detector is gone. Each
step's stderr is still drained line-by-line (last 50 lines kept for
failure messages) so subprocesses never block on a full pipe, and
cancellation kills the subprocess before propagating.

Tests cover the success path, parallel execution of embed+annotate,
per-step failure surfaces, the missing-bundle and missing-H5 sentinels,
and timeout-driven subprocess kill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`2546e9f`](https://github.com/tsenoner/protspace/commit/2546e9fe7ff322cd011bed5341665f6bdc86b2c5))

* feat(explore): route FASTA drops through prep backend, keep parquetbundle path intact

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`fcdf0ba`](https://github.com/tsenoner/protspace/commit/fcdf0ba1b1bb0f583cca68d78a32fc5befac05d2))

* feat(explore): add FASTA prep client (POST + SSE + bundle download)

Implements isFastaFile helper and prepareFastaBundle that uploads a FASTA
file, streams SSE progress events, and resolves with a .parquetbundle File.
Uses @public JSDoc tags on FastaPrepStage/FastaPrepOptions so knip recognises
them as intentional public API ahead of Task 10 wiring.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`9dc5230`](https://github.com/tsenoner/protspace/commit/9dc52307c6ee967c0bf8031196329d8d30c699c7))

* feat(prep): add TTL sweeper for orphaned job directories

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`d16473a`](https://github.com/tsenoner/protspace/commit/d16473a6c444956977b01aaa9c1531208012855d))

* feat(prep): wire FastAPI routes for submit, SSE events, bundle download

Adds api.py with POST /api/prepare, GET /api/prepare/{id}/events (SSE),
and GET /api/prepare/{id}/bundle. Updates app.py to accept an injectable
pipeline, fixes late-subscriber path in jobs.py to always synthesize a
queued event before replaying the terminal event, and hardens conftest.py
to set PREP_JOB_ROOT before module-level create_app() runs.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`9ed3a7d`](https://github.com/tsenoner/protspace/commit/9ed3a7d49dfcdd09d95263281ce0e650f64ef6a5))

* feat(prep): drive protspace prepare via subprocess with stage parsing

Adds pipeline.py with run_protspace_prepare(), which launches the
protspace CLI as an async subprocess, parses stderr for stage
transitions (embedding, projecting, annotating, bundling), enforces a
configurable timeout, and raises PipelineFailure on non-zero exit or
missing bundle output. Also provides cleanup_job_dir() for the TTL
sweeper.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`6a8894d`](https://github.com/tsenoner/protspace/commit/6a8894df4be4ea145012602adb4066a3406bca16))

* feat(prep): add in-memory job registry with bounded concurrency and SSE event queues

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`df7909c`](https://github.com/tsenoner/protspace/commit/df7909ca9fb9ee3e6bb422bb72a7e6fc05e1fedd))

* feat(prep): add SSE event framing helpers ([`41f8eb2`](https://github.com/tsenoner/protspace/commit/41f8eb221332d79f1e30fefb128572057d688ecf))

* feat(prep): add FASTA validation with limits and protein-only enforcement

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`950e45f`](https://github.com/tsenoner/protspace/commit/950e45fbe1d3284a383988742c86280a96576938))

* feat(prep): scaffold protspace-prep FastAPI service with healthz

Also fixes a pre-existing knip failure caused by playwright@1.57.0
crashing under jiti when the Playwright plugin loaded app/tests/
playwright.config.ts. Disable the plugin for the app workspace — specs
are already captured via the entry glob — and add a comment explaining
why. ([`887bdf2`](https://github.com/tsenoner/protspace/commit/887bdf2eefa0bc3a0b136db373ebdff8f6905057))

* feat: address review feedback for multi-annotation tooltip

- Swap (i) icon for open/closed-eye icons in annotation dropdown.
- Rename "Raw value" → "Value" and render it non-bold in the tooltip.
- Measure the actual tooltip height after render so multi-block tooltips
  no longer overflow the bottom of the plot viewport.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`2546e9f`](https://github.com/tsenoner/protspace/commit/2546e9f3887cf02d71d0d719b27d1772d56bfb3b))

* feat: increase annotation dropdown width

Signed-off-by: Elias Kahl <contact@elias.works> ([`71f69ce`](https://github.com/tsenoner/protspace/commit/71f69ced0d8d3b6f34b19eb2d0dc920dad4c0212))

* feat: multi-annotation hover tooltip (#234)

Lets users opt additional annotation features into the hover tooltip
alongside the primary annotation that drives the legend.

Dropdown UI:
- Primary indicator dot on the currently selected annotation row.
- (i) toggle on every other row that flips the annotation on/off in the
  hover tooltip. Hidden on the primary row (it is already shown).

Hover tooltip:
- Refactored TooltipView to carry an ordered blocks[] array. Each block
  carries its annotation key, display values, scores, evidence, and raw
  numeric value when applicable. The primary block renders first.

Persistence:
- New ?tooltip= URL param (comma-separated, deduped, primary stripped).
- Dataset-scoped localStorage seeded on dataset load when the URL does
  not pin a value, then kept in sync with subsequent toggles.
- Promoting an extra annotation to primary drops it from the extras.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`97dde4f`](https://github.com/tsenoner/protspace/commit/97dde4f41a643c8511c53f70da638a23735be29e))

* feat(tests): add new test configuration for isolation-dataset-swap (forgot to commit this change) ([`2b67214`](https://github.com/tsenoner/protspace/commit/2b672144daa6f9e5853e7ba6b237848abc0a86e5))

* feat(scatter-plot): close duplicate badge on first Escape before clearing selection

Mirror the selection ESC cascade: pressing Escape with a duplicate-badge
spider open now collapses the spider first, leaving the rest of the
selection state untouched. A subsequent Escape clears selections as
before, and a third toggles off selection mode.

Expose hasExpandedDuplicateStack() and closeExpandedDuplicateStack()
from the scatter-plot, extend the control-bar's ScatterplotElementLike
interface accordingly, and prepend the badge-close branch to the
existing handleDocumentKeydown cascade. ([`0961fd5`](https://github.com/tsenoner/protspace/commit/0961fd557d651cf6ead19d3f48419fc120564b58))

* feat(scatter-plot): add invalidateDepthOrder() so z-order changes don't lie about positions

WebGLRenderer's sort gate was tied to positionsDirty plus a sample-based
depth-changed check. The check compared this.depths[i] (sorted-order
value) against getDepth(points[i]) (input-order value), so it could not
reliably detect category-level z-order swaps. The scatter-plot used to
work around this by calling invalidatePositionCache() on z-order change,
which forced a re-sort by claiming the position buffer was stale.

Add a separate depthOrderDirty flag and a public invalidateDepthOrder()
method on WebGLRenderer. populateBuffers honors the flag and clears it
after re-sorting. scatter-plot's _handleZOrderChange and the !colorOnly
path of _handleColorMappingChange now call invalidateDepthOrder() —
positions remain valid, but the painter-sort is rebuilt. ([`6be0b82`](https://github.com/tsenoner/protspace/commit/6be0b8232789528f883614aeccbbb9a556d18a61))

* feat(scatter-plot): implement cross-projection duplicate grouping for consistent badge rendering

- Added a new private property to track duplicate groups across different projections.
- Implemented a method to compute and unify duplicate groups based on exact coordinates across projections.
- Updated relevant methods to utilize the new grouping for rendering and interaction, ensuring consistent badge display for duplicates. ([`0c6e079`](https://github.com/tsenoner/protspace/commit/0c6e07943e82c9ef9a4169a1a13a5e1eed860242))

* feat(css): add responsive font size using clamp for improved accessibility ([`819fbd0`](https://github.com/tsenoner/protspace/commit/819fbd006cd1e1a8fa693372b0ade7ed28a06959))

* feat(scatter-plot): invalidate position and style caches on z-order change to ensure correct rendering ([`104d2d7`](https://github.com/tsenoner/protspace/commit/104d2d73b721b9c40396d4af2c6f9fc77f07e7a1))

* feat(publish): click-to-select sidebar items + Delete/Backspace removal

Click an overlay or inset row in the right sidebar to select it (mirrors
canvas selection both ways via the controller). With a selection active,
Delete or Backspace removes it; Escape clears the selection. Skipped
while focus is in an editable element so typing Backspace inside the
label-text input still erases characters. ([`6367eb3`](https://github.com/tsenoner/protspace/commit/6367eb34541c4ff6781a51569e37ef1ac79af09f))

* feat(publish): geometric inset zoom + Dot size + smooth resize

Replace the raster crop+upscale path for zoom insets with a per-inset
WebGL re-render scoped to the source rect's data domain. Insets now
look like a real magnifying glass: native point sizes, no blurry blob
artifacts, controllable dot size, and fluid drag-resize.

- captureAtResolution gains dataDomain + pointSizeReference overrides;
  the renderer skips padding AND margins when dataDomain is provided so
  the inset's data fills the canvas edge-to-edge. New getRenderInfo()
  + getDataExtent() expose what the modal needs to translate sourceRect
  (canvas-norm) through xScale.invert into a margin-aware data viewport
  that aligns 1:1 with what's inside the source rect outline.

- Compositor accepts insetRenders[]; non-null entries draw whole into
  the target rect. Tests cover both the geometric and raster paths.

- Inset gains pointSizeScale (validator default 1; overlay-controller
  defaults newly-created insets to 2×). The right-panel "Dot size"
  slider (0.5×–20×) scales pointSizeReference linearly so 1× matches
  the main plot and N× produces dots N× bigger. Renders at the target
  rect's exact pixel dims so 1:1 mapping survives drawImage.

- Resize was buggy because the 120 ms debounce only fired *after*
  drag stopped (frozen content during drag, snap at end), and each
  WebGL pass spins up a fresh context + recompiles shaders (~20 ms).
  Replaced with rAF throttle + fast-path skip: when the last fresh
  render was <80 ms ago, reuse _lastInsetCanvases[i] and let the
  compositor stretch it via drawImage. A _settleTimer fires one
  final fresh render 120 ms after activity stops. Verified: 30
  rapid resizes → only 3 WebGL captures during drag + 1 after
  settle (vs. 30 before). ([`0bb6551`](https://github.com/tsenoner/protspace/commit/0bb6551112bf780fc10c7e57be52def831db57bc))

* feat(publish): break and disable aspect-lock when journal preset pins width

While a mm-based journal preset is active, width is fixed and only height
moves — so the chain link is meaningless. Render it as the unlocked glyph,
mark the button disabled (40% opacity, muted stroke, not-allowed cursor),
and ignore clicks. State.aspectLocked is preserved untouched, so switching
back to Flexible restores the chain to its previous linked state. ([`ad20676`](https://github.com/tsenoner/protspace/commit/ad20676a3e2e743e3aa14133805b8e2a69d48208))

* feat(publish): clamp height and lock width while journal preset active

Width slider/input are now disabled while a mm-based journal preset
(Nature, Science, Cell, PNAS, PLOS) is selected, and the height slider's
max is capped at the preset's maxHeightMm. Editing height clamps at the
cap and keeps the preset, instead of dropping into custom mode. ([`815e9e3`](https://github.com/tsenoner/protspace/commit/815e9e3f39e2e46992eedb61c0620eb901be31fe))

* feat(publish): preserve aspect ratio when applying journal presets

Picking a preset now applies its width and dpi but derives height from
the figure's current aspect ratio instead of using the preset's max
height. Journal presets define maxHeightMm as a page upper bound, not a
target shape; using it stretched typical figures into tall canvases. ([`27c29f0`](https://github.com/tsenoner/protspace/commit/27c29f04878394661b4a015f0a9e8f97bd2daf73))

* feat(publish): legend font size unit toggle (pt/px)

- Add fontSizeUnit ('pt' | 'px') to LegendLayout, default 'pt'.
- Replace the static unit chip with a dropdown next to the slider so
  users can flip the slider/input between pt and px on the fly.
- Slider range and step adjust per unit (pt: 1-50/0.5, px: 8-120/1).
- Keep fontSizePx as float when entered in pt mode so 8pt round-trips
  as 8pt (rounding to int px would clip 33.33 → 33 → 7.9pt).
- Tighten the slider rows: fixed 55px label cell, 8px gap, 110px slider,
  2.5rem number input — uniform tight gap and pixel-aligned start/end
  across Size %, Font size, and Columns.

Postpones the deeper pt-as-source-of-truth refactor (plan kept locally
in docs/superpowers/plans/2026-05-04-legend-font-pt.md, untracked). ([`2f42b2d`](https://github.com/tsenoner/protspace/commit/2f42b2d14507df77c66f52cafad3489e1ef4beec))

* feat(export): inject pHYs DPI into figure-editor PNG output ([`451ba03`](https://github.com/tsenoner/protspace/commit/451ba0390e809ce502eacf5c43a40e83928d9fb9))

* feat(publish): Photoshop-style Dimensions panel with Resample toggle

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`b651024`](https://github.com/tsenoner/protspace/commit/b651024d019921c50503da42b6ce8e38da1de0fe))

* feat(export): mm-accurate PDF page size from publish modal

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`d1353fd`](https://github.com/tsenoner/protspace/commit/d1353fd4736b1bcf00f026901880caf20e58a3a6))

* feat(utils): add pngWithDpi for PNG pHYs DPI metadata

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`53b3b8a`](https://github.com/tsenoner/protspace/commit/53b3b8af3e96e4d943f4b73210f130508b7eef3f))

* feat(publish): Resample-aware dimension helpers + aspect lock

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`54bd088`](https://github.com/tsenoner/protspace/commit/54bd0889c48c6e5874da7acc5835d8bfc0c92b3e))

* feat(publish): sanitise resample/aspectLocked/unit fields ([`702d257`](https://github.com/tsenoner/protspace/commit/702d25736bac86ae493c7f9b36264d6a7395676b))

* feat(publish): add resample, aspectLocked, unit fields to PublishState ([`d9151d4`](https://github.com/tsenoner/protspace/commit/d9151d40783c8853403f82fc7f3da7c5d9df82ce))

* feat(publish): add in/cm conversion helpers to dimension-utils ([`ad17d86`](https://github.com/tsenoner/protspace/commit/ad17d868b532ef6b586c2227a18e7dba7f200d29))

* feat(explore): align recovery banner with design system + add dismiss

- Add --warning / --warning-foreground HSL tokens (semantic severity,
  mirroring --destructive). Wire as `warning` in tailwind.config.ts.
- Recovery banner switches from raw amber-* palette to design tokens:
  bg-card text-card-foreground shadow-card panel matches the rest of
  the app's chrome. Severity is carried by the warning-tinted alert
  icon and title, not the surface.
- Action buttons unified on a single outline shape; intent conveyed
  by hue at /50 border opacity:
    Try again         — primary  (blue border + blue text)
    Load default      — neutral  (foreground border + foreground text)
    Clear stored data — destructive  (red border + red text)
  Hover wash uniform at /10 across all three (and the close X), so
  cursor movement across the banner is calm rather than rainbow-y.
  Drops the prior bg-accent green hover leak.
- New top-right close X (lucide alert-triangle + x SVGs inlined; banner
  is built in vanilla DOM from the non-React runtime path). Dismiss is
  session-only — banner reappears on next reload if the recovery
  condition is still true. Permanent escape hatch is Clear stored data.
- aria-live="polite" + role="alert" on root, aria-label="Dismiss" on
  the close button. Programmatic auto-focus removed; screen-reader
  users still hear the alert, keyboard users tab in (close → retry →
  default → clear). Removing the auto-focus also fixed Try again
  reading as visually heavier than its peers because of the focus ring. ([`4ae3842`](https://github.com/tsenoner/protspace/commit/4ae3842d7333680746c55be1d2a357b33bd4e31c))

* feat(utils): plot-data-accessors module for lazy point reads ([`9ac2c64`](https://github.com/tsenoner/protspace/commit/9ac2c64ac3604816ef4b5a7bce00ae201805c6a6))

* feat(startup): mount recovery banner on unresolved persisted load

Branches on PersistedLoadOutcome — when status is pending or error
from a prior tab crash, show the banner with Try again / Load default
/ Clear handlers instead of auto-retrying. Reverts the Task-4 knip
entry workaround now that the banner is reachable via the normal
import graph. Also un-exports RecoveryBannerHandlers and
ShowRecoveryBannerParams (internal types, no external consumers).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`fa9158f`](https://github.com/tsenoner/protspace/commit/fa9158ffb84942750b440dea38b5a19ed9cbd230))

* feat(explore): add recovery banner for unresolved persisted loads

Sticky banner with Try again / Load default / Clear actions. After
3 failed attempts the Try-again button is disabled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`31ca428`](https://github.com/tsenoner/protspace/commit/31ca428453ad128bbe2879c8571f47b6c56abcaf))

* feat(persisted-dataset): gate auto-load on lastLoadStatus

Returns PersistedLoadOutcome describing what happened. When status is
pending or error, returns recovery-required with the file metadata
instead of calling dataLoader.loadFromFile. Exposes tryLoadPersistedAgain
for the recovery banner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`5c07fb5`](https://github.com/tsenoner/protspace/commit/5c07fb5c3ccacde8e4a813341116d3f32ceffe11))

* feat(dataset): write OPFS lastLoadStatus on load success/error

handleDataLoaded marks success after view is applied (user/opfs loads
only). handleDataError marks error with the failure message.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`4c39f57`](https://github.com/tsenoner/protspace/commit/4c39f57e63b2a8aeeb2da5635dbc3443ff828902))

* feat(opfs): add lastLoadStatus + failedAttempts to dataset metadata

Bump schema to v2 with lastLoadStatus / lastError / failedAttempts.
Adds markLastLoadStatus + readLastLoadStatus APIs. v1 metadata is
silently migrated to status=success on first read.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`291b52b`](https://github.com/tsenoner/protspace/commit/291b52b28c3a69a72de3a1f9c0cbcaf018e5f529))

* feat(data): demo bundle with numeric length annotation

Replaces the demo data bundle with a regenerated ToxProt 2025 export that
exposes `length` as a real numeric column (435 unique values, 0 NA) instead
of the previous pre-binned `length_quantile` string column. Protein count
goes from 7418 to 7831; the curated manual sortModes for pfam / ec /
superfamily / protein_families / cath are preserved.

Updates `ANNOTATION_CATEGORIES.UniProt` accordingly: adds `length` and drops
the now-defunct `length_fixed` / `length_quantile`. Annotations not listed
fall through to the "Other" group, so removing the unused tokens has no
runtime effect beyond shrinking the categorized set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`948bbd3`](https://github.com/tsenoner/protspace/commit/948bbd3ae94f9cd36b79b528ca6e2c7be81b3067))

* feat(utils): introduce missing-values module

Add a single source of truth for NA concepts:
MISSING_VALUE_TOKENS (the spellings we treat as missing),
NA_VALUE (internal token), NA_DISPLAY (user label),
NA_DEFAULT_COLOR (#DDDDDD), and normalizeMissingValue (the
boundary normalizer). Pure-additive — no callers updated yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`51a03ef`](https://github.com/tsenoner/protspace/commit/51a03ef55611095b4d635f509508a2cb790a3f98))

* feat(numeric): use quantile + batlow as default numeric settings

Change default numeric binning from linear/cividis to quantile/batlow.
Quantile distributes data points more evenly across bins; batlow is a
publication-oriented perceptually uniform gradient. Update docs and
tests to reflect the new defaults.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`055ae09`](https://github.com/tsenoner/protspace/commit/055ae09a7a4a697c3005fff4fe8642c980d8b501))

* feat(numeric): treat NaN/NA as missing values in numeric annotations

Recognize common missing-value markers (NaN, NA, N/A, null, none, -, .,
Infinity) during type inference so they don't force numeric columns to
categorical. Missing values appear as "N/A" in the legend with a
neutral gray color, reserving one bin slot from the requested count.

- Add MISSING_VALUE_MARKERS set and isMissingValueMarker() in inference
- Append N/A pseudo-bin in materializeNumericAnnotation (binCount - 1)
- Centralize NA_COLOR in LEGEND_VALUES to eliminate duplication
- Sort N/A last in all legend sort modes, not just alpha

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`66db78c`](https://github.com/tsenoner/protspace/commit/66db78c97ee9b77961d8c2b5e7ed0f5c67026681))

* feat(legend): expose annotation type override ([`5e9be2d`](https://github.com/tsenoner/protspace/commit/5e9be2d68bbaad5b7b878ca378a9a6d7cc03625a))

* feat(annotation): apply type overrides to loaded data ([`9121a5a`](https://github.com/tsenoner/protspace/commit/9121a5a1c42bdc3224ed8e815794a55003ef573a))

* feat(legend): persist annotation type override ([`fce9ac0`](https://github.com/tsenoner/protspace/commit/fce9ac0a2c8406549ede09c03689928949b7e79b))

* feat(annotation): add numeric subtype fields ([`c692f5d`](https://github.com/tsenoner/protspace/commit/c692f5d831ae012de3f218132817a14688deb96e))

* feat(publish): sanitize saved publish state on load

sanitizePublishState drops unknown overlay types, clamps overlay
coords to [0,1], and rejects non-finite scalars rather than blindly
merging untrusted state into the modal. Protects against corrupted
localStorage and hand-edited parquet bundles.

Refs PR #232 review #4 ([`9934826`](https://github.com/tsenoner/protspace/commit/9934826c57979c03fb30e721c63dcc309e554816))

* feat(publish): crisp zoom insets via boosted capture, fix coordinate bug

Insets now render at full target-rect resolution by re-capturing the
scatterplot at up to 4x when insets exist. Also fixes a latent bug where
renderInset used plotRect offset for drawImage source coordinates,
causing wrong crops when legend is on the left or top.

Additional changes:
- Add inset resize/move handles for both source and target rects
- Remove magnification slider (zoom determined by size ratio)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d987233`](https://github.com/tsenoner/protspace/commit/d9872335e09d987fa97940f1528b5d53ef4a7303))

* feat(publish): label rotation from center, PowerPoint-style bounding box

- Text renders with textAlign=center so anchor is the midpoint
- Rotation pivots around text center, not left edge
- Bounding box centered and measured at scaled font size
- Rotate handle at center-top of box, drawn in local space
- Rotation uses same atan2 formula as circle (clockwise = positive)
- Removed double-click prompt editing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`83cccfe`](https://github.com/tsenoner/protspace/commit/83cccfe58ef2b042bb316f5a51e9032801d01d86))

* feat(publish): fix arrow rendering, add endpoint handles, remove headSize

- Shaft stops inside arrowhead (no gap, no poke-through)
- Arrowhead auto-sized from stroke width (headLen=4x, halfW=2x)
- Remove headSize from ArrowAnnotation and sidebar — stroke controls all
- Use butt lineCap for clean shaft-to-head transition
- Add start/end circle handles for arrow endpoint repositioning

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ea15084`](https://github.com/tsenoner/protspace/commit/ea15084e0cf990b3c47faf15fdb74d5eb38c9324))

* feat(publish): proportional annotation scaling, per-object editing, constant-size handles

- Add referenceWidth to PublishState for proportional pixel property scaling
- Scale strokeWidth, arrow width/headSize, fontSize, inset border
  proportionally when image dimensions change
- Compute displayScale (canvas px / display px) so handles, highlights,
  and drag indicators appear at constant screen size regardless of
  canvas resolution
- Per-annotation property controls in sidebar: circle stroke, arrow
  stroke/head, label text/fontSize, inset border — all with slider+input

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d673400`](https://github.com/tsenoner/protspace/commit/d673400b76618fadf857ce5e3740d0968f3c7ed2))

* feat(publish): circle rx/ry, rotation, resize/rotate handles, sidebar highlight

- Replace single radius with rx/ry for proper circles on non-square canvases
- Add rotation field to CircleAnnotation
- Resize handles (4 cardinal) and rotate handle on selected circles
- Selection persists after click — handles stay visible until clicking empty space
- Sidebar items highlight on hover with corresponding canvas outline
- Fix handle positions for rotated ellipses

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`36c1835`](https://github.com/tsenoner/protspace/commit/36c183589105aa0307d5a65335c737962720bb66))

* feat(export): add figure editor button, exportCanvasAsPdf, and legend overflow modes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`16654b8`](https://github.com/tsenoner/protspace/commit/16654b8dba7208b2800f6f61ed1208d8dc099eef))

* feat(publish): add parquetbundle persistence for publish editor state ([`d0511dc`](https://github.com/tsenoner/protspace/commit/d0511dcf9e1fe94e1c5d385f1cd1644afe606e6d))

* feat(publish): smart inset connectors and per-inset magnification slider ([`aec9e87`](https://github.com/tsenoner/protspace/commit/aec9e8790841fe930424718f88b05c734a5d3ecc))

* feat(publish): add free legend drag, underscore removal, and text wrapping

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`a8ca978`](https://github.com/tsenoner/protspace/commit/a8ca97887e04cfb22038d561fdc3fc672761a602))

* feat(publish): add slider+input controls for legend size, font, and columns ([`9ef7e31`](https://github.com/tsenoner/protspace/commit/9ef7e311a7d3b136df130248fee7646a75de3477))

* feat(publish): add size mode toggle with mm/DPI linkage and slider controls ([`498bbba`](https://github.com/tsenoner/protspace/commit/498bbbaa3465e2b613b51dd98d328cdcdd6eaeda))

* feat(publish): add hit-testing and drag-to-move for annotations and insets

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ed05638`](https://github.com/tsenoner/protspace/commit/ed05638859ac8927f28b9c3090760288fee03c04))

* feat(publish): add sizeMode, free legend position, inset magnification to state

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`9c9d242`](https://github.com/tsenoner/protspace/commit/9c9d242ec6a4ddb7b7adf4ffb874fccbe2400105))

* feat(publish): add dimension mm/px/DPI conversion utilities ([`5a33950`](https://github.com/tsenoner/protspace/commit/5a33950915e4b805f0c28805ae46685019dee257))

* feat(publish): default all annotation colors to black ([`7214c65`](https://github.com/tsenoner/protspace/commit/7214c6500cc1ec29741e6f1637c0c73ba2e1e26b))

* feat(core): initialize filter query with empty condition in control bar

Add functionality to seed the filter query with an empty condition when it is initially empty, ensuring users see a row immediately. Update background opacity in query builder styles for improved visibility. ([`f2c3537`](https://github.com/tsenoner/protspace/commit/f2c353792231c2efd7da475013e161699ae91f71))

* feat(core): render query builder as centered modal popup

Replace the dropdown popover with a centered modal overlay (70% width,
70vh height) with backdrop blur. Clicking outside closes the modal.
The modal provides much more space for complex queries. ([`358e432`](https://github.com/tsenoner/protspace/commit/358e4320bb1c59458ee0d4af7df5f9151ecb6633))

* feat(core): integrate query builder into control bar ([`1ebaccb`](https://github.com/tsenoner/protspace/commit/1ebaccb888524eaa9150ae48c7df9c20d4ef0afb))

* feat(core): add query-builder component ([`29d0fc5`](https://github.com/tsenoner/protspace/commit/29d0fc5039ecf1825c5514802cf66e8c83fc0055))

* feat(core): add query-condition-row component ([`efe5a7c`](https://github.com/tsenoner/protspace/commit/efe5a7c8244586a6b15596c719ee80fad829aee0))

* feat(core): add query-value-picker component ([`9a823fd`](https://github.com/tsenoner/protspace/commit/9a823fde0513eae5f253fbbaa3687a14c5795107))

* feat(core): add query builder styles ([`b367708`](https://github.com/tsenoner/protspace/commit/b3677081c6a209a24f01a55729d4fe537366201e))

* feat(core): add evaluateQuery with full test coverage ([`d5a4272`](https://github.com/tsenoner/protspace/commit/d5a42720b4e44d7d8e244eb4e8c27f40c2d6809b))

* feat(core): add query builder data model types ([`6bc4761`](https://github.com/tsenoner/protspace/commit/6bc476119e45c6c54ad467f6d950b54ad87b2ab3))

* feat(explore): persist url-backed view state ([`5423101`](https://github.com/tsenoner/protspace/commit/5423101c20b88f2463ea3f7814ff678fa98bf7ce))

* feat(tooltip): add subtle headers for bitscore and evidence ([`1d0378f`](https://github.com/tsenoner/protspace/commit/1d0378fa87cc4527dab93703eb90d88a86b624a5))

* feat(scatter-plot): allow scroll-wheel zoom during selection mode

Keep scroll-wheel zoom and double-click reset active while in selection
mode — only drag-to-pan is disabled (drag draws the selection instead).
The brush extent auto-updates on each scroll-zoom via _updateBrushExtent().
Lasso needs no change since _pointerToLocal() reads the live transform.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5fc4e89`](https://github.com/tsenoner/protspace/commit/5fc4e89fa3c49f631c9cf9b00b65d0d8777d86ea))

* feat(scatter-plot): add lasso selection mode (#208)

- Add selectionTool property ('rectangle' | 'lasso') to scatter-plot
- Implement lasso gesture handlers with pointer events and SVG path rendering
- Add queryByPolygon() to QuadtreeIndex with AABB pruning + ray-casting PIP
- Extract shared _commitSelection() to DRY up brush and lasso handlers
- Add inline toggle pair (rectangle/lasso) to control bar, visible in selection mode
- Add lasso CSS with non-scaling-stroke and design-system tokens
- Add 10 unit tests for pointInPolygon and queryByPolygon

Closes #208

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`394f07e`](https://github.com/tsenoner/protspace/commit/394f07e2beeb1b6150c7a6ddf0ee0dd66a1419e7))

* feat(app): add Cloudflare Web Analytics and privacy policy page

Add cookieless Cloudflare Web Analytics beacon to index.html,
create /privacy route with GDPR-compliant privacy policy page,
add privacy link to footer, and use dynamic copyright year.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`6ea6e5f`](https://github.com/tsenoner/protspace/commit/6ea6e5f65355d35fe64e214555c31f5b0512ca8e))

* feat(utils): change default numeric palette from viridis to cividis

Cividis is colorblind-friendly by design, making it a better default
for accessibility. Update tests and docs to match.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`6b1fa91`](https://github.com/tsenoner/protspace/commit/6b1fa91c143c16c6282d447bb54fda24ff0f28d3))

* feat(scatter-plot): add clear method to QuadtreeIndex and enhance data reference management ([`ca29018`](https://github.com/tsenoner/protspace/commit/ca290188faa41eee14a1f6420941ca2186a81f06))

* feat(export): add toggle to include or exclude legend in exported image ([`e1f002a`](https://github.com/tsenoner/protspace/commit/e1f002a6327f4d0b2fd8c30612316a4788513144))

* feat(core): integrate columnar data model into scatter-plot component

On projection switch, only Float32Array coordinates are swapped (~4MB)
instead of rebuilding all PlotDataPoint objects (~700MB for 500k proteins).
Style getters use columnar index-based lookups with a transparent wrapper
for backward compatibility. Falls back to legacy path in isolation mode.

Fixes #147 ([`cc077bf`](https://github.com/tsenoner/protspace/commit/cc077bfe9d17363d07af0b296d23f4748c74a3a2))

* feat(core): add columnar style getters for index-based annotation access ([`9bfdb43`](https://github.com/tsenoner/protspace/commit/9bfdb4359f44d17e0f0dc52d10ee78ae74ef9c69))

* feat(utils): add ColumnarDataProcessor for memory-efficient projection switching ([`9e8479b`](https://github.com/tsenoner/protspace/commit/9e8479b92db305ccbc6e752f41af37b16c934a6b))

* feat(utils): add columnar data types for memory-efficient storage ([`e930688`](https://github.com/tsenoner/protspace/commit/e930688bf0f6d099831500baa1b98bf1a7953a93))

* feat(app): persist imported datasets in OPFS ([`f53b6a5`](https://github.com/tsenoner/protspace/commit/f53b6a55a249a2d50d666407808274e22c54d572))

* feat(build): add knip for unused code and dependency detection

Add knip to detect unused files, dependencies, exports, and types.

- Add knip as dev dependency
- Create knip.json with workspace configuration
- Add knip and knip:fix scripts to package.json
- Add knip task to turbo.json
- Add knip check to CI workflow

Note: Existing unused code issues will be addressed in follow-up PRs.

Closes #129

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
Co-Authored-By: Elias Kahl <contact@elias.works>
Co-authored-by: Florin Senoner <florin.senoner@gmail.com> ([`7248cc8`](https://github.com/tsenoner/protspace/commit/7248cc8e7636e44417a81a9984af3a3fa0e37fff))

* feat(core): persist export options per annotation ([`dfffd5c`](https://github.com/tsenoner/protspace/commit/dfffd5c1021a56472c8867aa78203524e165e0d1))

* feat(product-tour): spotlight tips icon during welcome step

Highlight the ? button on step 1 so users know where to replay the
tour and find shortcuts. The glow is applied to the .trigger button
inside the shadow DOM to follow its rounded shape cleanly.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`5fa1628`](https://github.com/tsenoner/protspace/commit/5fa16287fec531fade14d5cf94b09f758e620461))

* feat(scatter-plot): redesign tips panel and fix tour wording

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`4a10147`](https://github.com/tsenoner/protspace/commit/4a10147d4d87d33d015bc67518a4a147a8257992))

* feat(product-tour): improve step descriptions and fix type error

- Add drag-and-drop mention to Import step
- Use "projections" instead of "dimensionality reductions"
- Add Cmd/Ctrl+K shortcut hint to Search step
- Rename "Select & Isolate" to "Selection Tools", add Clear and Esc
- Rename "Filter & Export" to "Filter, Export & Import", add parquetbundle export
- Add "(when available)" for 3D structure in scatterplot step
- Expand Legend step with color/shape, merge, sort reverse, and settings icons
- Add kbd styling for keyboard shortcut badges in tour CSS
- Fix onDeselected placement (DriveStep-level, not inside Popover)
- Fix Playwright test for driver-dummy-element on centred steps
- Add **/test-results to gitignore

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`6023f97`](https://github.com/tsenoner/protspace/commit/6023f97b583328ca1b69a7595d32ab9ef5b6d3bf))

* feat(scatter-plot): update tips & shortcuts

Signed-off-by: Elias Kahl <contact@elias.works> ([`46845d3`](https://github.com/tsenoner/protspace/commit/46845d32f0a6ea3e4b6c0da9ffd3749616c0b8a3))

* feat(product-tour): add an overview tour

Signed-off-by: Elias Kahl <contact@elias.works> ([`eccfbfa`](https://github.com/tsenoner/protspace/commit/eccfbfa1c212213c92ad1eb380a8b0cf56640cb8))

* feat(control-bar): hide tooltip-only annotations from dropdown

Filter gene_name, protein_name, and uniprot_kb_id from the annotation
dropdown as they are nearly unique per protein and only useful for
hover tooltip display.

Closes #162

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`163acd6`](https://github.com/tsenoner/protspace/commit/163acd6d13cc81391c8d381b23a6bc1d8506b321))

* feat(data): replace default dataset with ToxProt 2025

Closes #138

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`633e3d2`](https://github.com/tsenoner/protspace/commit/633e3d21706309b6d6322eb6cec9bb8f7bc96db3))

* feat(data): parse and display ECO evidence codes in annotations

Parse evidence codes (EXP, IDA, etc.) from pipe-separated annotation
values, propagate through data model, and display in protein tooltip.

Closes #156

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`88bb183`](https://github.com/tsenoner/protspace/commit/88bb18308b2c8751f2be8715fd949814fda67b5e))

* feat(structure-viewer): add InterPro link in header

Rework header to show protein ID as plain text with separate
UniProt and InterPro links. Extract URL builders into testable
header-links module with 14 tests.

Closes #157

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`2bbff9a`](https://github.com/tsenoner/protspace/commit/2bbff9aa9dce68a5fd0e7af1f31de9e72e61792e))

* feat(data): validation, annotation categories, multi-score support

- Validation: split semicolon-separated values before length check,
  reduce per-value max to 256 chars, improved error messages
- Annotation categories: add missing UniProt (ec, go_bp, go_cc, go_mf,
  keyword, length_fixed, length_quantile) and InterPro (cdd, panther,
  prints, prosite, smart) entries
- Multi-score: change score types from number|null to number[]|null,
  generic pipe-based score detection replacing hardcoded pfam/cath list,
  comma-separated multi-score parsing
- Tooltip: auto-show scores when present, readable formatting with
  Unicode superscripts, label truncation with ellipsis, score overflow
- Default annotation: protein_families instead of family

Closes #138, refs #24, refs #156

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`27734b8`](https://github.com/tsenoner/protspace/commit/27734b8ff61d770478a0d1e85c1f328ba9b726fc))

* feat(legend): <NA> gets marker shape updated in settings assignment
Fixes #153 ([`826cc4c`](https://github.com/tsenoner/protspace/commit/826cc4c6a021100742e622a245647b60d40d8ed7))

* feat(styles): structure-viewr, consistent style with legend and scatterplot ([`bd20d63`](https://github.com/tsenoner/protspace/commit/bd20d6353b6221a61f254128239cffadad623fcb))

* feat(styles): having matched shadow style around the legend, consistent with scatterplot component. ([`3b0bebc`](https://github.com/tsenoner/protspace/commit/3b0bebc7ca7455f8ac504dabcdae7fc02768f7fa))

* feat(legend): implement dataset clearing and state reset for new data loading ([`33e5199`](https://github.com/tsenoner/protspace/commit/33e5199c39601637f2cdeaeb38adc5012cad9cd2))

* feat(legend): enhance drag-and-drop functionality with improved item handling and prevent dragging of "Other" item ([`02de436`](https://github.com/tsenoner/protspace/commit/02de436bb78f74907c3399c16a901bd6388eca0d))

* feat(legend): enhance shape handling in legend items with persisted categories ([`e89d2cb`](https://github.com/tsenoner/protspace/commit/e89d2cbf8ded3f14a2c173b15f58cd313551dccc))

* feat(legend): add mouse event handlers for overlay interactions in settings and other dialogs ([`33ee976`](https://github.com/tsenoner/protspace/commit/33ee976830ae99918d6c1110febd7bc603ad1a70))

* feat(legend): implement global click handler to close color picker when clicking outside ([`eea75e6`](https://github.com/tsenoner/protspace/commit/eea75e6cb3916d59256fe9652e2119a8d29d14cd))

* feat(legend): add shape selection feature to legend items with customizable shape picker ([`8d9813c`](https://github.com/tsenoner/protspace/commit/8d9813c6f312fa305800513685f4567ac1277636))

* feat(legend): add color palette selection to legend setting ([`ee2c7c5`](https://github.com/tsenoner/protspace/commit/ee2c7c50d5b0ca64ec8372fa9c0ac6d1fac5ae4d))

* feat(legend): refactor color management by removing the color dialog and implementing a color picker for legend items ([`deb6b18`](https://github.com/tsenoner/protspace/commit/deb6b181e74b0f779dfd62fa949e8e4557ccfa08))

* feat(legend): implement color palette selection and management in color dialog ([`684835a`](https://github.com/tsenoner/protspace/commit/684835a8b14e5f09f27a0d4b8cf0042407ba16db))

* feat(legend): add color management feature with customizable legend item colors and color dialog ([`8a119f4`](https://github.com/tsenoner/protspace/commit/8a119f41ca1d5019b940512e08316f5a5bebd891))

* feat(scatter-plot): enhance protein tooltip with UniProtKB ID display and improved styling ([`71ec5cb`](https://github.com/tsenoner/protspace/commit/71ec5cb07e12552591804aeaa423ed466cdc3a51))

* feat(scatter-plot): implement protein tooltip component with enhanced styling and functionality ([`89e64b2`](https://github.com/tsenoner/protspace/commit/89e64b2b47a1a1a650a3f6539d39de04428fd78f))

* feat(scatter-plot): add ProtSpace tips component for user guidance ([`be241c6`](https://github.com/tsenoner/protspace/commit/be241c65ac2bd6480a7d79a587cc7d295f6f05f7))

* feat(scatter-plot): add protein name tooltip to scatter plot ([`45154ce`](https://github.com/tsenoner/protspace/commit/45154ceea0739889079b61cf5df013aa9fdef34d))

* feat(data-loader): add confidence score for pfam and cath when hovering ([`b182616`](https://github.com/tsenoner/protspace/commit/b182616399c5d5834e8c7b5ecc2e339e141741a6))

* feat(scatter-plot): add gene name tooltip to scatter plot and remove annotation name ([`cc9fd26`](https://github.com/tsenoner/protspace/commit/cc9fd260fd041264e8c5037f4433bc9de5b1babb))

* feat(header): add variant prop for customizable header styles

- Introduced a `variant` prop to the Header component to support different visual styles (default and light).
- Updated styles for text and dropdowns based on the selected variant.
- Adjusted the Explore page to utilize the new light variant for the header. ([`239966f`](https://github.com/tsenoner/protspace/commit/239966f5f402b526a8b584720fe28e436437c66d))

* feat(legend): add legend settings persistence in parquetbundle format ([`d600d27`](https://github.com/tsenoner/protspace/commit/d600d27a3be9e9ed23d6d7e75ee67bf5b496ad18))

* feat(export): add native high-resolution WebGL rendering for canvas export

- Add renderToCanvas() method to WebGLRenderer for off-screen rendering
- Add captureAtResolution() public API to ScatterplotComponent
- Create export-specific scales and transform for proper dimension scaling
- Scale point sizes proportionally to export dimensions
- Update export-utils to use native capture with html2canvas fallback
- Change default legend font from 48px to 24px, min from 12px to 8px
- Fix number input validation to only clamp on blur/change, not on input
- Allow intermediate values for legend width and font size sliders (step=1) ([`792434b`](https://github.com/tsenoner/protspace/commit/792434bd2c75456566c4bedf2cda64ccb686d132))

* feat(export): enhance export menu with granular pixel-based controls

- Replace scale multipliers with pixel values and add independent controls for dimensions, legend width, and font size
- Add aspect ratio lock toggle and reset button
- Fix scatterplot rendering to prevent dot distortion on aspect ratio changes
- Consolidate export defaults into single source of truth ([`7e04159`](https://github.com/tsenoner/protspace/commit/7e04159633db43d0696af4ce4e75c48c5beea93d))

* feat(export-utils): optimize PDF export layout and increase legend readability

- Use custom PDF page size to eliminate wasted space at bottom
- Reduce PDF margins from 20mm to 2mm for maximum content area
- Increase legend font sizes (20→28px header, 18→24px items)
- Increase legend marker size (18→28px) for better visibility
- Optimize width distribution between scatterplot and legend
- Refactor export code to eliminate duplication and improve maintainability ([`22f9f28`](https://github.com/tsenoner/protspace/commit/22f9f289510d13ae6272a7237bf1d9f7f947addd))

* feat(export-utils): enhance export functionality with legend scaling and border management

- Added `legendScaleFactor` option to improve readability of legend elements in exports.
- Implemented methods to remove and restore scatterplot borders during export to ensure a cleaner output.
- Updated export methods to accommodate new legend width ratios and improved typography for better visual clarity. ([`ce53d99`](https://github.com/tsenoner/protspace/commit/ce53d996f5d1585fe1a7c83e28a1ffacf874daca))

* feat(scatter-plot): improve depth value computation and add tests for z-order consistency ([`2a3f5dd`](https://github.com/tsenoner/protspace/commit/2a3f5dd0749e1ee3e09f5be810a637dfaad3af02))

* feat(scatter-plot): add tests for N/A value handling in style getters and update normalization logic ([`65fd2d8`](https://github.com/tsenoner/protspace/commit/65fd2d8319f4cb0a7379e569c628d57bc9d1f73a))

* feat(legend): enhance item prioritization and visibility handling in legend data processing tests ([`eb6bf72`](https://github.com/tsenoner/protspace/commit/eb6bf72af5ad21044adcc38f56ced5bd45f61b22))

* feat(legend): add comprehensive tests for N/A value handling and scatterplot interface functionality ([`6878ce0`](https://github.com/tsenoner/protspace/commit/6878ce0ae049ac53c575ce2ff171663736526ecd))

* feat(legend): enhance handling of N/A values ([`388d02a`](https://github.com/tsenoner/protspace/commit/388d02a3cd361ac551b992e9668e106061ecfd4b))

* feat(legend): implement manual-reverse sorting for legend items and update z-order logic ([`55a0472`](https://github.com/tsenoner/protspace/commit/55a04729b16dcf571e652acb5dcc6767cb3176a1))

* feat(legend): implement hasPersistedSettings method and update dialog footer logic ([`073f6a7`](https://github.com/tsenoner/protspace/commit/073f6a77d8151d8990b66b958795eeab2c3b9b32))

* feat(legend): update legend configuration and add tests ([`c129be6`](https://github.com/tsenoner/protspace/commit/c129be647e870ee9212f6b9f059fd0be92d95b8f))

* feat(legend): add enableDuplicateStackUI configuration option ([`60d371d`](https://github.com/tsenoner/protspace/commit/60d371d4aaf091f93a94719afce01b6957f1ba1f))

* feat(legend): enhance scatterplot configuration with enableDuplicateStackUI setting ([`981bbf4`](https://github.com/tsenoner/protspace/commit/981bbf4e10a57445611520f5f7fb6af7f3642bf8))

* feat(selection): remove selection on escape ([`4a4d2d7`](https://github.com/tsenoner/protspace/commit/4a4d2d734764293e1842c328fd48869731ea90fb))

* feat(search): add cmd/ctrl + k keyboard shortcuts for focusing search ([`7362d51`](https://github.com/tsenoner/protspace/commit/7362d51bbae99f48ef86e97eeea62a95aa5907f8))

* feat(legend): implement dataset hash and localStorage persistence for settings ([`97b520c`](https://github.com/tsenoner/protspace/commit/97b520c4eae2fb08e3d353050538a58623f79174))

* feat(control-bar): integrate feature select component and enhance styling

- Replaced the traditional select dropdown with a custom `protspace-feature-select` component for improved feature selection.
- Updated event handling to accommodate the new component structure.
- Enhanced styles for the feature select component to ensure proper display and responsiveness.
- Updated documentation to reflect new features and usability improvements in the Color By dropdown. ([`acea1a9`](https://github.com/tsenoner/protspace/commit/acea1a9be60f09b3f791995d50fe6a6f66fecab6))

* feat(legend): display category count for "Other" group

Show the number of categories in "Other" label as "Other (N categories)"
to help users understand the composition of the grouped items.

Fixes #107 ([`5fc9a01`](https://github.com/tsenoner/protspace/commit/5fc9a015f3467109da0850066b338a0114f7c6d0))

* feat(colors): enhance color generation with Kelly's palette and HSL conversion

- Introduced a new function to generate colors optimized for maximum contrast using Kelly's 22 colors.
- Added utility functions for RGB to HSL and HSL to hex conversions to support color generation.
- Updated shape generation to prioritize distinct shapes for better category visibility.
- Documented new functions and color schemes for clarity and maintainability. ([`6d9bf36`](https://github.com/tsenoner/protspace/commit/6d9bf3619d1a7ec14825f960554d8cc37dfc35af))

* feat(assets): replace placeholder logo and favicon with actual SVGs

- Replace Header placeholder with logo.svg image
- Add favicon.svg to index.html
- Create symlinks from docs/public/ to app/public/ for shared assets
- Remove unused placeholder.svg

Makes app/public/ the single source of truth for branding assets. ([`0dc3d65`](https://github.com/tsenoner/protspace/commit/0dc3d6516f6b374a4892575474a2eb8265cf4cdc))

* feat(docs): add npm scripts for image generation ([`5361381`](https://github.com/tsenoner/protspace/commit/5361381aabb8d3f919e3be4336c0fb129128966f))

* feat(docs): add screenshot generation scripts ([`116595a`](https://github.com/tsenoner/protspace/commit/116595abde5e0b27dfcce5cb6753eb42f3f6aafa))

* feat(docs): add Playwright configuration for screenshot automation ([`a2616e3`](https://github.com/tsenoner/protspace/commit/a2616e3fc957f76d0bb7cf1c73ef2b12503abcb7))

* feat(hero): update subtitle with new messaging ([`f269650`](https://github.com/tsenoner/protspace/commit/f269650dc1f3fdc330d7b9b791f9a3c24374eeb1))

* feat(explore): add header component to explore page ([`c9f1178`](https://github.com/tsenoner/protspace/commit/c9f1178f2e9087b38769db13d1fada270f2f90a2))

* feat(docs): add comprehensive documentation with VitePress

Added complete documentation site using VitePress including:

- API reference for all components (scatterplot, legend, control-bar, structure-viewer, data-loading)

- User guide and getting started documentation

- Developer guide with architecture and contribution guidelines

- Integration guides for HTML, React, and Vue

- Data format and preparation documentation

- FAQ and examples

Updated README.md with links to documentation and improved project overview.

Added VitePress cache and dist directories to .gitignore. ([`6f5ee12`](https://github.com/tsenoner/protspace/commit/6f5ee12234cecdb14f11408c89ed7ca135045d20))

* feat(search): add input focus handling to improve suggestion display ([`23a64fa`](https://github.com/tsenoner/protspace/commit/23a64fa96a159ef150d6dd5bcc5f9274fb05b25d))

* feat(legend): add keyboard navigation for settings dialog

- Implemented global keyboard listeners for Enter and Escape keys to manage settings dialog actions.
- Refactored settings save and close logic into dedicated methods for improved readability and maintainability.
- Ensured cleanup of keyboard listeners when the dialog is closed or the component is disconnected. ([`7e28150`](https://github.com/tsenoner/protspace/commit/7e28150cceb969d9c08979f1f475a5c9c54d7fba))

* feat(legend): enhance legend header with customizable actions

- Updated the legend header to include a reverse z-order button alongside the existing customize button.
- Refactored the renderHeader method to accept an actions object for better flexibility.
- Added styles for the new action buttons to ensure proper alignment and spacing. ([`1c4cada`](https://github.com/tsenoner/protspace/commit/1c4cada1e3f428db930559708c2e6e6fe2925ae2))

* feat(scatter-plot): improve spiderfy interaction handling for duplicate nodes

- Added explicit pointer event management for spiderfy nodes to enhance click reliability.
- Implemented pointerdown and pointerup events to treat short presses as clicks, addressing issues with d3.zoom gesture handling.
- Updated styles for spiderfy elements to ensure proper pointer interactions and visual feedback. ([`0f94e5e`](https://github.com/tsenoner/protspace/commit/0f94e5eb902ef0d34801f62f963bbde2ae57f901))

* feat(scatter-plot): synchronize WebGL selection state with UI interactions for the data selection opacity ([`de9b083`](https://github.com/tsenoner/protspace/commit/de9b083694995eefd21d2e07ec5fe203d7ef4873))

* feat(scatter-plot): enhance edge darkening effect for various shapes

- Implemented a new outline effect for non-circle shapes by darkening near their edges, improving visual consistency across different shapes.
- Added edge distance calculations for squares, diamonds, triangles, and plus shapes to create a more uniform appearance in the scatter plot.
- Updated shader logic to ensure the outline effect is applied efficiently without impacting performance. ([`c12070a`](https://github.com/tsenoner/protspace/commit/c12070ae50c3fade9cdabbc601afde874d8f8dce))

* feat(scatter-plot): add duplicate stack UI for overlapping points

- Introduced a new feature to enable a duplicate stack UI that displays numeric count badges and allows for spiderfy expansion on click for points sharing the same coordinates.
- Updated scatterplot configuration to include an option for enabling this feature.
- Enhanced rendering logic to manage duplicate stacks efficiently, improving performance and visual clarity in dense datasets.
- Implemented a canvas overlay for faster badge rendering and optimized interaction handling for duplicate points. ([`8b9ab9a`](https://github.com/tsenoner/protspace/commit/8b9ab9aae5a8cd453a640fafa9c4d033482f35f2))

* feat(scatter-plot): enhance hover functionality and state management ([`cb1510c`](https://github.com/tsenoner/protspace/commit/cb1510c1bb04447412e534c27e6c19fa5898725c))

* feat(scatter-plot): enhance rendering with depth sorting and shape handling

- Implemented depth sorting based on opacity and z-order mapping to improve visual clarity in the scatter plot.
- Updated shape rendering logic to include new shapes and adjusted diamond size for consistency.
- Refactored WebGL renderer to accommodate depth and shape attributes, optimizing performance for large datasets. ([`6f876d2`](https://github.com/tsenoner/protspace/commit/6f876d28c6f7578965e68534cde884c1ac727d49))

* feat(scatter-plot): implement z-order sorting for visible points in virtualization ([`b59ae5f`](https://github.com/tsenoner/protspace/commit/b59ae5f07d14092de30fd1b14353a117f1f8ecad))

* feat(legend): implement sorting modes for legend items ([`87613c8`](https://github.com/tsenoner/protspace/commit/87613c8831e28408bd9672332eba51a125071b37))

* feat(data-loader): add projections metadata info in scatterplot

- Implement metadata display in the scatter plot component, including formatting and parsing of JSON fields for better user experience. ([`01c7f10`](https://github.com/tsenoner/protspace/commit/01c7f1041c9d8437cd7d5cf252e222168053881a))

* feat(scatter-plot): enhance WebGL renderer with label color handling and pie chart logic ([`55421a4`](https://github.com/tsenoner/protspace/commit/55421a40e150586c1f8dcd7d2bef03c9dbdbc2ca))

* feat(scatter-plot): add z-order mapping for improved data rendering ([`298f261`](https://github.com/tsenoner/protspace/commit/298f26165d35391abe375877e75b21f92bc04b23))

* feat(demo): implement enhanced loading overlay for data visualization ([`dd29114`](https://github.com/tsenoner/protspace/commit/dd29114f0f708fdb0b7b3dd8c7fb2a6f0fe98fa6))

* feat(legend): removed green border for extracted legend items. ([`eb1bbed`](https://github.com/tsenoner/protspace/commit/eb1bbed2697ceaba95d029365a28e83692581b65))

* feat(features): update feature titles and descriptions for clarity and relevance ([`3c53f1e`](https://github.com/tsenoner/protspace/commit/3c53f1e4c5d09bed5e217f3e71b5fb1a3aab65e3))

* feat(hero): update hero title ([`b9b9e62`](https://github.com/tsenoner/protspace/commit/b9b9e62bde38ab03d9eb6a4eb276099092072a33))

* feat(features): remove webGPU and add 3D visualization feature and icon ([`179123d`](https://github.com/tsenoner/protspace/commit/179123dbaf6d2d0326b99fb4c65fa6ffbc252841))

* feat(hero): remove Github and add Data Creation button. ([`48480c9`](https://github.com/tsenoner/protspace/commit/48480c9db9d11295a3e6a6c03066026a2bbcd6c6))

* feat(app): create landing page ([`63c2b82`](https://github.com/tsenoner/protspace/commit/63c2b822d8f7fd8c3af545b5dcf0d435d6c1c594))

* feat: improve selection visibility: increase selected opacity to 1.0, reduce faded to 0.15 ([`db35b28`](https://github.com/tsenoner/protspace/commit/db35b28078ca50e194ac8e92e4bec0bf2edd7fb6))

* feat(scatter-plot): implement caching for scales computation to optimize performance ([`6a5ec14`](https://github.com/tsenoner/protspace/commit/6a5ec143cce5632bef26bbbde58d5b11032e9c31))

* feat: multilabel points

- Show multilabel data points as small "pie charts"
- Adjust data structures to accomodate multilabel data points
- Adjust legend handling for multilabel feature values ([`685c600`](https://github.com/tsenoner/protspace/commit/685c60018aab57e9ba14571a5815b90a0deb595b))

* feat(control-bar): unify protein selection handling between control bar and scatterplot ([`75cae82`](https://github.com/tsenoner/protspace/commit/75cae823825e7c15e841c9b33f52bf2987a2386b))

* feat(control-bar): trigger structure viewer for last selected protein in search ([`aec801e`](https://github.com/tsenoner/protspace/commit/aec801ee874ad334901b3438f0d07d19a5bd5044))

* feat(control-bar): emulate direct click on scatterplot for single protein selection ([`2add9b6`](https://github.com/tsenoner/protspace/commit/2add9b6383cd17ad40f20ae2337d0629f3e18c1b))

* feat(control-bar): add support for pasting multiple protein IDs in search component ([`be256ba`](https://github.com/tsenoner/protspace/commit/be256ba51d7c60c0bf4941f69899f654b85f3b43))

* feat(control-bar): sync search field with scatterplot ([`1a38c3d`](https://github.com/tsenoner/protspace/commit/1a38c3d49beaf651f8b54a407dcc4f5fd4b5a641))

* feat(control-bar): enhance search component with horizontal scroll support ([`9ff2cb9`](https://github.com/tsenoner/protspace/commit/9ff2cb9fe4afd3523d88da619cc6664eb25e88df))

* feat: improve control bar and search component styles for better responsiveness

- Updated control bar styles to allow the search group to expand and take remaining space. ([`2b785b9`](https://github.com/tsenoner/protspace/commit/2b785b9384572ea0de14754af6d9c9c656daa891))

* feat: add protein search component with multi-select option and autocomplete suggestions ([`17e8287`](https://github.com/tsenoner/protspace/commit/17e828722c35129a1eb19ae0ca6192d41af18658))

* feat(notebook): add xref_pdb feature selection

- Add 'xref_pdb' to UniProt feature selection options
- Enable PDB cross-reference data inclusion in dataset ([`82529ef`](https://github.com/tsenoner/protspace/commit/82529ef99560f03a16fa7ebb97c43b5ac2905fee))

* feat: add external link buttons to StructureViewer for UniProt and AlphaFold ([`8d14e3e`](https://github.com/tsenoner/protspace/commit/8d14e3e22f4e4d45033ad6c0adb7a7bee3cf5521))

* feat: enhance StructureService with 3D Beacons API integration ([`0ad7dca`](https://github.com/tsenoner/protspace/commit/0ad7dca1b27fadad4d57b2260926a8cdf0292256))

* feat(data): add example parquet bundles for notebook demo

- Add 5K and 40K parquet bundle files as example datasets
- Remove outdated shape-standardization documentation ([`9eb0918`](https://github.com/tsenoner/protspace/commit/9eb0918e2e3002d9615bc28626069ee9d773629c))

* feat(notebooks): add notebook for interactive data preparation and testing ProtSpace2 ([`a467386`](https://github.com/tsenoner/protspace/commit/a467386983c502ee415b6b2aaab83a4f948ec205))

* feat(scatter-plot, control-bar): implement data splitting functionality and enhance interaction

- Added brush selection event handling to synchronize selected proteins.
- Introduced split data functionality in the scatter plot to filter and display only selected proteins.
- Implemented reset split functionality to revert to the original dataset.
- Enhanced control bar with buttons for splitting and resetting data, along with state management for split mode.
- Updated legend to reflect split state and history.
- Improved selection handling to disable when insufficient data points are available. ([`9ca3349`](https://github.com/tsenoner/protspace/commit/9ca3349362eba9c93c87c863a5d0af69e4ae0069))

* feat: update demo to use real data instead of sample data

- Replace hardcoded sample data with automatic loading from data.parquetbundle
- Update HTML description to reflect auto-loading behavior
- Add robust error handling for data loading with fallback to drag-and-drop ([`900ed09`](https://github.com/tsenoner/protspace/commit/900ed09544e19919879f90002cea09c9c7e5064e))

* feat(message): add sanitizeForMessage utility for consistent message formatting ([`dacf302`](https://github.com/tsenoner/protspace/commit/dacf302e359a47bb8910ff4071f355a0a5df072b))

* feat(scatter-plot): add selection overlay and optimize rerendering for selection changes ([`f6efa0d`](https://github.com/tsenoner/protspace/commit/f6efa0d6d52d0a2d4824f53e07078ea5893d5ac7))

* feat(scatter-plot): optimize quadtree rebuilding with requestAnimationFrame scheduling ([`cf0baf0`](https://github.com/tsenoner/protspace/commit/cf0baf0805fd34af4ea8c3f5413fb922077d8ca5))

* feat(validation): enhance row validation to check for numeric-like column names and empty names ([`388fe61`](https://github.com/tsenoner/protspace/commit/388fe61191f7d216e1fedb1a3c07909455f428f9))

* feat(data-loader): improve progress tracking and step management during data loading ([`c40730f`](https://github.com/tsenoner/protspace/commit/c40730f4fa19efcef3855213b06ade244e2df5e4))

* feat(validation): add sanitization utility for error messages in data validation ([`94b4abd`](https://github.com/tsenoner/protspace/commit/94b4abd50877d9e0e9169e9259b19765a8ca45a9))

* feat(data-loader): add validation for parquet files and enhance data integrity checks

- Implement early file size validation and parquet magic checks in the data loader.
- Introduce basic dataset sanity validation after parsing parquet and parquet bundle files.
- Create a new validation utility to enforce limits on file size, row count, and data structure integrity. ([`94c100f`](https://github.com/tsenoner/protspace/commit/94c100f2bbe0eb071f99474262c41bab7e3d6dd8))

* feat(control-bar, data-loader): enhance responsiveness and layout adjustments for small screens ([`dffd7f1`](https://github.com/tsenoner/protspace/commit/dffd7f16758aa901f97f1a6c369850a51e62e355))

* feat(scatter-plot): implement caching for style getters to optimize rendering performance ([`27e4e99`](https://github.com/tsenoner/protspace/commit/27e4e9901348b78e22cf302e9933bfc9fdc97bed))

* feat(legend): enhance drag-and-drop animation ([`848c995`](https://github.com/tsenoner/protspace/commit/848c99595f9e025950c55fff9c88ef39407b7fb7))

* feat(legend, scatter-plot): enhance z-order management for improved rendering ([`ffeae6c`](https://github.com/tsenoner/protspace/commit/ffeae6c8881e55c0304f89f7f4bf4242721c856e))

* feat(scatter-plot): enhance canvas rendering with caching and style management

- Introduced caching for screen-space positions and style groups to optimize rendering performance.
- Added methods to invalidate caches for position and style, ensuring updates reflect changes in data and configuration.
- Improved handling of zoom interactions by utilizing requestAnimationFrame for smoother rendering during zoom events. ([`55687d1`](https://github.com/tsenoner/protspace/commit/55687d125e1643980e2db38d32a979082969bab0))

* feat(scatter-plot): adjust stroke opacity for improved visual clarity ([`9a59949`](https://github.com/tsenoner/protspace/commit/9a59949919da26f97c2ed4613a08d7cb3183f9e2))

* feat(scatter-plot): add zoom size scale exponent for responsive point sizing ([`d9918ba`](https://github.com/tsenoner/protspace/commit/d9918ba90947f80ad35368d42616e53d749e79ff))

* feat(legend): implement sorting features by first number in label ([`4a2bea0`](https://github.com/tsenoner/protspace/commit/4a2bea0e4792738aff622211e1db7349f3976961))

* feat(legend): adding support for drag and dropping any feature in the Other category ([`557eb2f`](https://github.com/tsenoner/protspace/commit/557eb2f8cbfb28038179fe39b61ae395dfaad1f9))

* feat(projection): implement projection plane selection and handling for 3D data

- Added projection plane state management to the ProtSpaceApp and related hooks.
- Introduced a dropdown in the ControlBar for selecting projection planes (XY, XZ, YZ) when the projection dimension is 3.
- Updated Scatterplot and computePlotData functions to accommodate the selected projection plane for accurate data rendering. ([`71f142c`](https://github.com/tsenoner/protspace/commit/71f142c6b1028d1dd75a2c1d9b0ae21d538fcdca))

* feat(export): enhance export functionality with custom coloring support

- Updated the export handler to accommodate custom coloring options, allowing for filtered protein exports based on user-defined criteria.
- Improved logic for determining which protein IDs to export, factoring in hidden features and custom filters. ([`cab4cc3`](https://github.com/tsenoner/protspace/commit/cab4cc3f5decdf3959cf61fd946bc4c99b96cad7))

* feat(filter-dialog): add instructional text for feature value selection ([`665d4a3`](https://github.com/tsenoner/protspace/commit/665d4a3bca16aea9804b656d410475604949ce93))

* feat(hooks): enhance protein visibility logic in useProtspace and update status metrics display

- Improved the useProtspace hook to accurately count visible proteins based on selected features and hidden values.
- Updated the status metrics to reflect a more approximate percentage of displayed proteins, enhancing clarity in the UI. ([`c9f73b3`](https://github.com/tsenoner/protspace/commit/c9f73b3bd92ec39ca663c4753bb07818ef9f8327))

* feat(scatterplot): optimize rendering by filtering visible points ([`028e6ce`](https://github.com/tsenoner/protspace/commit/028e6cee1a87557885ff71b1cc3977535850233f))

* feat(scatterplot): enhance filtering logic and support for custom coloring

- Updated useProtspace hook to auto-reset hidden feature values when both "Filtered Proteins" and "Other Proteins" are hidden.
- Added customColoring prop to Scatterplot component for improved visual representation of filtered data.
- Enhanced getOpacityFactory function to handle custom coloring scenarios, ensuring correct opacity based on selected features and hidden values. ([`b0e17c7`](https://github.com/tsenoner/protspace/commit/b0e17c7fac2d93ea9cc3ead14c417b1e98954033))

* feat(control-bar): enhance filter functionality with multi-value selection ([`ee7ebb4`](https://github.com/tsenoner/protspace/commit/ee7ebb4d0066cf03eb39976e86748515c5fa498c))

* feat(filter): add filter dialog and custom coloring functionality to ProtSpaceApp

- Introduced a FilterDialog component for configuring feature filters, allowing users to select which feature values to include.
- Enhanced ProtSpaceApp to manage filter state and integrate custom coloring based on selected filters.
- Updated Scatterplot to support custom coloring, distinguishing between filtered and other proteins visually.
- Modified ControlBar to include a button for opening the filter dialog, improving user interaction. ([`c39fe30`](https://github.com/tsenoner/protspace/commit/c39fe30dce0166ea141baa521a8c4e66760a3346))

* feat(scatterplot): add point size customization to scatterplot and legend

- Introduced point size state management in the ProtSpaceApp to allow dynamic adjustment of point sizes in the scatterplot.
- Updated InteractiveLegend to emit point size changes, enabling user-defined sizes for regular, highlighted, and selected points.
- Modified Scatterplot to utilize the new point size props for rendering, enhancing visual customization options for users. ([`bace8f3`](https://github.com/tsenoner/protspace/commit/bace8f3a880262110ec063391a01ede1d5849ab1))

* feat(legend): enhance interactive legend with settings dialog and shape customization

- Added a settings dialog for the interactive legend to configure max visible items, shape size, and visibility of the "Other" category.
- Integrated shape customization options into the legend and scatterplot components.
- Updated logic to handle visibility and shape rendering based on user preferences, improving the overall user experience. ([`e350cc8`](https://github.com/tsenoner/protspace/commit/e350cc82dde952222b112f5c2a542fcb5ffffcda))

* feat(scatterplot): implement double-click reset functionality for zooming ([`ae524c4`](https://github.com/tsenoner/protspace/commit/ae524c49315eabf80b1ce315926ad9c4fb9b3941))

* feat(data-loader): add utility functions for optimized file reading and Parquet bundle processing

- Introduced new utilities for data loading, including optimized file reading and functions for handling Parquet bundles, enhancing data import capabilities for the React app. ([`b6592ad`](https://github.com/tsenoner/protspace/commit/b6592adbc64009180f612eea54e30fea30212da9))

* feat(export-utils): improve legend export by filtering hidden features and adding visibility handling

- Enhanced the legend export functionality to filter out hidden feature values, ensuring only visible items are included in the export. ([`cc23c8e`](https://github.com/tsenoner/protspace/commit/cc23c8e1c877a5da4016d4fdd264b71c271db546))

* feat(export-utils): enhance protein ID export by filtering out hidden feature values

- When exporting Protein ID, only the proteins which are visible in the scatter plot would be exported. ([`35bcd13`](https://github.com/tsenoner/protspace/commit/35bcd139b9e101f44946321a347639c367ff1a4a))

* feat(legend, export-utils): implement live legend state export functionality and enhance legend data retrieval ([`2123ebc`](https://github.com/tsenoner/protspace/commit/2123ebc56e46e16e67f39c2e6471fdb70e130304))

* feat(control-bar): enhance filter button visibility ([`6bccc1e`](https://github.com/tsenoner/protspace/commit/6bccc1ee41964e60862b6a31fd95755e72cda328))

* feat(control-bar): add filter menu functionality with dynamic feature configuration ([`a3374bb`](https://github.com/tsenoner/protspace/commit/a3374bbf0a9fd6a4182e9d5152a243036540e692))

* feat(scatter-plot): treat synthetic "Other" values as identical in style rendering ([`4724c28`](https://github.com/tsenoner/protspace/commit/4724c2896ab5704eacf73be87b12862cde5c91b4))

* feat(legend): add drag-and-drop functionality for merging extracted items back into "Other" ([`35c33bf`](https://github.com/tsenoner/protspace/commit/35c33bf3981ed85adde3980ad367950221c3b54d))

* feat(legend): enhance handling of "Other" items in legend data processing

- Implement logic to filter and update "Other" items based on individually shown values.
- Recompute "Other" count and remove the item if no entries remain.
- Ensure proper handling of "Other" items when toggling visibility in the legend. ([`7faffdd`](https://github.com/tsenoner/protspace/commit/7faffdd37d7e4e58a10748a702540e546482d60a))

* feat(scatter-plot): double-click reset functionality for zoom ([`6de3ce5`](https://github.com/tsenoner/protspace/commit/6de3ce52e195513ce7fb0fd3751348b80df5b091))

* feat(scatter-plot): implement shape rendering in canvas renderer ([`00012ae`](https://github.com/tsenoner/protspace/commit/00012ae88a260d268a5ab4892fcff19853f7d69a))

* feat(legend, scatter-plot): add shape toggle and size control; fix legend/scatter shape parity

- Fix: canvas scatter plot now renders per-category shapes (not just circles) using D3 symbol paths; added getShape to canvas renderer and grouped by symbol path
- Feature: add “Include shapes” option to legend (default false). When off, legend and scatter plot use circles with colors; when on, both use per-category shapes
- Feature: add “Shape size” control in legend settings to adjust scatter plot point sizes
- UI: settings modal includes “Include shapes” and “Shape size” fields ([`cf649c2`](https://github.com/tsenoner/protspace/commit/cf649c2cb4145905845b8bf5a7f14b3c7fb816b8))

* feat(legend,scatterplot): gray out “Other” points and add settings to set max legend items ([`5e42622`](https://github.com/tsenoner/protspace/commit/5e42622b4b96c36688c5b5a694f4808d30fe8c7f))

* feat(control-bar): enhance projection handling and add projection plane selection

- Can visualize 3D data as three 2D planes ([`e14861e`](https://github.com/tsenoner/protspace/commit/e14861e0078a4ddff9442c3027774497c60afc8a))

* feat(split-mode): implement split history management and UI updates

- Introduced split history state to manage selections in isolation mode.
- Enhanced protein selection handling to support multiple splits.
- Updated UI components to reflect changes in isolation mode and selection states.
- Improved status bar to indicate filtered views and total counts.
- Refactored related components to accommodate new split functionality. ([`627c08c`](https://github.com/tsenoner/protspace/commit/627c08c8098d8202c1b30dca84b10daaa4e744be))

* feat(StructureViewer): enhance error handling and loading states

- Reset error and loading states when protein ID changes.
- Implement a check for the existence of the AlphaFold URL before loading.
- Display an error message in the UI if the AlphaFold structure is unavailable.
- Ensure error state is cleared during component cleanup. ([`5705c73`](https://github.com/tsenoner/protspace/commit/5705c73321fda37561734c090a0faae3029b8362))

* feat(dependencies): add html2canvas for enhanced export capabilities

- Updated package.json to include html2canvas as a dependency.
- Modified pnpm-lock.yaml to reflect the addition of html2canvas.
- Enhanced the InteractiveLegend component to support image export functionality using html2canvas.
- Improved the StructureViewer component with a title prop for better context.
- Refactored the ImprovedScatterplot component for better responsiveness and selection handling. ([`8ef425a`](https://github.com/tsenoner/protspace/commit/8ef425a07fffbb91dc3371e5efa2484e31288500))

* feat(shapes): remove stroke shapes ([`da9478d`](https://github.com/tsenoner/protspace/commit/da9478d2e3cab9800b255cff07ef4fc7d2a20467))

* feat: add PDF export functionality and enhance export options ([`93a8d41`](https://github.com/tsenoner/protspace/commit/93a8d41db3798ce2814ca32021cfbcbc8ef7be42))

* feat: enhance UI components and styles

- Updated global styles to include new color variables and smooth transitions for theme changes.
- Refactored Header component to use a custom Logo component and improved layout with gradient text.
- Enhanced ControlBar and InteractiveLegend components with better spacing and hover effects.
- Improved tooltip positioning in ImprovedScatterplot for better user experience.
- Added custom scrollbar styles and improved error message visibility in Scatterplot module.
- Updated StatusBar for better layout and responsiveness.
- Introduced a new Logo component. ([`1d144a2`](https://github.com/tsenoner/protspace/commit/1d144a2aef103e2b9166df77c8b29ca35c913414))

* feat: add web component migration plan and new components

- Introduced a migration plan for transitioning core visualization components to web components using Lit.
- Added new components: `ProtScatterPlot` and `ProtInteractiveLegend` for improved visualization.
- Created documentation for shape standardization and web component migration.
- Updated `package.json` to include new dependencies for Lit and Molstar.
- Enhanced existing components with new features and improved structure. ([`8445f47`](https://github.com/tsenoner/protspace/commit/8445f47343725c59a3b7604fea35fa087b9fbf32))

* feat: add updated dual component approach ([`4faf27e`](https://github.com/tsenoner/protspace/commit/4faf27e43b8e5ca2e3599dc7a8f4ccf707b3ab36))

* feat: add inital spec ([`0c9b0f7`](https://github.com/tsenoner/protspace/commit/0c9b0f7e5d5cdfa108f32f797aacd4f924839576))

* feat(assets): add RostLab and ProtSpace logos ([`9946582`](https://github.com/tsenoner/protspace/commit/9946582469f81138678b173671d4b460242634dc))

* feat(visualization): implement basic scatterplot component

- Add D3.js-based scatterplot visualization
- Implement dynamic data loading and validation
- Add interactive projection and feature selection
- Support multiple marker shapes and colors
- Handle error states and data validation ([`7de449c`](https://github.com/tsenoner/protspace/commit/7de449cfdf8b28ccb6d5aed9892d87b5a4c16f6a))

### Fixes

* fix(style): correct numeric-column selectedPaletteId behavior + guard bad input

Review of #71 found the palette model was inverted for numeric columns.
The live frontend derives a numeric column's gradient from selectedPaletteId
(a gradient id applies; a non-gradient resets to batlow), but the docs claimed
it was "ignored entirely" and _warn_if_bad_palette falsely told users a valid
numeric gradient would fall back to kellys.

- skip the categorical-palette warning for numeric columns (a gradient id is
  the correct choice there); fix the contradicting docs/styling.md note
- guard _warn_if_bad_palette against a non-string selectedPaletteId
  (["viridis"] previously raised TypeError: unhashable type)
- use the canonical _is_missing so "<N/A>"/"NaT"/"None" display forms don't
  suppress the numeric warning
- drop the non-existent length_fixed/length_quantile annotation references
- README: list all five annotation sources + the ted/biocentral groups
- add tests for the non-string guard and numeric-gradient suppression

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`e96c491`](https://github.com/tsenoner/protspace/commit/e96c491cad33cf2d12ad6eacd156c74833bf855e))

* fix(style): document color palettes + validate selectedPaletteId

Document the 11 built-in palettes in docs/styling.md, split by data type:
6 categorical (settable via selectedPaletteId; kellys default) and 5 numeric
gradients (batlow default), sourced from the web frontend registry
(color-scheme.ts COLOR_SCHEMES + numeric-binning.ts GRADIENT_COLOR_SCHEME_IDS).
They were absent because the CLI passes selectedPaletteId through opaquely
(hardcoded 'kellys', no catalog) — the palettes live in the frontend.

Numeric gradients are UI-only (numericSettings), so selectedPaletteId only sets
the categorical palette; a gradient/unknown id silently resets to kellys. Warn
on that via _warn_if_bad_palette (mirrors the numeric warning), with the palette
id sets mirrored from the frontend + a keep-in-sync note. Rename the style-warning
test file and add palette-validation tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`a816396`](https://github.com/tsenoner/protspace/commit/a816396bdd16024815e42d7680d24bdac0b6e0fb))

* fix(style): warn when styling a numeric annotation (#67)

protspace style is categorical-only, but the web frontend bins numeric columns
into gradient ranges — so per-value colors/shapes set via the CLI were silently
dropped. Emit a warning (naming the column + distinct-value count) from the
template and both apply paths, and document the categorical-only model plus the
pre-bin / web-UI alternatives in docs/styling.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`b332bb3`](https://github.com/tsenoner/protspace/commit/b332bb333ec5f75bbc99d642338c0f11e7bba97e))

* fix(figure-editor): render badges at the unzoomed view (#294)

Duplicate-stack badges were captured at the live zoom position; added captureBadges(transform) to re-render them at the identity transform alongside the fit-all points during captureAtResolution. ([`9e21aa3`](https://github.com/tsenoner/protspace/commit/9e21aa348c6f8f27cda80d0ade278b3c924c66e1))

* fix(figure-editor): always render the default unzoomed view (#294, #297)

Editor now ignores the live transform and renders the fit-all view at all capture sites via a resetView flag; also resets zoom on isolation enter/exit to prevent stale state. Closes #294, #297 ([`8028859`](https://github.com/tsenoner/protspace/commit/802885926c5858065e8146dc144ef55ba9727bc8))

* fix(annotations): keep every hit of a multi-hit scored cell at display

`to_display_value` trimmed the `|score`/`|evidence` suffix with a single
`raw.split("|", 1)[0]` on the whole cell. In a multi-hit cell the first hit's
`|` precedes the `;` separators, so everything after the first hit was dropped:
`"apoptotic process|IDA;signal transduction|IEA"` collapsed to
`"apoptotic process"`. This silently lost hits 2+ for every common multi-value
scored annotation (GO bp/mf/cc, InterPro, TED, multi-EC) in the Dash `serve`
plot/legend, and desynced it from the `;`-splitting style template.

Trim the suffix per hit (after the `;` split), then re-join with `;`, so the
whole multi-hit cell stays one score-stripped/decoded category
(`"A|0.9;B|0.8"` → `"A;B"`). Single-hit and `--no-scores` cells are unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`809ebd0`](https://github.com/tsenoner/protspace/commit/809ebd08488f11952e51c546a6a8266514525527))

* fix(transfer): re-stamp bundle format version when replacing annotations

`replace_annotations_in_bundle` wrote the new annotations table without a
format-version stamp. `transfer` (and the prediction overlay) build that table
via `rename_columns`/concat, which drop pyarrow schema metadata — so running
`protspace transfer` on a v2 bundle emitted an unstamped annotations part.
Consumers that gate decoding on `protspace_format_version` (the hyparquet
frontend, Dash `serve`) then read it as v1 and render the transferred,
already-encoded names with raw `%XX` escapes.

Stamp at the single annotations-write chokepoint so no caller has to remember
(same unconditional-v2 trust boundary as `cli/bundle`). Covered by
test_replace_annotations_in_bundle_restamps_format_version.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`b40b043`](https://github.com/tsenoner/protspace/commit/b40b04335385b74a7bd3b9207111694082a44931))

* fix(style): key annotation styles by display value, not raw wire cell

`generate_template` lists decoded display values, but `add_annotation_styles_*`
validated and stored color/shape keys against the raw percent-encoded cells
(`get_all_annotation_values`). For a v2 name containing `;`/`|`/`%` the two
diverged, so a styles file built from the template raised "Value ... does not
exist" and could not round-trip.

Both style paths (parquet dir + bundle) now validate/store against the
annotation's display values via a shared `_annotation_display_values` helper —
the same `_to_display_value` transform the template uses — so keys match what
the template exposes and what the plot/legend groups by. NA-like labels carry
no reserved char and pass through unchanged, so NA handling is unaffected.

Docs: note in styling.md that value keys are display values; tests cover the
template→style round-trip for an encoded name on both the parquet and bundle
paths.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`bdc7d96`](https://github.com/tsenoner/protspace/commit/bdc7d96dd7117e4b1582248e163e3e6dd2e75008))

* fix(transfer): correctness fixes from review

- cli/transfer._is_missing: reuse the shared MISSING_VALUE_TOKENS instead of
  a bare `== ""` check. A real float NaN in a numeric target column
  (str(nan) == "nan") was treated as present, so NaN queries got no
  prediction and NaN references were transferred as the literal label "nan".
- protlabel/transfer.eat: break exact-distance ties on the lexically
  smallest source id, so the reported provenance (source_id) no longer
  depends on the arbitrary argsort order of equidistant references —
  matching the docstring's order-independence claim.
- protlabel/backends.nearest: raise a clear ValueError on an empty reference
  set instead of a cryptic argpartition(kth=-1) crash for direct callers.
- protlabel/lookup: use np.asarray, not astype, so save/load don't copy an
  already-float32 embedding matrix (multi-GB at Swiss-Prot scale).

Also folds in the related cleanup that touches the same files: validate
--metric against the shared METRIC_TYPES constant instead of a bare literal;
thread the full-table and embedded identifier lists through run_transfer so
they are materialized once rather than per transfer column; hoist the
per-chunk row index out of the nearest() loop.

Adds regression tests for NaN-as-missing and deterministic source_id.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`6d28940`](https://github.com/tsenoner/protspace/commit/6d28940e5f854bc5ba2c00a93cf370d3453d9a39))

* fix(transfer): bound the float64 rerank pool by max_block_bytes

The candidate over-fetch (previous commit) widened the float64 rerank tensors
to (eff_chunk, k_pool, d), whose size scales with the embedding dim d. But
eff_chunk was sized only against the (eff_chunk, n_refs) distance block, so for
a small reference set (block budget never shrinks the chunk) queried by many
high-dim vectors — e.g. a curated ~800-ref set, 2048 queries, ESM2-3B d=2560 —
the rerank peaked at ~1.4 GB for an 8 MB reference matrix, contradicting the
module's laptop-feasible memory promise. Correctness was unaffected.

Cap eff_chunk against the rerank footprint (k_pool * d * ~24 B/query-row) as
well, so both per-chunk tensors stay within max_block_bytes. The Swiss-Prot
case is unchanged (still block-bound at eff_chunk 58); the fix only shrinks the
chunk where the rerank would otherwise dominate. Adds a tracemalloc regression
test (peak now ~170 MB, was ~1.4 GB).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`efbb898`](https://github.com/tsenoner/protspace/commit/efbb898dc2d635811746f166a8ebe330be05c069))

* fix(transfer): over-fetch candidates before the float64 kNN rerank

The float32 GEMM distance ||q||^2 - 2 q.r + ||r||^2 loses precision to
catastrophic cancellation for high-norm pLM embeddings, so the argpartition
top-k *selection* could drop a true nearest whose float32 distance is noise.
The exact float64 recompute only reordered the already-selected candidates, so
it could not recover a nearest that selection discarded — for the default k=1
with two near-equidistant references, eat() could transfer the wrong label.

Over-fetch a wider candidate pool (max(2k, k+16), capped at n_refs) with the
fast float32 block, rerank the whole pool in float64, then take the true top-k.
Selection is now robust to the float32 cancellation, not just the reported
distance. The rerank stays O(b * k_pool * d) << the O(b * n_refs) GEMM, so cost
and peak memory are unchanged in practice.

Adds a regression test: high-norm near-duplicate clusters whose true distances
collapse below the float32 rounding floor. Exact-k selection returns decoy
indices for most queries; over-selection recovers every true anchor.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`609d233`](https://github.com/tsenoner/protspace/commit/609d233097592c60641188e8934aad8662ef433c))

* fix(transfer): address review findings — atomicity, precision, security, robustness

Resolve issues found in code review of the EAT transfer backend (PR #55):

- predictions: make the overlay idempotent — drop existing <col>__pred_* columns
  before re-appending, so re-running transfer replaces them instead of producing
  a duplicate-column bundle that can no longer be read back
- bundle: atomic writes (temp file + os.replace) in write_bundle and the
  replace_* helpers, so an interrupted in-place overwrite (-b X -o X) can no
  longer destroy the bundle; reject the reserved delimiter in serialized parts
- backends: replace scipy.cdist with a pure-numpy BLAS GEMM path and recompute
  the surviving top-k distances in float64 (precise for near-identical vectors);
  guard cosine against zero-norm NaN
- lookup: store float32 + unicode arrays, load with allow_pickle=False
  (no pickle/RCE surface; lossless round-trip)
- transfer/classification: materialize only the needed columns (no full
  to_pylist); deterministic RI tie-break; translate input errors to BadParameter
- cli: colon/Windows-safe -e/-i parsing via a shared split_h5_spec helper
- docs/notebook: qualify the reliability-index formula per metric and k

Adds tests for protlabel engine, overlay idempotency, atomic write, spec
parsing, and CLI error handling. Full suite: 572 passed; ruff clean.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`6410ff9`](https://github.com/tsenoner/protspace/commit/6410ff95c6a069c4715c2527393b618391aaefe9))

* fix(transfer): handle protein_id id column in real bundles; clearer errors

- Normalize protein_id→identifier before run_transfer and rename back after
  so real bundles (produced by protspace prepare) no longer KeyError.
- Add ValueError when no bundle proteins match any embedding key.
- Correct misleading comment in test_run_transfer_predicts_for_query_with_missing_value.
- Add end-to-end regression test exercising the protein_id rename path.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`544d80e`](https://github.com/tsenoner/protspace/commit/544d80e3806c597853e4af30f04d9b9c2109d866))

* fix(protlabel): bound kNN per-chunk memory adaptively; guard k>=1

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`742a602`](https://github.com/tsenoner/protspace/commit/742a60263ded663269cf09ffccda28177b4b9fdf))

* fix(annotations): resolve PR66 review — serve style consistency, v2 decode gate, annotate stamp

Addresses the three review findings on the bundle-format-v2 branch:

- **serve style keys (high):** the Dash plot grouped points by the *decoded*
  value while the style dropdown stored/looked up colors and shapes by the
  *encoded* value, so a user's color choice was silently dropped for any name
  containing `;`/`|`. serve now operates entirely in display space: the value
  dropdown, color-picker preview, and stored style keys all use the shared
  display value, matching the plot's categories.

- **display decode (medium):** factor a single `encoding.to_display_value`
  used by both the plot and the `style` template (unifying the `|`-suffix trim
  so the stats `cluster N|score` cells match their `cluster N` auto-legend
  styles), and gate the percent-decode on `format_version >= 2`. ArrowReader
  now reads `protspace_format_version` from the annotations parquet metadata
  and threads it through the serve dict round-trip, so a legacy v1 name with a
  literal `%XX` is left untouched.

- **annotate stamp (minor):** `protspace annotate` now stamps its parquet as
  v2, so an un-bundled annotate output declares its encoding for any consumer
  that gates decoding on the version.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`8705d0e`](https://github.com/tsenoner/protspace/commit/8705d0ecf8e7e055186635ac827c8510dbd9c392))

* fix(serve): decode v2 percent-encoded annotation cells in plot legend/hover

prepare_dataframe() built the plotly color/symbol/legend/hover column
straight from the raw stored annotation cell, so encoded names showed
%3B/%7C/%25 in the serve viewer instead of ;/|/%. Decode once at the
single fetch site via a small _decode_annotation_value() helper (no-op
on None/non-strings), mirroring the style path's existing decode. ([`2ef6437`](https://github.com/tsenoner/protspace/commit/2ef643755c1a3aa938a3cf0042867b5a6237ac1d))

* fix(annotations): --no-scores also strips ted_domains pLDDT scores

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`2f38987`](https://github.com/tsenoner/protspace/commit/2f38987819f3be903537d5b336facfdb25dd382f))

* fix(annotations): stop fabricating names for unnamed CATH superfamilies (#57) ([`951b691`](https://github.com/tsenoner/protspace/commit/951b691f4cdca21846028da3d99afc4bcfbe2f98))

* fix(monorepo): repoint apps/web wordmark symlinks broken by the move

apps/web/public/wordmark{,-black}.svg symlinked ../../docs/assets/... which
dangled after app/ (depth 1) → apps/web/ (depth 2). Same class as the docs
favicon fix; missed earlier because the precommit runs docs:build, not the full
`pnpm build` that consumes these. Verified: pnpm build now green (3/3).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`0ad0844`](https://github.com/tsenoner/protspace/commit/0ad0844702663df42c6257225776edc806c894cb))

* fix(test): colored CI output splits "--option" tokens with ANSI codes so the guard-message substring match failed; strip escape sequences before asserting (also wraps an over-long invoke arg list ruff format flagged)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`3c86c33`](https://github.com/tsenoner/protspace/commit/3c86c33b692b5a66d645b5945d5a3598b620ad8f))

* fix(stats): spearman_distance used ordinal (index-broken) ranks, biasing on ties and reporting a spurious perfect score for collapsed layouts; use midranks and return NaN when distances are all-tied

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`f3ca79b`](https://github.com/tsenoner/protspace/commit/f3ca79ba07a68b6d52efe6dc1940dc3e1a558eae))

* fix(stats): stats -a rewrote the annotations parquet through a pandas round-trip that re-inferred dtypes (nullable int64 → float64 on untouched columns); append cluster columns onto the original Arrow table instead

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`04b8569`](https://github.com/tsenoner/protspace/commit/04b8569b5e94a6e02facbd93fb24c798d6f0f646))

* fix(cli): prepare silently ignored --stats-annotation/--cluster-selection when --stats was off; reject a non-default value without --stats

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`a6540d9`](https://github.com/tsenoner/protspace/commit/a6540d9a0779e248be617dab7a1cc4cf9c7f1afa))

* fix(stats): an id-namespace mismatch silently added an all-empty cluster column and styled a phantom legend; warn and skip zero-match columns, and style only the columns that landed values

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`77e696d`](https://github.com/tsenoner/protspace/commit/77e696da6a496f072a9f8ca5a1ad66b0dc2de99f))

* fix(stats): _select_embedding silently picked embedding_sets[0] when several embeddings covered the ids with no source, scoring faithfulness against the wrong space; abstain (return None) on ambiguity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`5fcb159`](https://github.com/tsenoner/protspace/commit/5fcb1591b73ef541573247b27d0bbf667d96c6e0))

* fix(stats): a faithfulness metric that raised (e.g. random_triplet on a metric paired_distances rejects) vanished silently from quality; record it as a skipped NaN row instead

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`4fc7446`](https://github.com/tsenoner/protspace/commit/4fc74468d93c72bebfdacc2dc749a5e8a229e27c))

* fix(stats): kmeans_elbow drew its large-n fit/silhouette subsample positionally from the raw seed, making clusters depend on input row order; draw it id-canonically (id-seeded, canonical order) like the other metrics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`d028ab5`](https://github.com/tsenoner/protspace/commit/d028ab5bee9cb575031f56f8e21e9e2f1159576e))

* fix(stats): annotation validity scored value|score compound labels, splitting one category per evidence code; strip the score suffix to the bare category before scoring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`f6a567d`](https://github.com/tsenoner/protspace/commit/f6a567d70a7f6401b6296d5adf806e07d4bd6a17))

* fix(stats): review + simplify pass on the projection-statistics engine

Correctness (from /code-review):
- driver `_align`: return None when a reduction has no ids and the row counts
  differ, instead of falling through to positional indexing that IndexError'd
  and silently dropped the projection's entire stats report.
- validity: `--cluster-selection silhouette` on a degenerate/coincident
  projection left no scorable silhouette-K, emptying the labellings so the
  projection vanished from the report — now falls back to the elbow labelling.
- pipeline `_compute_statistics`: build the fallible artifacts (to_arrow,
  legend settings) before mutating the shared reductions/metadata, so a late
  failure yields a clean "no stats" fallback rather than a half-enriched bundle.

Cleanup (from /simplify + review):
- bundle.py: extract `_parse_bundle` (single read+split+validate+normalize
  seam) and `_table_to_parquet_bytes`; fold `read_settings_from_file`; this
  also fixes `read_statistics_from_bundle` silently skipping the part-count
  validation the other readers enforce.
- driver `_align`: keep the embedding at native float32 (was upcast to float64
  per projection); faithfulness bails before its upcast past the ceiling.
- cli/stats: extract `_parse_info_json` (was duplicated); export
  `read_statistics_from_bundle` from data/io.
- docs: add `stats/_sampling.py` to the package tree; fix test counts.
- tests: regression tests for the `_align` no-id guard and the
  silhouette->elbow fallback.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`2934ee6`](https://github.com/tsenoner/protspace/commit/2934ee6cd213724d00d333392b0b8c5c84914f69))

* fix(stats): review + simplify pass on annotation cluster-validity

Correctness (from /code-review):
- Honor explicit --stats-annotation names by bypassing the auto suitability
  heuristic — it silently dropped documented high-cardinality columns like
  ec_number, so the `major_group,ec_number` example scored only major_group.
- Make annotation-validity subsampling id-canonical (shared id_seed) so the
  once-per-embedding "separability ceiling" and each projection score the same
  proteins above the 5000-point threshold instead of two different draws.
- Recognize <N/A>/<NA>/NaT (and NA/null/none) missing sentinels so a missing
  value is never scored as a phantom category.

Cleanup (from /simplify + review):
- Extract stats/_sampling.py (id_seed + sorted_subsample), reused by
  faithfulness (behavior-identical) and annotation_validity.
- suitable_annotations early-exits past the cardinality cap; the explicit
  --stats-annotation path only inspects the named columns, not the whole frame.
- Avoid the full-embedding float64 upcast + pre-subsample copy in the
  once-per-embedding pass; extract _run_stats; reuse ann_frame instead of
  re-reading the annotations parquet.
- Shared CLUSTER_COLUMN_PREFIX constant; _resolve_id_col helper; push the
  --stats-annotation parse into build_annotation_labels; drop a redundant
  int() cast and dict copies.
- Fix stale docstrings and CLAUDE.md test counts; add explicit-name +
  subsample-determinism regression tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`4ac74cb`](https://github.com/tsenoner/protspace/commit/4ac74cbb221a052210379b8d265dd162c19e8caf))

* fix(stats): correct random-triplet sampling + simplify/harden extras

Quality pass over the projection-stats "extras" (cluster-selection,
silhouette-as-score, global faithfulness).

Correctness
- random_triplet: sample two DISTINCT others per anchor (j != m != anchor)
  instead of drawing uniformly from [0, n). Self-pairs are distance-0 and
  trivially "agree" in both spaces, biasing the accuracy score upward.

Robustness / efficiency
- faithfulness: return the n > hard_ceiling skip row BEFORE the canonical
  sort/copy, so oversized inputs (metrics skipped anyway) don't pay a wasted
  O(n log n) sort + two array copies.
- cluster-validity: fall back to the 'elbow' default when the raw stats API
  receives an unrecognised cluster_selection (the CLI already validates via a
  Typer enum) instead of silently emitting no labelling at all.

Simplify
- model --cluster-selection as ClusterSelection(str, Enum) in common_options;
  Typer auto-validates, deleting two duplicated manual validation blocks in
  prepare.py + stats.py.
- validity: carry selection_name in a _Labeling NamedTuple (drops the
  reverse-derivation; shrinks _emit_labeling's signature 8 -> 5 args).
- kmeans_elbow: unify the two duplicate ElbowResult return sites.
- faithfulness: factor the 3x repeated local-scope extra dict.

Docs
- sync stale test-count table in CLAUDE.md (37->43, 11->12, 9->10).
- sync driver.compute_statistics docstring params (cluster_selection,
  include_scores, max_fit_sample, n_triplets_per_point, cluster_annotations).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`5b6b002`](https://github.com/tsenoner/protspace/commit/5b6b002270faac7937c64dd01a3306f709d2a225))

* fix(stats): address adversarial review of the extras feature set

- random_triplet was NOT row-order invariant for n<=sample_threshold (it samples
  triplets by array position). Canonicalise emb/coords/ids by id up front in
  FaithfulnessStatistic.compute so EVERY metric depends only on the id-set, in
  both the subsampled and non-subsampled paths. Invariance test now parametrised
  over both regimes and asserts all five metrics.
- prepare: validate --cluster-selection before the expensive query/embed/similarity
  stages (fail-fast), mirroring the stats command; add a CLI rejection test.
- Refresh stale docs/help/comments that still referenced the removed separate
  silhouette_<proj> column (carriage.py, cli/stats.py) and fix a "dense ranks"
  comment (ordinal ranks) + hoist a repeated fancy-index in random_triplet.

574 fast tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`49d3856`](https://github.com/tsenoner/protspace/commit/49d385607df22b737f98b3c4c28aca648f16d636))

* fix(stats): harden projection-statistics correctness, scaling, and defaults

Refinements to the not-yet-released stats subsystem from a /simplify pass, an
xhigh /code-review, and researched fixes for the deferred review findings.

Correctness:
- base_processor.save_output: persist `settings` in the unbundled (--no-bundle)
  branch too — cluster legend styles were silently dropped there.
- cli/stats: union same-name -i inputs (merge_same_name_sets) so multi-file
  same-embedding runs don't collapse to the last set; guard --settings-out to
  require -a; write metadata/annotations parquet atomically (temp + rename);
  infer 3D from z when projection metadata is absent.
- faithfulness continuity: compute via a correct dual (`_continuity`) so the
  embedding is ranked by the run's high-dim metric (was always euclidean);
  bit-identical on the euclidean default path.
- validity silhouette: report the aggregate as the exact per-point mean when the
  per-point column is computed (was an inconsistent sampled estimate).
- faithfulness subsample: select on canonical id order so scores are row-order
  invariant (matching the already order-invariant seed).

Scaling / cleanup:
- kmeans_elbow: fit the K sweep on a bounded subsample (MiniBatchKMeans) +
  predict above 50k points; full-batch unchanged below. Remove the write-only
  silhouette_optimal_k cross-check and its duplicate silhouette compute.
- Collapse duplicated faithfulness try/except into a loop; drop the
  self._stats_settings side channel (return (table, settings)); remove a
  redundant empty-table branch, a needless list copy, a double np.unique, and an
  unused shape param; centralize the reduction `source` stamp via a closure.

Behavior:
- prepare: `--stats` now defaults to False (opt-in) — heavy compute + bundle
  column/style injection should not run on every run.

Adds regression tests (continuity dual, subsample determinism/order-invariance,
silhouette consistency, unbundled settings, --settings-out guard). 565 tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`190e2f0`](https://github.com/tsenoner/protspace/commit/190e2f02dcdd3b2df69b4af3d87b464789d4a035))

* fix: union protein IDs when multiple inputs share the same embedding name

When multiple -i inputs resolve to the same embedding name (e.g. two species
both embedded with ProtT5), their proteins are now concatenated (unioned)
instead of intersected. Inputs with different names still use intersection
for multi-embedding comparison. Fixes #44.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`4be81c1`](https://github.com/tsenoner/protspace/commit/4be81c180bd048dbccadb73da6717bb7a0ca3d5f))

* fix: use CATH latest-release URL instead of hardcoded v4_4_0

The latest-release/ path is a stable alias that always points to the
current CATH release, so we automatically pick up new versions.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`aaad9be`](https://github.com/tsenoner/protspace/commit/aaad9be9b57d760e6a5fee3ccfc1c0705437a12a))

* fix: consolidate repetitive cache-hit messages into compact summaries

Group per-item cache warnings (projections, embeddings) into single
summary lines, remove repeated --force-refetch hints in favor of one
at the end, and demote verbose per-item logs to INFO level.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`af0c76d`](https://github.com/tsenoner/protspace/commit/af0c76d1a10e8a71bdaf7d1098dcbff5c4004155))

* fix: warn when using cached annotations and when cache is all empty

Change cache-hit message from INFO (only visible with -v) to WARNING
so users always know when cached data is being used. Also detect and
warn about all-empty cached annotations with actionable advice
(--force-refetch or -f).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ce6f650`](https://github.com/tsenoner/protspace/commit/ce6f650b1488ef838300314f8540cc0cccee1ef0))

* fix: simplify UniProt ID handling and document annotation input requirements

Remove _manage_headers() — identifiers must be valid UniProt accessions
directly. Non-matching IDs are skipped with a clear warning that
distinguishes accession-dependent (UniProt, Taxonomy, TED) from
sequence-dependent (InterPro, Biocentral) annotations.

Also:
- Fix _add_required_annotations() to include 'sequence' for Biocentral
- Simplify _build_sequence_map() (no reverse mapping needed)
- Document input requirements in docs/annotations.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`72dde67`](https://github.com/tsenoner/protspace/commit/72dde671eb891926ae274188027a48eef2fb570e))

* fix: improve annotation validation error with suggestions and group list

Show fuzzy-matched suggestions (via difflib), list available groups,
and link to online annotation reference. Example output:

  Unknown annotation 'biocentra'. Did you mean: biocentral?
    Groups: all, biocentral, default, interpro, taxonomy, ted, uniprot
    See https://github.com/tsenoner/protspace/blob/main/docs/annotations.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`aaae6ae`](https://github.com/tsenoner/protspace/commit/aaae6ae303326bf56846927c2ab9668af078cba9))

* fix: attach -f FASTA path to H5 embedding sets for sequence reuse

When user provides H5 embeddings with -f fasta.fasta, store the FASTA
path on the EmbeddingSet so sequences are available for Biocentral
predictions and InterPro without needing UniProt accessions.

Also improve the warning message when no sequences are available.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5d99e21`](https://github.com/tsenoner/protspace/commit/5d99e21d0965a370ffd08a9562786f50177b1070))

* fix: use cache dir for MMseqs2 temp files instead of system temp

Pass cache_dir from CLI to compute_similarity() so MMseqs2 temp files
are stored alongside other cached data. Falls back to system temp
when no cache dir is available. Only cleans up temp files when using
system temp (cache dir is preserved for reuse).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`65b3b96`](https://github.com/tsenoner/protspace/commit/65b3b96b752ef2308c6f0326e60ca1ee95c0c679))

* fix: pass FASTA sequences through pipeline and deduplicate for Biocentral

- Extract sequences from EmbeddingSet.fasta_path in the pipeline and
  pass them to ProteinAnnotationManager, avoiding redundant UniProt
  sequence re-fetches for FASTA/Query input modes
- Merge local sequences (priority) with UniProt sequences (fallback)
  in both _fetch_interpro() and _fetch_biocentral()
- Deduplicate sequences before sending to Biocentral API (rejects
  duplicate sequences) and map predictions back to all headers sharing
  the same sequence

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`50faeaa`](https://github.com/tsenoner/protspace/commit/50faeaaa4a5d7481a3d2a57e3f2c1e623e927698))

* fix: add tests for new annotations and update CLI help text

- Add 7 unit tests for Pfam CLAN transformer (mapping, dedup, edge cases)
- Add 7 unit tests for TED retriever (mocked AlphaFold API, CATH names)
- Add 14 unit tests for Biocentral retriever (TMbed parsing, per-sequence)
- Update CLI help text to include ted and biocentral groups
- Update annotations.md overview with all five sources and group presets

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`6d6d599`](https://github.com/tsenoner/protspace/commit/6d6d5999a994451d7a137a780c514a5e3ff9dc07))

* fix(ci): replace semantic-release publish with gh release upload and remove unused deps

semantic-release publish fails in detached HEAD (tag checkout). Use
gh release upload instead, and drop the now-unused python-semantic-release
tool install + cache from the pypi job.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`9550b1b`](https://github.com/tsenoner/protspace/commit/9550b1bc5209cf6bdd9ded462ef1472f0580c0ac))

* fix(ci): bump all workflow actions to latest versions and add uv lock to semantic-release build

- Bump actions in release.yml and publish.yml to Node 22+ versions
  (checkout v6, setup-python v6, setup-uv v7, cache v5, etc.)
- Add build_command = "uv lock" to semantic-release config so uv.lock
  is regenerated after version bumps, fixing Docker --locked builds

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7ba2a39`](https://github.com/tsenoner/protspace/commit/7ba2a3920f267e15a466c3f254a542a5ccdcd237))

* fix(ci): bump all actions to latest major versions (checkout v6, setup-python v6, setup-uv v7)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`e16f8d5`](https://github.com/tsenoner/protspace/commit/e16f8d53c0540288deb1487157e8d8ff4f7a6275))

* fix(ci): bump actions to Node 22 versions to silence deprecation warnings

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`f9cf7c6`](https://github.com/tsenoner/protspace/commit/f9cf7c6895df5346724dbbef894be635900fdd24))

* fix(ci): run push checks only on main to avoid duplicate PR checks

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`30a0964`](https://github.com/tsenoner/protspace/commit/30a096400662c48ea2222b6de8be466499f828d8))

* fix: install protspace from PyPI instead of git in Colab notebook

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`bd0d4b1`](https://github.com/tsenoner/protspace/commit/bd0d4b16d40d8c6874f6f6858d1537c2ed9f50a6))

* fix: audit — critical bugs, consistency fixes, and documentation overhaul

Critical fixes:
- MDS reducer: metric param was conflated with precomputed (forced non-metric MDS)
- serve/wsgi: ProtSpace import failed (missing from __init__.py)
- wsgi: loaded .env.example instead of .env

Consistency:
- Align eps default between prepare (was 1e-6) and project (1e-3)
- Fix Metric enum handling (string default → proper enum in project.py)
- Make -a/--annotations repeatable in prepare (was single string)

Code quality:
- Replace print() with logging in Dash callbacks
- Log instead of swallowing exceptions in ArrowReader
- Add per-duplicate DEBUG logging in h5 loader
- Unpin torch, align pyarrow dev dep to >=20.0.0

Documentation:
- Fix outdated file references in CLAUDE.md (local_processor→h5, common_args→app)
- Update test table to actual 16 files with real counts
- Fix styling.md: protspace-annotation-colors → protspace style
- Fix pfam_clans README: protspace local → protspace prepare
- Fix README: add LocalMAP to DR method list
- Fix tests README: uvrun typo, wrong test file, CI description
- Fix help_overview.md typos

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`848f778`](https://github.com/tsenoner/protspace/commit/848f778e3e032e0afbbb504a5666865f7ce71150))

* fix: use raw H5 keys as identifiers instead of parsing them

H5 keys from UniProt and Biocentral are already clean accessions
(e.g., P12345). The parse_identifier() extraction was lossy for
non-UniProt data (e.g., NCBI|name|species → name) and caused CSV
annotation mismatches. Now H5 keys are used as-is.

parse_identifier() is kept for FASTA header parsing where extraction
is still needed (query.py, fasta.py, similarity.py).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`de0a3a7`](https://github.com/tsenoner/protspace/commit/de0a3a7f55ee54f5bbf291b8c2e3e3e155a3700e))

* fix: skip taxonomy/interpro fetch when not requested

ProteinAnnotationManager previously defaulted to fetching all three
annotation sources (UniProt, taxonomy, InterPro) regardless of which
annotations were actually requested. With default annotations (ec,
keyword, length, protein_families, reviewed) — all UniProt-only — this
unnecessarily downloaded the NCBI taxonomy database (~1 min).

Now derives sources_to_fetch from AnnotationConfiguration when not
explicitly provided, so only needed sources are queried.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5ee2259`](https://github.com/tsenoner/protspace/commit/5ee2259fd3a88a483220d534ebc12015337684ba))

* fix: identifier parsing, projection naming, CLI cleanup, frontend passthrough

Identifier parsing:
- Parse UniProt accessions from FASTA headers before embedding
  (sp|P12345|NAME → P12345), so H5 keys are clean from the start
- load_h5 also applies parse_identifier as safety net for old H5 files
- similarity loader maps MMseqs2 output IDs through parse_identifier

Projection naming:
- Add format_projection_name() with display name maps for pLMs and methods
- Produces: "ProtT5 — PCA 2", "ESM2-650M — UMAP 2", "MMseqs2 — MDS 2"
- Frontend formatProjectionName() now passes through names as-is

Similarity handling:
- Precomputed sets always get MDS 2 automatically, independent of -m methods
- No longer warns about skipping other methods for precomputed sets

CLI cleanup:
- Remove --custom-names, --probe, --dry-run, --embedding-cache
- Make -e and -a comma-separated (like -m)
- Remove non-pLM embedders, constrain --metric to enum
- Default --metric cosine, --n-neighbors 25, --eps 1e-6
- --keep-tmp default True, -a default "default"

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`86fc2bc`](https://github.com/tsenoner/protspace/commit/86fc2bca4069353aed91a685179dc3c44f078105))

* fix(annotations): resolve EC names for partial/incomplete EC numbers

Parse ExPASy enzclass.txt alongside enzyme.dat to provide human-readable
names for partial EC numbers like 3.4.-.- or 2.-.-.-. Both files are
merged into a single cached map keyed by standard EC format.

Closes #33

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`6c97962`](https://github.com/tsenoner/protspace/commit/6c97962a80449eb7b64119b6a5fda2fb6cd65e63))

* fix(arrow_reader): use first column as identifier instead of hardcoded "protein_id"

Resolves #10

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`e5065e4`](https://github.com/tsenoner/protspace/commit/e5065e46c3f40c32c2f3f6a39237e39b89268c62))

* fix(reducers): robust float16 upcast, annoy fallback, suppress noisy warnings

- Upcast float16 → float32 at HDF5 load time (local_processor) with a
  safety-net in base_processor, preventing overflow in all DR methods
- Add lazy annoy health check: on platforms where annoy segfaults or
  returns empty results (e.g. macOS ARM64), transparently swap in an
  sklearn NearestNeighbors drop-in so PaCMAP/LocalMAP keep working
- Suppress harmless sklearn RuntimeWarnings (randomized SVD overflow),
  FutureWarnings, and umap UserWarnings during fit_transform
- Add LocalMAP to Colab notebook (METHODS list, parameter sliders,
  intro text) — previously missing from the preparation UI

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`71a2e36`](https://github.com/tsenoner/protspace/commit/71a2e369a1c399db5fe5c885fb1d3c0de9f37b52))

* fix(cache): separate storage from presentation in --keep-tmp cache

Always cache annotations as parquet with scores, regardless of
--no-scores or --non-binary flags. Move score stripping to the CLI
output layer via new strip_scores_from_df() utility. Add incremental
annotation fetching to UniProtQueryProcessor. Add --dump-cache flag
for inspecting cached data.

Closes #24

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`547c939`](https://github.com/tsenoner/protspace/commit/547c939cff61873a210ca44d54492be044c7c297))

* fix(uniprot): resolve inactive/obsolete entries via secondary accession search

fetch_many() silently drops inactive UniProt entries (merged/demerged).
After each batch, detect missing accessions and resolve them by searching
the sec_acc field, which returns the current replacement entry.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`7ea27de`](https://github.com/tsenoner/protspace/commit/7ea27de49ae7917a41ee7b7a419ad157884aed6e))

* fix(uniprot): correct reviewed field parsing for TrEMBL entries

Parser incorrectly matched "unreviewed" when checking for "reviewed" string.
Now returns "Swiss-Prot" or "TrEMBL" directly, eliminating the need for
transform_reviewed() method. ([`9c9fbbb`](https://github.com/tsenoner/protspace/commit/9c9fbbbbcdc7279b30ff3099effae5f784b69cef))

* fix(annotations): remove internal columns from final output, keep in cache ([`9d3be3c`](https://github.com/tsenoner/protspace/commit/9d3be3cd16a375b834d73449b573f719fc458f84))

* fix(annotations): remove raw length field from output after binning ([`55c6281`](https://github.com/tsenoner/protspace/commit/55c6281d92f62b8f145f18d4c572b8035be907d5))

* fix(features): correct user feature filtering in configuration

Previously, when users specified specific features (e.g., -f domain),
the configuration was filtering DEFAULT_FEATURES instead of user_features,
causing all default features to be fetched unnecessarily.

Now correctly filters user_features, ensuring only requested features
and their dependencies are retrieved from data sources.

Fixes issue where requesting only taxonomy features would still trigger
full UniProt and InterPro data downloads. ([`03e553b`](https://github.com/tsenoner/protspace/commit/03e553b20f0563b066c91d1534ad028cb8570228))

* fix(parser): truncate protein family descriptions at first dot

- Update protein_families property to remove trailing text after period
- Clean up family description formatting in UniProt parser
- Update toxins dataset with improved family annotations ([`d53303e`](https://github.com/tsenoner/protspace/commit/d53303e704f2f960ba1b41a92d754baeca09c284))

* fix(cli): update imports to new module paths

- Update local_data.py to import LocalProcessor from processors
- Update uniprot_query.py to import from new locations
- Ensures CLI commands work with refactored architecture ([`93359d1`](https://github.com/tsenoner/protspace/commit/93359d10b785c9f4cc4d1fafafd03222ed39ef55))

* fix(examples): update jupyter notebooks to use current CLI commands

Replace deprecated 'protspace-json' command with 'protspace-local' in example notebooks:
- examples/notebook/PfamExplorer_ProtSpace.ipynb
- examples/notebook/Run_ProtSpace.ipynb

This ensures the example notebooks work with the current CLI interface and
improves the user experience for notebook-based workflows. ([`aead4fb`](https://github.com/tsenoner/protspace/commit/aead4fb660c9b024fb44dedd4afe98b49c436619))

* fix(docker): add curl dependency and fix jupyter notebook imports

1. Docker build fix:
   - Add curl dependency to resolve pymmseqs build failure
   - The pymmseqs package requires curl to download the MMseqs2 binary during installation
   - Without curl, Docker builds fail with 'curl: not found' error
   - This resolves: scripts/download_mmseqs.sh: 37: curl: not found

2. Jupyter notebook import fix:
   - Updated import path from 'from protspace.app import ProtSpace' to 'from protspace import ProtSpace'
   - Modified src/protspace/__init__.py to expose ProtSpace at package level
   - This simplifies imports for users in notebooks and examples

Fixes the Docker build failure in GitHub Actions and improves the developer experience for notebook users. ([`e2b3e78`](https://github.com/tsenoner/protspace/commit/e2b3e7842cdaaa33e60186ff1395a978e61876ab))

* fix: JSON encoder for NumPy data types in BaseDataProcessor

- Introduced NumpyEncoder class to handle serialization of NumPy integers, floats, and arrays.
- Updated json.dump call in save_output method to use NumpyEncoder for improved data handling. ([`7958e04`](https://github.com/tsenoner/protspace/commit/7958e0412fe806e177a69f573d703e77ac3beb28))

* fix: correct validation logic for taxon IDs in TaxonomyFeatureRetriever ([`ae32766`](https://github.com/tsenoner/protspace/commit/ae327668e2948ab4df88be883269cff14ea92a7c))

* fix: correct spelling of delimiter in parquet handling ([`c471b32`](https://github.com/tsenoner/protspace/commit/c471b32be56a654cadbcaeb65cb2df04498b19be))

* fix(tests): update tests for new architecture and add automatic ChromeDriver management

- Fix import paths: ProtSpace moved to server.app, DataProcessor to LocalDataProcessor
- Update LocalDataProcessor API usage in tests to match new method signatures
- Add conftest.py for automatic ChromeDriver version management using webdriver-manager
- Resolve Chrome/ChromeDriver version mismatch issues
- All tests now passing: 4/4 app tests, 4/4 sampled data processing tests ([`751bd46`](https://github.com/tsenoner/protspace/commit/751bd46ba353d147cba802b73067007855cf46e2))

* fix: correct import and variable names from REDUCER_METHODS to REDUCERS ([`fde0706`](https://github.com/tsenoner/protspace/commit/fde07067972426a4eb7a0c97e849c89b6786335e))

* fix: remove limit on UniProt headers in fetch_features method ([`8ee6859`](https://github.com/tsenoner/protspace/commit/8ee68596715beaf20585d97fdbb19ff745c0801c))

* fix(config): update marker shape configuration to use ValidatorCache

To work with Plotly update
This commit modifies the marker shape configuration in `config.py` to utilize `ValidatorCache` for improved performance and maintainability. The `SymbolValidator` is now retrieved from the cache, streamlining the extraction of marker shapes for both 2D and 3D plots. ([`4dd04ed`](https://github.com/tsenoner/protspace/commit/4dd04eda893e0fdd4bf51d95645e63aa5c508b73))

* fix(docker): resolve Kaleido and markdown helper dependencies

This commit addresses two critical functionality issues in the Docker container:

1. Kaleido Image Generation:
- Adds libexpat1 to the runtime stage of the Dockerfile
- Ensures proper library availability for Kaleido subprocess
- Maintains clean image by removing apt lists after installation

2. Markdown Helper:
- Adds build-essential and gcc to build stage for proper compilation
- Ensures markdown content is properly accessible in container
- Fixes path resolution for helper markdown files

These changes restore both the image generation functionality and markdown
helper features while maintaining container performance and security best
practices. ([`e01330d`](https://github.com/tsenoner/protspace/commit/e01330d6d41517c8a62c3d74727fa4920263250e))

* fix(pca): switch to arpack solver for numerical stability

Resolves `RuntimeWarning`s during PCA on `float16` embeddings by using `svd_solver='arpack'`. Removed prior dtype casting attempts. ([`e8c620b`](https://github.com/tsenoner/protspace/commit/e8c620bc33468936903efae9465d6e483e89d7ef))

* fix: NaN coloring ([`a238cfb`](https://github.com/tsenoner/protspace/commit/a238cfbfc11d3caae6df821a3d15babf6c95c8e3))

* fix: NaN process + app.run update ([`20c20a9`](https://github.com/tsenoner/protspace/commit/20c20a9c222ab5e0f4803c73ce1bd1828fa14e7f))

* fix: add metadata delimiter definition option and sanity checks when creating .h5 ([`01034cc`](https://github.com/tsenoner/protspace/commit/01034cc2227618fd597f1ca5e0baab428de1f369))

* fix: update annotation image ([`74fa2f6`](https://github.com/tsenoner/protspace/commit/74fa2f6f1557a660cd0511082726a7239d7bc89c))

* fix: update the dependencies ([`bc2946f`](https://github.com/tsenoner/protspace/commit/bc2946f43851d2e4c89dd0a571592200605c780b))

* fix: add JSON instruction layout ([`6b2e8e3`](https://github.com/tsenoner/protspace/commit/6b2e8e3681bf2ea036ba7e614299ed817c4d276d))

* fix: update workflow image ([`e23cbe5`](https://github.com/tsenoner/protspace/commit/e23cbe579f2236ea0552033577dde6a07030bb31))

* fix: wrong import in prepare_json ([`d7c383b`](https://github.com/tsenoner/protspace/commit/d7c383ba228a5e3ad4c1a605fe0fe03a427d16f2))

* fix: make embeddings without feature <NaN> ([`5d8b3bb`](https://github.com/tsenoner/protspace/commit/5d8b3bb316ee4920bcb7f64cee39407b5a20c9b5))

* fix: transparancy assignment ([`9a27e06`](https://github.com/tsenoner/protspace/commit/9a27e06d71282c9964d9556fcb25122d155d248b))

* fix: only display possible 3D markers ([`ad71828`](https://github.com/tsenoner/protspace/commit/ad71828386b46cc854d1476bb590501fdf2162f3))

* fix: go back to square 1 ([`43d4246`](https://github.com/tsenoner/protspace/commit/43d4246a14db87d5766d39b35f69700275aae392))

* fix: adjust python version for numba ([`5a069d1`](https://github.com/tsenoner/protspace/commit/5a069d147c7939e2234263639bef527beb396615))

* fix: remove support for 3.10

Python 3.10 requires an only numy that is troublesome. ([`ee270aa`](https://github.com/tsenoner/protspace/commit/ee270aaa2ec4ae8fd904d901bc46b24371e0cb56))

* fix: remove dash-bio dependency ([`fb80155`](https://github.com/tsenoner/protspace/commit/fb8015537390d155da331b6fcd7398807b63c01d))

* fix: remove explicit bio-dash dep ([`6e742e0`](https://github.com/tsenoner/protspace/commit/6e742e09d89d66bacbe6da8054479e16c9b05b35))

* fix: populate __init__ file with scripts ([`7dc02cf`](https://github.com/tsenoner/protspace/commit/7dc02cf62b879abef91643d511ce1a508c08ad2d))

* fix: populate __init__ file with scripts ([`87d4a4c`](https://github.com/tsenoner/protspace/commit/87d4a4c6c8466e48020ce281c9c6ad5a07e79643))

* fix: jupyter notebook call ([`db11c60`](https://github.com/tsenoner/protspace/commit/db11c605198ac8a2cf6f6aeb1b73a42cf6b1ab98))

* fix: allow for python version 3.10, 3.11, 3.12 ([`d8f78a0`](https://github.com/tsenoner/protspace/commit/d8f78a0076eedcfe18e4a64367d4c9fd03bff507))

* fix: psr toolname ([`96dd516`](https://github.com/tsenoner/protspace/commit/96dd516f7a18211819a8012bef520247754b04c3))

* fix: github release ([`ef41856`](https://github.com/tsenoner/protspace/commit/ef4185666003fc73c98592b9c250406b702adc6c))

* fix: fix detached history problem ([`b35974e`](https://github.com/tsenoner/protspace/commit/b35974e541da6a629a5a85d632494c3fd78f9604))

* fix: update config option in pyproject.toml ([`52abea8`](https://github.com/tsenoner/protspace/commit/52abea896b6052ed1ff0eb3e1a9129b07c172906))

* fix: check for release ([`6975930`](https://github.com/tsenoner/protspace/commit/6975930c3a51a31a744dfdab07cbb10a301f4f2a))

* fix: add uv lock git username ([`6a7a0ce`](https://github.com/tsenoner/protspace/commit/6a7a0ce2485fcf1e42993c3ae15acc59cdaeda9f))

* fix: add manual uv.lock update ([`ff1ecac`](https://github.com/tsenoner/protspace/commit/ff1ecacd2e9988211c0f3120fda920c5c16f0f98))

* fix: version command ([`763bcdc`](https://github.com/tsenoner/protspace/commit/763bcdcb3a2e4d8404d18c35cc38317a7a1f4a8d))

* fix: correct semantic-release command ([`04e69b8`](https://github.com/tsenoner/protspace/commit/04e69b8bd7a676121b9dc8b27a9ad7fc0912944a))

* fix: remove git setup ([`9199161`](https://github.com/tsenoner/protspace/commit/9199161b4d07f75e59afa317b40730b5d48c07bc))

* fix: improve uv build process ([`e022726`](https://github.com/tsenoner/protspace/commit/e02272649fed1dd41f55af12b55c409f52b8cc13))

* fix: change repository version ([`26c7dd9`](https://github.com/tsenoner/protspace/commit/26c7dd97d702f1eac3e5482d07e22e3047a87d61))

* fix: add token permissions ([`4be1dfd`](https://github.com/tsenoner/protspace/commit/4be1dfdb3fffb51cd60ddc2da330462004af9e9a))

* fix: add version ([`7432766`](https://github.com/tsenoner/protspace/commit/7432766cf3e411ad96eda64a1781e603ae5aad2b))

* fix: correct version ([`6e24853`](https://github.com/tsenoner/protspace/commit/6e2485353eac5a69f477fb3db61061d668f5b779))

* fix(scatter-plot): restore pre-data selection guard, dedupe transform

Post-merge review fixes for the interaction layer:

- Restore the pre-data guard dropped in the controller extraction: add PlotInteractionHost.hasScales() and re-gate updateSelectionMode() so enabling selection on an empty/loading plot is a no-op again (matches main).

- Make the host the single owner of the d3 transform: drop the controller's parallel _transform, add host.getTransform(); applyZoom writes via onTransform() before any in-handler read.

- Remove dead host-side lasso state (_isLassoing/_lassoVertices/_lassoPath/_handleLassoEnd/_clearLassoVisual); migrate the two unit tests to drive the live controller path. ([`833187a`](https://github.com/tsenoner/protspace/commit/833187abd6a22c281be239d5ddfa42b573c1f69d))

* fix: route Biocentral-unavailable failures to Colab

Biocentral is routinely down. When it is, `protspace embed` exits with
"No healthy biocentral service became available in time", which the prep
pipeline did not recognise, so users saw a generic "embedding step failed,
please try again" toast and kept retrying a doomed job.

- pipeline.py: add "no healthy biocentral" to _BIOCENTRAL_DOWN_PATTERNS so
  the outage timeout is classified as BIOCENTRAL_UNAVAILABLE
- notify.ts: add optional NotifyOptions.action rendered as a Sonner action
  button (mailto via location.href, http(s) via window.open new tab)
- notifications.ts: rewrite BIOCENTRAL_UNAVAILABLE copy to point to Colab and
  attach an "Open in Colab" action for that code
- fasta-prep-limits.ts: extract COLAB_NOTEBOOK_URL constant (de-dup runtime.ts)

The NotifyOptions.action shape matches the pending feat/contac_link
support-mailto design so the two merge cleanly.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ae0a681`](https://github.com/tsenoner/protspace/commit/ae0a68138945eec10990cf64e9ed0f72cf262923))

* fix(header): darken Feedback CTA on the light header for WCAG AA

The canonical brand blue #00a3e0 only reaches ~2.6:1 against the light
Explore header (#f4f4f4), failing WCAG AA (4.5:1). Make the ghost CTA
hue variant-aware: keep #00a3e0 on the dark header (~5.6:1) and use a
darker #006d96 (~5.3:1) on the light variant. Both hues are literal
class strings so Tailwinds source scan can generate them.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`21c9a75`](https://github.com/tsenoner/protspace/commit/21c9a75bc24df09830e34a683bb29407a8d55d70))

* fix(header): restyle Feedback button as an on-brand ghost

The Feedback button rendered with the shadcn default variant (solid
bg-primary #3c83f6), a different and more prominent blue than the
canonical ProtSpace #00a3e0 used in-canvas. Switch both the desktop and
mobile call sites to a no-border ghost: transparent, #00a3e0 text/icon,
faint blue hover. De-emphasized and consistent on the light and dark
headers.

Closes #283

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`b7c9fa8`](https://github.com/tsenoner/protspace/commit/b7c9fa8bb376115f153af488ce887253a81fdd26))

* fix(data-loader): split categorical values only on top-level ';'

Categorical annotation cells encode multiple hits as
"accession (name)|score" joined by ';', but a name can itself contain
';' (e.g. CATH-Gene3D "Ribosomal Protein L15; Chain: K; domain 2"). The
naive split(';') shattered a single hit into bogus categories such as
"domain 2)" and "Chain: K". Split only on ';' at parenthesis depth 0 so
each (name) stays intact, falling back to a plain split for the rare
name with an unbalanced '(' so distinct hits are not merged.

This repairs already-distributed bundles; sanitizing the names at the
source is tracked in tsenoner/protspace#56.

Closes #282

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`5db65f2`](https://github.com/tsenoner/protspace/commit/5db65f2c6c1b4cffe16d6248447dc7bb2ee10200))

* fix(legend): persist per-annotation category visibility across switches

Switching annotations called clearPersistedLegendHiddenValues, which
rewrote the previous annotation's legend localStorage entry to an empty
hiddenValues array, so hidden categories reappeared on switch-back. The
core legend already persists and restores hiddenValues per datasetHash +
annotation, so remove the clearing call and its now-dead plumbing
(the persisted-legend controller, its runtime wiring, and the
lastKnownAnnotation tracking it required).

The demo still resets on a full reload via the separate
clearForNewDataset path, so it always returns to its original state.

Closes #281

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`91df768`](https://github.com/tsenoner/protspace/commit/91df7681b14f185972dbc57c4fd2a07b31a685ed))

* fix(security): upgrade jspdf 3→4 to clear critical PDF advisories

jspdf 3.0.x carried 2 critical (Local File Inclusion / Path Traversal,
HTML Injection) and 6 high advisories, plus a vulnerable transitive
DOMPurify. Bumping to 4.2.x drops production advisories from 38 to 12
(no criticals, no jspdf/DOMPurify entries remain).

The only APIs used (constructor opts, setProperties, addImage, save) are
unchanged in v4; the code already imports via dynamic ESM. All 294 utils
tests pass and the build is clean.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`14fa0d8`](https://github.com/tsenoner/protspace/commit/14fa0d8b94e634f0dc23d8d22059e724236de2c5))

* fix(legend): reflect a query filter the same way as isolation

A query filter is a constrained view like isolation: the legend should show
the kept set's counts, not the full dataset. getIsolationState() now reports
an active filter as a constrained view, appending filteredProteinIds as a
history layer (intersecting with any real isolation layers), so the legend's
existing isolation path runs identically for filters.

Verified in-browser that filtering and isolating to the same protein set
produce identical legends, and that clearing the filter restores the full
legend.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`2c8ff75`](https://github.com/tsenoner/protspace/commit/2c8ff75ec569b160189bba03ca0a1ea0f27c469b))

* fix(control-bar): harden query evaluation and apply gating

- Empty group now evaluates as a match-all no-op instead of the empty set
  that AND-killed the whole query (count 0, Apply disabled).
- Apply is gated when the result matches every protein (e.g. a configured
  condition OR'd with an empty one), which would filter nothing.
- Removing the first condition clears a leftover leading AND/OR that the
  first-row operator select cannot display; NOT is preserved.
- Document the numeric null-under-NOT asymmetry (no live impact today).

Addresses code-review findings on the filtering refactor.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`f0e7949`](https://github.com/tsenoner/protspace/commit/f0e79498bbca8afff8fa0ca4481da64b76b9a55d))

* fix(control-bar): match multi-label proteins on ANY label in filters

Categorical filter matching and value-picker counts only inspected each
protein's FIRST annotation label (getFirstAnnotationIndex). A protein
labeled [A, B, C] resolved to just A, so filtering for B or C silently
dropped every multi-label point whose primary label differed — e.g.
'domain is A AND domain is B' returned nothing instead of the points
carrying both.

Add resolveAnnotationInternalValues, which reads ALL of a protein's
labels (getProteinAnnotationIndices), normalizes and dedupes them, and
falls back to ['__NA__'] for unlabeled proteins / missing columns. Route
evaluateCondition and the value picker's count map through it so a
protein matches when ANY of its labels is selected — consistent with the
legend and visibility-model semantics. Pin the behavior with a
multi-label test suite. ([`47bcdfb`](https://github.com/tsenoner/protspace/commit/47bcdfb6e9f2824d77eef81b30632a7d2e7373b0))

* fix(control-bar): keep Apply disabled for all-no-op filter queries

A freshly opened filter popover seeds one unconfigured condition, which
evaluates as a match-all no-op. Apply gated only on matchedIndices.size,
so this seeded query could be applied — lighting up the filter-active
badge without filtering anything. Gate Apply on hasConfiguredCondition
instead, and guard _handleApply for callers that bypass the click path. ([`9d46c63`](https://github.com/tsenoner/protspace/commit/9d46c634b9d25b1af901b5dc8dd59991bfba0bc8))

* fix(scatter-plot): rebuild plot data when an active query filter is cleared

Reset All clears filteredProteinIds/filtersActive, but _processData's
coordinate-only fast path guarded on the NEW filtersActive value (already
false) rather than on whether the current _plotData was built culled. The
culled points were therefore never restored: the legend (fed from
getCurrentData(), which reads the cleared filter state) updated while the
canvas kept rendering the filtered subset.

Track _plotDataWasCulled on every rebuild and exclude culled builds from
the fast path, mirroring the invariant resetIsolation() already enforced
manually via _lastDataRef = null. ([`8948bf4`](https://github.com/tsenoner/protspace/commit/8948bf43f4cb9a60720aaab4889ebac969f474f4))

* fix(scatter-plot): keep global originalIndex under a query filter (#257 follow-up)

Routing query filters through the filteredProteinIds channel (df07c96) exposed a
latent rendering bug. _processData built _plotData from _getCurrentDisplayData(),
which COMPACTS the matched subset, so each PlotDataPoint.originalIndex became a
slice-local 0..N index. But the style getters (_buildStyleGetters uses the full
materialized data) and the tooltip path (this.data) resolve annotation values by
originalIndex against the FULL dataset. For any non-prefix filter (e.g.
protein_family=X, which keeps a scattered subset) every kept point was painted
with the WRONG protein's colour/shape/opacity and showed the wrong tooltip — and
points whose mis-resolved value was legend-hidden vanished. The channel was
dormant before df07c96, so query-apply is what first made this reachable.

Fix: build _plotData from the full materialized data and apply the matched-id
set as a membership filter AFTER the map (a new optional `visibleProteinIds` arg
on DataProcessor.processVisualizationData), exactly as isolation already does, so
originalIndex stays a GLOBAL index. The style getters and tooltips — both written
for global indices — now resolve correctly with no change. The fast path is
gated off whenever a filter is active (it already rebuilt every time under the
old slice-by-reference approach, so no perf change). getCurrentData()/data-change
keep slicing for the legend and export, which want the filtered protein list.

Add scatter-plot.filter-render.test.ts pinning per-point colour for a non-prefix
filter, plus the prefix and unfiltered cases. ([`3d55218`](https://github.com/tsenoner/protspace/commit/3d55218956144aae3688efe1d4f596ee36c7139a))

* fix(control-bar): make numeric filtering reachable and consistent under NOT

Three numeric-filter correctness fixes:

- `_selectAnnotation` keyed on `kind === 'numeric'`, but the currently-coloured
  numeric annotation is materialized to `kind:'categorical'` (it keeps
  `sourceKind:'numeric'`), so picking it offered a categorical bin picker instead
  of the numeric range input. Use the shared `isNumericAnnotation()` so a numeric
  annotation is filtered numerically whether or not it is currently materialized.

- An unconfigured numeric condition evaluated to the empty set, so NOT-wrapping it
  isolated EVERY protein (complement of nothing) while Apply stayed enabled —
  asymmetric with an empty categorical condition. Treat an unconfigured numeric
  condition as a no-op (matches all), mirroring categorical, so `NOT(unconfigured)`
  matches nothing and Apply stays disabled.

- Switching operator left the now-hidden bound populated; switching back silently
  resurrected it and re-constrained the filter. Null the unused bound on operator
  change.

Also give the operator select and min/max inputs accessible names (aria-label),
and add component tests for the controlled round-trip, operator switch, numeric
NOT-symmetry, and annotation kind detection. ([`98effa7`](https://github.com/tsenoner/protspace/commit/98effa7790712e2a439c9171f4b8e2cd0abf8fd1))

* fix(control-bar): apply filter query via filteredProteinIds channel (#257)

The query builder evaluates against the full materialized dataset, but
`_handleQueryApply` mapped the matched indices through `getCurrentData()` — the
isolated subset after a prior apply — then stacked another `isolateSelection()`
layer. Re-applying the same query resolved wrong/undefined ids and shrank the
result each time (546 -> 19 -> only fading): the open #257 report.

Route the query through the dedicated, idempotent `filteredProteinIds` /
`filtersActive` channel the scatter plot already consumes, mapping indices
through `getMaterializedData()` so they align with the array the query was
evaluated against. A filter is no longer a selection or an isolation:
re-applying is a no-op, manual isolation is left untouched, and the dead
`isolate-data` / `reset-isolation` dispatches are dropped.

Clear the filter on dataset swap (scatter-plot `updated()`, `applyPlotState`,
and the control-bar data-change handler) so a stale filtered-id set can't blank
the new plot or leave a stale Filter badge. Relabel "Apply & Isolate" ->
"Apply Filter".

Add control-bar.query-apply.test.ts pinning the idempotent-apply / reset /
no-isolation contract. ([`7727af2`](https://github.com/tsenoner/protspace/commit/7727af25a825452279409e683c198cb5e8d27fac))

* fix(control-bar): clear value picker on annotation switch + cover numeric exclude path ([`068d1df`](https://github.com/tsenoner/protspace/commit/068d1df64fe7e2b1d775bb99a29b4346fb16ed3c))

* fix(annotations): fit the dropdown menu to its content instead of the trigger width

The menu was pinned to the full width of the "Annotation" trigger button (~489px)
via the shared dropdown mixin, and the row's flex-grow label stretched to fill it —
leaving a ~295px empty gap before the right-aligned visibility toggle (obvious once
the ⓘ moved to the left). Override the width at `.dropdown-menu.align-left`
specificity (needed to beat the mixin's matching rule) so the menu hugs the widest
annotation row (~258px), with a 16rem floor for the search box and a viewport-safe
cap. The toggle now sits ~8px after the label. The popover is `position: fixed`, so
it is unaffected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`2843af1`](https://github.com/tsenoner/protspace/commit/2843af1935f2ba54b8d9514f4a96e9c5e780c4fb))

* fix(annotations): anchor the dropdown info popover beside the panel so row names stay visible

The side popover sat immediately left of the ⓘ icon, which is over the row's label
— you couldn't see which annotation the summary described while moving over the
icons. Anchor it to the dropdown panel's clipping edge instead, so the bubble
floats entirely outside the list: every row's name stays visible as you move up and
down the column of ⓘ icons, and the arrow points at the row.

Because the bubble is now across the panel from the icon, extend the keep-open
region from the icon to the whole row (the popover is a DOM descendant of it), so
the user can still glide from the ⓘ into the bubble to click "Learn more" — only
the small panel↔bubble gap relies on the close grace. Verified with real pointer
movement: open on hover, stay open while gliding in, "Learn more" reachable, one
bubble at a time while scanning, labels always visible.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`a4a5fe9`](https://github.com/tsenoner/protspace/commit/a4a5fe9c2e99c5a7d89b14c5f857267fc498c753))

* fix(annotations): float the dropdown info popover beside the icon, not over the list

The ⓘ summary popover opened below the icon, so it covered the next dropdown rows
(and was clipped by the menu's overflow) — moving the pointer down to the next
annotation landed on the bubble instead of the row.

Add a `placement="side"` mode to the info popover: it renders `position: fixed`
(escaping the dropdown's `overflow` clipping) to the left of the icon, vertically
centred, with an arrow pointing back at it; it flips to the right and clamps to the
viewport when there's no room, and repositions on scroll/resize. This keeps the
icon column clear so downward navigation hits the next row, while the popover stays
hoverable for the "Learn more" link. The legend keeps the default `bottom`
placement.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`097f64d`](https://github.com/tsenoner/protspace/commit/097f64d3456af71b179fd3b981bcc10d3f225fd3))

* fix(annotations): correct docs link base and keep info popover in-bounds

The "Learn more" links pointed at /guide/annotations… but the VitePress
docs site is mounted under /docs/, so they 404'd. Prefix the registry's
docsUrl with /docs/.

The dropdown info popover opened rightward and spilled outside the
dropdown panel. Add an `align` option to the popover (the dropdown uses
align="right" to open leftward) plus a viewport-overflow flip safety net,
and cap its width to the viewport.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`fea7f54`](https://github.com/tsenoner/protspace/commit/fea7f543a902b2e57b739b25264d3a49146832b1))

* fix: point prod build at prep backend to fix upload 405 (#278) ([`0be3b0a`](https://github.com/tsenoner/protspace/commit/0be3b0aaadd026b4c8a8f6a14d2ab3f128745dfe))

* fix(perf): readiness gate accepts SoA PlotData container (MODEL-O1 follow-up)

_waitForHostFullyLoaded gated on Array.isArray(host._plotData), which is always
false now that _plotData is a PlotData SoA object (4b7e9ef) — the 573K perf run
timed out after 10min. Gate on the container's numeric `length` instead. The cast
is `any`-typed so type-check could not catch it. Harness-only; the product
load/render path was unaffected (verified: `page errors: []`, run passes in 60s). ([`7b7683a`](https://github.com/tsenoner/protspace/commit/7b7683a758218570457b25c128612c044ea4a97f))

* fix(search): cap suggestions + debounce input to prevent 573K-node DOM explosion (INT-search)

Replace unbounded O(N) filter with an early-exit scan capped at 50 suggestions,
and debounce per-keystroke recomputes by 120 ms. Extracts pure helper
`computeSearchSuggestions` with full unit-test coverage. ([`8048bf4`](https://github.com/tsenoner/protspace/commit/8048bf4a44f2fd6e2117eb8abbaabb95f220114b))

* fix(explore): make FASTA-prep SSE resilient to transient disconnects

A native EventSource error (network blip, proxy timeout, tab throttle) carries
no data; the handler treated it as terminal and closed the stream, killing
auto-reconnect and orphaning the still-running backend job. Now: server error
frames (with JSON data) reject; CLOSED reconnect-exhausted rejects; transient
CONNECTING errors let EventSource reconnect within a bounded budget. Also guard
queued/progress JSON.parse, validate done.download_url, and map bundle 409/410.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`2b20488`](https://github.com/tsenoner/protspace/commit/2b204884b34dbad5f4c0a1e77e7127c699296224))

* fix(protspace-prep): key rate limiter on proxy-resolved client IP

client_key parsed the raw X-Forwarded-For header itself, bypassing uvicorn's
proxy-headers trust entirely. Switch to request.client.host, which uvicorn
resolves from XFF only for peers in FORWARDED_ALLOW_IPS (the firewalled private
LAN subnet). The trust boundary is now enforced in-process instead of trusting
a spoofable header.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`dd9e94e`](https://github.com/tsenoner/protspace/commit/dd9e94e51511c63ca0e80ed89f049633deb33e60))

* fix(protspace-prep): emit Retry-After on 429 and harden rate-limit tests

Enable headers_enabled=True on the Limiter and inject Response into the
submit endpoint so slowapi can write rate-limit headers (Retry-After,
X-RateLimit-*) on 429 responses.  Change test windows from /minute to
/hour to eliminate fixed-window boundary flakiness, add a fixture comment
explaining env-var ordering, and add a new test asserting Retry-After is
present on 429.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`c4ebf04`](https://github.com/tsenoner/protspace/commit/c4ebf04453225606cd6f3d03ced055ba272eb7a0))

* fix(protspace-prep): fall back to default when PREP_RATE_LIMIT is blank

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`d6f44e5`](https://github.com/tsenoner/protspace/commit/d6f44e54aa34cce78d23c4a9bf1b988bc7834d6a))

* fix(protspace-prep): address review nits in prep backend

- bundle: defer mark_consumed + unlink to a post-stream BackgroundTask so a
  failed mid-stream download leaves the job retryable instead of 410
- config: drop unused biocentral_endpoint field (loaded, never read)
- config: align PREP_SEQUENCE_MIN_COUNT default (1 -> 20) with docker-compose
  and document it in the README; pin min=1 in tests that exercise other gates
- README: note in-memory JobRegistry does not survive container restart

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`93a14d3`](https://github.com/tsenoner/protspace/commit/93a14d385dcc68595a6e33f6c3f7f92907346a2b))

* fix: review comments ([`1b9d593`](https://github.com/tsenoner/protspace/commit/1b9d593d4509331f080254cc053b5934fd77f666))

* fix(tests): set working directory for Playwright e2e tests ([`af6655d`](https://github.com/tsenoner/protspace/commit/af6655d47fc18346fc1a47daaec309d56c141c37))

* fix(explore): advance FASTA prep progress bar across the 5 stages

Progress was hard-coded to 25% for every onProgress event, so the bar
froze for the entire pipeline. Map each stage (queued/embedding/
annotating/projecting/bundling) to its own percentage and clamp with
Math.max so out-of-order events can never roll the bar backwards.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`fe16d66`](https://github.com/tsenoner/protspace/commit/fe16d668f379e853c47bb370533ea42f6700f65b))

* fix(prep): normalize FASTA headers so annotations actually attach

embed/project keyed projections_data.identifier by the raw FASTA header
(sp|P12345|NAME_HUMAN) while annotate ran the same header through
parse_identifier (P12345). The frontend bundle join in
data-loader/utils/bundle.ts joins on projection.identifier, so for any
UniProt FASTA every lookup missed and annotations silently dropped.

Run both subprocesses against an input.normalized.fasta whose headers are
already passed through protspace's parse_identifier, so both downstream
tables agree on a single key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`8f0f9dd`](https://github.com/tsenoner/protspace/commit/8f0f9dd2dfd875290f93f7992a9d2a4d13ef8757))

* fix(core): surface loadFromFileHandler errors via data-error event

When a consumer-supplied loadFromFileHandler rejected, the rejection
propagated to the caller but the data-loader never updated its `error`
property or fired `data-error`, so listeners (the explore runtime in
particular) had no signal to drop the loading overlay. Catch handler
errors at the boundary, set `this.error`, and dispatch `data-error`
with the original Error so existing listeners can branch on
`originalError.name === 'AbortError'` cleanly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`9365be2`](https://github.com/tsenoner/protspace/commit/9365be2922e696b4e93d74fc6bb6169541fafd7c))

* fix(prep): keep SSE stream alive across keepalive timeouts

The previous keepalive loop wrapped each `aiter.__anext__()` in
`asyncio.wait_for`, which cancels the inner coroutine on timeout. That
cancellation exhausted the underlying async generator, so the first
keepalive frame silently truncated the stream and the EventSource client
fired an error event surfacing as "Bundle preparation failed."

Hold a single in-flight `__anext__()` task across keepalive ticks via
`asyncio.shield`, only creating a new one once an event has been
delivered. Regression test now asserts the stream keeps flowing past the
keepalive boundary and still delivers `event: done`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`aaf7341`](https://github.com/tsenoner/protspace/commit/aaf7341f2959f0005eac83c93d002248b96f334c))

* fix(explore): remove AbortSignal listener after FASTA prep completes

Extract abort handler to a named function so cleanup() can call
removeEventListener, preventing listener accumulation when the same
AbortController is reused across multiple prepareFastaBundle calls.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`571dc5e`](https://github.com/tsenoner/protspace/commit/571dc5e05d43bc81295319118b1e7caeb6d53e72))

* fix(prep): address review findings (header injection, SSE keep-alive, races)

- Fix 1: sanitize Content-Disposition filename via _safe_download_name()
  to prevent header injection from hostile original_name values
- Fix 2: add SSE keep-alive comment frames every _KEEPALIVE_INTERVAL_SECONDS
  (15 s default, monkeypatchable) using asyncio.wait_for on the subscribe iter
- Fix 3: register subscriber queue BEFORE yielding the synthetic queued event
  so terminal events published during the yield cannot be missed
- Fix 4: send None sentinel to all live subscriber queues in sweep_expired()
  before popping _subscribers, preventing indefinite hangs
- Fix 5: catch asyncio.CancelledError in _run(), publish error event, set
  ERROR status, then re-raise so cancellation propagates cleanly
- Fix 6: use peek_bundle/mark_consumed split so consumed flag is only set
  after a successful path.read_bytes(); OSError surfaces as HTTP 500
- Fix 7: register atexit handler in conftest.py to clean up the mkdtemp dir
  after the test session (previously leaked on every run)

New tests: 14 added (47 total, was 33). All pass.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`d68bef9`](https://github.com/tsenoner/protspace/commit/d68bef96372658cdd1ab8e9c6d14213351167753))

* fix: measure tooltip height after child render; estimate as fallback

The <protspace-protein-tooltip> child LitElement renders its content one
microtask AFTER the parent scatter-plot's updated() runs (verified empirically),
so reading el.offsetHeight synchronously in updated() returned the previous (or
empty, on first hover) content height. The bottom-edge clamp then used a wrong,
usually-too-small height and tall multi-annotation tooltips could run off the
bottom of the viewport.

Measure after the child's updateComplete resolves, guarded by a monotonic token
that discards superseded/cleared measurements. Replace the magic 160px fallback
used before the async measurement lands with a content-scaled estimate
(estimateTooltipHeight) derived from the tooltip view model — a pure, CSS-
calibrated, unit-tested helper biased toward over-estimating (the safe direction
for clamping) and floored at the prior 160. The previous commit's
changedProperties.has('_tooltipData') guard is preserved, so zoom/pan/selection
updates still skip the offsetHeight reflow. ([`5016164`](https://github.com/tsenoner/protspace/commit/5016164058eb95a6cab189ddf71cd15455ba18a2))

* fix: restore per-dataset tooltip memory on dataset import

The tooltip restore block ran only when the URL had no tooltip= param. But
latestViewRequest reflects the browser URL, which is not reset on a file import,
so importing a different dataset (B) while the URL still carried dataset A's
tooltip= param left present.tooltip=true and suppressed B's own saved tooltip
set — B silently inherited A's stale tooltip request.

Branch on loadMeta.kind: an active user import of a *subsequent* dataset now
ignores the stale URL tooltip param and restores that dataset's own persisted
set (rewriting/clearing the URL to match), while initial page loads, refreshes,
and OPFS restores keep URL-wins behavior. A first-ever file drop (no previous
dataset) is gated out via hadPreviousDataset so a shared ?tooltip= link is still
honored, consistent with the annotation/projection params. ([`f537269`](https://github.com/tsenoner/protspace/commit/f53726947f310b86a777ccf0786ec179c90a3d0e))

* fix: persist tooltip annotations under correct dataset hash on switch

The view-change subscription that persists tooltip annotations is keyed by
currentDatasetHash. On a dataset switch A->B, the "restore persisted tooltip"
block calls viewController.setRequestedView(), which synchronously emits a view
change — but currentDatasetHash was assigned the new hash only after that block.
So the restore's emit wrote dataset B's tooltip set into dataset A's localStorage
key, silently corrupting A's saved preference.

Move the currentDatasetHash assignment above the restore block so both the
restore emit and applyLatestViewForDatasetLoad persist under the correct hash. ([`12cd578`](https://github.com/tsenoner/protspace/commit/12cd5781f400e47ba4310ab07f45d449c652363c))

* fix(app): scope fluid root font-size to viewports >=1380px

Untested below the verified 1440-1920px range, the clamp() shrank
1rem to 12px on smaller viewports (incl. the 1280x720 Playwright
config), affecting all rem-based sizing across the app.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`61ff80c`](https://github.com/tsenoner/protspace/commit/61ff80ca4d87cb87e240942c535b7c21f7a9e735))

* fix(scatter-plot): keep spider anchored to the clicked point on pan/zoom

_toggleSpiderfy previously wrote the click anchor directly onto the
current stack object's x/y/px/py. _duplicateStackByKey rebuilds with
fresh objects on every viewport recompute, so any pan or zoom while
the spider was open snapped the anchor back to whichever group member
the iterator happened to encounter first.

Store the anchor separately as { stackKey, x, y } on the component
and reapply it inside _ensureDuplicateStacksForViewport after each
rebuild. The reapply is guarded by stackKey match, so stale anchors
from a previously-closed stack stay inert. ([`2c50aef`](https://github.com/tsenoner/protspace/commit/2c50aef221fae477464b42bd4dc1af745673f86f))

* fix: reset button was remaining after loading default dataset if the points were isolated ([`b7dcc82`](https://github.com/tsenoner/protspace/commit/b7dcc8217dad9ba5efc7cc975bcd8d4dd4937b92))

* fix(docs-screenshots): repair legend GIFs, add click-type labels

- legend-toggle.gif: helpers clicked the wrong DOM node (the wrapper
  `.legend-item` div); the @click/@dblclick listeners live on the inner
  `.legend-item-main` button, so toggles never fired. Now targets the button.
- legend-others.gif: reducing maxVisibleValues sorted N/A into Other under
  size-desc (lowest count). Route through `_handleMergeToOther` for two
  specific non-N/A categories so N/A keeps its top-level slot, matching the
  default layout in the other GIFs.
- New `showActionLabel` helper renders a transient blue pill anchored
  above the click point. Wired into legend-toggle (Click / Double-Click)
  and select-single (Click / ⌘+Click). ([`1c429d3`](https://github.com/tsenoner/protspace/commit/1c429d3d010234ca57dfe6f808146b7f742f8def))

* fix(scatter-plot): make export-time margin scaling reproducible

`createExportScales` and `getRenderInfo` scaled their margins by
`exportSize / config.{width,height}`, where `config.width/height`
track `clientWidth/clientHeight` via the ResizeObserver in
`scatter-plot.ts:902-956`. So the captured plot's data → pixel
mapping shifted with browser-window resizes — same data landed
~3-4% off between common window sizes.

For the publish modal this meant overlays placed at one window
size drifted relative to clusters when re-rendered later: the
overlay normalised coords are saved against a plot rect that the
buggy renderer then re-derived against a *different* margin.

Fix: anchor margin scaling to a fixed reference (800×600, matching
the existing fallback convention), so export geometry is now a
pure function of `(exportWidth, exportHeight, data, transform)`.
`getRenderInfo` uses the same reference so inset → data-domain
inversion stays consistent with `createExportScales`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`7524c98`](https://github.com/tsenoner/protspace/commit/7524c982f926461ff6903506e0e4d1f17ebefd85))

* fix(publish): keep editor open when export fails ([`8321142`](https://github.com/tsenoner/protspace/commit/832114274afaf7bce404cbff1409413e10f42ee2))

* fix(publish): handle null 2D context in composeFigure ([`30cc3f2`](https://github.com/tsenoner/protspace/commit/30cc3f2dd5c80ebea3933be6fc435353c1893bf0))

* fix(publish): preserve HiDPI source resolution in capture fallback ([`6f8f18a`](https://github.com/tsenoner/protspace/commit/6f8f18aa315f6eb6037a408e575d27bd6f71b822))

* fix(publish): align sizeMode with applied preset ([`26cfc95`](https://github.com/tsenoner/protspace/commit/26cfc95c3771790b38e2d0ece7ea6e9a4e771a73))

* fix(publish): guard _setupOverlay against post-disconnect resolution ([`e74aae3`](https://github.com/tsenoner/protspace/commit/e74aae3d33487477f5cf8412153a06ba848329bc))

* fix(publish): bypass inset render fast-path during export ([`c718f25`](https://github.com/tsenoner/protspace/commit/c718f257b4290dab1b9e304046bcb08a48ff17a1))

* fix(publish): include background color in plot cache key ([`eed8287`](https://github.com/tsenoner/protspace/commit/eed8287ec26506c84a6d81b6119628fe0d52dbc6))

* fix(utils): sanitize publishState at parquet ingest boundary ([`92270bf`](https://github.com/tsenoner/protspace/commit/92270bf22389dfb521a424de62d058c7f79e99ff))

* fix(publish): clamp NormRect overrun and cap label text length ([`ca81d69`](https://github.com/tsenoner/protspace/commit/ca81d697d0f430f069963ecda324ea109913d1d0))

* fix(utils): harden pngWithDpi against non-PNG and malformed input ([`276bf4b`](https://github.com/tsenoner/protspace/commit/276bf4b40f3daf849d1faaff776a4427bccabbff))

* fix(publish): construct figure-editor modal via createElement

new ProtspacePublishModal() bypassed the customElements registry, so
after Vite HMR re-evaluated publish-modal.ts the import handed back a
class object that was no longer registered for the tag — the next
"Open Figure Editor" then threw "Illegal constructor" and surfaced as
an Export failed toast. createElement routes through the registry,
matching every other custom-element mount in the app. ([`9231694`](https://github.com/tsenoner/protspace/commit/9231694156fc999e9dd8ae2de4dffd6e5074b2e8))

* fix(publish): use safe-custom-element wrapper + shorten export label

Switch publish-modal to the HMR-safe customElement wrapper used by every
other component, so duplicate-loaded chunks don't throw "the name
\"protspace-publish-modal\" has already been used with this registry"
and surface as an "Export failed" toast on a second open. Add a vitest
that walks src/components and fails if any @customElement-using file
imports the decorator from lit/decorators.js directly.

Also shorten the action-row Export button to "Export" (with a
format-aware tooltip) so it fits its dedicated slot. ([`a5d0e67`](https://github.com/tsenoner/protspace/commit/a5d0e67ff8cc55be937e52f4a499d6faf9428956))

* fix(publish): render chain icon via single svg + css toggle

Replace the buggy nested html\`...\` inside the SVG (which broke SVG
namespace rendering) with a single SVG containing both locked/unlocked
<g> groups toggled by CSS display rules; add regression test. ([`b50c34a`](https://github.com/tsenoner/protspace/commit/b50c34ad5cb6ccfbf3b770feed7a491e87efbe9f))

* fix(publish): guard Px helpers, parity tests + JSDoc cleanup

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`316efa4`](https://github.com/tsenoner/protspace/commit/316efa486a83d2d3d4486a99a4ddb53004fde4c4))

* fix(bundle): preserve publishState through normalizeBundleSettings

Happy path silently dropped publishState; only the legacy fallback branch
kept it. ([`2d7f3ed`](https://github.com/tsenoner/protspace/commit/2d7f3ede6e965137b48dffcce0d3f89fa00054ec))

* fix(load-reliability): docs anim script reads via lazy accessor; trim dead guard

C1: capture-animations.spec.ts page.evaluate now reads annotation values
from plot.data.annotation_data via originalIndex, since PlotDataPoint no
longer carries annotationValues.

I1: simplify _refreshSelectedAnnotationValues guard now that the lookups
no longer feed a per-point loop. ([`0c8bc83`](https://github.com/tsenoner/protspace/commit/0c8bc83271be9a404d20972490e91be6a5872b99))

* fix(numeric-binning): null selection materializes nothing

Previously a null selectedNumericAnnotation matched every numeric
annotation, eagerly binning all of them on first render. Now it
materializes none — only the explicitly selected annotation is binned.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`8f13292`](https://github.com/tsenoner/protspace/commit/8f13292e16ea9e5bbb93a729b89734fe8f0baea5))

* fix(explore): symmetric error guard, banner focus, more tests

Address review feedback on PR #240 and unblock CI:

- dataset-controller only writes OPFS error status when the failed load
  was a user/opfs load (mirrors handleDataLoaded). Prevents a default
  load failure from being mis-attributed to the persisted file.
- recovery-banner moves focus to the primary action on mount, and labels
  the disabled retry button with the reason. Improves keyboard a11y.
- Playwright covers the error state (with lastError surfaced) and the
  Clear stored data click handler end-to-end.
- Reformat design doc with Prettier (was failing format:check).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`82c3e5b`](https://github.com/tsenoner/protspace/commit/82c3e5b721df32c5bd79d2455d6f8125ae2e1607))

* fix(opfs): only increment failedAttempts on consecutive pending transitions

Spec defines failedAttempts as a streak counter for unfinalized loads,
not a total-transitions counter. success → pending must not increment
(user retrying a healthy dataset). Adds tests for the missing case
and for the no-prior-metadata no-op path. Adds a comment on the
non-atomic read-modify-write inside markLastLoadStatus.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`fc502a3`](https://github.com/tsenoner/protspace/commit/fc502a3102c691047c947fe4e8f58d20d22db5ba))

* fix(legend): keyboard-reorder Escape robust to focus loss + helper exact-match

Two surgical fixes that came out of fixing the numeric-binning Playwright suite:

* `_handleDragHandleKeyDown`'s Escape branch only fires while focus stays on
  the dragged item's handle, but Lit re-renders during ArrowDown can briefly
  move focus to <body> before the rAF focus restore lands. The window-level
  capture-phase Escape handler now also cancels active keyboard reorder, so
  cancel works regardless of focus state. The handler is registered when
  `_keyboardDragValue !== null` (alongside the existing dialog/picker cases),
  so keyboard reorder + Reset + dialog flows all share the same Escape path.
  This also fixes the N/A pinning intermittency when resetting numeric bin
  count on a column with missing values.

* `selectAnnotation` test helper used `hasText: annotation` (substring,
  case-insensitive) which collided when one annotation name was a substring
  of another in the new ToxProt 2025 demo bundle (e.g. "ec" matching
  "species"). Switched to anchored regex with whitespace tolerance so the
  filter lands on the exact dropdown row.

* `loadDemoDataset` switched from `'ec'` to `'order'` because the demo
  bundle ships `ec` with a curated `sortMode: "manual"`, which doesn't fit
  the "keeps non-manual sorting" assertion in the categorical keyboard
  tests. `'order'` is a clean Taxonomy categorical (18 values, no NAs) and
  uses the default size-desc sort.

Closes #230

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`75f2786`](https://github.com/tsenoner/protspace/commit/75f27862676d7e586b9d652bb4e76d82da0001a6))

* fix(data-loader): append synthetic __NA__ category for missing categorical cells

Mirror materializeNumericAnnotation's pattern in the three categorical
conversion paths (convertBundleFormatData, extractAnnotationsOptimized,
convertLegacyFormatData): when any cell has no real values, append a
single NA_VALUE entry to annotation.values with NA_DEFAULT_COLOR + circle,
and point every empty annotation_data cell at it.

Without this fix, missing-value proteins silently vanish from the legend
after the prior commits' normalization work — they have no row to toggle,
color, or count. With it, all missing-value proteins land in a single
"N/A" legend row, completing the spec's headline behavior:

  Categorical column ["red", null, "NA", "blue", "", "None", "n/a"]
  → 3 legend rows: red, blue, N/A (covering the 4 missing entries)

Also update docs/guide/data-format.md to describe the new contract and
the strict missing-value set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`c8d6133`](https://github.com/tsenoner/protspace/commit/c8d61337579852744555a79587a36c8b5b90f7bb))

* fix: resolve merge conflicts from amend

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d533db7`](https://github.com/tsenoner/protspace/commit/d533db73febaa848ef7a1fedd7c10899792f2cc9))

* fix(numeric): fall back quantile to linear for sparse distinct values

Quantile bin edges collapse when distinct values <= binCount (e.g.,
binary 0/1 data produces a single "0 - 1" bin). Auto-fall back to
linear binning in these cases while keeping quantile as the default
for continuous data with many distinct values.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`8100d4a`](https://github.com/tsenoner/protspace/commit/8100d4a8b06cad407ca1e47fc10dc78771d982b7))

* fix(numeric): fall back quantile to linear for sparse distinct values

Quantile bin edges collapse when distinct values <= binCount (e.g.,
binary 0/1 data produces a single "0 - 1" bin). Auto-fall back to
linear binning in these cases while keeping quantile as the default
for continuous data with many distinct values.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`05eed3b`](https://github.com/tsenoner/protspace/commit/05eed3bf3848bbc6057ae5f29fc8a4e97faad5c6))

* fix(legend): remove manual annotation type override ([`2cc1503`](https://github.com/tsenoner/protspace/commit/2cc15033224aad5a88f36ad0ec089151f5d700da))

* fix(legend): prevent numeric override save loops ([`10bf0f8`](https://github.com/tsenoner/protspace/commit/10bf0f8fb16d9f849d218b9a1c143606f7e74e7a))

* fix(legend): restore auto numeric source settings ([`d889887`](https://github.com/tsenoner/protspace/commit/d88988714b45ded8e69d25281b8884eb27ccb815))

* fix(legend): normalize override sort persistence ([`e414094`](https://github.com/tsenoner/protspace/commit/e414094879c37cbafa7d7cf6556f20500b902156))

* fix(legend): normalize override dialog state ([`cff6514`](https://github.com/tsenoner/protspace/commit/cff6514c4245e1202c69426a20642f0738fb853c))

* fix(legend): derive settings from type override ([`675678a`](https://github.com/tsenoner/protspace/commit/675678ad0522b2ba9572fa861beaff3d60a46bfe))

* fix(annotation): reject scored numeric overrides ([`263a199`](https://github.com/tsenoner/protspace/commit/263a1998b6439173f81f7c52faeeb19f957c4595))

* fix(legend): preserve annotation type override settings ([`926f157`](https://github.com/tsenoner/protspace/commit/926f1577ee45ed7684a3937465274033fcf12cb0))

* fix(numeric): preserve tiny float display precision ([`b283f0c`](https://github.com/tsenoner/protspace/commit/b283f0cdd46582a8638635c069f819e517671c9f))

* fix(numeric): format labels by inferred subtype ([`052cc3c`](https://github.com/tsenoner/protspace/commit/052cc3ccf3f8753d2cd0ec97f06a865e8de5de08))

* fix(loader): avoid duplicate numeric parsing ([`f9f8803`](https://github.com/tsenoner/protspace/commit/f9f88036e1cf3551b4cf9ced4c95365603a1ceb5))

* fix(loader): infer numeric annotations from all values ([`af72cc5`](https://github.com/tsenoner/protspace/commit/af72cc5600dbc4e4fbb12d390f2cad0ae4c8a0ba))

* fix(explore): keep structure errors inline ([`3122137`](https://github.com/tsenoner/protspace/commit/3122137b579d0f5dee369ada2909a96bd6bccd84))

* fix(explore): remove structure error notification mapper ([`a823830`](https://github.com/tsenoner/protspace/commit/a823830526bbcb01a2d4031e3e4facb79d65d373))

* fix(publish): cast through unknown for stub legend element

HTMLDivElement → HTMLElement & { getLegendExportData } is a no-overlap
cast in TS strict mode; the IDE/LSP flagged it even though tsc let it
through. Routing through `unknown` makes the intent explicit. ([`934402a`](https://github.com/tsenoner/protspace/commit/934402a00ab994ebaf3db5c983a7e7947eadad3b))

* fix(publish): clamp capture size and await font readiness

- clampCaptureSize prevents canvas dimensions or area from exceeding
  browser limits (16384 px / ~268M px) when boosted captures are scaled
- waitForFonts ensures webfonts have loaded before compositor fillText
  so exports never silently fall back to a system font

Refs PR #232 review #6, #8 ([`ce18012`](https://github.com/tsenoner/protspace/commit/ce18012fcd34eb97ab75db4f3d197c2ea1b3f2a3))

* fix(publish): pointer-capture lifecycle and unclamped handle drag

- handle pointercancel: release capture, reset drag state
- destroy() releases active pointer capture and clears drag state
- track activePointerId to support destroy mid-drag
- arrow handle drag uses toNormUnclamped to allow drags past plot edge

Refs PR #232 review #1, #2, #5 ([`7ab32bf`](https://github.com/tsenoner/protspace/commit/7ab32bf8b0384074b04deb9c1f8ce51a036a901f))

* fix(publish): render per-item shapes in figure editor legend

Always render each legend item's actual shape from the legend data,
honoring user-assigned custom shapes while keeping circles as default.
Remove dead includeShapes parameter and drawColoredCircle function.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7089861`](https://github.com/tsenoner/protspace/commit/7089861defa766a0b2777cac8d17a2bf22dfd5b6))

* fix(publish): warn on legend state read failure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b47b93b`](https://github.com/tsenoner/protspace/commit/b47b93b9b140039995ee5a024c94c13f6829bf79))

* fix(publish): render shapes in figure editor legend

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`9155001`](https://github.com/tsenoner/protspace/commit/9155001f3b46696921b41f202fb13d9fa4fac37e))

* fix(publish): lock zoom inset target to source aspect ratio

Target rect now always maintains the same pixel aspect ratio as the
source rect — during creation, corner-handle resize, and when the
source is resized. The rubber-band indicator also previews the
constrained proportions while drawing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`a4cafb2`](https://github.com/tsenoner/protspace/commit/a4cafb22405489eb7e61f3da67fbba7dab716369))

* fix(publish): account for rotation in circle ellipse hit-testing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`af6d60a`](https://github.com/tsenoner/protspace/commit/af6d60a801ae5ca03c8a787d695d4ca6c2f093a9))

* fix(legend): change extract-all button class from btn-primary to btn-danger ([`cd55432`](https://github.com/tsenoner/protspace/commit/cd55432020d71b18808db9681aaacf66a42d1634))

* fix(legend): improve extract-all button style, DRY dialog close, dispatch events, add tests

- Change extract-all button from btn-danger to btn-primary (additive action)
- Extract _closeOtherDialog() helper to DRY 4 close locations
- Dispatch extract events for each item in _handleExtractAllFromOther
- Remove redundant empty-check guard (button already disabled)
- Add 28 tests for dialog template and extract methods

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`af94774`](https://github.com/tsenoner/protspace/commit/af94774de1ac5d70750c484ffa5d1da5ae0856f1))

* fix(legend): update extract all button title and aria-label for clarity ([`73a4e3d`](https://github.com/tsenoner/protspace/commit/73a4e3d7f5d2c66fe359389d8f1f36579a0e6416))

* fix(core): reset pre-isolation visible values on annotation change

Update the _handleAnnotationChange method in ProtspaceLegend to reset _preIsolationVisibleValues when isolationMode is active. This ensures that the new annotation uses the correct maximum visible values instead of being constrained by the previous annotation's set. ([`1bfd4d2`](https://github.com/tsenoner/protspace/commit/1bfd4d2f200c0b78fc6166b965cbf6764da45e72))

* fix(core): update positioning of value and annotation pickers for improved usability ([`a994fcf`](https://github.com/tsenoner/protspace/commit/a994fcfcc3df586e700241162bf7f7221b509271))

* fix(core): replace repeat directive with .map() to avoid Lit/Vite compat issue ([`d25a1e3`](https://github.com/tsenoner/protspace/commit/d25a1e3a011dc17a0c738fc61a402008d98ad989))

* fix(core): address code review findings

- Remove non-null assertion on protein_ids in _handleQueryApply
- Remove duplicate _scheduleEvaluation call in _dispatchQueryChanged
- Add clarifying comment on matchesOperator dual behavior
- Add test for is_not with multiple values ([`6f79d8a`](https://github.com/tsenoner/protspace/commit/6f79d8a8c5a845c235911ed0067b7936eb95dffa))

* fix(structure-viewer): prevent bottom clipping by making viewer fill available height

- Guard _updateBrushExtent() with _isBrushing flag to avoid resetting
  D3 brush drag state on scroll-wheel zoom mid-selection
- Remove overflow-y-auto on explore page root to prevent page scroll
- Change right-panel to overflow:hidden; align grid items with stretch
- Replace fixed min-height/max-height on :host with flex-grow:1 and
  min-height:150px so the viewer fills available space and can shrink ([`4e43bb3`](https://github.com/tsenoner/protspace/commit/4e43bb392e7ec44b1cd871ab63fa988a29685570))

* fix(webgl): two-pass selection rendering and remove faded point outlines

- Render unselected points with blend OFF (flat, no density accumulation)
  and selected points with blend ON (correct MSAA anti-aliasing)
- Track selectedStartIndex in populateBuffers to split the draw call
- Skip edge darkening for faded points (alpha < 0.5) in fragment shader
  to eliminate disproportionately visible dark outlines on unselected points
- Restore selectionActive state to coordinate two-pass rendering

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`86ee41b`](https://github.com/tsenoner/protspace/commit/86ee41bc01923eb72bb96bf696a552b7882b5791))

* fix(scatter-plot): track visible viewport for brush extent, not margins (#189)

The D3 brush extent was hardcoded to the margin rectangle in local
(untransformed) coordinates. Because the brush group carries the zoom
transform, this created dead-zones at the canvas edges where selection
could not start or end — especially noticeable when zoomed in.

Replace the static margin bounds with the visible viewport computed via
transform.invertX/invertY. The extent now exactly matches what is on
screen at any zoom/pan level, eliminating edge dead-zones.

Includes 5 Playwright E2E tests covering default zoom, zoom-out,
zoom-in, pan+zoom, and structural extent verification.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b3f2983`](https://github.com/tsenoner/protspace/commit/b3f298381dc136bf8ef7fe88979e7e63a6d78814))

* fix(core): reject files without .parquetbundle extension before loading

Validate file extension before showing any loading UI. Files without
.parquetbundle extension are rejected immediately with an error event,
preventing the loading overlay from appearing.

Closes #209

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`1a12152`](https://github.com/tsenoner/protspace/commit/1a12152d774928d14387397547a3f57bb0099cdc))

* fix(core): clear scatterplot isolation state on dataset load

When loading a new dataset while in isolation mode, the scatterplot's
isolation state persisted, causing the legend to render with zero items.

Closes #206

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7f57b0b`](https://github.com/tsenoner/protspace/commit/7f57b0ba34da92ebc3e811065f489421b2927035))

* fix(core): pass through projection names without reformatting

Remove formatProjectionName() logic that split on underscores and applied
toUpperCase(), which mangled prefixed names like "prot_t5 — PCA_2" into
"PROT PCAt5 - 2". Projection names are now displayed exactly as stored
in the .parquetbundle, with formatting handled by the backend.

Fixes #166

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`28d2f0b`](https://github.com/tsenoner/protspace/commit/28d2f0bb942ad28a59dbd366be59624a46e76ebb))

* fix(core): align structure error typing ([`04eab26`](https://github.com/tsenoner/protspace/commit/04eab260f7ecfa4b81ce0ae8c22887344cb34524))

* fix(app): clarify OPFS persistence failures ([`3ad27f6`](https://github.com/tsenoner/protspace/commit/3ad27f6f22b161cf8f05e5ea40bfd1184b647cc5))

* fix(scatter-plot): anti-alias shape edges with smoothstep SDF

Replace hard discard with smoothstep + fwidth for smooth ~1px alpha
transitions at shape boundaries. Unifies the duplicate shape logic
(discard test + edge distance) into a single signed distance field
computation. Fixes #173. ([`11cc858`](https://github.com/tsenoner/protspace/commit/11cc85857f8890bfa270368cd915d72209f180b3))

* fix(legend): harden isolation mode handling and add missing test coverage ([`3a72345`](https://github.com/tsenoner/protspace/commit/3a72345e26a00195f865963c70272030dd467fdb))

* fix(legend): ensure "Other" category is preserved in isolation mode and adjust legend item processing ([`c2f8b4f`](https://github.com/tsenoner/protspace/commit/c2f8b4fafe9f1fe8890c649db4bd4f44d98345ea))

* fix(legend): prevent dataset hash reset during isolation mode when protein IDs change ([`c60b926`](https://github.com/tsenoner/protspace/commit/c60b926a22a70658cf6b47cb7b34b0789057c5de))

* fix(scatter-plot): reset data reference to ensure full data rebuild in processing ([`6bbe917`](https://github.com/tsenoner/protspace/commit/6bbe9178afc267d9cfca9acc023936c7e3a010e6))

* fix(scatter-plot): position isolation indicator in bottom-left corner ([`f7075de`](https://github.com/tsenoner/protspace/commit/f7075ded8e0cb7ad4cbe984fb5e0c4523f9ccb47))

* fix(core): prevent OOM crash on projection switch for large datasets

Update coordinates in-place on existing PlotDataPoint objects instead of
rebuilding the entire array. For 573K proteins this avoids a ~700MB memory
spike that crashed the browser tab.

Remove premature columnar data integration that added extra memory pressure
and introduced behavioral regressions. Columnar infrastructure (types,
processor, style getters) remains available for future renderer work.

Fixes #147 ([`acea16a`](https://github.com/tsenoner/protspace/commit/acea16ae26c3935b29b90336d89cd37219a9e544))

* fix(core): handle all ECO/GO evidence codes in annotation parsing (#172)

Replace hardcoded KNOWN_EVIDENCE_CODES set with a regex pattern that
matches 2–5 uppercase letters or ECO:digits, covering all standard GO
evidence codes (IPI, IGI, IEP, etc.) and raw ECO ontology IDs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`dec6b32`](https://github.com/tsenoner/protspace/commit/dec6b32f9e45c6d3bd5240f4c3c7d3042504a97f))

* fix(app): always reset legend state on dataset load (#178)

Remove the isReload guard that preserved localStorage across page
reloads, so clearForNewDataset() and setFileSettings() always run.
Clean up dead code: hasStorageItemsForHash, selectionMode/isolationMode
variables, and unused toggle-selection-mode listener.
Add Playwright E2E test for reload-resets-state behavior.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`a8a3358`](https://github.com/tsenoner/protspace/commit/a8a33582e1df0fbbe4c986dc3d507249be3e9bf9))

* fix(scatter-plot): keep tooltips open when hovering

Signed-off-by: Elias Kahl <contact@elias.works> ([`ddde5b5`](https://github.com/tsenoner/protspace/commit/ddde5b5b64725cf4ca51d13953d5b7b39b4b2ce8))

* fix(docs): update image paths in README for consistency ([`fdb69f6`](https://github.com/tsenoner/protspace/commit/fdb69f68d3d871d953b98eced08b64051b6162e8))

* fix(app): sync header spacer height with navbar ([`021d1fe`](https://github.com/tsenoner/protspace/commit/021d1fe01603ad8571bc79ed4302f3f2691ea352))

* fix(perf): ensure gpu is used in perf tests

Signed-off-by: Elias Kahl <contact@elias.works> ([`85a5023`](https://github.com/tsenoner/protspace/commit/85a50230193a19f317a3e2d9de649f430b7c05cb))

* fix(test): fix data url for tests

Signed-off-by: Elias Kahl <contact@elias.works> ([`96a0ebf`](https://github.com/tsenoner/protspace/commit/96a0ebf1a0f261d39c687ea9d8f800acfcb87bca))

* fix(webgl): handle lost context leading to white canvas ([`8d01953`](https://github.com/tsenoner/protspace/commit/8d019534bc27f37560ead40628c99b1a2109ba11))

* fix(core): structure-viewer height assignment and filter annotation data shape ([`3c4dcb1`](https://github.com/tsenoner/protspace/commit/3c4dcb152e87f221a16f865873b365d8e620fc8e))

* fix(utils): use toInternalValue for empty/whitespace N/A and add tests

- DataProcessor and legend.ts: replace ?? with toInternalValue() to
  handle empty strings and whitespace, not just null/undefined
- Extract shared toInternalValue into @protspace/utils
- Add toInternalValue, DataProcessor, and export-utils N/A tests ([`82f6053`](https://github.com/tsenoner/protspace/commit/82f605376cf8058ddf41c39bd45bc079796f3bb5))

* fix(export-utils): normalize N/A at source in computeLegendFromData

- computeLegendFromData now emits LEGEND_VALUES.NA_VALUE instead of 'N/A'
- Removed dead conversion code in buildLegendItems
- renderLegendToCanvas uses toDisplayValue() for canvas label text
- Fixed stale JSDoc comment referencing old 'null' key format ([`ad12ae7`](https://github.com/tsenoner/protspace/commit/ad12ae7c15da43e4e227b09799d9f1fd2f5a5724))

* fix(export-utils): use LEGEND_VALUES.NA_VALUE instead of 'null' string ([`6a0841b`](https://github.com/tsenoner/protspace/commit/6a0841b8ac3525ce75a622fd2aa52f01aa1e8fa8))

* fix(tooltip): display __NA__ as N/A and filter from metadata fields ([`3987926`](https://github.com/tsenoner/protspace/commit/398792646065123aee746535959dfead8a26ad5a))

* fix(styles): adjust grid layout for export format options to use four columns ([`6bbcfce`](https://github.com/tsenoner/protspace/commit/6bbcfce9f0b906b70f99648bdaf254c63d4af8d0))

* fix(legend): cleaner appearance when dragging ([`37013a6`](https://github.com/tsenoner/protspace/commit/37013a63822719d60917540d4b0ac1dcfbe0cd31))

* fix(styles): unify focus outline colors across annotation select and scatter plot components ([`fa89f67`](https://github.com/tsenoner/protspace/commit/fa89f67887dd7cb8055b55a21f629590de420b8b))

* fix(styles): standardize focus ring and background colors across components ([`e46b938`](https://github.com/tsenoner/protspace/commit/e46b938da83422f948b61a9abacea3e1b64d20a9))

* fix(legend): update color scheme from accent-purple to primary for legend item styles ([`d180848`](https://github.com/tsenoner/protspace/commit/d180848a94102f1f0d3dce25098e5ee7dacfad67))

* fix(legend): implement highlight effect for dropped legend items after drag-and-drop ([`bad3c9d`](https://github.com/tsenoner/protspace/commit/bad3c9d020f075d5e3c81a1b8f4d17650b6a2dce))

* fix(legend): add drag-and-drop merge target highlighting for legend items ([`360c676`](https://github.com/tsenoner/protspace/commit/360c6766109012dec99d4df92306e4cbaf60dfa4))

* fix(legend): update shape assignment logic and improve shape handling when toggling settings ([`9403af2`](https://github.com/tsenoner/protspace/commit/9403af27e813d7092117df5a468347856feeac59))

* fix(legend): improve visible values logic for legend items during initial load ([`5aa651c`](https://github.com/tsenoner/protspace/commit/5aa651cb4440819b91e68d0cad46a3f28feb2085))

* fix(legend): enhance sorting logic for legend items ([`b35232e`](https://github.com/tsenoner/protspace/commit/b35232e2ea76ea5dce1f0e4cb5e7afc6c24586a3))

* fix(legend): legend item sorting ([`232196f`](https://github.com/tsenoner/protspace/commit/232196f287ac45cacf51bff525a2919167ca81c4))

* fix(legend): legend item sorting ([`251c10a`](https://github.com/tsenoner/protspace/commit/251c10a32334e8941eece5e716b942a1858693f3))

* fix(legend): preserve localStorage settings on page reload and fix export/import category states

Two bugs fixed:

1. Page reload no longer overwrites localStorage with defaults. The data-loader
   now propagates a `source` field ('user' | 'auto') so the app can distinguish
   explicit uploads from auto-loads. On reload, if localStorage already has
   entries for the dataset hash, clearing and file-settings application are
   skipped entirely.

2. Legend category visibility is now correctly persisted in exported parquet
   bundles. The root cause was a stale `_legendItems` array in `setFileSettings`
   that caused `_visibleValues` to return the wrong set; clearing it before
   rebuild lets it fall back to `_pendingCategories` from the file. Additionally,
   the duplicated `OTHERS`/`Other` constants are unified to `OTHER`, and
   color/shape conflict resolution now prevents default-encoded items from
   colliding with persisted visual encodings.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`9d480f9`](https://github.com/tsenoner/protspace/commit/9d480f9d5bc97aae94b4dc14353b43777e4b8781))

* fix(webgl-renderer): triangle shape ([`2663bd6`](https://github.com/tsenoner/protspace/commit/2663bd649ce00174257c902d38020fc7f5ee3f8f))

* fix(scatter-plot): enhance tooltip text to include detailed protein information ([`63b2452`](https://github.com/tsenoner/protspace/commit/63b2452cbcbe1c842c8c72abdd9b4fbd97e61b62))

* fix(build): use lint-staged in pre-commit hook to properly stage fixed files

The pre-commit hook was running prettier --write and eslint --fix on all
files but not re-staging the changes, allowing improperly formatted code
to be committed. Now uses lint-staged to run checks only on staged files
and automatically re-stage any fixes before the commit is created.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com> ([`29a073e`](https://github.com/tsenoner/protspace/commit/29a073ead994f5900efe3fd59f82f2c49905a272))

* fix(structure-viewer): remove buttonMixin to prevent Mol* button interference ([`187766d`](https://github.com/tsenoner/protspace/commit/187766d252494e103e39c12a7188330f2419058b))

* fix: suppress console errors and warnings in structure viewer

- Add fetch interceptor to silence Molstar validation server requests
- Fix Lit update cycle warning by deferring structure loading
- Suppress expected 404 logs when structures are unavailable
- Remove redundant logging and unused variables in demo app ([`9c121c9`](https://github.com/tsenoner/protspace/commit/9c121c991add28149bf9078b1032b82f5fd422a1))

* fix: linting ([`d5cf325`](https://github.com/tsenoner/protspace/commit/d5cf325c83fede5890921c8426eeb1af620fa8bb))

* fix(export): display N/A and Other category count in exported legends

- Add getLegendDisplayText utility function in shapes.ts (DRY principle)
- Export otherItemsCount from legend component's getLegendExportData
- Use shared utility in both legend-renderer and export-utils
- Properly display "N/A" for null/empty values in exports
- Append "(X categories)" text to "Other" items in exports ([`55aa626`](https://github.com/tsenoner/protspace/commit/55aa626ceb1628ac6a9651ca048dce942688a7fd))

* fix(export-utils): prevent legend cutoff and squishing on browser resize

- Calculate minimum required width based on actual text measurements
- Allocate sufficient space for legend instead of scaling content down
- Adjust export canvas width dynamically to fit legend content
- Maintain proper proportions and readability at all browser sizes ([`1468f78`](https://github.com/tsenoner/protspace/commit/1468f7829b770742aa0f52d4999d50e0fc180ef9))

* fix(legend): update handling of visible values to include null and empty strings for N/A items ([`8f5a014`](https://github.com/tsenoner/protspace/commit/8f5a0143ba6faefa25350d5da520d3eae877b164))

* fix: linting ([`70efc19`](https://github.com/tsenoner/protspace/commit/70efc193cadcc778b9c07cf10ca54431938ce619))

* fix(docs): correct Explore link navigation across dev servers ([`f1acb86`](https://github.com/tsenoner/protspace/commit/f1acb8654461467d9560f85a8160543bf680cb8b))

* fix(layout): restore fixed header positioning

- Restore fixed positioning to ensure persistent navigation
- Fix scrolling behavior on Explore and Index pages ([`ce00e50`](https://github.com/tsenoner/protspace/commit/ce00e5037ac96bb45ff2dd718c615631d0a8f84d))

* fix(explore): overhaul layout for full-screen responsiveness

- Implement flexbox layout to fix scrolling and overflow issues
- Remove manual height calculations and wrapper hacks
- Add TypeScript definitions for custom web components ([`496a835`](https://github.com/tsenoner/protspace/commit/496a835b7f2e8d2747cf9fdc2fb5d3db66d2d1a4))

* fix(ci): remove explicit pnpm version from workflow

pnpm/action-setup@v4 automatically reads the version from package.json's packageManager field. Removing the explicit version: 10.11.0 to use the packageManager value of 10.24.0 and avoid version mismatch errors. ([`55d88fc`](https://github.com/tsenoner/protspace/commit/55d88fc89775094e430d3c184e2bbd4888899c19))

* fix(build): resolve vite build hang in @protspace/utils

Fixed missing __dirname in ESM context by using fileURLToPath and dirname from Node.js URL and path modules. Added dts plugin optimizations (rollupTypes: false, copyDtsFiles: true) for faster type generation. Declared external dependencies to improve build performance.

This resolves the issue where the build would hang indefinitely during the vite build step. ([`41a9816`](https://github.com/tsenoner/protspace/commit/41a98166d93c22d60d0c2b053ac8492a92af7b87))

* fix(legend, scatter-plot): refine z-order handling and feature value normalization

- Updated z-order mapping logic in the ProtspaceLegend component to remove the 'Other' category check, ensuring all non-null values are considered.
- Enhanced style getter logic in the scatter-plot to correctly identify and handle feature values belonging to the 'Other' category, improving data representation. ([`bb2da29`](https://github.com/tsenoner/protspace/commit/bb2da29162eab9458e8d6e2cb2d42059cd5eba5a))

* fix(search): update placeholder text for protein ID input field to clarify usage ([`e6e3e2a`](https://github.com/tsenoner/protspace/commit/e6e3e2aead7c87682a6b09754876fbfae16c6054))

* fix(scatter-plot): ensure valid selection on data updates to prevent blank plots

- Added logic to validate the selected projection index and feature when new data is loaded or the projection index changes. This prevents issues when switching datasets with varying projections/features. ([`c864ebb`](https://github.com/tsenoner/protspace/commit/c864ebbe8ed4ac646ff8beb595c25bbbdb7b29a0))

* fix(structure-viewer): structure viewer when selecting multiple points ([`d2bf8b2`](https://github.com/tsenoner/protspace/commit/d2bf8b20fed44d3b7e69435bfd56a47594abf29c))

* fix(scatter-plot): improve selection mode display for clarity ([`7f84907`](https://github.com/tsenoner/protspace/commit/7f849077fbf604565fea953fc295b2692d2b196a))

* fix(scatter-plot): selection highlighting ([`e615007`](https://github.com/tsenoner/protspace/commit/e61500756c8560621ef11886c85921eb11a66fe7))

* fix(legend): remove green boarder when extracting label from "other" ([`c8b5859`](https://github.com/tsenoner/protspace/commit/c8b5859096e63cbf7219b3324f4750cafe06d87a))

* fix: Change N\A to N/A.

resolve #47

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`8ce5ff3`](https://github.com/tsenoner/protspace/commit/8ce5ff354ed0f5ff214ff29a29296104cda66fbb))

* fix(storybook): resolve configuration and version compatibility issues

- Remove duplicate dev args from root storybook script
- Replace non-existent @storybook/addon-essentials with individual addons
- Update Storybook packages to latest stable 9.1.12
- Update @chromatic-com/storybook to stable ^4.1.1

The addon-essentials package doesn't exist for Storybook 9.x as core
functionality is now built-in. This was causing version conflicts with
v8.x dependencies being pulled in. ([`3df7223`](https://github.com/tsenoner/protspace/commit/3df72237a4c6057ba6d8a256f30b9a25e1809da8))

* fix: update N/A name

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`bfe5c88`](https://github.com/tsenoner/protspace/commit/bfe5c88d23581ef6d8c4619656c4b753d689a736))

* fix(hero): change button text from "View Demo" to "Start Exploring" ([`90b1b24`](https://github.com/tsenoner/protspace/commit/90b1b24ff584a8ca8a191d2e0ab191afd39db1c6))

* fix(header): update application name in header from "ProtSpace Web" to "ProtSpace" ([`d940264`](https://github.com/tsenoner/protspace/commit/d9402641c7cfebaa0a189a50848cf1e7ef499e69))

* fix(legend): disable shapes when switching to multilabeled features

Shapes now correctly disabled in scatterplot when switching from
non-multilabeled to multilabeled features. Previously, shapes would
persist in scatterplot despite being hidden in legend. ([`ec1591b`](https://github.com/tsenoner/protspace/commit/ec1591b20412c9cc85be2c19c3b70ca5488d14b1))

* fix(legend): force circles for multilabel features

- Add _isMultilabelFeature() to detect multilabel features
- Force legend symbols to circles when multilabel detected
- Disable and grey out 'Include shapes' option for multilabel

Multilabel features render as pie charts and only support circles.

Fixes #83 ([`f7e5509`](https://github.com/tsenoner/protspace/commit/f7e5509ecac7181c58d025dafe15f5ac80e31b10))

* fix(config): change pointSize to not have a conflict ([`a11201e`](https://github.com/tsenoner/protspace/commit/a11201e8d7f1a09942de1f005c5471319fbaf672))

* fix: correctly handle hiding of multilabel feature value arcs

- hides arc segment if feature is hidden
- aggregates "other" feature values into one single arc ([`a4feb91`](https://github.com/tsenoner/protspace/commit/a4feb910e641eb592220427d582be61fc15b8a97))

* fix: separate multilabel feature values in tooltip ([`6d9f2ee`](https://github.com/tsenoner/protspace/commit/6d9f2ee1fbd322f059633cbcc6431e911f26ac68))

* fix: reload legend when empty parquet file provided
Fixes #72

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`31d901b`](https://github.com/tsenoner/protspace/commit/31d901b26372168164c966688033ffaddd903920))

* fix(control-bar): change the default behavior of select mode to append selection ([`3c640b8`](https://github.com/tsenoner/protspace/commit/3c640b8c91eed9a1a40fe0102f562a9ecf8c7b27))

* fix(control-bar, scatter-plot): using ctrl/command instead of shift for multi selection ([`e5e947b`](https://github.com/tsenoner/protspace/commit/e5e947b3f0b7a01a4440de72f471a5b7af65e661))

* fix(search): update search suggestion filtering to use prefix matching ([`1eb6ee1`](https://github.com/tsenoner/protspace/commit/1eb6ee1422759d469b24d08a5d435c5293a6ce8d))

* fix(search): we have fixed order of selection ([`c8efcf9`](https://github.com/tsenoner/protspace/commit/c8efcf9cc9f72c4314a42ac796b510e4e8996c22))

* fix(scatter-plot): reset zoom on data change to enhance user experience ([`0c32d6f`](https://github.com/tsenoner/protspace/commit/0c32d6f2f8093e58f7c08bc4d7b93925cfb1c47d))

* fix(control-bar/legend/example/structure-viewer): fixed responsive sizing issues. ([`a6ec941`](https://github.com/tsenoner/protspace/commit/a6ec94116fc2986b3acc5ddbe5192dd9fd878222))

* fix: enhance AlphaFold API integration

- Updated StructureService to fetch structure data from the AlphaFold API, improving error handling and response validation.
- Enhanced structure data interface to support multiple formats (PDB, CIF, MMCIF). ([`75b9676`](https://github.com/tsenoner/protspace/commit/75b967657852a3416c6a43bf4ee8e88d611a00ac))

* fix: move data.parquetbundle to public dir for scatterplot example ([`f083267`](https://github.com/tsenoner/protspace/commit/f083267c8526663254512ec1ad276d5b773ee69e))

* fix: update dependencies and configuration

- Added esbuild as a dependency in package.json.
- Updated .prettierignore to exclude lock.yaml files. ([`a54b5b8`](https://github.com/tsenoner/protspace/commit/a54b5b8f73a6e884abbec0c6a33f0b56a55e6035))

* fix(legend, scatter-plot): handling N/A values ([`25411e6`](https://github.com/tsenoner/protspace/commit/25411e6ec67a76ca3a8854891bcfd7e6af89ec70))

* fix(scatter-plot): ensure immediate reflection of selection/highlight changes in canvas styles ([`d66795d`](https://github.com/tsenoner/protspace/commit/d66795d7038c4fe1a1b0a007a85b78bee1824b62))

* fix(scatter-plot): make it responsive when you hover on data points ([`188aec2`](https://github.com/tsenoner/protspace/commit/188aec2354549346fb9992e6ccdcaa41cee128e9))

* fix(legend): update default symbol size and add placeholders for input fields ([`d1fab9d`](https://github.com/tsenoner/protspace/commit/d1fab9d37e8c6429424840f4962957281add4580))

* fix(export): for the PDF and PNG options ([`2404d2e`](https://github.com/tsenoner/protspace/commit/2404d2e7b9a4499f94c1b9e41aaac34dbde67296))

* fix(control-bar): remove unsupported export type 'svg' from handleExport method ([`e5b17e0`](https://github.com/tsenoner/protspace/commit/e5b17e09264ad824557a642bc5ed1bec267173d0))

* fix(session-buttons): update SVG path for improved icon representation ([`fb8369d`](https://github.com/tsenoner/protspace/commit/fb8369d87299567ee47c14f56cb13a5679792d55))

* fix(filter-dialog): update background opacity for improved visibility ([`65226ed`](https://github.com/tsenoner/protspace/commit/65226ed3c432e0cef36cfdeecffa31e9f201073b))

* fix(mode-toggle-button): update button styles for improved visual consistency ([`daf0c3c`](https://github.com/tsenoner/protspace/commit/daf0c3c4eb7773749792aa92064077821bd9dc2a))

* fix(scatterplot): ensure consistent color assignment for 'Other' values ([`cd7860e`](https://github.com/tsenoner/protspace/commit/cd7860e85c0b347fa57d073d9c818cc237b161f7))

* fix(page): adjust main container height for better layout consistency ([`9ff6c89`](https://github.com/tsenoner/protspace/commit/9ff6c89eabd95b89dbdfe0deb8fd3ebb22a0a36e))

* fix(scatterplot): improve tooltip and click handling for protein interactions

- Enhanced the logic for displaying tooltips and handling clicks on proteins in the scatterplot. The search radius for finding nearby proteins has been reduced, and additional checks ensure that the cursor is over the rendered point before displaying tooltip data or triggering click events. ([`c842158`](https://github.com/tsenoner/protspace/commit/c842158b0168852fa4759ebee571a77559b6142f))

* fix(legend, scatter-plot): update display handling for null and empty values

- Modified the display logic in the legend and scatter plot components to show "N\\A" for null or empty string values, improving clarity in data representation. ([`7a61155`](https://github.com/tsenoner/protspace/commit/7a61155d41b942dddd86247011e5e5b159e1b578))

* fix(scatter-plot): optimize point visibility handling and quadtree rebuilding

- previously, even if a point on the scatter plot was invisible, if you were hovering on it, you could see the info about that protein, currenlty you can only hover on the visible proteins. ([`dc69672`](https://github.com/tsenoner/protspace/commit/dc696720d945d7079f616f81d15bb68aa808efa2))

* fix(data-loader): update placeholder text for ParquetBundle file uploads ([`c76ff6f`](https://github.com/tsenoner/protspace/commit/c76ff6fe8ed5e8d9d4401335be9d96b89a5876c6))

* fix(scatter-plot): handle null case for selected protein element in display update ([`4850483`](https://github.com/tsenoner/protspace/commit/4850483c1012fc891d7bd9f797baa5f8743e6b5a))

* fix(scatter-plot): ensure merged config includes previous state ([`7d51133`](https://github.com/tsenoner/protspace/commit/7d5113374eb2b484558edcea32a42dc382746449))

* fix(legend): Others off button in the setting shows all categories and clears scatterplot “Other” ([`e515a8e`](https://github.com/tsenoner/protspace/commit/e515a8e91010758ab0102e3763ffd29bf461e671))

* fix(legend): hide “Other” bucket when isolating another item ([`c5a6411`](https://github.com/tsenoner/protspace/commit/c5a6411b7095f1956b325b97fa70fbf090a00a1d))

* fix: handle the cases where we don't have any structure from AlphaFold ([`14d2a4c`](https://github.com/tsenoner/protspace/commit/14d2a4c2ee5ad903d144edd180b2b37798c971be))

* fix(control-bar): update selectionMode before dispatch to restore single-selection

- Set local and scatterplot selectionMode before emitting toggle event
- Include selectionMode in event detail
- Fixes previous selection not clearing after deactivating selection mode ([`ff6c526`](https://github.com/tsenoner/protspace/commit/ff6c526f578e24971438fa509a53bf8cba00f4c4))

* fix(visualization): resolve TypeScript and React hooks issues

- Move helper functions inside useEffect to properly handle dependencies
- Add state management for projection and feature selections
- Fix TypeScript null checks using non-null assertion
- Remove unused getCurrentSelections function
- Update dropdown handling to use React controlled components

Resolves build errors and improves component state management. ([`8d932bd`](https://github.com/tsenoner/protspace/commit/8d932bd0023189ebc07e45904cb5cae3c5bda6ab))

### Performance Improvements

* perf(e2e): reduce redundant browser coverage ([`343f957`](https://github.com/tsenoner/protspace/commit/343f9571c18b15d16dc9894c8d194ba54d65e8a5))

* perf(e2e): remove deterministic test waits ([`eb4bb57`](https://github.com/tsenoner/protspace/commit/eb4bb57ea43eac980fea84f25c7128e37d108e32))

* perf(transfer): halve cosine kNN memory to 1x reference matrix; verify 4GB deploy fit

The cosine path in backends.nearest held the reference matrix twice (raw + a
normalized copy), so cosine at full Swiss-Prot / dim 1024 needed ~4.7 GB and would
OOM a 4-core/4 GB deployed box. Fold the per-reference norm into the dot product
(cos = q.r / (||q|| ||r||)) instead of storing a normalized copy, so cosine holds
1x references like euclidean. Behaviour preserved (existing cosine equivalence +
zero-vector tests stay green); _l2_normalize is now unused and removed.

Measured in a docker --cpus=4 --memory=4g container (one fresh process per config):
full Swiss-Prot (570K x 1024) now fits at ~3 GB peak for both metrics, ~7-10 ms/query
on 4 arm64 cores. Adds packages/protlabel/benchmarks/bench_memory.py and folds the
results into the research doc.

Also clarifies in reliability.py that the backend never emits negative distances
(euclidean is a clamped sqrt; cosine distance in [0,2]) — the guard is defensive.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`25e26c5`](https://github.com/tsenoner/protspace/commit/25e26c5dad26117c2759a958e8294fbfd4df5f60))

* perf(stats): _align fancy-indexed a full copy of the embedding even when faithfulness skips it past the ceiling; return source arrays as views on an in-order identity match

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`6e527d5`](https://github.com/tsenoner/protspace/commit/6e527d5b9642d44caa5e1b52ef51c04f6f91e321))

* perf: lazy per-method reducer imports + use logger for taxonomy status

- Move umap/pacmap imports into fit_transform() so PCA-only runs skip
  pynndescent/numba entirely
- Replace print() with logger.info() for taxonomy database download
  status — proper logging, controllable by callers

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5cf9177`](https://github.com/tsenoner/protspace/commit/5cf9177e5fb31855754673270f949fc5630a5260))

* perf: lazy-load umap/pacmap per-method instead of all at once

Move `from umap import UMAP` and `from pacmap import PaCMAP, LocalMAP`
from top-level into each reducer's fit_transform() method. PCA-only
runs no longer trigger pynndescent/numba JIT compilation.

Before: importing reducers.py loaded all 6 reducer libraries (~3s).
After: importing reducers.py loads only sklearn (~0.3s). umap/pacmap
are imported on first use of their respective reducers.

Verified: PCA run completes with umap=False, pacmap=False in sys.modules.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ef41591`](https://github.com/tsenoner/protspace/commit/ef41591be8fe32db2c4a7e83e2aa34d28e6f2f0b))

* perf: defer heavy reducer imports (umap/pacmap/numba) until first use

Extracted DimensionReductionConfig and method name constants from
reducers.py into a new constants.py with zero heavy dependencies.

Before: importing pipeline.py triggered reducers.py which eagerly
imported umap, pacmap, pynndescent, and numba — ~3s locally, ~30-60s
in Colab due to CUDA/TensorFlow interference.

After: pipeline.py imports only constants.py (0.3s). The heavy reducer
classes are loaded lazily via get_reducers() at reduction time.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`64cbac9`](https://github.com/tsenoner/protspace/commit/64cbac9ecdf0b1cf525906ffdb529a8b99ea2bfc))

* perf: lazy imports for 20x faster CLI startup (2.0s → 0.1s)

Defer heavy ML library imports (sklearn, umap, pacmap, pandas,
pyarrow) until first use via PEP 562 module __getattr__. CLI help
now responds in ~100ms instead of 2 seconds.

- utils/__init__.py: lazy-load reducer classes via get_reducers()
  and __getattr__ with __dir__ for IDE support
- protspace/__init__.py: remove eager imports of add_annotation_style
  and ProtSpace
- serve.py: inline DEFAULT_PORT constant (was importing entire
  Dash/pandas stack for a single 8050 integer)
- annotate.py, bundle.py, project.py, prepare.py: move pyarrow and
  pandas imports inside function bodies

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b1f523d`](https://github.com/tsenoner/protspace/commit/b1f523d9c5767dc195c29dffe06009e7be5cb355))

* perf: add dev dependencies ([`a086fb9`](https://github.com/tsenoner/protspace/commit/a086fb9ccfda5680b2536ac855da7617d3b08f2c))

* perf(data-loader): index-scan the top-level ';' splitter

Replace the per-character `for..of` + `current += ch` build in
splitOnTopLevelSemicolons with an index + slice scan: no per-char
allocation, no code-point decoding, byte-identical output (25 splitter
tests unchanged).

Also document the fallback's net-imbalance limitation — a stray '(' in
one hit cancelled by a stray ')' in a later hit leaves end-depth 0, so
the inter-hit ';' is swallowed and the two hits merge (subsumed by the
name-sanitization work in tsenoner/protspace#56) — and add a JSDoc block
to the now-exported splitCategoricalAnnotationValues.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`74a5b50`](https://github.com/tsenoner/protspace/commit/74a5b50b50e38fc867eafaf33b6548c2a3334b8a))

* perf(data-loader): skip paren scan for paren-free categorical cells

The top-level ; splitter only needs its per-char paren-depth scan when a
cell contains a parenthesis. Most categorical columns (Kingdom/Organism/
Localization) never do, so short-circuit to a native split for them —
behavior-identical since depth stays 0 throughout.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`2d3b3ca`](https://github.com/tsenoner/protspace/commit/2d3b3cae2f6444ed0386366be2b7b01d6f8f7e4e))

* perf(scatter-plot): drop per-point work and count interactive points

- _getMaterializedData gains a reference/primitive fast-path so the
  per-point getOpacity -> visibility-model path no longer runs
  JSON.stringify on the WebGL staging loop for large datasets.
- The bottom-left chip counts interactive points (opacityOf > 0) and keys
  its memo on (originalIndices, length) so a projection switch reuses the
  cache; dead scratch x/y writes removed.
- The numeric-recompute rAF no longer builds the filtered deep-slice twice.
- Brush and lasso selection share an allocation-free _slotsToInteractiveIds
  helper instead of map/filter/map with a PlotDataPoint per hit.

Addresses code-review findings on the visibility-model refactor.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`2dad587`](https://github.com/tsenoner/protspace/commit/2dad58717ebe491a31a4c93704ff940c1365e4df))

* perf(conversion): memoize annotation parse per distinct cell value (CONV-O2)

Annotation parquet columns are dictionary-encoded, so the same cell string
repeats across many proteins (e.g. kingdom: 22 distinct values over 573K rows).
extractAnnotationsByProtein now memoizes split+parse keyed by the raw cell
value and reuses it across proteins that share a cell, turning parse cost from
O(proteins) into O(distinct cells). Frequency counting, arity, and
score/evidence detection stay per-protein, so output is byte-identical.
Measured on the real 573K bundle: extraction 5.78s -> 3.31s (1.74x). ([`34c0f18`](https://github.com/tsenoner/protspace/commit/34c0f18627d5d11c2c2ec9897367bb5b4f208d3f))

* perf(conversion): parse each annotation cell once in extractAnnotationsByProtein (CONV-O1)

Pass 1 cached the per-protein parse output (labels + sparse scores/evidence)
so Pass 2 is now a pure dictionary index-mapping pass instead of a full
re-split + re-parse of every cell. ~22 categorical columns x 573K proteins
were parsed twice; now once. Output is byte-identical. Microbench at 573K:
extractAnnotationsByProtein 11.66s -> 8.53s (1.37x). ([`0ee81fa`](https://github.com/tsenoner/protspace/commit/0ee81fae6f6b8a86d10e078aaea6ead5c3f6d7ab))

* perf(scatter-plot): reuse originalIndices for isolate slice in getCurrentData (SCAT-O2)

getCurrentData()'s isolation branch rebuilt the survivor->original mapping by
scanning all ~573K materialized protein_ids and testing Set membership, then did
a SEPARATE full-573K rescan per numeric annotation. The survivor mapping is
already computed in _plotData.originalIndices (ascending indices into the full
source ids); when no view filter is active the materialized protein_ids is that
same full array in original order, so originalIndices IS keptIndices. Reuse it
(guarded by a length check, with a membership-scan fallback for the pre-filtered
case) and slice numeric columns by keptIndices directly. Removes one full-dataset
scan plus one per numeric annotation and a throwaway 573K Set from every isolate.

Output is byte-identical to the prior path (and strictly more correct for the
duplicate-id edge case, where index identity beats id-Set membership). Adds
fast-path and fallback-path regression tests for the isolate slice. ([`73cae6b`](https://github.com/tsenoner/protspace/commit/73cae6bf87fb98315910c26320ec8bb39201af72))

* perf(legend): Set-based isolation membership in getFilteredIndices (LEGEND-O1)

getFilteredIndices ran `history.includes(id)` — a linear array scan — once per
protein, making it O(N x layerSize). On the 573K SwissProt dataset, isolating a
~1/4 selection (~143K survivors) triggered a ~18s main-thread freeze in this one
function. Build a Set per isolation layer once so membership is O(1); a realistic
573K-isolate microbenchmark drops this from ~18.5s to ~18ms (~1000x), with
identical results. Mirrors the Set-based intersection already used by
DataProcessor.processVisualizationData. ([`388946f`](https://github.com/tsenoner/protspace/commit/388946fda6adae68dac48365968b41de3a76e904))

* perf(data-loader): decode+convert parquetbundle in a Web Worker (PARQ-OPT-1/MODEL-O6)

Moves extractRowsFromParquetBundle + convertParquetToVisualizationDataOptimized off
the main thread into an inlined module worker for the .parquetbundle load path. Kills
the ~24s main-thread freeze and keeps the ~470MB row-object intermediate on the worker
heap (freed on terminate), lowering the main-isolate peak. Transfers Float32 coords +
Int32 annotation columns back zero-copy; strings/metadata structured-cloned. Main-thread
fallback retained for unsupported/errored workers. Inline (?worker&inline) bundling so
the dist is self-contained for the consuming app build. ([`e3e4312`](https://github.com/tsenoner/protspace/commit/e3e4312a3fe6b78f7e2b7de90e876b429b8cf6c0))

* perf(model): store Projection.data as Float32Array (PARQ-OPT-5 worker-transfer precondition)

Replaces the 573K [x,y(,z)] tuple arrays per projection with a flat Float32Array
(stride = new required `dimension` field). Removes ~20MB duplicate tuple storage and
lets the decode worker transfer coordinates zero-copy instead of structured-cloning
tuples. Coord export round-trip is now float32-precision (imperceptible for UMAP viz).
Rendering unaffected (PlotData coords were already Float32 since MODEL-O1). ([`8129a7a`](https://github.com/tsenoner/protspace/commit/8129a7a27d4cca49ea30cf2fb672d480f2611270))

* perf(model): replace PlotDataPoint[] with SoA PlotData container (MODEL-O1/PARQ-OPT-5)

Eliminates the 573K boxed { id, x, y, z?, originalIndex } render objects. Bulk store
is now a Float32Array-backed PlotData SoA; the renderer hot loop feeds the unchanged
style-getter interface a single reused scratch point, and PlotDataPoint objects are
materialized on demand (~1 per hover/click) at interaction boundaries. Quadtree stores
slots. Public protein-hover/click events and style-getters are unchanged. ([`f75bcd8`](https://github.com/tsenoner/protspace/commit/f75bcd868610420d172e37abf8f9751e3e9e4a93))

* perf(scales): memoize projection extents per plotData ref in createScales (MODEL-O4)

Add a module-level WeakMap keyed by PlotDataPoint[] reference. On resize the
same array reference is passed, so the two O(N) d3.extent scans are skipped and
cached extents are reused; only the cheap d3.scaleLinear domain/range rebuild
runs. Any data/projection/plane change constructs a fresh array, correctly
missing the cache. WeakMap entries are GC'd with the array — no leak.
Tests: empty input, known fixture (domain+range), single point, resize path
(same array → domain identical, range updated), different arrays → different domains. ([`db7d4c5`](https://github.com/tsenoner/protspace/commit/db7d4c504f3d1a45477378017a70977923461efb))

* perf(numeric): store materialized numeric annotation as Int32Array, not number[][] (MODEL-O3)

Replace the per-protein number[][] (one tiny array per protein) with a flat
Int32Array: present → realizedIndex, missing+NA → naIndex, no-value → -1.
Consumers access via getFirstAnnotationIndex/getProteinAnnotationIndices which
already handle Int32Array transparently. At 573K proteins this eliminates ~573K
tiny heap objects and the GC pressure they generate on every re-bin. ([`371df34`](https://github.com/tsenoner/protspace/commit/371df34fecade92ff54b214d11d779d99582b707))

* perf(scatter-plot): rAF-gate canvas hover to coalesce tooltip updates (INT-hover)

Wrap _handleCanvasMouseMove in a rAF gate so that rapid mousemove events
over dense regions (e.g. 573K SwissProt points) coalesce to at most one
quadtree lookup + Lit re-render per animation frame. d3.pointer is still
called synchronously in the event handler (event.currentTarget is null
after dispatch); only the quadtree search and _handleMouseOver are deferred.
Pending hover is cancelled on mouseout and disconnectedCallback to prevent
stale callbacks from firing after the pointer leaves. ([`74cb7d5`](https://github.com/tsenoner/protspace/commit/74cb7d55fac7aa19a1b5cf0a0e16e55fd80e85ce))

* perf(legend): build annotation value list without flatMap throwaway arrays (INT-legend)

Extract buildAnnotationValueList into annotation-values.ts; output is identical
to the old flatMap (single-valued compacted, multi-valued expanded). Eliminates
one throwaway []/{value} allocation per protein per annotation switch (~573K
at full SwissProt scale). Uint32Array histogram optimisation is intentionally
deferred to a later task. ([`477772c`](https://github.com/tsenoner/protspace/commit/477772c0e611da682c4514c86f884231eacd474f))

* perf(renderer): size buffers to texture-row-aligned capacity, not next pow2 (REND-OPT5)

Replace next-pow2 capacity with a texture-row-aligned (×256) geometric-growth
planner. At 573K points this avoids the ~83% overallocation that next-pow2 caused
(573440 vs 1048576) across all SoA arrays and the ~32 MiB label texture. ([`a002e73`](https://github.com/tsenoner/protspace/commit/a002e731af2dd5a2c1e5c60c6681dc828976bf2f))

* perf(renderer): index-sort staging via Uint32Array order + depth scratch (REND-OPT1)

Replace the per-render ~573K-object `staged` array + `staged.map()` retained copy with a
reusable `Uint32Array sortOrder` + `Float32Array sortDepths` scratch. Eliminates the large
transient allocation and GC pressure on every annotation switch. ([`7d941e8`](https://github.com/tsenoner/protspace/commit/7d941e857e56d0f324fb3bad4337cc658e9329ea))

* perf(renderer): texSubImage2D label texture + gate dead per-label fill loop (REND-labeltex)

- Extract fillLabelColorTexels helper: skips single-label points (shader never
  samples texture for them) and writes only count-1 actual slices instead of
  the full MAX_LABELS=8 slots. Cuts ~4.6M resolveColor calls at 573K points down
  to the subset that actually have >1 label.
- Replace both populateBuffers fill loops (reorder path + color-only path) and
  the export prepareOffscreenBufferData fill loop with the helper.
- Add labelTextureInitialized flag: first call (or after expandCapacity /
  resetRendererState) uses texImage2D to allocate GPU storage; subsequent style
  updates use texSubImage2D (in-place, no 32 MiB realloc per recolor).
- 6 vitest tests covering 0-label, 1-label (dead-slot guard), 2-label RGBA bytes,
  overflow capping, idx offset, and bounds safety. ([`f28f68d`](https://github.com/tsenoner/protspace/commit/f28f68d4b231126afe70f556ce46e7cb79791100))

* perf(data-loader): decode bundle parts sequentially and free each to cut load peak (PARQ-OPT-2)

Replace Promise.all([part1, part2, part3]) with three sequential awaits, nulling each
ArrayBuffer binding after its decode resolves. hyparquet is CPU-bound on the single JS
thread — Promise.all provides no real parallelism, only interleaved continuations that
keep all three sliced buffers + decode scratch simultaneously live. Sequential decode
ensures only one part's buffer is resident at a time, reducing the transient memory peak
during load (measured ~2.3 GB for SwissProt 573 K). ([`1008ce3`](https://github.com/tsenoner/protspace/commit/1008ce315410045c2b9eecae3193beb56445df44))

* perf(isolation): use per-layer Set membership instead of Array.includes (MODEL-O5b)

Replace O(N·Σm) Array.includes isolation loop with O(Σm + N·L) Set.has
per-layer approach; converts each isolationHistory layer to a Set<string>
once, then filters with O(1) membership. Intersection semantics preserved:
empty layer still yields empty result; surviving points keep originalIndex.
Adds 10 new deterministic tests covering single-layer, multi-layer
intersection, empty-layer, isolation-off, and originalIndex preservation. ([`6da442a`](https://github.com/tsenoner/protspace/commit/6da442a61216064ef7b5ad08d598687275d5b691))

* perf(harness): capture peak/steady heap + load time, add dataset scoping (T0)

- playwright.config.ts: add --enable-precise-memory-info to chrome args
- webgl-perf-suite.ts: add HeapSample/LoadMetrics types, readHeap() helper,
  resolveDatasetList() for webglPerfDatasets URL param override, rework
  loadDataset() to return LoadMetrics (heapBefore/AfterLoad/Steady, duration,
  polled peak), spread load metrics into each result entry
- webgl-perf.spec.ts: read PERF_DATASETS env var and append webglPerfDatasets
  param; add best-effort CDP JSHeapUsedSize poller (Chrome only, try/catch);
  write *-cdp.json sidecar; replace any casts with typed assertions
- perf/README.md: document dataset scoping, load block schema, cdp sidecar ([`d512112`](https://github.com/tsenoner/protspace/commit/d5121127ffa0db73ef9789a39bb0618c0c9685ae))

* perf: only measure tooltip height when tooltip data changes

_measureTooltipHeight() ran unconditionally at the end of every updated()
lifecycle and reads el.offsetHeight whenever a tooltip is visible, forcing a
synchronous layout reflow. Since updated() fires on every reactive change —
zoom/pan (_transform), selection overlays, and the self-triggered _tooltipHeight
update — a forced layout was paid on every frame while a tooltip was open.

Guard the measurement on changedProperties.has('_tooltipData'). The rendered
tooltip height derives purely from _tooltipData.view (the tooltip element binds
only .view), so that is the complete and sufficient signal. Clearing the tooltip
sets _tooltipData = null, which is itself a _tooltipData change, so the
null-reset of _tooltipHeight still fires. ([`dc5c149`](https://github.com/tsenoner/protspace/commit/dc5c1492a8c51ab3b452404ee6a06f6db6c87040))

* perf(docs-screenshots): rAF-based settle + wait for loading overlay

Replace fixed `waitForTimeout(1000/500/300)` calls in waitForDataLoad,
waitForLegend, and waitForControlBar with two requestAnimationFrame
ticks. Tighten polling from 500/1000 ms to 200 ms.

waitForDataLoad now also requires `_plotData` and `_scales` to be
populated AND the `#progressive-loading` overlay element to be removed
from the DOM — without the latter, screenshots could land during the
overlay's 500 ms fade-out and capture the loading screen on top of an
already-rendered plot.

Refresh all docs/explore/images/* assets with the new pipeline. ([`53bc7c8`](https://github.com/tsenoner/protspace/commit/53bc7c865c501b6766d176211ce58ad4dd6ac264))

* perf(docs-screenshots): share one page across the static suite

Static screenshots used to do `page.goto('/explore')` + `waitForDataLoad`
in every per-test beforeEach (13 tests × ~3-5 s). Load the dataset once
in beforeAll and reset only the per-test mutations between tests
(injected callouts, open dropdowns/modals, structure viewer, filter
query). Cuts the static suite from ~60 s to ~22 s. ([`9ffbb52`](https://github.com/tsenoner/protspace/commit/9ffbb520c4a465ccaf7d50b3f2ef7ae14b5e51b7))

* perf(data-processor): bare PlotDataPoint, strip annotation Records ([`d39d1c0`](https://github.com/tsenoner/protspace/commit/d39d1c0594612a355d46ce758ff440ab5c9d96d7))

* perf(scatter-plot): style-getters reads annotation values via accessor ([`7940a4b`](https://github.com/tsenoner/protspace/commit/7940a4bf4ac6863cf3e9f3880b06e0fb1663052f))

* perf(utils): tighten getProteinAnnotationValues hot-path loop

Indexed loop + pre-sized output, drop redundant Number.isFinite.
Called 573k+ times per render frame. ([`389ae6a`](https://github.com/tsenoner/protspace/commit/389ae6adfd980686bf1077259512b3eed730ce24))

* perf(bundle): keep projections + annotations separate, drop spread merge

extractRowsFromParquetBundle now returns annotationsById +
projections instead of materializing a per-row {...projection,
...annotation} merge. The optimized conversion path reads cells via
annotationsById.get(proteinId)[col] directly. The slow path
materializes a merged rows array internally (small-dataset
acceptable). Saves ~1.1M object allocations on sprot_50-scale
datasets. Adds mergeProjectionsForTesting helper for tests that
need to introspect merged row contents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`55ced7d`](https://github.com/tsenoner/protspace/commit/55ced7d79da41fbad7f8befb9b8796ae47a7d7c5))

* perf(data-loader): use Int32Array for single-valued categorical columns

Replaces the per-protein number[] allocation in extractAnnotationsOptimized
with Int32Array storage when maxValuesPerProtein <= 1 (no scores or
evidence) — the common case. Adds AnnotationData union type and accessor
module (getProteinAnnotationIndices, getProteinAnnotationCount,
getFirstAnnotationIndex, sliceAnnotationData). Consumers updated to route
through the accessor.

Cuts ~12M tiny array allocations on sprot_50-scale datasets, which
was the dominant heap pressure causing renderer OOM.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`5ff983d`](https://github.com/tsenoner/protspace/commit/5ff983db22c064901f88accf4d6608fac80162ac))

* perf(core): optimize data conversion pipeline (24.5s → 4.1s) ([`b7105e9`](https://github.com/tsenoner/protspace/commit/b7105e984d9b0d387cc9e57eb524e6354280ce04))

### Refactoring

* refactor(cli): group --help into intent panels with crisper summaries

Restructure 'protspace --help' so 'prepare' reads as the one-shot entry point
and the rest are specialized commands, grouped into panels: Start here /
Pipeline stages / Refine / Visualize (registration order drives panel + command
order). Add a quick-start block that steers users to the web app
(protspace.app/explore), tighten every command's one-line summary, and make the
per-command pages consistent: standardize --verbose (shared Opt_Verbose,
show_default=False), unify project's -i/-o/-f into one Input/Output panel, and
group stats/transfer options. 'project' summary drops 3D (web app is 2D-only);
pca3/umap3 and the local Dash serve 3D view are unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`1725bf8`](https://github.com/tsenoner/protspace/commit/1725bf87905f355451c7093b13be48e321bd974f))

* refactor(data-loader): drop redundant try/catch in readFormatVersion

The body cannot realistically throw (`?? []`, `.find`, `Number`), and its only
caller already wraps `parquetMetadata(...) + readFormatVersion(...)` in a
try/catch with the identical `formatVersion = 1` fallback. Remove the dead
inner defensiveness; the single call-site fallback still covers any parse
failure.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`2d4512e`](https://github.com/tsenoner/protspace/commit/2d4512ec6231f29f54b82956439df1340c513ed1))

* refactor(core): unify v1/v2 annotation parsers; reuse parsed parquet metadata on bundle load

parseAnnotationValueV1/V2 had byte-identical control flow apart from V2's
decodeField wrap on the label; fold them into one impl parameterized by a
label-decode strategy. Bundle load parsed part1's parquet footer twice
(once for format_version, again inside parquetReadObjects); parse once and
pass the FileMetaData into the read call instead.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017A9q6QZuqfUSVQv5iPqnWf ([`fb6be15`](https://github.com/tsenoner/protspace/commit/fb6be158780cb5aac01424431da5079925eb8943))

* refactor(scatter-plot): tidy reset-view capture path

Code-review cleanups on the resetView capture added for #294:
- Use the canonical d3.zoomIdentity in webgl-renderer instead of a
  hand-rolled `{ x: 0, y: 0, k: 1 } as d3.ZoomTransform`, matching every
  sibling and dropping the unsafe cast.
- Drop the no-op `?? undefined` in the badge-composite ternary; the
  downstream width/height guard treats null and undefined identically.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`335bb0b`](https://github.com/tsenoner/protspace/commit/335bb0b25e7bf34bfa9a45dcd5a469b6a0907d06))

* refactor(annotations): simplify v2 encoding/display internals from review

Quality cleanups from the /simplify pass (no behavior change):

- `encode_field` uses a `str.maketrans` table (single C-level pass) instead of
  a guard + per-char `dict.get` join; drop the now-redundant `not s` in
  `decode_field`'s guard (`"%" not in ""` is already True).
- Centralize the v2 decode gate as `ArrowReader.should_decode()` (uses the
  `BUNDLE_FORMAT_VERSION` constant), replacing the five copy-pasted
  `get_format_version() >= 2` literals across plotting/callbacks/style.
- `add_annotation_styles_bundle`: hoist the single `compute_value_frequencies`
  scan and reuse its keys for validation, dropping a second full-protein
  scan+decode per styled annotation.
- Drop the dead `if raw is None` branch in `_read_format_version` (`int(None)`
  is already caught).
- Correct the `to_display_value` docstring: it's the shared per-hit transform;
  the `;` multi-label split is layered on only by the style template.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`a27dc22`](https://github.com/tsenoner/protspace/commit/a27dc2259357fd1adfc69d18e0f7f837e9612fef))

* refactor(transfer): simplify EAT classification, bundle I/O, and overlay

- classification.classify: drop the per-protein row dict (rebuilt once per
  protein, empty for the common id-prefix-only rule) and index column_data
  directly; remove the unreachable missing-column guard in _matches (the
  up-front validation already raises). Accept a precomputed identifier list
  so callers don't re-materialize it.
- data/io/bundle.replace_annotations_in_bundle: route through the shared
  _parse_bundle decoder instead of a second hand-rolled delimiter split, so
  it preserves settings + statistics parts. A 5-part (statistics) bundle now
  round-trips instead of being rejected. write_bundle reuses
  _table_to_parquet_bytes, and replace_settings_in_bundle now runs the
  delimiter guard on every write path.
- data/io/predictions.add_overlay_columns: accept a precomputed identifier
  list so overlaying several columns onto one table doesn't re-materialize
  the id column on each call.

Adds round-trip tests for statistics-bearing bundle preservation.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`10f5119`](https://github.com/tsenoner/protspace/commit/10f5119698f5e150833f5bdaf746bd4eebf973e6))

* refactor(transfer): address PR #55 review — cosine default, bounded RI, protlabel as uv workspace member

Addresses reviewer (t03i) feedback on the EAT backend:

- Default metric for `protspace transfer` is now cosine (bounded, interpretable
  confidence); euclidean stays opt-in. The protlabel engine keeps goPredSim-canonical
  euclidean as its primitive default.
- Reliability index clamps to [0,1], guards negative distance, and maps non-finite
  (NaN/inf) distances to 0 so an invalid neighbour can't yield a high confidence.
  (NaN->1.0 bug found by our own xhigh review; redundant clamp dropped.)
- Drop the unused, heavy scipy dependency (only a docstring/test comment referenced it).
- Extract protlabel into a uv workspace member (packages/protlabel) with its own
  pyproject + dependencies (numpy only), published as its own distribution; protspace
  depends on protlabel>=4.4.0. No-protspace-imports boundary enforced by a test;
  lock-step versioning via semantic-release; CI + Docker build both packages.
- Move protlabel's engine tests into the member (packages/protlabel/tests); a bare
  `uv run pytest` covers both via testpaths.
- Rewrite the design spec to as-built reality (cosine default, brute-force + query
  batching, workspace architecture); drop the frontend (-> protspace_web), the
  ProtTucker/faiss speculation, and hardware-specific benchmarks.

Verified: 576 tests pass, ruff clean, `uv build --all-packages` produces both wheels
with a clean dependency boundary (protlabel requires only numpy).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`d1aaa88`](https://github.com/tsenoner/protspace/commit/d1aaa88de7516218d9f1c540f5c905a87a2aecae))

* refactor(transfer): drop __pred_source overlay column; keep numeric confidence

The per-cell prediction overlay now writes only <col>__pred_value and
<col>__pred_confidence. The reference id (source) is noise as a colour feature,
so it is dropped from the bundle; it remains available on protlabel's Prediction.
A legacy <col>__pred_source is dropped on re-run so older bundles are cleaned up.

Keeping confidence as a separate numeric column lets the web frontend colour and
threshold by reliability (gradient legend) — which inline label|score values do
not enable (those render tooltip-only).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`e4cf9b2`](https://github.com/tsenoner/protspace/commit/e4cf9b20c3c5a90ad4cc3f73fec4f7f93e3954b7))

* refactor(annotations): drop unused encoding metadata key, dedup GO properties, document bundle -a trust boundary

- Remove write-only protspace_encoding parquet metadata key (redundant with
  protspace_format_version, nothing reads it).
- Extract _go_terms_encoded() helper to dedup go_bp/go_mf/go_cc parsing.
- Document the bundle -a annotations trust boundary (assumed already
  percent-encoded by the same-version annotate/prepare pipeline).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017A9q6QZuqfUSVQv5iPqnWf ([`15e45b4`](https://github.com/tsenoner/protspace/commit/15e45b4f8e37b5fd938ef25e5561ccab91c03e9d))

* refactor(stats): high_dim_metric stacked 'info.metric or default_metric or euclidean' redundantly; normalise default_metric once so the fallback lives in one place

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`a53a674`](https://github.com/tsenoner/protspace/commit/a53a674448624369f5c7ed23dcb251a2fcf90dbc))

* refactor(stats): the elbow _Labeling tuple was copy-pasted for the primary and fallback cases; build it via a local _elbow_labeling() helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`e0ef2aa`](https://github.com/tsenoner/protspace/commit/e0ef2aa41bad18413565a5f2710ae9fb4efd422b))

* refactor(stats): DEFAULT_SAMPLE_THRESHOLD was defined identically in three metric modules; hoist it to stats.base and import it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`6c9d308`](https://github.com/tsenoner/protspace/commit/6c9d308c45288418350a5be96560ff62703e11af))

* refactor(stats): annotation_select re-listed the missing-value tokens that standardize_missing hardcodes; share them via core.constants.MISSING_VALUE_TOKENS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`5169a2b`](https://github.com/tsenoner/protspace/commit/5169a2bdd4ab8b97e75f7ee579d3f52ca7244896))

* refactor(stats): address final-review nits (docstrings, validation, extra-copy, cleanups)

Fixes six minor findings from the whole-branch review of the
annotation-based cluster-validity feature: stale eight-column docstrings
in stats/base.py, a strict "auto" guard in cli/stats.py that didn't match
the parser's normalised comparison, a shared/aliased `extra` dict across
StatRows in annotation_validity.py, an unused np.unique return in
validity.py, a duplicated _clean() call in annotation_select.py, and a
doc/notebook wording+formatting nit.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`817a704`](https://github.com/tsenoner/protspace/commit/817a70453067e0ff1f7f6dfdd2e826c435bd6485))

* refactor(stats): drop auto-cluster self-validity, add ARI/NMI agreement

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`ef7d13f`](https://github.com/tsenoner/protspace/commit/ef7d13fcd6c3ac55f0e2eb114745cc26dd8c6f8c))

* refactor(stats): rename elbow membership column to cluster_elbow_<proj> + sync docs

- Rename the elbow clustering's membership column cluster_<proj> -> cluster_elbow_<proj>
  so both selections are explicitly named (cluster_elbow_ / cluster_silhouette_).
  The column name is the only provenance signal that survives to the frontend
  (AnnotationColumn.extra is dropped at carriage), so name the method in it.
- Bring docs + notebook current with the whole extras feature set (they only
  reflected the base PR): --cluster-selection, silhouette-as-attached-score
  (no separate silhouette_ column), and the local/global faithfulness split.
  Updated docs/cli.md, CLAUDE.md, README.md, ProtSpace_Preparation.ipynb.

574 fast tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`adfeacf`](https://github.com/tsenoner/protspace/commit/adfeacf13d904678f365f94e2822490acf4ba1e1))

* refactor: use _run_with_overridden_config in precomputed-MDS branch

The precomputed-MDS branch in _run_reductions was the last call site
still mutating self.base.config in place (set precomputed=True, then
pop() after). Migrate it to _run_with_overridden_config so:

- The save/restore pattern is consistent across all reduction call sites.
- A precomputed flag can no longer survive in base.config if
  process_reduction raises mid-call.

Regression tests cover both the happy path (flag is set during
reduction, cleared after) and the exception path (flag is cleared
even when reduction raises).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`70ff7c8`](https://github.com/tsenoner/protspace/commit/70ff7c8380f7c2e298044d99a08e8ee57afd6892))

* refactor: extract _run_with_overridden_config and dedupe project loop

- Add _run_with_overridden_config(base, effective_params, method, dims, data)
  to pipeline.py to centralize the save/restore pattern for BaseProcessor.config.
  A leaked `precomputed` flag (or any temporary key) can no longer survive
  across reduction calls.
- Update ReductionPipeline._run_reductions and cli/project.py to use both
  the new helper and disambiguation_suffix. cli/project.py previously set
  base.config without restoring it; this is now handled in one place.
- Hoist the lazy in-test imports added in the previous commit to the top-level
  import block in tests/test_pipeline_utils.py.

Addresses PR #48 review feedback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`218fed0`](https://github.com/tsenoner/protspace/commit/218fed0317d105e7e0ae016c4eb41b0a2384ae66))

* refactor: extract disambiguation_suffix helper

Centralize the param-suffix rule used by ReductionPipeline._run_reductions
into a single helper so cli/project.py can share it (follow-up commit).

Includes a regression test for the mixed plain+override case
(`-m umap2 -m umap2:n_neighbors=50`) which currently emits "ProtT5 — UMAP 2"
and "ProtT5 — UMAP 2 (n=50)".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`58712e0`](https://github.com/tsenoner/protspace/commit/58712e06113c8327f4bb1ac507361588a5548ab6))

* refactor: extract shared paginated_get() utility for REST API calls

Consolidate the duplicated Link-header pagination loop (4 instances
across uniprot_retriever, taxonomy_retriever, and uniprot_parser) into
a single paginated_get() function in http_utils.py. Each caller is
now a 1-3 line function.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`c5094b4`](https://github.com/tsenoner/protspace/commit/c5094b400398ac150de844d7d8f3b31beb513f07))

* refactor: complete Colab notebook rewrite for bulletproof UX

Addresses NAR reviewer feedback: "ProtSpace processing failed with
return code: 2" with no explanation. The notebook is now bulletproof.

## Notebook Architecture (3 cells)

Cell 1 — Install & Setup (~30s):
- pip install under %%capture (zero output)
- tqdm patched for notebook-style progress bars before protspace import
- Pre-import protspace pipeline (lightweight — heavy reducers deferred)

Cell 2 — Choose Input Data (4 tabs):
- Example Dataset: auto-selects first dataset on cell run, downloads
  from GitHub releases on dropdown change (no button needed)
- Upload H5: HDF5 embedding upload with validation (groups, 2D squeeze,
  per-residue detection, protein count, dim, dtype reporting)
- Upload FASTA: sequences for on-the-fly embedding via Biocentral API
- UniProt Query: direct protein fetch with example queries
- Embedder multi-select shown only for FASTA/Query tabs
- Dark mode fix: CSS in same cell as Tab widget (per-cell iframes),
  bridges --jp-ui-font-color0 missed by Colab's colabtools#1895

Cell 3 — Generate & Download:
- Direct Python pipeline calls (no subprocess, no 30s import overhead)
- Step indicators: 1/4 Loading → 2/4 Annotations → 3/4 Reducing → 4/4 Bundling
- Annotation caching via keep_tmp (re-runs skip API fetching)
- CSV/TSV upload for custom annotations (merged with API data, CSV wins)
- Annotation presets: Default, All, Custom (no None option)
- Auto-download on completion (no separate download cell)
- Method parameter sliders with overflow:hidden (no scrollbars)
- Taxonomy note inline with annotation controls

## Package Changes (already committed separately)

- fix: skip taxonomy/interpro fetch when not requested (manager.py)
- perf: extract constants.py — pipeline import 2.96s → 0.30s
- perf: lazy per-method reducer imports — PCA skips umap/pacmap/numba
- feat: CSV annotation support in protspace prepare pipeline
- docs: update annotations.md/cli.md command names and CSV docs
- fix: better error handling in CLI (sys.exit(1) + stdout errors)
- fix: harden HDF5 loading (groups, 2D squeeze, dim validation)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`78d5d16`](https://github.com/tsenoner/protspace/commit/78d5d1612ddc1251438ac4cdd565b00ce0ac6ec4))

* refactor: run CI on all branches, not just main/stage

Support feature-branch workflow by triggering CI on every push
and PRs targeting main.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`1b713c1`](https://github.com/tsenoner/protspace/commit/1b713c1dfda42099b830ff00789496611f663b8b))

* refactor: simplify CI/CD — consolidate workflows, add Python version matrix, use GitHub App auth

- Remove jekyll-gh-pages.yml (no Jekyll site exists)
- Remove unused requirements-py310/311/312.txt and update_deps.sh
- Merge python.yml + docker.yml into single publish.yml (no Render deploy)
- Replace expiring SEMANTIC_RELEASE_TOKEN PAT with GitHub App token
- Fix UV_TOOL_DIR/cache path mismatch in release.yml
- Add Python 3.10/3.11/3.12 test matrix to ci.yml
- Remove continue-on-error from ruff format check
- Simplify [tool.semantic_release] config in pyproject.toml

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b7b8f91`](https://github.com/tsenoner/protspace/commit/b7b8f91b271c8dad61bbfb1bf5224925e71745d5))

* refactor: remove JsonReader, unify Dash frontend on ArrowReader

ArrowReader now accepts both Path (Parquet files) and dict (in-memory
data), fully replacing JsonReader. All Dash frontend code migrated.

- ArrowReader.__init__ accepts Path | dict via isinstance dispatch
- Delete json_reader.py (97 lines) and readers.py (105 lines)
- Remove JSON file input from main.py detect_data_type()
- Remove default_json_file param from ProtSpace.__init__
- Fix wsgi.py broken API call (was using removed param)
- Remove LEGACY_OUTPUT_DATA from test fixtures
- Remove commented-out dead code from app.py
- Clean up data/io/__init__.py exports

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`693685d`](https://github.com/tsenoner/protspace/commit/693685ded0736ae250345c2ed242fcc17fd1cea4))

* refactor: consolidate parameter passing with config dataclasses

Introduce config objects to reduce parameter threading across the
codebase. Adding a new CLI flag now requires ~4 changes instead of
12-14.

- New cli/common_options.py: shared Typer option types (Opt_Methods,
  Opt_Metric, Opt_NNeighbors, etc.) used by both prepare and project
  commands, eliminating duplicated definitions.
- New EmbedConfig frozen dataclass: consolidates embedding params
  (batch_size). Passed as single object through embed_fasta() →
  embed_sequences() instead of threading individual args.
- New ReducerParams frozen dataclass: replaces dict[str, Any] in
  PipelineConfig with typed, IDE-friendly config. Converted to dict
  via asdict() at the BaseProcessor boundary.
- Simplified _write_run_log(): from 22 keyword params to 14 by
  accepting config objects and auto-serializing via asdict(). New
  config fields appear in the log automatically.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`360af60`](https://github.com/tsenoner/protspace/commit/360af606616666867f4babcf5700fa946505d5cc))

* refactor(cli): normalize flags, remove legacy JSON format, ruff format

Breaking changes:
- --no-scores → --scores/--no-scores (default: ON, pass --no-scores
  to strip). Internal APIs unchanged (PipelineConfig.no_scores stays).
- --non-binary removed — legacy JSON output format dropped. Only
  Parquet and .parquetbundle output remain.
- --half-precision removed — not implemented in Biocentral server.

Cleanup:
- Delete NumpyEncoder, create_output_legacy(), save_output_legacy()
  from base_processor.py.
- Remove non_binary from PipelineConfig, AnnotationManager, pipeline.
- Remove JSON code paths from add_annotation_style.py.
- Delete PfamExplorer_ProtSpace.ipynb (depended on JSON format).
- Add ankh3-large to ClickThrough_GenerateEmbeddings.ipynb dropdown.
- ruff format across all src/ and tests/ (19 files).
- Remove 4 legacy JSON test cases.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ab77ee4`](https://github.com/tsenoner/protspace/commit/ab77ee4a8caed178eac407fda4a640217e79f58a))

* refactor: remove dead code, non-pLM embedders, and outdated references

Dead code removal (-794 lines):
- cli/app.py: remove parse_custom_names(), determine_output_paths(),
  compute_cache_hash() and unused hashlib/Path imports
- pipeline.py: remove unused custom_names field from PipelineConfig
- utils/analyse_json.py: delete unregistered CLI utility
- utils/add_annotation_style.py: remove dead argparse main()
- examples/cli/protspace_local.py, protspace_query.py: delete old examples
- tests/test_output_combinations.py: remove test classes for deleted functions

Code quality:
- query.py: unify identifier parsing via parse_identifier() from h5.py
- biocentral.py: remove non-pLM embedders (one_hot, blosum62, aa_ontology,
  random) from MODEL_SHORT_KEYS

Documentation:
- Fix -e syntax in README.md, CLAUDE.md, docs/cli.md (comma-separated)

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`e3275c0`](https://github.com/tsenoner/protspace/commit/e3275c08ecb699fc40b84fc68da85effb93ac17b))

* refactor(data): extract input loaders into data/loaders/ package

Create composable loader functions extracted from LocalProcessor and
UniProtQueryProcessor, preparing for the unified ReductionPipeline.

- data/loaders/embedding_set.py: EmbeddingSet dataclass (name, data, headers,
  precomputed, fasta_path)
- data/loaders/h5.py: load_h5() with PLM name resolution from H5 attrs,
  CLI override, or error. Extracted from LocalProcessor._load_h5_files
- data/loaders/fasta.py: embed_fasta() via Biocentral API, writes model_name
  attr to H5. Extracted from LocalProcessor._embed_fasta_to_h5
- data/loaders/query.py: query_uniprot() for FASTA download from UniProt REST
  API. Extracted from UniProtQueryProcessor._search_and_download_fasta
- data/loaders/similarity.py: compute_similarity() via MMseqs2, returns
  EmbeddingSet(precomputed=True, name="MMseqs2"). Extracted from
  UniProtQueryProcessor._get_similarity_matrix
- LocalProcessor._collect_datasets now delegates to loaders.h5

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`1fa1fe9`](https://github.com/tsenoner/protspace/commit/1fa1fe9210df45fa27632626045bee2c9f37a7bd))

* refactor(annotations): remove length binning, promote raw `length` to user-facing annotation

Length binning (`length_fixed`, `length_quantile`) is moved to the frontend
(protspace_web). The backend now exposes raw `length` as a regular annotation
in the default group. Deleted `LengthBinner` class and all associated plumbing
(configuration constants, transformer wiring, manager binning logic, internal
column filtering). Updated CLI help, docs, examples, notebook, and tests.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ef135b8`](https://github.com/tsenoner/protspace/commit/ef135b87180e73ea7d4b272d1533ed70394cbbd4))

* refactor(notebooks): improve both Colab notebooks

ProtSpace_Preparation.ipynb:
- Fix -f → -a CLI flag bug
- Add CSV metadata upload widget
- Complete annotation lists (all UniProt + InterPro)
- Remove legacy JSON output option
- Simplify code (~43% line reduction), consolidate imports
- Apply ruff check + format

ClickThrough_GenerateEmbeddings.ipynb:
- Add adaptive batched embedding (sorted by length, auto-halves on OOM)
- Set comparison to skip already-computed embeddings upfront
- Fix HF login: wrap userdata.get in try/except, actually call hf_login
- Use torch.inference_mode() in both embed paths
- Use tqdm.auto for proper notebook widget rendering
- Split config form from function definitions
- Rename variables for clarity (MODEL_SHORT_KEYS, preprocess_sequences)
- Apply ruff check + format

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`c37aada`](https://github.com/tsenoner/protspace/commit/c37aada1e06245ec419ca11d341028f380955f63))

* refactor(annotations): rename gene_symbol to gene_name

Rename the gene_symbol property to gene_name across the codebase for
simpler and more intuitive naming. ([`6be3e41`](https://github.com/tsenoner/protspace/commit/6be3e41e36c4f11abc9048688d3d304de3ecb0a8))

* refactor(cli): update to use public LocalProcessor API

Update CLI to call public methods instead of private ones:
- _load_input_file() → load_input_file()
- _load_or_generate_metadata() → load_or_generate_metadata()

No functional changes, just using the now-public API. ([`32d64ea`](https://github.com/tsenoner/protspace/commit/32d64ea7f41051822a7d5691685347342cf17f76))

* refactor(data): remove backward compatibility code

- Delete old base_data_processor, local_data_processor, uniprot_query_processor
- Delete old feature_manager and feature_retrievers/ directory
- Update __init__.py to export only new module paths

Breaking change: removes all backward compatibility aliases ([`6b7e001`](https://github.com/tsenoner/protspace/commit/6b7e0010dcc511e0e08393507d13a099b700a681))

* refactor(data): restructure into modular architecture

- Create features/ module with configuration, manager, and merging
- Add retrievers/ subdirectory with uniprot, taxonomy, interpro
- Add transformers/ subdirectory with feature transformations
- Create io/ module with readers, writers, and formatters
- Create processors/ module with base, local, and query processors

This modular structure improves maintainability and testability ([`32b87c9`](https://github.com/tsenoner/protspace/commit/32b87c9d9450f96ef4e6b1ac6ebb0f443e1270f3))

* refactor(data): simplify feature processing and remove backward compatibility

- Remove backward compatibility for old cc_subcellular_location format
- Consolidate annotation_score handling (remove annotation alias)
- Process cc_subcellular_location as semicolon-separated values
- Update UNIPROT_FEATURES constant to match new parser properties
- Assume clean data format from unipressed/UniProtEntry parser ([`77c3ca9`](https://github.com/tsenoner/protspace/commit/77c3ca9678237c951a502dd66dc9ed837102f81a))

* refactor(ui): rename missing value label from <NaN> to <N/A>

- Standardize missing value display to '<N/A>' across UI and processing ([`6d3d3ff`](https://github.com/tsenoner/protspace/commit/6d3d3ff4fe458a04dca58fe7031dda64bf7c21be))

* refactor: improve CLI examples with better documentation and user-friendliness

- Add comprehensive docstrings and shebang lines
- Improve error handling and user feedback
- Fix import sorting issues
- Add input validation for local data example
- Enhance comments and parameter explanations
- Make examples more professional and user-friendly ([`8420be3`](https://github.com/tsenoner/protspace/commit/8420be3ef120bffe1fdad44a8bf6d9733ad6da5c))

* refactor(vis): fix ruff linting issues in visualization module

- Fix C408: Replace dict() calls with dictionary literals (6 instances)
- Fix ARG001: Replace unused is_3d parameter with underscore
- Improve code consistency and readability
- Follow modern Python best practices for function parameters ([`bf66e32`](https://github.com/tsenoner/protspace/commit/bf66e3274222f4fb4358fc7415c93faf25d7d634))

* refactor(utils): fix ruff linting issues in utility modules

- Fix B904: Add proper exception chaining with 'from e' (2 instances)
- Fix C401: Replace generators with set comprehensions (2 instances)
- Fix C416: Replace list comprehension with list() call
- Improve error handling and code efficiency
- Follow modern Python exception handling practices ([`adac124`](https://github.com/tsenoner/protspace/commit/adac124fe145da51bbe83fb157b7315450175c88))

* refactor(ui): fix ruff linting issues in UI callbacks

- Fix C408: Replace dict() calls with dictionary literals (5 instances)
- Fix C414: Remove unnecessary list() call in sorted()
- Improve code formatting and consistency
- Follow modern Python best practices ([`99c4998`](https://github.com/tsenoner/protspace/commit/99c49982bc263b11dcab6d8a1eba50fecf0095c3))

* refactor(data): fix ruff linting issues in data processing modules

- Fix B007: Replace unused table_name with underscore in loop
- Fix C414: Remove unnecessary list() call in sorted(set())
- Add missing trailing comma in INTERPRO_MAPPING
- Improve code quality and follow modern Python practices ([`bd1c0c5`](https://github.com/tsenoner/protspace/commit/bd1c0c5a51cbb1cede9b1f461a316008c605cc73))

* refactor(utils,vis): modernize utility and visualization modules with ruff auto-fixes

- Update type annotations to modern syntax
- Reorganize imports with proper sorting
- Replace dict() calls with literals
- Update deprecated imports
- Improve code formatting and consistency
- Enhance error handling and logging
- Optimize set comprehensions and generator expressions ([`2afe075`](https://github.com/tsenoner/protspace/commit/2afe075bd1240a7c6db9f38e6c7be7dcea88c963))

* refactor(ui): modernize UI and application modules with ruff auto-fixes

- Update type annotations to modern syntax
- Reorganize imports with proper sorting
- Replace dict() calls with literals
- Update deprecated imports
- Improve code formatting and consistency
- Enhance error handling and logging ([`a130203`](https://github.com/tsenoner/protspace/commit/a130203cef7420b9d30dfa49b6bec9fa2614bc0a))

* refactor(cli): modernize CLI modules with ruff auto-fixes

- Update type annotations to modern syntax
- Reorganize imports with proper sorting
- Replace dict() calls with literals
- Update deprecated imports
- Improve code formatting and consistency
- Enhance error handling and logging ([`0de08db`](https://github.com/tsenoner/protspace/commit/0de08db7df944032bea9834dd52777dffbf8a6d1))

* refactor(core): modernize core modules with ruff auto-fixes

- Update type annotations to modern PEP 585/604 syntax
- Reorganize imports with proper sorting
- Replace dict() calls with literals
- Update deprecated imports
- Improve code formatting and consistency ([`06c6114`](https://github.com/tsenoner/protspace/commit/06c6114bf8b7c54e78670934eff248358c2fc2ac))

* refactor(imports): update imports to reflect new module structure

- Update main __init__.py to import from .app instead of .server
- Update app.py imports for ui.callbacks and core.config
- Update main.py to use core.config
- Update ui module imports (callbacks, layout, styles)
- Update visualization/plotting.py imports
- Update data/feature_manager.py to import from feature_retrievers
- Add proper exports in ui/__init__.py

All imports now reference the new directory structure. ([`2478883`](https://github.com/tsenoner/protspace/commit/2478883c62144070b3e79b7847a2ed0c11c276c4))

* refactor(structure): reorganize codebase into logical module directories

- Move ProtSpace class from server/app.py to root app.py
- Create core/ module for configuration and constants
  - Move config.py to core/config.py
  - Rename helpers.py to core/constants.py for clarity
- Create data/feature_retrievers/ subdirectory
  - Move interpro_feature_retriever.py
  - Move taxonomy_feature_retriever.py
  - Move uniprot_feature_retriever.py
- Reorganize UI components
  - Move callbacks.py from server/ to ui/
  - Move styles.py from root to ui/
- Move molstar_helper.py to visualization/molstar.py
- Remove server/ directory (now empty)

This improves code organization and follows Python packaging best practices. ([`1f9a000`](https://github.com/tsenoner/protspace/commit/1f9a000e089b36e3dfab62723306541f86a9415b))

* refactor: simplify download_plot and save_plot functions

- Remove strict width/height requirements for 2D plots
- Eliminate unused parameters in download_plot callback
- Add proper HTML file handling in generate_plot
- Improve code maintainability and compatibility ([`b8d2ef6`](https://github.com/tsenoner/protspace/commit/b8d2ef6d7f566832df42c67ee2bf2b407f565091))

* refactor: renamed --metadata to --features

- Renamed -m, --metadata to -f, --features, making it more descriptive
- Updated the test
- Updated the examples
- Updated the README ([`4ada78c`](https://github.com/tsenoner/protspace/commit/4ada78c5f8f67a997dba8796743bc0b5a457acf5))

* refactor: remove old test files and add tests for the data module ([`a78083b`](https://github.com/tsenoner/protspace/commit/a78083be29e6b6ab304eeed08ba727b51ffb7d24))

* refactor: enhance data input handling in main.py for ProtSpace

- Consolidated JSON and Arrow directory input into a single argument.
- Implemented a new function to detect data type and validate input paths.
- Updated ProtSpace initialization to accommodate the new input structure. ([`b9da5dc`](https://github.com/tsenoner/protspace/commit/b9da5dcee1a2e68bf371db061ee64351aabf8a22))

* refactor: update import paths and modify ProtSpace initialization in image_creation.py

- Changed import of ProtSpace to a direct import from protspace.
- Updated initialization in image_creation.py to use arrow_dir instead of json_file.
- Cleaned up __init__.py to reflect the new import structure and removed unused imports. ([`a94f4bf`](https://github.com/tsenoner/protspace/commit/a94f4bfe24a273de60b1646c4f4575204db2898a))

* refactor: change data type conversion to np.float32 in BaseDataProcessor ([`bf4315a`](https://github.com/tsenoner/protspace/commit/bf4315ac7e8a454cc4deff54a884c5a459e61791))

* refactor: remove sp filtering from UniProt query processing, users should provide the exact query themselves ([`62e83ce`](https://github.com/tsenoner/protspace/commit/62e83ce058cc860a16bb330033584ff9007e9b6a))

* refactor: restructure data processors with inheritance-based architecture

- Replace prepare_json.py with modular BaseDataProcessor and LocalDataProcessor classes
- Extract common data processing logic into BaseDataProcessor base class
- Refactor UniProtQueryProcessor to inherit from BaseDataProcessor
- Move local data CLI functionality to dedicated cli/local_data.py module
- Update entry points and imports to reflect new module structure
- Improve code organization and reduce duplication across processors

Breaking change: rename protspace-json CLI command to protspace-local ([`d4abd64`](https://github.com/tsenoner/protspace/commit/d4abd643fa023770a87d7b55b405ea417b6133d1))

* refactor: update import paths to use absolute imports for consistency and clarity ([`3fa72cb`](https://github.com/tsenoner/protspace/commit/3fa72cb952d1dcd5cacf44f4eed6d81bb08eceea))

* refactor: update import paths and clean up whitespace in various files; enhance .gitignore to include additional data directories ([`d3baf0e`](https://github.com/tsenoner/protspace/commit/d3baf0e84be8892c727152e7fe8477eaedca9660))

* refactor(config): Centralize settings and simplify callbacks

This commit improves maintainability by centralizing configuration and reducing duplicated logic.

- Hardcoded side panel widths are now defined in `config.py`.
- A new `is_projection_3d` helper function was created to simplify dimension-checking logic in callbacks, removing redundancy. ([`5f3bad8`](https://github.com/tsenoner/protspace/commit/5f3bad82b3ef88123300c52bc7f39040df937266))

* refactor(ui): Overhaul codebase for maintainability and redesign help system

This commit introduces a major architectural refactoring to improve modularity, simplify logic, and enhance long-term maintainability. It also completely redesigns the help menu for better user experience and easier content management.

**Refactoring:**

- **Data Processing & Plotting:**
  - Eliminated the `data_processing.py` module by moving its data preparation logic directly into `plotting.py`, improving code locality.
  - The monolithic `create_plot` function was broken down into smaller, focused helper functions (`_create_base_figure`, `_add_legend_traces`, etc.) for significantly improved readability.
  - A new `helpers.py` module was created for general utility functions, starting with `standardize_missing`.

- **Callbacks:**
  - Replaced the complex, multi-purpose `toggle_side_panels` callback with a reusable `create_side_panel_callback` factory. This simplifies the logic for managing side panels and makes it easily extensible.

- **Layout:**
  - The `create_layout` function was streamlined to correctly initialize the application state from the main `ProtSpace` class, resolving multiple bugs.

**Features & Enhancements:**

- **Help Menu Overhaul:**
  - Re-implemented the help menu to use a robust, tabbed interface (`dbc.Tabs`).
  - Help content is now managed in separate, easy-to-edit Markdown files located in a dedicated `assets/help_content/` directory.
  - The "Interface Overview" tab now features interactive jump links that scroll to the relevant sections, created programmatically in the layout to ensure they always work correctly.
  - The layout for the overview tab is now generated with Dash HTML components to ensure the interface image displays reliably and scales correctly.
  - Added a main "ProtSpace Help Guide" title and removed redundant subheadings from content files for a cleaner UI. ([`614d843`](https://github.com/tsenoner/protspace/commit/614d843a4107703baec4e1ba1822af18ab6c624c))

* refactor(ClickThrough_GenerateEmbeddings): correct max_len handling ([`8e154ce`](https://github.com/tsenoner/protspace/commit/8e154ce9b0c1b464a33e3d4c66c3e526e073956b))

* refactor(ClickThrough_GenerateEmbeddings): streamline code structure and enhance functionality

- Updated cell metadata and IDs for better organization.
- Improved installation instructions by adding missing dependencies.
- Enhanced model setup logic to support additional models, including ProstT5, native ESM3 (open variant), and native ESMC (300m and 600m variants).
- Refined embedding computation to handle different model types and added length checks.
- Updated output file naming convention to include model type for clarity.
- Improved error handling for invalid sequence headers.
- Added optional Hugging Face login cell for models requiring authentication. ([`cacb174`](https://github.com/tsenoner/protspace/commit/cacb174e236b1c112396820563fe6f42786c77d9))

* refactor(prepare_json): Improve maintainability ([`1d6ebab`](https://github.com/tsenoner/protspace/commit/1d6ebabbb3dfdf63c7c1b41bd77a1dff5c693596))

* refactor(json-analysis): show all feature values on high verbosity ([`653cde4`](https://github.com/tsenoner/protspace/commit/653cde450bba7f18da11e182c14958db7fa1213b))

* refactor: check types ([`986395e`](https://github.com/tsenoner/protspace/commit/986395e1c3aa30e063019d1bc43c38f887622fd0))

* refactor: move pacmap dependence out of dev ([`21d30da`](https://github.com/tsenoner/protspace/commit/21d30da73b86f36f3abd58d5d028e32f33c389ba))

* refactor(monorepo): move app→apps/web and prep→apps/prep

Restructure into an apps/ layout ahead of the protspace history import:

- git mv app → apps/web (history preserved), services/protspace-prep → apps/prep
- repoint web config path refs: pnpm-workspace, root tsconfig, knip, package.json
  test:e2e, eslint globs, .gitignore, deploy.yml (app/dist), e2e.yml report paths
- fix escaping ../ imports broken by the extra depth (app/ 1-deep → apps/web/ 2-deep):
  tsconfig references, src/config.ts, Header.tsx, vite.config.ts, playwright REPO_ROOT
- repoint docs/public/{favicon,logo}.svg symlinks that targeted ../../app/public
- repoint prep build context: docker-compose.yml, publish-images.yml (trigger/context/dockerfile)
- keep @protspace/app package name (--filter unchanged); prep Dockerfile context-relative, no edits

Verified: pnpm install resolves the workspace; turbo type-check + knip + docs:build pass.
OpenSpec merge-protspace-monorepo tasks 2.1-2.3.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`76779f9`](https://github.com/tsenoner/protspace/commit/76779f95162754a3ad7a909ac21f2e9c1c9917fb))

* refactor(scatter-plot): apply code-review cleanups and guards

Follow-up fixes from a deep code review of the scatter-plot refactor:

- Cache gamma-correction uniforms instead of re-querying them per frame
- Guard the duplicate-stack viewport cache key against a k=0 divergence
- Use a spread-free reduce for legend zMax (avoids Math.max(...) overflow
  on very large legends)
- Share point-style staging between the full rebuild and the color-only
  recolor path via a new stagePointStyle helper
- Drop a dead picking host-interface member and the unused static export
  data-extent seam; dedupe the duplicate-stack collapse helpers
- Consolidate the 0.05 plot-padding constant into @protspace/utils
- Restore stubbed globals after the numeric-recompute runner test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`387363d`](https://github.com/tsenoner/protspace/commit/387363d53464605d238807ec9ead679e3039a817))

* refactor(scatter-plot): group helpers into feature subdirectories

Organize the flat scatter-plot/ helper files into feature folders so the directory is easier to navigate. No behavior change — only file moves (via git mv, history preserved) plus relative-import path updates.

New layout (entry, config, styles, perf, integration tests, and the webgl/ subtree stay at the root):

- tooltips/            protein-tooltip(+styles,+helpers), protspace-tips(+styles), tooltip-position, tooltip-height-estimate

- duplicate-stacks/    duplicate-badges-canvas-renderer, duplicate-stack-{helpers,overlay-controller,types,viewport}, spiderfy-layer

- interaction/         plot-interaction-controller, quadtree-index

- styling/             visibility-model, style-getters, numeric-recompute-runner

- projection-metadata/ projection-metadata(+styles) ([`7d363ac`](https://github.com/tsenoner/protspace/commit/7d363aca8ed4a4fb8a349953a20a1814930c1099))

* refactor(scatter-plot): drop dead numeric-recompute running flag

Remove the _running field and isRunning() method (no production caller — the host tracks busy state via runningAnnotation()); update tests to assert running state via runningAnnotation(). ([`7b658b7`](https://github.com/tsenoner/protspace/commit/7b658b7c21bacfeeb53a4e785f1baeb0c9027d4a))

* refactor(scatter-plot): dedupe duplicate-stack overlay helpers

- Extract pointInWindow() (duplicate-stack-viewport.ts); replace the inclusive-bounds predicate copy-pasted at 3 sites.

- Clear expandedAnchor on every collapse path (symmetric with closeExpanded).

- Merge the two byte-identical updateOverlays guard branches.

- Extract renderBadgesForViewport() shared by updateOverlays and redrawBadgesOnly. ([`c3a1cf0`](https://github.com/tsenoner/protspace/commit/c3a1cf07766120a2614d5ea3b0d4519e3d71b44f))

* refactor(scatter-plot): share point draw-state, unify export staging

Deduplicate WebGL code shared by the live and offscreen-export paths:

- Extract bindPointDrawState() (render-target.ts) for the shared point uniform/texture/VAO setup; used by renderPoints and renderOffscreenPoints.

- Extract buildPaintOrder() (point-staging.ts) as the canonical painter-order + selectedStartIndex staging; converge the export path onto it so export==live is structural (F-15 oracle stays green). Flatten the selectedStartIndex ternary.

- Make the blend/depth precondition local to the point draw (setPointBlendState inside bindPointDrawState).

- Add point-staging unit tests. ([`54c7fee`](https://github.com/tsenoner/protspace/commit/54c7fee22e20d14a4dc6beacf73098a8b2be3278))

* refactor(scatter-plot): B12 dead-code & doc cleanup (F-44,F-45,F-55,F-56,F-62)

Strict no-op: delete confirmed-dead, unconsumed symbols (verified via knip + repo-wide
grep) and collapse two transient duplicate types left by earlier batches. Every live
render path stays byte-identical.

- F-44: remove the dead per-point stroke plumbing end-to-end (getStrokeColor/getStrokeWidth
  getters + WebGLStyleGetters members + the wiring keys + the _getStrokeColor/_getStrokeWidth
  wrappers). The fragment shader's hardcoded strokeWidth=0.15 (the only stroke value the GPU
  uses) is untouched — that is what makes this a no-op.
- F-45: remove the unused VisibilityModel.tierOf + exported DisplayTier (the opacity/depth
  carriers getOpacity/getDepth/opacityOf/baseOpacityOf/isInteractive are untouched).
- F-55: remove the unused public getGamma/setGamma accessors (the gamma field, all its read
  sites, and getEffectiveGamma are kept).
- F-56: remove the deprecated no-op setSelectedAnnotation.
- F-62: rewrite the stale 'BIT-FOR-BIT replica' visibility-model comment to single-authority
  phrasing.
- Collapse (recon #7): webgl/types.ts ScalePair now re-exports the @protspace/utils ScalePair
  (single canonical definition; B6/F-54's transient duplicate removed).
- Collapse (from B5): duplicate-badges-canvas-renderer's local render-subset type folded onto
  RenderDuplicateStack = Pick<ViewportDuplicateStack,...> in duplicate-stack-types (single
  ViewportDuplicateStack definition).

Gates: type-check, core vitest (1231), utils vitest (301), build, lint (0 err), knip (reduced
unused surface), dead-ref grep clean; e2e figure-editor + brush-selection 12/12; visual 6/6
(0 drift) + F-01 + F-15 oracles still PASS. ([`2437cf6`](https://github.com/tsenoner/protspace/commit/2437cf6e7863efcd1cade5a1d8895c2a78b35b96))

* refactor(scatter-plot): B11 Lit reactivity & event-contract hygiene (F-19,F-31,F-57,F-47,F-46)

Tighten the Lit reactivity and event/type contracts; strictly behavior-preserving.

- F-19+F-31: new legend/legend-mapping-events.ts (typed LegendColorMappingDetail/
  LegendZOrderDetail per INV-07 + isLegend* runtime key-validation guards). The two
  legend handlers consume the typed details and early-return on malformed input;
  _zOrderMapping/_colorMapping/_shapeMapping are demoted from @state to plain fields
  (read pull-based in the style-getter closures, not in render()), so a legend mapping
  change renders ONCE via the imperative path (the INV-08 colorOnly branch intact)
  instead of twice — visually identical.
- F-57: drop the redundant explicit requestUpdate() in NumericRecomputeRunner (start +
  end); the setRunning() @state mirror (_numericRecomputeRunning) already schedules the
  Lit update. (The plan's L846/L904 were stale — the calls moved into the runner in B6.)
- F-47: type IScatterplotElement.config + scatterplot-sync-controller.updateConfig as
  Partial<ScatterplotConfig> (compile-time tightening; @ts-expect-error guard added).
- F-46: remove the unconsumed public numeric-recompute-start/-end CustomEvents (re-verified
  zero listeners; absent from INV-05). The runner's job-id stale-job guard + busy state are
  kept; the three committed tests that asserted the events (runner unit, B7/F-23, B2/F-05)
  are re-characterized to observe last-write-wins via the _numericRecomputeRunning mirror.

Gates: type-check, core vitest (1227), utils vitest (301), build, lint (0 err), knip;
e2e numeric-binning 41/41; visual 6/6 (0 drift) + F-01 + F-15 oracles still PASS. ([`0ec6d5d`](https://github.com/tsenoner/protspace/commit/0ec6d5d31d4c89e90a8480b2ffa85aae45a214f1))

* refactor(scatter-plot): B2 renderer lifecycle guards (F-35,F-11,F-05,F-12,F-16,F-21)

Construct the WebGLRenderer in exactly one place and make every teardown path safe;
strictly behavior-preserving on the connected happy path.

- F-35+F-11: extract _createWebglRenderer() (canvas + scale/transform/config closures +
  the 7-getter style bundle + _handleWebglContextLost) and route BOTH firstUpdated and
  _updateSizeAndRender through it. firstUpdated no longer unconditionally re-constructs a
  second renderer (the previous double-construction orphaned renderer #1).
- F-16: track _commitSelectionRafId and cancel it in disconnectedCallback, so a deferred
  selection commit whose RAF resolves after detach never dispatches — implemented by
  cancellation (matching F-05/F-10), NOT an isConnected body-guard, so the connected
  commit flow stays byte-identical.
- F-21: _renderWebGL early-returns when _webglRenderer is null (drops the two ! asserts),
  converting a post-context-loss TypeError into a no-op.
- F-05: already satisfied by B6/F-04 (NumericRecomputeRunner.cancel() bumps the job id +
  cancels the RAF; disconnectedCallback calls it) — added a characterization lock, no
  production change; did not re-introduce a host job-id field.
- F-12: already satisfied by B8 (PlotInteractionController.teardown() interrupts the 750ms
  resetZoom transition; disconnectedCallback calls teardown) — added a controller-level
  interrupt characterization, no production change; did not re-introduce a host svg field.

Tests: new scatter-plot.lifecycle.test.ts (5 findings) + an F-12 teardown-interrupt test on
PlotInteractionController. scatter-plot.test.ts unchanged.

Gates: type-check, core vitest (1212), utils vitest (301), build, lint (0 err), knip;
e2e dataset-recovery + brush-selection + numeric-binning 54/54; visual 6/6 (0 drift) +
F-01 + F-15 oracles still PASS. ([`fa61e66`](https://github.com/tsenoner/protspace/commit/fa61e66607b163dbcd5e0ef0262f23233e57e010))

* refactor(scatter-plot): B10 dedupe isolation render-refresh (F-33)

Collapse the byte-identical reprocess+rebuild-quadtree+invalidate-renderer-caches+refresh-
signature+requestUpdate+deferred-renderPlot sequence duplicated in isolateSelection() and
resetIsolation() into one private _reprocessAndRefresh(); both callers route through it.
resetIsolation keeps _lastDataRef = null BEFORE the call (the only divergence, forcing the
full-rebuild path). Strictly behavior-preserving: all event dispatches (data-isolation,
data-isolation-reset, data-change, auto-disable-selection) and their detail shapes are
untouched (INV-05), and getCurrentData stays the constrained isolated view (INV-04).

The plan's optional Step 8 (getCurrentData reslice via sliceVisualizationDataByIndices) was
already landed by B6/F-13 — verified present and skipped here (getCurrentData untouched).

Tests: render-refresh sequence + single-shared-impl characterization in
scatter-plot.isolation.test.ts (the _lastDataRef-null-before-reprocess divergence pinned).

Gates: type-check, core vitest (1206), utils vitest (301), build, lint (0 err), knip;
e2e isolation-dataset-swap 2/2; visual 6/6 (0 drift) + F-01 + F-15 oracles still PASS. ([`0b39cec`](https://github.com/tsenoner/protspace/commit/0b39cec57b93d186d2e03bc919ca1f76d15ea7f4))

* refactor(scatter-plot): B9 extract pure tooltip-position helper (F-34)

Lift the tooltip-positioning math out of scatter-plot._getTooltipStyle into a pure,
unit-testable tooltip-position.ts (computeTooltipStyle + named constants
TOOLTIP_EDGE_PADDING=15, TOOLTIP_MAX_WIDTH=350, TOOLTIP_ANCHOR_OFFSET_X=15,
TOOLTIP_ANCHOR_OFFSET_Y=60, TOOLTIP_FALLBACK_HEIGHT=160), mirroring the
tooltip-height-estimate precedent. The component delegates only the pure math; the
no-tooltipData early-return + height-resolution (_tooltipHeight ?? _estimateTooltipHeight)
are preserved. Byte-identical CSS output across all branches (interior, right-edge flip,
left/top clamps), proven by the parameterized computeTooltipStyle unit suite.

Strictly behavior-preserving: protein-hover dispatch (INV-03 bubbles, not composed), INV-05
detail shape, the async measure-token guard, and the four _tooltip* @state fields are
untouched; the finding's optional state-object clause is deliberately not exercised
(would change Lit reactivity keys — no carve-out).

Gates: type-check, core vitest (1203), utils vitest (301), build, lint (0 err), knip;
e2e multi-annotation-tooltip 3/3; visual 6/6 (0 drift) + F-01 + F-15 oracles still PASS. ([`3332479`](https://github.com/tsenoner/protspace/commit/3332479d440543072d6b2437226320a9ad50c540))

* refactor(scatter-plot): B8 interaction layer extraction (F-48,F-28,F-07)

Lift the fused d3 zoom/brush/lasso + RAF interaction layer out of scatter-plot.ts into a
cohesive PlotInteractionController; strictly behavior-preserving (event dispatch stays on
the host per INV-03/INV-05). scatter-plot.ts 2486 -> 2293 lines.

- F-48: demote _transform from @state to a plain field (render() never reads it) — removes
  the redundant per-zoom-frame updated()->_renderPlot() double-render; the zoom RAF + d3
  attr() transform keep the visual byte-identical.
- F-28: unify the duplicated hover/click hit-test into one pickInteractivePointAt (15px
  search radius, /3 point radius); both hover and click resolve the identical point.
- F-07: PlotInteractionController owns the d3 zoom/brush/lasso lifecycle, the SVG groups,
  and the zoom/lasso RAF handles, driven by a narrow PlotInteractionHost bridge; the host
  keeps _slotsToInteractiveIds + _commitSelection + all event dispatch (INV-03/05), plus
  _hoverRaf/_quadtreeRebuildRafId. teardown() interrupts the reset transition (incidental
  to F-12, which B2 owns — not claimed here). Thin _handleLassoEnd/_handleBrushEnd host
  shims keep scatter-plot.test.ts byte-identical.

Tests: new plot-interaction-controller.test.ts, scatter-plot.pick.test.ts,
scatter-plot.transform-reactivity.test.ts. The committed brush-selection.spec.ts (which
drives the brush/zoom programmatically through the now-relocated _brush/_brushGroup/
_svgSelection/_zoom) is re-pointed to plot._interaction.* — same asserted contracts.

Gates: type-check, core vitest (1196), utils vitest (301), build, lint (0 err), knip;
e2e brush-selection 8/8 + multi-annotation-tooltip 3/3; visual 6/6 (0 drift, incl. the
re-driven zoomed + selection views matching baseline) + F-01 + F-15 oracles still PASS. ([`fee4790`](https://github.com/tsenoner/protspace/commit/fee47903792c0ae74d9bee107427979fe533a92b))

* refactor(scatter-plot): B5 duplicate-stack/spiderfy/badge subsystem extraction (F-53,51,52,30,32,36,06)

Lift the ~450-line inline duplicate-stack overlay feature out of scatter-plot.ts into a
cohesive DuplicateStackOverlayController; strictly behavior-preserving (no carve-out).
scatter-plot.ts ~3017 -> 2486 lines.

- F-53: ViewportDuplicateStack named type replaces 8 inline record literals.
- F-51: computeViewportWindow + buildViewKey pure helpers (3 duplicated viewport blocks
  + 2 viewKey templates collapsed).
- F-52: cullAndCapStacks viewport-cull + top-N cap helper (replaces the inline filter +
  _capDuplicateStacksForRendering; DUPLICATE_BADGES_MAX_VISIBLE single source).
- F-30: DuplicateBadgesCanvasRenderer — the Canvas2D badge engine out of the component
  (byte-identical geometry/style constants).
- F-32: SpiderfyLayer — SVG ring build + pointer-capture click-synthesis (ring radius/
  angles + 16px/700ms click thresholds verbatim); event dispatch STAYS on the host via
  onActivate/onHover/onHoverEnd callbacks (INV-05/INV-03).
- F-36: production grouping reuses the shared buildDuplicateStacks helper (one impl).
- F-06: compose DuplicateStackOverlayController owning all state/schedulers/compute;
  component holds one _dupOverlay field and forwards; the B7/F-24 + duplicate-overlay
  Lock probes re-pointed to controller accessors with the same asserted contracts.

Gates: type-check, core vitest (1187), utils vitest (301), build, lint (0 err), knip;
visual 6/6 (0 drift, feature off by default) + F-01 + F-15 oracles still PASS. Duplicate-
stack UI is opt-in with no e2e project; unit + component-characterization coverage is the
behavioral guard. (Minor: duplicate-badges-canvas-renderer keeps a local render-subset
type; collapse onto duplicate-stack-types deferred to B12's sweep.) ([`b1695b3`](https://github.com/tsenoner/protspace/commit/b1695b30f7c84ec0fbf5c4c28ee238cd1274119f))

* refactor(scatter-plot): B6 data-derivation & cache correctness (F-60,59,54,13,40,17,04,18)

De-duplicate and harden the scatter-plot.ts data-derivation/caching surface;
behavior-preserving except two sanctioned changes.

- F-60/F-59/F-54 (trivial trio): single numeric-column read; DEFAULT_NUMERIC_BIN_COUNT
  const; createScales gets an explicit ScalePair|null return (ScalePair exported from
  @protspace/utils — utils can't import core webgl/types; the webgl/types alias stays a
  transient duplicate B12 collapses) and scatter-plot drops the redundant cast.
- F-13: sliceVisualizationDataByIndices(data, keptIndices) shared slicer in @protspace/utils
  (B10 reuses it); _getCurrentDisplayData + getCurrentData isolation branch delegate to it,
  which also realigns annotation_scores/annotation_evidence to keptIndices (latent fix,
  invisible to every current consumer; INV-04 preserved).
- F-40: memoize the filtered display-data rebuild (keyed by ref on materialized +
  filteredProteinIds + filtersActive + selectedProjectionIndex + projectionPlane);
  value-identical (same object ref on hit, full slice retained).
- F-17 (SANCTIONED bug fix, >=1M only): _buildQuadtree bumps a _quadtreeGeneration folded
  into the virtualization cacheKey + invalidates + renders, so un-hidden points reappear
  without a pan/zoom. <1M rendered pixels unchanged.
- F-04: extract NumericRecomputeRunner (job-id race per B7/F-23 + start/end events +
  running mirror + cancel-on-disconnect), all preserved exactly.
- F-18: split updated() into ordered named effects sharing one INV-11 geometry predicate;
  call order + every guard preserved verbatim.

Gates: type-check, core vitest (1164), utils vitest (301), build, lint (0 err), knip;
e2e numeric-binning 41/41 + isolation-dataset-swap 2/2; visual 6/6 (0 drift); F-01 + F-15
oracles still PASS. F-17 >=1M path validated by its committed unit-mechanism oracle
(scatter-plot.b6.test.ts); large-bundle fixture is local-only/absent here. ([`1456d6a`](https://github.com/tsenoner/protspace/commit/1456d6a4551c76a7413d4d1b5b57afb74564f693))

* refactor(scatter-plot): B4 WebGLRenderer god-class decomposition (F-50,F-61,F-29)

Shrink the 2105-line WebGLRenderer to a 1147-line facade (-958) by extracting its
natural seams; strictly behavior-preserving (no sanctioned change).

- F-50: route the remaining framebuffer-teardown triples through B3's existing
  destroyFramebuffer(gl,fb) (no new module).
- F-61: GLResources holder owns the GPU inventory (programs, 6 vertex buffers + quad,
  VAO, label texture, linearFramebuffer) with createAll/validate/deleteAll/reset;
  dirty-flag cache signatures stay on the renderer. validate() is a byte-faithful
  mirror of the original isRendererStateValid (deliberately does NOT check quadBuffer
  or linearFramebuffer — adding those would change when ensureGL resets).
- F-29: split into ContextLossController (single webglcontextlost listener per the
  post-B1 model; markLost idempotent -> onContextLost) and ExportRenderer (offscreen
  subsystem + inset math, consuming the B3 substrate, preserving the F-15 two-pass);
  shared point/gamma shader sources factored into export-shaders.ts. The facade
  preserves every public renderer method signature (the scatter-plot<->renderer contract).

Gates: type-check, core vitest (1144), utils vitest, build, lint (0 err), knip;
e2e dataset-recovery 5/5 + figure-editor 4/4; visual 6/6 (0 drift); F-01 + F-15
oracles both still PASS (split perturbs neither sanctioned behavior). ([`ab1f023`](https://github.com/tsenoner/protspace/commit/ab1f0236943bac0480c29de9f83fb22c30e3b26a))

* refactor(scatter-plot): B3 offscreen export pipeline consolidation (F-38,20,41,42,37,14,49,58,08,15)

Collapse the duplicated live-vs-offscreen WebGL pipeline in webgl-renderer.ts into
shared webgl/renderer substrate helpers, then rewire the offscreen export to consume
them (webgl-renderer.ts: -217 net lines).

New pure helpers (each + unit test, node-env mock GL):
- point-locations.ts  resolvePointLocations (F-38) — collapses 4 hand-spelled location records
- point-attributes.ts POINT_ATTRIBUTE_LAYOUT + setupAttributes (F-20)
- framebuffer.ts      createLinearFramebuffer + destroyFramebuffer(gl,fb) (F-41)
- render-target.ts    bindAndClearTarget + setPointBlendState (F-42) + drawPoints (F-15)
- gamma-quad.ts       QUAD_VERTICES + drawGammaQuad (F-37)
- stage-point.ts      stagePoint(10-arg, pre-scaled) + StagePointArrays/StagePointStyle (F-14)
- data-extent.ts      computeExtent/computePaddedExtent + DATA_EXTENT_PADDING (F-49)
- viewport-defaults.ts DEFAULT_VIEWPORT_WIDTH/HEIGHT (F-58)
+ PointAttribLocations/PointUniformLocations named types in webgl/types.ts.

F-08: omnibus rewire of initializeOffscreenContext/prepareOffscreenBufferData to the
helpers; deletes createOffscreenLinearFramebuffer + renderOffscreenGammaCorrection.
F-14 color-only live staging loop kept inline (documented exemption).

F-15 (SANCTIONED VISIBLE CHANGE): offscreen export gains the live two-pass selection
blend (records selectedStartIndex; both live renderPoints and renderOffscreenPoints now
route through the shared drawPoints). Live rendering is a pure extraction (byte-identical).

Gates: type-check, core vitest (1121), utils vitest, build, lint (0 err), knip (dead code
removed); e2e figure-editor 4/4; visual diff 7/7 (0 live drift); F-15 export==live oracle
PASS (two-pass branch exercised; luma conserved to 0.1%; residual is a pre-existing margin
framing offset, not a blend delta). ([`bb7b01e`](https://github.com/tsenoner/protspace/commit/bb7b01e4a3f593a3a0bc495d61ca64c89317e57a))

* refactor(scatter-plot): B1 WebGL context-loss lifecycle & recovery (F-43,F-39,F-01,F-10)

- F-43: destroy() now calls dispose() — single GPU-teardown owner, freeing
  buffers/VAO/textures/programs/framebuffer that the listener-only teardown leaked.
- F-39: delete the unreachable internal handleContextRestored handler + its
  webglcontextrestored listener (dead under the rebuild-on-loss strategy); drop the
  now-unused EMPTY_PLOT_DATA import.
- F-01 (SANCTIONED VISIBLE CHANGE): route programmatic context loss to recovery by
  moving onContextLost?.() into markContextLost() (inside its idempotency guard) and
  dropping the direct call from the DOM handler. Every loss path (DOM + programmatic
  ensureGL/isContextLost) now fires recovery exactly once instead of latching blank.
- F-10: guard the recovery microtask in _handleWebglContextLost with a generation
  token + isConnected check so a detached element (route change) or a superseded loss
  no longer reconstructs a renderer on a detached node.

Tests: new webgl-renderer.lifecycle.test.ts (F-43/F-39/F-01); F-10 case in
scatter-plot.test.ts (connect-then-disconnect variant — the verbatim plan sketch hung
on updateComplete for a never-appended Lit element); two B7 context-loss cases that
characterized the deleted restore handler reconciled to the new no-internal-restore reality.

Gates: type-check, core vitest (1100), utils vitest, build, lint (0 err), knip;
e2e dataset-recovery 5/5; visual diff 6/6 (0 drift); F-01 principled oracle PASS
(forced WEBGL_lose_context -> rebuild returns pixel-identical, non-blank canvas). ([`68b216c`](https://github.com/tsenoner/protspace/commit/68b216c9c83e81c0661376c89330f6831518f1b5))

* refactor(legend): drop dead app-side legend hidden-state

The core legend owns per-annotation hidden categories
(saveSettings/loadSettings + syncHiddenValues, keyed by datasetHash +
annotation). The interaction controller's `hiddenValues` field and
`handleLegendItemClick` only mutated write-only state that was never
pushed to the plot, and `handleAnnotationChange` always pushed `[]`
regardless of click history.

Remove the field, the handler, and its now-dead `legend-item-click`
listener; push `[]` directly and document why the core's async restore
runs after this synchronous reset. Behaviour-identical — the legend
hide/restore e2e tests still pass on Chromium, Firefox and WebKit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`82e88f2`](https://github.com/tsenoner/protspace/commit/82e88f27cdb1a9a82268811632ef121a5607c73c))

* refactor(app): use @theme inline for Tailwind v4 token mapping

The v4 migration mapped the design-system variables in a plain @theme
block, which also emits each token into :root as a redundant var(--…)
indirection — including the self-referential --shadow-glow:
var(--shadow-glow) — that resolved correctly only by cascade-layer
ordering (base wins over theme).

- Map color/gradient/radius tokens via @theme inline so the value is
  substituted into each utility with no redundant :root emission.
- Define shadow elevations as literal @theme values, since the Tailwind
  --shadow-* namespace collides with the same-named design tokens; the
  shadow values had no other consumer.
- Drop dead shadcn-template carryover with zero usages: the `dark` custom
  variant, the accordion keyframes/animations, and --ease-smooth.

Verified: build, type-check, format, lint, and the full unit-test suite
pass; the built CSS now has no self-referential vars and every utility
resolves to the real value.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`d6fde88`](https://github.com/tsenoner/protspace/commit/d6fde88c8d8bad5ac3657dbcc705eb57c6738539))

* refactor(scatter-plot): route visibility predicates through shared model ([`b8af564`](https://github.com/tsenoner/protspace/commit/b8af564925a10540877987ebb3f49c5b8af384e9))

* refactor(scatter-plot): delegate opacity semantics to visibility-model ([`fd5e33f`](https://github.com/tsenoner/protspace/commit/fd5e33f9ba68d88953b25427dbda1306d98432ad))

* refactor(scatter-plot): polish visibility-model per review

Remove dead Int32Array conditional in makeData, drop redundant
Object.is assertion, split the rule-3 multilabel test so the named
subject's fixture comes first, and add clarifying comments to the
hiddenMask bounds check and non-null assertions in visibility-model.ts. ([`ff64d82`](https://github.com/tsenoner/protspace/commit/ff64d82deebaad6bbffff22d631fc85cf78cf795))

* refactor(scatter-plot): consolidate pinned style-getter test fixtures ([`f39cf1a`](https://github.com/tsenoner/protspace/commit/f39cf1ae55dd8c0e4a9ece081de1503b794c24d7))

* refactor(control-bar): drop min/max hints from numeric input placeholders

The numeric filter's placeholder text showed the data's min/max
("min (4)", "max (1630)"). Removed at user request; placeholders are
now just "min" / "max". This also drops the now-unused
computeNumericBounds helper and the _dataBounds/_boundsAnnotation state
that only existed to feed those hints. ([`dda6b25`](https://github.com/tsenoner/protspace/commit/dda6b2546f486e3ac8cc6f86113e371917c7c362))

* refactor(control-bar): narrow numeric-changed handler event type ([`c897628`](https://github.com/tsenoner/protspace/commit/c897628abfffed89938fc2052baa67606f77b497))

* refactor(control-bar): drop unused isNumericCondition type guard ([`1dcd75b`](https://github.com/tsenoner/protspace/commit/1dcd75bf1e5bc1aa149b0eeb31592944c4621ffd))

* refactor(control-bar): drop dead isProjection3D and getProjectionPlane helpers

After the plane selector removal in earlier commits, these helpers
have zero remaining callers in packages/ or app/. Removed both
functions and their describe blocks from the test file.

Part of refactor for issue #196. ([`2dbcffc`](https://github.com/tsenoner/protspace/commit/2dbcffc6824a765955acaf0658ae74519bf43f63))

* refactor(data-processor): drop projectionPlane param + xz/yz remap

Removes the projectionPlane parameter from
DataProcessor.processVisualizationData and the conditional xz/yz
coordinate remap. 3D projections now collapse to coords[0] / coords[1]
on every code path. PlotDataPoint loses its optional z field; nothing
consumed it (scatter-plot's only write was removed in the previous
commit).

Test changes:
- Delete xz and yz plane-mapping tests.
- Replace 'preserves z coordinate for 3D projections' with
  'drops the z coordinate for 3D projections (rendered as 2D)',
  pinning the new contract.

Part of refactor for issue #196. ([`7ae6f74`](https://github.com/tsenoner/protspace/commit/7ae6f743797dab9d1e1cef76a09b171d45be6b27))

* refactor(scatter-plot): drop projectionPlane property and dead z assignment

Removes the projectionPlane Lit property, the xz/yz coordinate remap,
the point.z = coords[2] write (a write-only assignment with no readers),
and the projectionPlane entries in the _processData change-detection
gates. The data-processor call now passes four args; the unused fifth
parameter on data-processor itself is removed in a follow-up commit.

3D Parquet inputs now render using coords[0] / coords[1] only, matching
the historical default plane ('xy') that the property defaulted to in
production.

Part of refactor for issue #196. ([`1ed4afc`](https://github.com/tsenoner/protspace/commit/1ed4afcebd094a4d43a76758da6b424ca462a225))

* refactor(control-bar): remove 3D plane selector and projectionPlane plumbing

Drops the Plane (XY/XZ/YZ) <select>, handlePlaneChange, the
projection-plane-change CustomEvent, the projectionPlane @property,
and the cross-element assignment that pushed the plane onto the
scatter-plot. Also drops projectionPlane? from ScatterplotElementLike.

Helpers isProjection3D and getProjectionPlane are no longer imported
here; they are deleted in a follow-up commit. The scatter-plot still
owns its projectionPlane property in this commit; cleaned up next.

Part of refactor for issue #196. ([`f3c4030`](https://github.com/tsenoner/protspace/commit/f3c4030db687e61dbf2d673e052f4a8e3dcf74a3))

* refactor(annotations): move the dropdown ⓘ icon to the left of the label

The info popover floats out the left of the panel, but the ⓘ was on the right of
the row — so reaching the bubble meant dragging the pointer across the whole panel
(~450px). Make the ⓘ a leading icon (just after the selection indicator), so it
sits right where the bubble appears: the icon→bubble hop drops to ~45px, the arrow
points at a nearby icon, and the ⓘ column moves to the left while labels and the
right-hand visibility toggle stay put. Verified with real pointer movement (open on
hover, glide in, "Learn more" reachable).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`d10f854`](https://github.com/tsenoner/protspace/commit/d10f8545d0970b4a7a3913f4669a450f35e5a33f))

* refactor(prep): apply review fixes — bugs, dead code, and Caddy dedup

Backend:
- Stream bundle via FileResponse + BackgroundTask (no full read into memory)
- ExceptionGroup handling joins all PipelineFailure messages instead of
  dropping siblings
- Switch JobState timestamps to time.time() to match sweep's mtime check
- FastaValidationError exception handler collapses three 400 blocks
- Drop dead consume_bundle, cleanup_job_dir, and # Fix N: markers
- Extract _force_put helper for the queue drop-oldest pattern
- functools.partial replaces _default_pipeline closure
- Misc: BOM escape, named nucleotide threshold, encoding="utf-8"

Caddy/Docker:
- Caddyfile.example: handle_path -> handle (was 404'ing every request)
- Extract (prep_backend) snippet to deduplicate dev/example
- Drop duplicate HEALTHCHECK from Dockerfile (compose owns it)
- Switch base image to ghcr.io/astral-sh/uv:python3.12-bookworm-slim

Frontend:
- loading-overlay scopes #progress-* lookups to the overlay element

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`86bc132`](https://github.com/tsenoner/protspace/commit/86bc13274b95f843d3fd7c3b60b2ba6bdbd0f525))

* refactor(scatter-plot): group duplicate badges per current projection

Drop the union-find that grouped points sharing coords in ANY projection.
Under UMAP and t-SNE, members of a cross-projection group can render at
distinct canvas coordinates, so the spider would open at one anchor while
the other group members remained visible as scattered dots elsewhere.

Now keyed by exact coords in the current projection only: identical
embeddings still stack under PCA (where they collapse to the same point),
but UMAP/t-SNE no longer fabricate stacks for points that are physically
apart on screen. Extracted into duplicate-stack-helpers so the key
contract can be unit-tested.

Preserves the _cancelDuplicateStackCompute guard and the
_scheduleDuplicateOverlayUpdate(true) call after quadtree rebuild —
those fix the original #121 lag and are independent of this change. ([`2aca991`](https://github.com/tsenoner/protspace/commit/2aca9917cf3619f1c40838d500c882b513adfc28))

* refactor(publish): drop includeShapes from publish modal ([`957b49f`](https://github.com/tsenoner/protspace/commit/957b49f74d89b9efb4c5a32c67dda3fe87ab620e))

* refactor(export): drop includeShapes from canvas legend export ([`1436726`](https://github.com/tsenoner/protspace/commit/14367267f4b648bdd95c6ed940c3d81932f552b2))

* refactor(legend): remove includeShapes from LEGEND_DEFAULTS ([`401c633`](https://github.com/tsenoner/protspace/commit/401c633d816568eff50b0b38a9d6a8cd6e6c5d50))

* refactor(legend): drop dead isMultilabelAnnotation from settings dialog state ([`153a2d4`](https://github.com/tsenoner/protspace/commit/153a2d43c92f35d044f9e97c4fb7bfcc2bc6af28))

* refactor(legend): remove Include shapes toggle from settings dialog ([`768e3ec`](https://github.com/tsenoner/protspace/commit/768e3ec5eef69fc883f51348da84209d7e8f3264))

* refactor(persistence): stop persisting includeShapes for legend settings ([`e9d87b5`](https://github.com/tsenoner/protspace/commit/e9d87b5e09b617016c538cd266aa4b1dbb3363c4))

* refactor(scatterplot): drop useShapes + syncShapes from scatterplot stack ([`27d54f8`](https://github.com/tsenoner/protspace/commit/27d54f8511e9dbef9567538305bd708cea684d02))

* refactor(legend): remove orphaned claimedShapes set after shape-rotation drop ([`e52c222`](https://github.com/tsenoner/protspace/commit/e52c2221d37a173127a2c0cc666fb99d7940bad0))

* refactor(legend): drop shapesEnabled from visual encoding + processor ([`ff3829f`](https://github.com/tsenoner/protspace/commit/ff3829f2d5b70c9ce77d6cccf147a18f0b375dbd))

* refactor(types): make legend includeShapes optional + drop on sanitize ([`433d649`](https://github.com/tsenoner/protspace/commit/433d64911e30f192b9a2d848e5e1cba9a0797b65))

* refactor(publish): remove dead first pass in legend Y-offset computation ([`9ca3687`](https://github.com/tsenoner/protspace/commit/9ca36877a4ae10e3fd9c0c86d293f50df7eeea28))

* refactor(publish): DRY 25.4 conversions, prune stale comments ([`ca845f3`](https://github.com/tsenoner/protspace/commit/ca845f384f76126aca2f9f7db71159ea63993199))

* refactor(publish): polish dimensions panel — vertical chain + sliders

- Drop misleading predicted-MB readout (raw RGBA was ~10x export size).
- Replace chain glyph with vertical Lucide link/unlink rotated -45°,
  flanked by bracket arms anchoring it to the Width and Height rows.
  Fix invisible-stroke bug: codebase token is --primary, not --accent
  (which is an HSL fragment, so the var() fallback never fired).
- Re-add Width/Height sliders alongside narrowed value inputs, and
  drop the dim-pair grid override that stretched inputs across the
  whole column. ([`98457f5`](https://github.com/tsenoner/protspace/commit/98457f5f99d68b40efa18bb8c433a5df56485820))

* refactor(publish): chain icon visually links width/height; honest memory readout

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`3591a33`](https://github.com/tsenoner/protspace/commit/3591a334fa2c000c7e8a9f7e21ee96c0fdd41fb4))

* refactor(publish): tighten dimensions panel after review ([`c15ffac`](https://github.com/tsenoner/protspace/commit/c15ffac34ef905b8c906932b31426e672526296b))

* refactor(load-reliability): address PR review feedback

- Rename mergeProjectionsForTesting → materializeMergedRows; the
  function runs in production (small-dataset slow path + legacy
  fallback), not just tests.
- Unify extractAnnotationsOptimized and …Separated behind a shared
  extractAnnotationsByProtein. Both adapters pre-build a per-protein
  row lookup and delegate. Net -131 LOC, single source of truth for
  Pass 1/Pass 2 + Int32Array NA handling.
- Attach view: TooltipView to protein-hover / protein-click event
  detail. Preserves a lookup-friendly shape for external consumers
  after the Phase 2.5 strip; in-tree consumers only read proteinId
  and are unaffected.
- Dedup readValuesAt across two page.evaluate blocks in
  capture-animations.spec via collectClusterScreenPoints helper.
- Console-error filter in load-large-bundle.spec: match third-party
  hostnames in source URL OR message text. Chrome reports CORS
  preflight failures with the calling page as the source location,
  so URL-only matching missed cloudflareinsights/CORS errors.
- Document the Object.keys(annotationsById.values().next()) schema
  assumption in convertLargeDatasetOptimized. ([`7cdbbed`](https://github.com/tsenoner/protspace/commit/7cdbbedc82e244b7c79bdc6fbd1d4e9fd8530389))

* refactor(tooltip): build TooltipView per hover; tooltip reads from view ([`19140f0`](https://github.com/tsenoner/protspace/commit/19140f017f852ab012bac81fc954bbdf4bb73a2a))

* refactor(visual-encoding): pair-aware color+shape generation

Replaces generateColors/generateShapes (independent cycles) with
generateColorsAndShapes that advances shape only after a full palette
cycle. Yields palette.length × shapeCount distinct (color, shape)
pairs (126 for Kelly's vs 42 reachable today). Arrays are capped at
the distinct-pair limit; consumers use modular indexing for
categories beyond the cap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`387fffc`](https://github.com/tsenoner/protspace/commit/387fffce90204fe76ae1331179c8fb647e0de6b2))

* refactor(legend): NA cleanup — drop 'missing' token, dedupe NA-append, filter NA from manual order

Three cleanups that fell out of the #228 review:

* `MISSING_VALUE_TOKENS` no longer maps the literal string `"missing"` to N/A.
  The other canonical NA spellings (`na`, `n/a`, `nan`, `null`, `none`) cover
  the common cases; `"missing"` is more often a real categorical label than a
  missing-value sentinel and shouldn't silently collapse.

* Extract `appendSyntheticNACategory` helper in `conversion.ts` and replace
  the three identical 16-line blocks in `convertBundleFormatData`,
  `convertLegacyFormatData`, and `extractAnnotationsOptimized`. Behaviour
  unchanged.

* Filter `NA_VALUE` (alongside `OTHER`) when building numeric
  `manualOrderIds` in `_setNumericManualOrderIds` and
  `_buildNumericManualOrderIds`. Numeric NA is pinned to the legend end
  regardless of sort mode, so its position in the persisted manual order is
  silently ignored — keeping it out of the saved state avoids confusion when
  inspecting persisted bundles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`fb725dc`](https://github.com/tsenoner/protspace/commit/fb725dcb954188eb9189f7e63c4d0e810cdb2ab8))

* refactor(legend): NA-as-regular-category + numeric-NA pin gating

Categorical NA now sorts and falls into Other like any other value;
its default color is #DDDDDD via the legend processor (override-able
via persistedCategories). Numeric NA is pinned to the end of the
legend regardless of sort mode and its color/shape are locked to
NA_DEFAULT_COLOR + circle (persisted overrides ignored, persistence
skipped). visual-encoding.ts no longer special-cases NA — that's the
processor's job.

Fixes:
- categorical "NA" string leaks now collapse via ingestion normalization
- manual zOrder for NA is no longer silently dropped
- renaming-or-display-string mismatches in visual-encoding gone
- numeric NA legend swatch and plot stay in sync (both use defaults)
- one Kelly slot is no longer wasted on NA's overridden swatch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`233a708`](https://github.com/tsenoner/protspace/commit/233a708b5b62ba5803d4b72045cc7ac542611e8a))

* refactor(data-loader): normalize missing values at ingestion

Apply normalizeMissingValue at row read so every spelling of
missingness collapses to JS null upfront. Categorical columns now
fold "NA"/"N/A"/"NaN"/"None"/"null"/"missing" (case-insensitive),
empty strings, and whitespace-only strings into one canonical NA
category instead of leaking them as separate string categories.
Drop MISSING_VALUE_MARKERS and isMissingValueMarker — they're
subsumed by the boundary normalizer.

Also remove the temporary defensive wrappings introduced in the prior
commit (style-getters.ts toLegendKey helper, data-processor.ts inline
normalize call). After this change the boundary contract holds: every
consumer downstream of conversion.ts can rely on `value == null` for
missingness. Two unit tests in data-processor.test.ts that exercised
the old whitespace-string contract have been updated to use null —
the realistic post-ingestion input shape. The corresponding
empty-string and whitespace tests in style-getters.test.ts (which
covered the now-removed defensive wrapping) have been dropped; the
existing null-input variants cover the post-Task-3 contract.

Behavioral notes: '-' and '.' are no longer treated as missing. The
string forms 'Infinity' / '-Infinity' / 'inf' / '-inf' / '+inf' are
also no longer in the missing-marker set (the JS-level numeric
±Infinity is still treated as missing via Number.isFinite). A
numeric column containing any of these literal strings now demotes
to categorical. Datasets that relied on these as missing markers
should preprocess to null before export.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`2fc6304`](https://github.com/tsenoner/protspace/commit/2fc6304ee8cded2d634e6430bae20abc0fdde093))

* refactor(utils): migrate NA constants to missing-values module

Drop LEGEND_VALUES.NA_VALUE / NA_DISPLAY / NA_COLOR. Move
toInternalValue from shapes.ts and isNAValue from legend/config.ts
to the new missing-values module. All call sites updated to direct
named imports. shapes.ts now exposes only LEGEND_VALUES.OTHER.
Behavior unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`4da96d0`](https://github.com/tsenoner/protspace/commit/4da96d01275d386696ade6de7bda9029e477b9b2))

* refactor(publish): cap widthPx/heightPx at MAX_CANVAS_PIXEL_DIM in validator

Closes the defense-in-depth gap left after dropping clampCaptureSize:
corrupt state from a parquet bundle or hand-edited localStorage can no
longer carry oversized canvas dimensions past the validator boundary.

- MAX_CANVAS_PIXEL_DIM = 8192 (matches the UI's per-axis input cap)
- widthPx, heightPx, referenceWidth must be > 0 and ≤ 8192 or fall back
  to defaults
- two new tests: above-cap rejection and exact-at-cap preservation ([`1423446`](https://github.com/tsenoner/protspace/commit/1423446deabe0a5e8a203ff7acd57efe9f737ba2))

* refactor(publish): clamp inset boost against canvas pixel area

Replace the post-hoc clampCaptureSize wrapper with a boost-level cap
in computeInsetBoost(insets, maxBoost, plotPixelArea?). The boost is
the only path that can exceed browser canvas limits — non-boosted
captures use UI-bounded dimensions (max 8192) that stay well under
256M.

- MAX_CANVAS_PIXELS = 256_000_000 (slightly under the 268M Safari cap)
- Drop MAX_CANVAS_DIM and clampCaptureSize (no longer needed)
- _scheduleRedraw and _handleExport pass plotRect.w * plotRect.h to
  let computeInsetBoost cap the boost when needed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`bfd4702`](https://github.com/tsenoner/protspace/commit/bfd4702c32a8d323996b8a22fd00ec8eb342f341))

* refactor(publish): tighten saved-state validator

- drop overlays with coords outside [0,1] instead of clamping
- positivity checks: rx > 0, ry > 0, border ≥ 0, fontSize > 0,
  strokeWidth > 0, width > 0, widthPx > 0, heightPx > 0, dpi > 0,
  widthPercent in (0, 100], columns must be a positive integer
- inset rects must stay within bounds (x + w ≤ 1.001, y + h ≤ 1.001)
- connector must be 'lines' or 'none' or the inset is dropped

Aligns with the review's "drop coords outside [0,1]" wording. ([`7570eda`](https://github.com/tsenoner/protspace/commit/7570eda3a8488bf3e70eeb4e8e570dd211ec2afe))

* refactor(publish): fold toNorm clamp into parameter, fix inset handle drag

- toNorm gains an opt-in clamp flag (default true). Replaces the
  previous toNormUnclamped helper (DRY).
- applyInsetHandleDrag now passes clamp:false so dragging an inset
  corner past the plot edge follows the cursor instead of collapsing
  it to the boundary. Closes the gap from Task 1's narrower scope. ([`efa8972`](https://github.com/tsenoner/protspace/commit/efa897269a22c3b0fa59ada439995e29377e7e58))

* refactor(publish): tighten legend smoke test and defer mixin adoption

- legend smoke test now asserts _legendTitle and _legendItems so it
  actually verifies the property path it names
- revert inputMixin/overlayMixins from publish-modal styles: the
  attribute-selector specificity (input[type='text']) would override
  the deliberately-invisible label overlay input; defer adoption
  until a visual smoke check can prune duplicated rules safely

Address review feedback on commit fcdf778 ([`e3e91a3`](https://github.com/tsenoner/protspace/commit/e3e91a3cca56b1b6c551a76e9be2ea1b6a0e0295))

* refactor(publish): pass legend element as property, adopt style mixins

- legendElement property replaces document.querySelector('protspace-legend')
  for embedding compatibility; querySelector retained as best-effort fallback
- adopt shared inputMixin and overlayMixins so the publish modal inherits
  the same base styling as other modals/overlays in the codebase

Refs PR #232 review #7 + style consistency note ([`fcdf778`](https://github.com/tsenoner/protspace/commit/fcdf778c3ab2a3c3d91c6bdd0312aa97d423dc23))

* refactor(publish): drop dead-code area clamp and tighten font tests

- MAX_CANVAS_PIXELS = MAX_CANVAS_DIM² made the second-stage area
  clamp mathematically unreachable; remove it and the misleading
  test that never exercised that branch
- restore document.fonts after each waitForFonts test instead of
  leaking mutation, and switch to a static import
- file-scope simplification only; no behaviour change at call-sites

Address review feedback on commit ce18012 ([`90fb159`](https://github.com/tsenoner/protspace/commit/90fb159e6ca074a3753fb5a3d821aa5b76e476c7))

* refactor(publish): validate preset list and reuse clamp01

- preset is now validated against JOURNAL_PRESETS ids + 'custom'
  rather than blindly cast through; unknown strings fall back to
  the default preset
- replace local clamp01 with the existing @protspace/utils export
  to avoid drift between two definitions

Address review feedback on commit 9934826 ([`fff653d`](https://github.com/tsenoner/protspace/commit/fff653d31d6b49d807b2779e3da2706b9d64bf41))

* refactor(publish): improve export-handler type narrowing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ca95421`](https://github.com/tsenoner/protspace/commit/ca954217803799ca1c8c5993da45481276075d07))

* refactor(publish): extract legend layout scale constants

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`0bdc6fe`](https://github.com/tsenoner/protspace/commit/0bdc6febdf8e6d0ffc4aac680af65b16e9e09132))

* refactor(publish): rename annotationName → legendTitle

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`c3351fb`](https://github.com/tsenoner/protspace/commit/c3351fb4c7d1452e4e15ec2d66ba007d45408c62))

* refactor(publish): rename annotation → overlay in CSS classes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d249819`](https://github.com/tsenoner/protspace/commit/d2498194aac9d87a6546f7611ffe2b79e67c625d))

* refactor(publish): DRY cleanup, comprehensive tests, and documentation

- Remove duplicate mmToPx/pxToMm from journal-presets.ts (now imports from dimension-utils.ts)
- Extract shared _applyStateAndRebuild() from _handleReset/_handleNewFigure
- Add _renderSliderInput() helper to consolidate 10 slider+input combos
- Create CaptureablePlotElement type alias for repeated cast
- Remove dead code (void pr, unused variable)
- Add 35 new tests for overlay controller and compositor
- Add comprehensive Figure Editor documentation page
- Update exporting docs for new Figure Editor workflow

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`456add0`](https://github.com/tsenoner/protspace/commit/456add0a5cbb229c81a80d62d0023b2439149759))

* refactor(publish): rename annotations to overlays, add persistence and fingerprint

- Rename Annotation→Overlay, CircleAnnotation→CircleOverlay, etc. across
  all publish files to avoid naming clash with data annotations
- Add PublishState persistence via localStorage (survives page reload)
  and parquetbundle (survives file sharing)
- Add viewFingerprint tracking (projection + dimensionality) to detect
  when overlays may be stale after projection changes
- Add fingerprint mismatch warning banner with "Clear overlays" action
- Add "New Figure" button (clears overlays/insets, keeps layout settings)
- Remove ExportPersistenceController and all per-annotation export state
- Simplify Export dropdown: Figure Editor + Quick Export, no redundant controls

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`238f2cd`](https://github.com/tsenoner/protspace/commit/238f2cd54d602accb199fcf21c19bf779a70ed63))

* refactor(publish): consolidate toggle button styles, remove Escape close

Use shared .publish-toggle-btn base class for toolbar and preset buttons
with blue-border-only active state matching the control-bar filter-active
pattern. Remove Escape key and dead CSS (.publish-size-mode-*).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`2c9ab21`](https://github.com/tsenoner/protspace/commit/2c9ab21f46c2da74be4e200b368fdc89889f0bb4))

* refactor(publish): improve legend rendering and simplify options

- Remove overflow modes (scale/truncate/multi-column) — user controls
  columns directly via slider
- Show item counts in all columns (not just single-column)
- Add column gap spacing between count numbers and next column symbols
- Variable row heights for wrapped text — no more overlapping labels
- Center symbols and text vertically within multi-line items
- Tight legend height for overlay/free positions based on content
- Remove corner overlay and hidden legend position options
- Reserve count width in label maxTextWidth to prevent overlap

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`63683a9`](https://github.com/tsenoner/protspace/commit/63683a946ebf3c6fabdab3743ee60d30a2893080))

* refactor(publish): fix journal specs, simplify dimension UI, default to flexible preset

- Fix PNAS 1-col width (88→87 mm), PLOS widths (83→132, 173→190 mm)
- Add maxHeightMm to Cell (225), PNAS (225), PLOS (222) presets
- Replace Poster preset with Flexible (2048×1024, 300 DPI)
- Show mm dimensions in preset buttons
- Remove full-resolution checkbox (always render at export resolution)
- Remove size mode toggle (presets handle mm constraints directly)
- Dimension sliders: label+number on top, full-width slider below
- Preset mm constraint: changing DPI adjusts px, changing px adjusts DPI
- Height clamped to preset maxHeightMm when applicable
- Default preset to flexible, DPI max 1000, legend size max 100%

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`4dc1a94`](https://github.com/tsenoner/protspace/commit/4dc1a94bdd471407ff92879d0759b4c2ba857bec))

* refactor(legend): simplify _handleExtractAllFromOther method by removing unnecessary checks and comments ([`132e310`](https://github.com/tsenoner/protspace/commit/132e31066ad2bb7439c56426beefb65eb940d5f4))

* refactor(core): simplify query builder UX and fix issues

- Remove operator dropdown (is/is_not/contains/starts_with); values
  selected directly via chip picker
- First condition shows dimmed blank/NOT dropdown (UniProt pattern)
- Add X close button, Cancel button, ESC key to close modal
- Footer layout: Reset All (left) | Cancel + Apply & Isolate (right)
- Neutral styling for AND/OR/NOT dropdowns with chevron indicator
- Center Add condition/group buttons inline under conditions
- Match count always reflects full dataset via getMaterializedData()
- Reset keeps one empty condition instead of clearing
- Fix value chip truncation: X button always visible on long values
- Add ARIA dialog attributes, update docs, add evaluateQueryExcluding tests
- Remove dead code (unused opClass, operator styles)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`fba8aed`](https://github.com/tsenoner/protspace/commit/fba8aed577545aa5f663fbe8215f292a072c254c))

* refactor(core): enhance query builder functionality and styles

Refactor the query builder component to improve the handling of matched indices and excluded conditions. Introduce a new `evaluateQueryExcluding` function for better value counting. Update styles for the query condition row and value picker to ensure consistent spacing and improved usability. Replace button classes for better integration with the new button styles. ([`4b5e983`](https://github.com/tsenoner/protspace/commit/4b5e983aa2aea43ed726adee4fd37b4bb5ca1301))

* refactor(core): clean up query builder code review findings

Remove dead _evaluating loading state, extract shared groupAnnotations
utility to eliminate duplication, and remove redundant type assertions
after isFilterGroup type guards. ([`ded4cdc`](https://github.com/tsenoner/protspace/commit/ded4cdc148f12a0f123527da6c53d76c6bdf652b))

* refactor(core): update query builder styles for consistent sizing ([`2bb8f6e`](https://github.com/tsenoner/protspace/commit/2bb8f6eb08e7cea062c1b98b060d76057546c420))

* refactor(core): remove old checkbox filter code ([`24d04e0`](https://github.com/tsenoner/protspace/commit/24d04e0721ddb715b18872d97baf599cca770006))

* refactor(core): extract annotation categories to shared module ([`2b92761`](https://github.com/tsenoner/protspace/commit/2b92761b5d9e8045413ac7706e59c0851d7c1b13))

* refactor(explore): make loader queueing explicit ([`5d827ad`](https://github.com/tsenoner/protspace/commit/5d827ad6cb738ff413c6272da4f9ab1c404520ae))

* refactor(tooltip): extract headerType from IIFE and tighten label type

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`fcfaafd`](https://github.com/tsenoner/protspace/commit/fcfaafd9446adfb43dabb71699452a50f3d01ac2))

* refactor(scatter-plot): improve brush selection perf, fix race condition, DRY up tests

- Replace O(n) linear scan in _handleBrushEnd with quadtreeIndex.queryByPixels()
- Fix RAF + setTimeout race condition by consolidating into nested RAFs
- Add brush cleanup in disconnectedCallback to prevent listener leaks
- Extract _setupDblClickHandlers to avoid duplicated handler registration
- Remove reimplemented selection logic from brushSelect() test helper
- Replace waitForTimeout with waitForFunction in E2E tests
- Extract shared test helpers (waitForDataLoad, dismissTourIfPresent)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`3e9a60c`](https://github.com/tsenoner/protspace/commit/3e9a60cd85b0aa5c96060eb6071aacec09ebcfa5))

* refactor(core): deduplicate isolation reset in scatterplot

Have resetIsolation() call clearIsolationState() instead of
duplicating the same two assignments.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5033d58`](https://github.com/tsenoner/protspace/commit/5033d5841f9017a66d762951bee35c5e0fc05891))

* refactor(utils): deduplicate isNumericAnnotation and clamp01

Replace 8 inline `kind === 'numeric' || sourceKind === 'numeric'` checks
with calls to the already-exported `isNumericAnnotation()` and export
`clamp01()` from numeric-binning to eliminate the duplicate in color-scheme.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`76aaf66`](https://github.com/tsenoner/protspace/commit/76aaf6611d6102736819ef3a5ef755a28af6aeb6))

* refactor: unify messaging across app and components ([`69724ae`](https://github.com/tsenoner/protspace/commit/69724aed6a490773202ca0144a5be99f833c7259))

* refactor: clean up stale comments, reduce export surface, extract PDF helpers

- Remove stale columnar JSDoc on _buildStyleGetters()
- Narrow conversion.ts exports to only the public API (6 functions → private)
- Extract duplicated PDF creation/save logic into helpers
- Add DEFAULT_INCLUDE_LEGEND constant

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`fef1c61`](https://github.com/tsenoner/protspace/commit/fef1c61644954afa12aa0b78eae0a5bcd675b5a1))

* refactor: remove unused columnar code, add includeLegend test coverage

Remove ~490 lines of dead columnar infrastructure (ColumnarDataProcessor,
ColumnarData types, createColumnarStyleGetters, ColumnarStyleGetters interface)
that was integrated in cc077bf then reverted in acea16a due to isolation mode
regressions. The approach is sound but the hard part (isolation mode support)
was never solved — keeping dead code adds maintenance burden without progress.
Design docs in docs/plans/ preserved for future reference.

Add missing test coverage for the includeLegend export toggle:
- INCLUDE_LEGEND added to EXPORT_DEFAULTS required keys check
- Default value test for INCLUDE_LEGEND
- ExportOptions includeLegend acceptance tests (true/false/undefined)
- getOptionsWithDefaults nullish coalescing behavior tests ([`86b845b`](https://github.com/tsenoner/protspace/commit/86b845bf85f86754bf0b154606c1cb8e5e94c5c6))

* refactor(scatter-plot): streamline blending and depth testing logic during rendering ([`8f00e00`](https://github.com/tsenoner/protspace/commit/8f00e007ae7479ac964de6d53efd9ee9d91d49ff))

* refactor(scatter-plot): improve depth stability and rendering efficiency ([`63c48bd`](https://github.com/tsenoner/protspace/commit/63c48bda04d4df635134df935a39d670e31dc9a5))

* refactor(structure): remove dead code and redundant assignments

- Remove unused `loadPdb` from MolstarViewer interface
- Remove stale tombstone comment in structure-viewer
- Remove redundant format/isBinary assignments (use defaults)
- Add line break before pLDDT tip text

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`6038526`](https://github.com/tsenoner/protspace/commit/6038526ad0f86a9a8323e78474b62e3355d47dec))

* refactor(app): deduplicate dataset name and error recovery logic

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`14b38cf`](https://github.com/tsenoner/protspace/commit/14b38cf8d31897b96b7320fe9f22cb72f78d29fe))

* refactor(core): extract BasePersistenceController and improve docs/tests

DRY up duplicate logic between ExportPersistenceController and
PersistenceController into a shared generic base class. Update
data-format docs for optional settings section, document the
"Include export options" checkbox, and add missing test cases.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`dd110a5`](https://github.com/tsenoner/protspace/commit/dd110a52d5736ca8a08ee07dc5bc70e76ecd15d9))

* refactor(product-tour): use data-driver-id for all tour selectors

Signed-off-by: Elias Kahl <contact@elias.works> ([`c948102`](https://github.com/tsenoner/protspace/commit/c9481023c54db8e525ed1252bce3fdf1ad7f7922))

* refactor(scatter-plot): remove dead hint style and align kbd values

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`502cc71`](https://github.com/tsenoner/protspace/commit/502cc71f6cec5bdb944d3325adfef1a7ad007659))

* refactor: move Colab notebook to backend repo and update links

Remove ProtSpace_Preparation.ipynb (now lives in protspace repo at
notebooks/ProtSpace_Preparation.ipynb). Update all Colab badge URLs
in README, Hero component, and data-preparation docs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`a4ea0fb`](https://github.com/tsenoner/protspace/commit/a4ea0fb6f66b1a7b4594cd9285c9cdcc151f7c49))

* refactor(legend): remove isNADataValue function and integrate toInternalValue for N/A handling ([`1cb479e`](https://github.com/tsenoner/protspace/commit/1cb479edaee92884c2852649cde3e01d63760479))

* refactor(style-getters): remove N/A special cases, use unified __NA__ flow ([`f94f247`](https://github.com/tsenoner/protspace/commit/f94f247e3337caaa1f92763030352c2a42544053))

* refactor(legend): normalize null annotations to __NA__ in legend pipeline ([`a5abd03`](https://github.com/tsenoner/protspace/commit/a5abd033601ade98109aaad5d136b7a2bcab98c1))

* refactor(data-processor): normalize null annotations to __NA__ at source ([`a87b915`](https://github.com/tsenoner/protspace/commit/a87b9154d613379b30d140721a5d1e1f8a05c7db))

* refactor(legend): convert _highlightDroppedItem to async and simplify rendering logic ([`cca8f0a`](https://github.com/tsenoner/protspace/commit/cca8f0a01ed32f3137b034b2cac0a1249ff5fb6a))

* refactor(export): remove JSON export functionality and related state management ([`99846fd`](https://github.com/tsenoner/protspace/commit/99846fddf1be0016c6d37a31e536c4828efcf843))

* refactor(legend): remove redundant tests for 40K.parquetbundle to streamline test suite ([`edfe989`](https://github.com/tsenoner/protspace/commit/edfe989a1f4cd437db1b71ff425fba35545d7513))

* refactor(legend): remove unused parameters from legend item rendering for cleaner code ([`539f58d`](https://github.com/tsenoner/protspace/commit/539f58d65941d2a81e810d9a8b4af61a3720d500))

* refactor(legend): improved performance for custom colors ([`8445476`](https://github.com/tsenoner/protspace/commit/8445476c33518ec5da54fbbd048b54be2e2dfa3e))

* refactor(scatter-plot): projection metadata component for a better style ([`e54d7ed`](https://github.com/tsenoner/protspace/commit/e54d7ed0cfdf5436387eddba465db8a70983bceb))

* refactor(legend): simplify filename generation and enhance metadata handling ([`865db7a`](https://github.com/tsenoner/protspace/commit/865db7a473fa20f8e24c11b9319a67ddad92a387))

* refactor(legend): remove duplicate re-exports in favor of canonical imports ([`6742b47`](https://github.com/tsenoner/protspace/commit/6742b47e9a0b0baf12fa7c188a1c50c7f50a9af5))

* refactor(control-bar): consolidate export defaults and add comprehensive tests

- Remove debug console statements from export-utils.ts and control-bar.ts
- Consolidate EXPORT_DEFAULTS to single source in control-bar-helpers.ts
- Integrate helper functions (calculateHeight/Width, isProjection3D, etc.)
- Extract closeOtherDropdowns() to reduce dropdown toggle duplication
- Extract _initializeFilterConfig() to deduplicate filter setup logic
- Export EXPORT_DEFAULTS from @protspace/core for external usage
- Add 41 new export tests covering dimensions, scale factors, and options ([`62a2f74`](https://github.com/tsenoner/protspace/commit/62a2f7424fdd1a3481ae1edf70ecfcf6a635041f))

* refactor(control-bar): add editable export values and simplify styling ([`05a4213`](https://github.com/tsenoner/protspace/commit/05a42134c5d6b59ee0d6457698cb699f44dc3ab8))

* refactor(control-bar): simplify filter menu with minimalistic design ([`e913157`](https://github.com/tsenoner/protspace/commit/e913157ec49cf90e7240162a1fc53717cb14ab62))

* refactor(control-bar): unify dropdown closing behavior with parent-based handling

- Move click-outside logic from child components to parent control-bar
- Add event-based communication between parent and children
- Remove individual document click listeners from annotation-select
- Integrate search component into unified dropdown system
- Extract shared dropdown utilities to dropdown-helpers
- Ensure consistent behavior: opening any control closes others ([`df62b50`](https://github.com/tsenoner/protspace/commit/df62b504b7a7621e3062cdb438d5a060fc1e8485))

* refactor(styles): implement unified style architecture with modular patterns

- Add standardized breakpoint tokens (--breakpoint-xs to --breakpoint-2xl)
- Refactor legend component from 497-line monolithic to modular structure
  - Extract to styles/ directory: theme, layout, item, modal, responsive
  - Fix duplicate .legend-item.dragging definition
- Add breakpoint token comments to all media queries
- Move structure-viewer media queries to end of file
- Create comprehensive style-architecture.md documentation
- Add style architecture guide to VitePress config
- Fix dropdown menu clipping in three-row control-bar layout ([`38b80e0`](https://github.com/tsenoner/protspace/commit/38b80e080c175b2e82a6c08091306ff2a49defb5))

* refactor(styles): unify button variants and fix layout consistency

- Create comprehensive button variant system (primary, secondary, danger, link, icon, close)
- Standardize button heights to match dropdown triggers across all components
- Fix annotation-select dropdown by importing buttonMixin
- Update danger tokens for better visual feedback (brighter hover state)
- Fix responsive layout at 1050-950px breakpoint to eliminate scrollbar
- Unify isolation indicator styling with design tokens
- Remove duplicate button CSS and empty media queries

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com> ([`5398286`](https://github.com/tsenoner/protspace/commit/539828620dac7bd53fd7c3eabe44da1f50cb5c21))

* refactor(styles): extend modular CSS architecture across components

- Expand design token system with color palette and z-index scale
- Create overlay-mixins module for loading, modal, and tooltip patterns
- Migrate legend, scatter-plot, and structure-viewer to use centralized tokens
- Standardize z-index hierarchy to fix dropdown stacking issues
- Add backward compatibility alias for --dropdown-z token ([`a78044d`](https://github.com/tsenoner/protspace/commit/a78044d811dd830a099b85dc9bd37b695b2fdbab))

* refactor(control-bar): modular CSS architecture with responsive design

Extract control bar styles into modular, reusable components:
- Create shared design tokens (colors, spacing, typography)
- Extract reusable mixins (buttons, inputs, dropdowns, icons)
- Split control bar styles into layout, filter, export, and responsive modules
- Implement progressive responsive design with proper element degradation

Responsive improvements:
- Three-row layout at 1200px with full-width elements
- Progressive element hiding: icons first (800px), chevrons last (550-600px)
- Center-aligned content when decorative elements are hidden
- Prevent text overflow with proper ellipsis truncation
- Maintain center vertical alignment during layout transitions

This modular approach eliminates CSS duplication, provides a single
source of truth for design patterns, and ensures consistent behavior
across all control bar components.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com> ([`c979927`](https://github.com/tsenoner/protspace/commit/c979927ee4758321c0670a3b3a5e2cb5a0a4adcf))

* refactor(control-bar): extract helpers and add tests

- Extract control bar logic to helpers module for testability
- Add tests for annotation-select, search, and helpers
- Fix projection dropdown container styling ([`573e99f`](https://github.com/tsenoner/protspace/commit/573e99fa9d30f43d1aff02e6a77211efe65781d3))

* refactor(annotation-select): update annotation categorization ([`fed0fcd`](https://github.com/tsenoner/protspace/commit/fed0fcd8be034d8f6acbea977a73ede1aa6e1bdb))

* refactor(control-bar): unify dropdowns with master classes

Convert projection selector to custom dropdown and introduce master CSS
classes (.dropdown-trigger, .dropdown-menu, .dropdown-item) shared by
all dropdown components for consistent styling and behavior.

- Replace projection <select> with custom dropdown
- Create master dropdown classes following DRY principle
- Update annotation-select to use master classes
- Fix responsive wrapping for projection and annotation controls ([`abc48d7`](https://github.com/tsenoner/protspace/commit/abc48d79c337e53649e358d55902d07b1c466925))

* refactor(control-bar): remove CSS variable prefix and hardcoded values

- Remove 'up-' prefix from all CSS custom properties
- Eliminate hardcoded values in favor of CSS variables
- Improve design token consistency across components ([`27a2355`](https://github.com/tsenoner/protspace/commit/27a2355436c7beba56e3c0fb97804e60169b2684))

* refactor(control-bar): merge main and adopt annotation terminology

Resolve merge conflicts by:
- Renaming feature-select component to annotation-select
- Updating all feature/Feature references to annotation/Annotation
- Maintaining enhanced dropdown with search and categorization
- Aligning with main branch's biological terminology changes ([`bbd553a`](https://github.com/tsenoner/protspace/commit/bbd553a7850fa1da060876160c7812ef7c59d8e8))

* refactor(notebook): rename 'feature' to 'annotation' in Colab notebook

- Renamed FEATURES → ANNOTATIONS variable and related methods
- Updated progress messages and UI labels for consistency ([`e5ab614`](https://github.com/tsenoner/protspace/commit/e5ab614c9e8310e2ff02c2be003c401da0796c02))

* refactor(shapes): eliminate D3 shape dependencies and consolidate shape utilities

- Remove all D3 SymbolType dependencies across codebase
- Consolidate shape utilities into single shapes.ts module
- Implement direct string-to-index mapping for WebGL rendering
- Use shared SVG path generators for Canvas/Legend/Export rendering
- Update WebGLStyleGetters interface to return string instead of d3.SymbolType
- Import SHAPE_PATH_GENERATORS directly from utils in legend-renderer
- Remove unnecessary re-export from legend config
- Simplify shape pipeline: shape string → index (no D3 middleman) ([`92ec4fe`](https://github.com/tsenoner/protspace/commit/92ec4fe5eccb394996e29927824150d10109dbdc))

* refactor(export-utils): fix annotation shifting and remove borders from exports

- Fix issue where datapoints shifted during export due to ResizeObserver triggers
- Capture scatterplot with borders and crop programmatically to avoid DOM manipulation
- Remove all UI overlays from exports (tooltips, indicators, metadata)
- Extract common logic into reusable helper methods
- Consolidate duplicate code between PNG and PDF exports
- Improve code maintainability and reduce complexity ([`acb41ce`](https://github.com/tsenoner/protspace/commit/acb41ce0ce000b9566b06b319744ea0173a2c455))

* refactor(export-utils): update typography and layout for export visuals

- Increased header and item font sizes for improved readability in exports.
- Adjusted layout calculations to enhance spacing and positioning of elements.
- Removed unnecessary export title and date text from PDF output for a cleaner presentation. ([`1d7b2b0`](https://github.com/tsenoner/protspace/commit/1d7b2b06bf5218d2475875d0c15ba15aedb4a4c1))

* refactor: merge main and resolve conflicts by consolidating legend utilities

Merged main branch into fix/96-sorting-and-NA and resolved conflicts by:

- Moved LEGEND_VALUES constants to @protspace/utils for shared access
- Refactored getLegendDisplayText -> toDisplayValue for consistency with toInternalValue/toDataValue
- Consolidated legend imports through config.ts re-exports (LEGEND_VALUES, toDisplayValue, SHAPE_PATH_GENERATORS)
- Updated property names from Feature to Annotation across codebase (hiddenFeatureValues -> hiddenAnnotationValues, etc.)
- Fixed all test files to match new data structures and property names
- Added shapes property to Annotation interface mocks
- Fixed Projection interface usage (coordinates -> data)

All tests passing (259 passed). ([`aeab70d`](https://github.com/tsenoner/protspace/commit/aeab70db6ab27ae15474ca657ad2a19f84b82e2b))

* refactor(legend): formatting ([`d08ca5b`](https://github.com/tsenoner/protspace/commit/d08ca5b15e03eea875977a75ff5e26d875a7f6b3))

* refactor(legend): remove reverseZOrderKeepOtherLast function and update close icon rendering ([`9bc7433`](https://github.com/tsenoner/protspace/commit/9bc7433eb2b89dcf945089b1057dbe10d1de7a5a))

* refactor(legend): improve code readability by formatting and simplifying function implementations ([`268bdc5`](https://github.com/tsenoner/protspace/commit/268bdc5a52fba1fb3806ac02efa9489b50608256))

* refactor(legend): update legend data processing to use persisted categories and streamline z-order handling ([`29668a4`](https://github.com/tsenoner/protspace/commit/29668a4f03dda240953e824a06dd35caec53c372))

* refactor(legend): rename features to annotations and update related configurations ([`1d18bec`](https://github.com/tsenoner/protspace/commit/1d18bec268e48c0789f310c7e4580f2156e93764))

* refactor(legend): update drag-and-drop handling with index tracking

- Changed dragged item tracking from value to index for improved drag-and-drop functionality.
- Adjusted related methods to utilize the new index-based approach, ensuring correct item reordering.
- Updated utility functions to reflect changes in dragged item representation. ([`85e57ee`](https://github.com/tsenoner/protspace/commit/85e57ee513b20edb88098b774515dd273a7e0cd6))

* refactor(storage): remove outdated comments and clean up code in data-hash and index files ([`4b63ff1`](https://github.com/tsenoner/protspace/commit/4b63ff14503faa4cc9f8fc21615e3f534a31aa16))

* refactor(legend): implement slot-based visual encoding with color persistence

- Add SlotTracker class to manage color/shape slot assignments
- Assign slots by frequency order (most frequent = most distinct color)
- Colors persist through sort order changes and projection switches
- Implement slot recycling when items move to/from "Others" bucket
- Use Kelly's 21 colors of maximum contrast for optimal distinction
- Reserve special colors for Others (#999999) and N/A (#DDDDDD)
- Legend now drives scatterplot colors via colorMapping event
- Replace d3 symbol markers with custom SVG paths matching WebGL shapes
- Remove legacy pre-generated colors from data conversion
- Add visual encoding documentation to legend.md ([`599b75d`](https://github.com/tsenoner/protspace/commit/599b75d1103e10eaafea44c8e831e53569ca6f6f))

* refactor(core): replace any types with specific types

- Replace Map<string, any> with Map<string, unknown> in scatter-plot
- Replace (element as any) with HTMLElement type assertion
- Replace scatterplot config any casts with typed interfaces
- Fix trailing commas for consistent formatting ([`6793562`](https://github.com/tsenoner/protspace/commit/679356232e664902d910ae9cf7c1b9e2983789ab))

* refactor(app): remove redundant onClick from external links in mobile nav ([`ac9c48e`](https://github.com/tsenoner/protspace/commit/ac9c48ef89a3c189c9d3c8a42595444191b3c922))

* refactor(config): add shared navigation with unified experience

- Centralize all navigation items in config/navigation.ts
- Add Resources dropdown appearing on all pages
- Unify VitePress sidebar to show all sections consistently
- Update Header component with dropdown menu support
- Fix VitePress "Docs" link to avoid /docs/docs/ navigation issue
- Ensure consistent top navigation across landing, docs, and explore ([`6b014fd`](https://github.com/tsenoner/protspace/commit/6b014fd956e880cdacc21f09b93367bd4c65790a))

* refactor(dev): add Vite proxy for dev/prod parity

Proxy /docs requests from app server to VitePress dev server, enabling identical relative URLs in both development and production environments. ([`5f9f61d`](https://github.com/tsenoner/protspace/commit/5f9f61d6b59060889337c0fbb8b533636962ee44))

* refactor(config): centralize URL and port configuration

Create single source of truth for all URLs, ports, and domains in config/urls.ts.
Eliminates scattered hardcoded values and improves maintainability.

- Add config/urls.ts with PORTS, PRODUCTION_DOMAIN, and URLS exports
- Update VitePress config to import from centralized config
- Update app config to use centralized URLs
- Update Vite config to use PORTS.app constant
- Simplify docs build script to use NODE_ENV instead of VITE_HOME_URL

All builds verified and type-checking passes. ([`ae7effb`](https://github.com/tsenoner/protspace/commit/ae7effb7debcaa93a8c71928f286a11f92594969))

* refactor(links): convert absolute urls to relative paths ([`8b3c58b`](https://github.com/tsenoner/protspace/commit/8b3c58b5bc0fb2ac29c9e1d4ad9094f376515664))

* refactor(routes): rename demo route to explore ([`06505f2`](https://github.com/tsenoner/protspace/commit/06505f2a1a53726c2960770357aec411422a6267))

* refactor(nav): update header navigation items ([`6a34598`](https://github.com/tsenoner/protspace/commit/6a3459836a717ca0abc96b3180af1afe2d5d18f7))

* refactor(types): replace any types with proper TypeScript types

Replace all 49 'any' type usages with proper TypeScript types for better
type safety and IDE support.

Core package changes:
- data-loader/utils/types.ts: Change GenericRow from any to unknown
- data-loader/utils/bundle.ts: Use GenericRow type, fix unused variable
- data-loader/utils/validation.ts: Proper unknown handling for coordinates
- data-loader/utils/conversion.ts: Type projection_name casting
- scatter-plot/canvas-renderer.ts: Add StyleGroupMeta interface
- scatter-plot/scatter-plot.ts: Fix Lit lifecycle and d3 key function types
- legend/legend-utils.ts: Add ScatterplotData type
- legend/legend.ts: Import ScatterplotData, fix isolationHistory type
- control-bar/types.ts: Enhance interfaces with missing properties
- control-bar/control-bar.ts: Replace all 'as any' with proper types

Utils package changes:
- structure/structure-service.ts: Type API response structures
- visualization/export-utils.ts: Fix window and DOM element types

All changes maintain runtime behavior while adding compile-time safety. ([`2e47560`](https://github.com/tsenoner/protspace/commit/2e4756013d216456d93b0cf95ebd7aaf174ce3cf))

* refactor(icons): replace deprecated lucide-react brand icons

Replaced deprecated Github and GithubIcon from lucide-react with inline SVG components from Simple Icons (https://simpleicons.org). All brand icons in lucide-react are deprecated and scheduled for removal in v1.0.

Created centralized brand-icons.tsx component file for reusable icon components with customizable className prop. Updated Header and Footer components to use the new GitHubIcon component. ([`d224576`](https://github.com/tsenoner/protspace/commit/d2245762d2c684ed3296f38f10b8cb3cad03a414))

* refactor(legend): refactor namings in the legend sorting options ([`5129f7f`](https://github.com/tsenoner/protspace/commit/5129f7faadcb8dec343e6098c9f16bcda69430b8))

* refactor(scatter-plot): improve WebGL renderer documentation and performance

- Enhance comments and documentation for clarity on the gamma-correct rendering pipeline.
- Refactor framebuffer management to improve resource handling and cleanup.
- Update point size calculations and buffer updates for better performance and maintainability.
- Deprecate the selected feature method in favor of style signature management. ([`92af5e4`](https://github.com/tsenoner/protspace/commit/92af5e48e26dc91fba49e5e0873ea7c9b366ed65))

* refactor(scatter-plot): enhance WebGL renderer ([`71de911`](https://github.com/tsenoner/protspace/commit/71de9118fad77767241f733b9cba66c12cef265b))

* refactor(scatter-plot): migrate to WebGL renderer for improved performance and large dataset handling

- Replace CanvasRenderer with WebGLRenderer for enhanced rendering capabilities.
- Implement viewport culling and density rendering for large datasets.
- Update configuration options and remove deprecated properties.
- Optimize data processing and buffer management for better performance. ([`1fe2ca7`](https://github.com/tsenoner/protspace/commit/1fe2ca79c20c625d2619ee87061a7f94adbeb878))

* refactor(legend): remove unused rendering methods and drag handle ([`a8668fb`](https://github.com/tsenoner/protspace/commit/a8668fba0df02225e903c80e7bd29efe5170674a))

* refactor: fix 404 error when switching to demo page in github pages. ([`192827c`](https://github.com/tsenoner/protspace/commit/192827c2edec3e8fa29974ae5684e4af485aa7c4))

* refactor(scatter-plot): update zoom in to infinite ([`93653c9`](https://github.com/tsenoner/protspace/commit/93653c9e25071576acbe83cbbdf55c84cc1a1da1))

* refactor: garbage collect

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`bf79694`](https://github.com/tsenoner/protspace/commit/bf79694a73d0de7ba41f1987f1533f0de350a7c7))

* refactor: separate storybook into separate folder

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`669d21f`](https://github.com/tsenoner/protspace/commit/669d21f9051b1bbe6e725df556d26baa6cead441))

* refactor(legend): improve type safety and centralize symbol size

- Use DragEvent types for drag handlers instead of Event with casting
- Add LEGEND_STYLES.legendDisplaySize constant for fixed legend symbol size
- Replace hardcoded 16 with named constant for better maintainability ([`9df03da`](https://github.com/tsenoner/protspace/commit/9df03da34338dd118388d0ac1ec917f009962c02))

* refactor(legend, control-bar, scatter-plot, data-processor, scales): improve feature value handling and null checks ([`aa9cb20`](https://github.com/tsenoner/protspace/commit/aa9cb20c18ddfb0809a2c7f244cae6ff2694197d))

* refactor(legend): update default symbol size configuration ([`96e54ea`](https://github.com/tsenoner/protspace/commit/96e54ead47b723a2aa573d3d6577792f0733ccff))

* refactor(legend): enhance symbol rendering and item display logic

- Refactored the LegendRenderer to improve symbol rendering with added padding for shapes.
- Removed redundant symbol rendering logic from ProtspaceLegend, improving code clarity and maintainability. ([`62de342`](https://github.com/tsenoner/protspace/commit/62de342a50586b6807147ef85acb78d63a49e055))

* refactor(control-bar): rename data split methods and events to isolation for consistency ([`7a94053`](https://github.com/tsenoner/protspace/commit/7a94053cdeaa1285ed707f9ab46bf2520bb7dd8f))

* refactor(export-utils): update feature_data type and enhance visibility logic ([`fbd015e`](https://github.com/tsenoner/protspace/commit/fbd015e21e00c3bf4b6f29f6931955dd542bea2f))

* refactor(data-loader): rename projectionsMetadataData variable for clarity ([`1a45c61`](https://github.com/tsenoner/protspace/commit/1a45c61e68e548d06150d7499f520b7974456bac))

* refactor(ui): simplify control bar attributes and remove isolation state listener ([`cc0b533`](https://github.com/tsenoner/protspace/commit/cc0b5332bd94d55149c05f1fc58713aef120649a))

* refactor(ui): rename 'Split' to 'Isolate' across entire codebase

Complete refactor of split terminology to isolation for clarity:

- UI: Button label 'Split' → 'Isolate' with improved focus icon
- Variables: splitMode → isolationMode, splitHistory → isolationHistory
- Methods: getSplitHistory() → getIsolationHistory(), isSplitMode() → isIsolationMode(),
  splitDataBySelection() → isolateSelection(), resetSplit() → resetIsolation()
- Events: data-split → data-isolation, split-data → isolate-data,
  data-split-reset → data-isolation-reset, split-state-change → isolation-state-change
- Attributes: split-mode → isolation-mode, split-history → isolation-history
- CSS: split-indicator → isolation-indicator
- Comments and documentation updated throughout

Improves code clarity by using 'isolate' terminology which better describes
the feature's purpose of focusing on selected proteins. ([`a85dfdb`](https://github.com/tsenoner/protspace/commit/a85dfdb09365518f9d3f0b75bbb6f59088a820dc))

* refactor(scatter-plot): remove highlighted and selected point size configurations ([`c82353e`](https://github.com/tsenoner/protspace/commit/c82353ebd9205e4d75092e455be46181c19939c4))

* refactor: make change more concise

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`1fcf773`](https://github.com/tsenoner/protspace/commit/1fcf7738dfb7e3d0dc213c3a42d9d9cb17405007))

* refactor(control-bar): streamline selection event handling and remove redundant state updates ([`5f2e76f`](https://github.com/tsenoner/protspace/commit/5f2e76fbd1d27bbaacb5d8817e9c7f872d67b9c5))

* refactor(search): simplify protein search component by removing chips UI and related functionality ([`234cd99`](https://github.com/tsenoner/protspace/commit/234cd99485e275d6b77217e8090abce2746a5fd5))

* refactor(control-bar): enhance styles for improved layout and responsiveness

- Adjusted control bar styles to use nowrap for flex wrapping and improved alignment on smaller screens.
- Updated search component styles to prevent overflow and ensure proper display of search chips. ([`264c0c1`](https://github.com/tsenoner/protspace/commit/264c0c1a7e9f8802147c082ebe8fac0c7c64a320))

* refactor(control-bar): update export button styling and structure for improved layout ([`014ea75`](https://github.com/tsenoner/protspace/commit/014ea75b21b29060ff08305c8efe3735a1b533a0))

* refactor(data-loader): remove unused states and methods ([`9f3c3c3`](https://github.com/tsenoner/protspace/commit/9f3c3c35094c15c9a03636853db98ac7553382de))

* refactor(scatter-plot/example HTML): now the data can be dragged onto the scatterplot and it will load properly. ([`e35786f`](https://github.com/tsenoner/protspace/commit/e35786feac27ded0c58027bc5f8f5b4bc73d7203))

* refactor(control-bar/data-loader): moved whole data loader to a button in the right control bar, but drag and drop funtionality doesnt work on the button, just click and the file select dialogue opens. ([`bbc8863`](https://github.com/tsenoner/protspace/commit/bbc886328a0debf083822187af95489f2e7df843))

* refactor: replace external buttons with clickable links in StructureViewer for UniProt and AlphaFold ([`62173e2`](https://github.com/tsenoner/protspace/commit/62173e2b582d24ccc7e78660bf1c35b8a63de249))

* refactor: update structure loading to use 3D-Beacons API

- Improved error handling, when a structure is not available ([`68056ad`](https://github.com/tsenoner/protspace/commit/68056ad61f8d289d9dc426a5ac4a2e1cf3549eaf))

* refactor: apply lint and prettier ([`3e856d6`](https://github.com/tsenoner/protspace/commit/3e856d66bd47c9929b83bd5be3dd6e6a9e7ad38e))

* refactor(README): update documentation for ProtSpace_d3 ([`b4ed350`](https://github.com/tsenoner/protspace/commit/b4ed35022201b44362abad6fc450f91ba4e0bb00))

* refactor(scatter-plot): simplify feature value null checks in z-order calculation ([`5d62346`](https://github.com/tsenoner/protspace/commit/5d623467aea1a40e6c5286c675abbd950b340c67))

* refactor(scatter-plot): introduce shallow comparison for z-order mapping updates ([`a75548f`](https://github.com/tsenoner/protspace/commit/a75548f813084e594a060f3ee5789a422f0d5255))

* refactor(legend, scatter-plot): replace hardcoded color values with NEUTRAL_VALUE_COLOR constant ([`ec6122a`](https://github.com/tsenoner/protspace/commit/ec6122af04aba1dec890cd3683dfd689507a98ac))

* refactor(structure-viewer): remove unused error message styles and clean up code

- Removed the error message styles from structure-viewer.styles.ts.
- Cleaned up unnecessary whitespace and comments in structure-viewer.ts for improved readability. ([`7851652`](https://github.com/tsenoner/protspace/commit/785165216d1c9e3d1e3335a073f8895eb86a6d73))

* refactor: remove React app and focus on core web components (#26)

- Remove entire Next.js app and React components
- Remove non-essential documentation files
- Update workspace configuration to exclude app
- Simplify package.json scripts for core development
- Update CLAUDE.md to reflect core-component focus
- Streamline turbo.json for packages-only workflow ([`103a058`](https://github.com/tsenoner/protspace/commit/103a058bc0abefc270c24337de087fd953a3db60))

* refactor(scatterplot): simplify tooltip instructions for protein selection ([`d444a55`](https://github.com/tsenoner/protspace/commit/d444a55307174950278155bb416090ae38055295))

* refactor(structure-viewer): streamline error handling and improve structure loading logic ([`da9232f`](https://github.com/tsenoner/protspace/commit/da9232faccab85bab169f72a7d4905a83b9f7564))

* refactor(export): remove SVG export functionality and related legend handling ([`4b7f576`](https://github.com/tsenoner/protspace/commit/4b7f576c60c5ca62acdc0bbe9e5316bd5854110e))

* refactor: remove isolation mode and split history from ProtSpaceApp and related components ([`3b8527e`](https://github.com/tsenoner/protspace/commit/3b8527ea358c5761154a8e124b14281dab892ef6))

* refactor(scatterplot): add resolution scale configuration

- Updated the component name from ImprovedScatterplot to Scatterplot for clarity.
- Introduced a resolutionScale prop to enhance canvas rendering quality. ([`ed96b25`](https://github.com/tsenoner/protspace/commit/ed96b2511f859b84e0396edb266dc861ea8ab0e0))

* refactor(scatterplot): replace SVG rendering with canvas layer for improved performance ([`80fcac4`](https://github.com/tsenoner/protspace/commit/80fcac4edaff2e70798e98b1bf78c13fb8316128))

* refactor(control-bar, data-loader, scatter-plot, structure-viewer, structure-service, export-utils): remove console logs and clean up unused code ([`cd75d44`](https://github.com/tsenoner/protspace/commit/cd75d44e2abf115db5893bf2115660848d381b8e))

* refactor(scatter-plot, control-bar): remove isolation mode handling and clean up related code ([`65ecdc8`](https://github.com/tsenoner/protspace/commit/65ecdc8183f7ac4a6faad2a8d7fb411d9b97f0ba))

* refactor(export-utils, control-bar): streamline export functionality and remove SVG export ([`585b02b`](https://github.com/tsenoner/protspace/commit/585b02b9b0ca6e538af17cf6d21fbfdb270fb4c4))

* refactor(control-bar, types, scatter-plot): remove isolation mode functionality and related event handling ([`db94f74`](https://github.com/tsenoner/protspace/commit/db94f7471715742fe2e21e2ff6c6fd0fb9481872))

* refactor(scatter-plot): add type annotations for plot data point properties ([`18908b6`](https://github.com/tsenoner/protspace/commit/18908b64e8cce85378915f457eed643b34f14ae9))

* refactor(page): enhance data loading and session management

- Refactored the data loading function to accept an optional data path, improving flexibility.
- Updated session handling to differentiate between complete session files and data files.
- Enhanced error handling during data loading and session restoration.
- Improved the file input acceptance to support both .protspace and .json formats. ([`e25b36a`](https://github.com/tsenoner/protspace/commit/e25b36a504af11c49ccc4b137ae1c9403481035c))

* refactor(example): rename example data ([`a4a0362`](https://github.com/tsenoner/protspace/commit/a4a036202956865bd3888b2d407cb5631238999f))

* refactor(layout): restructure components project directories ([`36111b7`](https://github.com/tsenoner/protspace/commit/36111b7b71f68e283821022950ed65422639711b))

* refactor: remove obsolete dist folder ([`8e0421e`](https://github.com/tsenoner/protspace/commit/8e0421e76bf6386526ecfbe2cbf110079fe1d053))

* refactor: change template to next.js ([`7b67f82`](https://github.com/tsenoner/protspace/commit/7b67f82dd434df95c434dc626939baf948834bc2))

### Testing

* test(style): widen module docstring to match file scope

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`c847277`](https://github.com/tsenoner/protspace/commit/c847277f537d981fca5f4bae18735a39f7ddbc27))

* test(style): pin the palette-id catalog to catch drift

Assert _CATEGORICAL_PALETTE_IDS / _GRADIENT_PALETTE_IDS against expected sets
(plus disjointness + defaults), so the Python copy can only change deliberately
and stays reconciled with the frontend source of truth + docs/styling.md.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`0d02b15`](https://github.com/tsenoner/protspace/commit/0d02b15937d249774408a0646909179815440927))

* test(e2e): stabilize webkit history traversal ([`d15d73f`](https://github.com/tsenoner/protspace/commit/d15d73f0af4422858c209d0b93444f4fd5c49c62))

* test(e2e): harden flaky and opt-in handling ([`32d6da3`](https://github.com/tsenoner/protspace/commit/32d6da3bb50cfe0de484f0806c3627d3bdd87e94))

* test(e2e): isolate url normalization variants ([`606e103`](https://github.com/tsenoner/protspace/commit/606e1037ca65e60f10a49616769382648cf2ba49))

* test(e2e): preserve optimized suite coverage ([`f066651`](https://github.com/tsenoner/protspace/commit/f066651058bf56d58127d07985b52505ed6e6fb8))

* test(core): add discriminating v2 parse test; fix v2 docstring + fixture regen comment

- conversion.ts: fix parseAnnotationValueV2 docstring to remove false claim about
  evidence tokens carrying encoded characters; evidence codes only contain [A-Z]{2,5}
  or ECO:\d+ so never need decoding
- conversion.test.ts: add discriminating test verifying v2 decodes encoded reserved
  chars in labels (Cytop%3Blasm → Cytop;lasm) while v1 leaves them encoded
- v2-roundtrip.test.ts: fix fixture regeneration comment path to include
  ../protspace_web/ prefix for correct target when running from protspace repo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`1235f3b`](https://github.com/tsenoner/protspace/commit/1235f3ba393e13ec3068302c22056f7dfe1e095a))

* test(core): cross-repo v2 bundle round-trip proof (#56/#57/#58) ([`3c4839b`](https://github.com/tsenoner/protspace/commit/3c4839bb59d9027c278fadd9b933cf56eeb38a44))

* test(core): repoint bundle fixtures to apps/web after the app/ move

The app → apps/web restructure left two core roundtrip tests resolving fixtures
under the old app/public/data and app/tests/fixtures paths, so they threw ENOENT.
This only surfaced now that the Code Quality job gets past format:check to the
test step. Point them at apps/web/… (same 6-up-to-root, new subdir).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`2105569`](https://github.com/tsenoner/protspace/commit/21055699c648e1fe8d983d775cf7445c937f60f8))

* test: cover empty-predictions and unknown-id overlay edge cases ([`456c4e9`](https://github.com/tsenoner/protspace/commit/456c4e95412379c6ed750cb604c77f15425cd281))

* test: cover neither-match exclusion and multi-prefix OR in classifier ([`29f74f5`](https://github.com/tsenoner/protspace/commit/29f74f53597859b8a327d353a05128a43f133b08))

* test(protlabel): document RI tie-break and cover nearest-source selection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`809254e`](https://github.com/tsenoner/protspace/commit/809254e6295a8662a66d82a01a313fb0ff64b2ea))

* test: assert stamp_format_version merges metadata; docs: trim redundant wording

- test_annotation_encoding.py: seed schema metadata before stamping and
  assert stamp_format_version preserves it alongside the new
  protspace_format_version key, instead of only covering the fresh-table case.
- annotations.md: "commas, parens, and parentheses" was redundant
  (parens == parentheses); tighten to "commas and parentheses". ([`2a7eb62`](https://github.com/tsenoner/protspace/commit/2a7eb626b07a449624515d4fa55aff584a285fe8))

* test(annotations): backend end-to-end v2 bundle round-trip proof

Proves a ';'-bearing CATH name survives write_bundle -> read_bundle
losslessly: the encoded cell round-trips byte-for-byte, the literal ';'
never leaks into the parsed name (only its %3B escape), the cell stays
parseable as a single hit, and decode_field recovers the exact original
string. Also asserts the annotations part still carries the v2
format-version stamp. ([`05a71cf`](https://github.com/tsenoner/protspace/commit/05a71cf1bb2f89fe41118e5fac127cfcd78ca027))

* test(annotations): make InterPro name-encoding test exercise the real emit path ([`a1e384f`](https://github.com/tsenoner/protspace/commit/a1e384fff1f973d717db85a3e327b836f551832b))

* test(stats): test_base_data_processor imported via src.protspace.* while the new stats suite used protspace.*, duplicating module singletons under one pytest run; standardize this file on protspace.*

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`9952f05`](https://github.com/tsenoner/protspace/commit/9952f056d4809684a3c096070b95ac8df5049f16))

* test(stats): legend-envelope test used isinstance-only checks so a bad value (e.g. maxVisibleValues=0) would pass; assert the actual field values

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`d166f00`](https://github.com/tsenoner/protspace/commit/d166f00a151faf87c450bf5c7f1f851a1ed11a49))

* test(stats): the global-metric test only asserted the by-construction [0,1]/[-1,1] bounds (vacuous); assert a faithful projection scores meaningfully high instead

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`a8ea4cf`](https://github.com/tsenoner/protspace/commit/a8ea4cf34fcdfb894fb26760a8ba326dbb2784c0))

* test(bundle): extract_bundle_to_dir was only tested stats-only; add a full 5-part case asserting both settings and statistics files land with correct content

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`9a7433b`](https://github.com/tsenoner/protspace/commit/9a7433bda45aa9dde4e841938daf343495c34c09))

* test(stats): no end-to-end test drove an explicit --stats-annotation list; add one asserting only the named columns are scored (not a silent auto fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`b2bdf79`](https://github.com/tsenoner/protspace/commit/b2bdf798d0d7c0c80ba0bbb4323894b9c64e6549))

* test(stats): the _align positional-fallback positive branch (no ids, equal rowcounts) was untested; add a test that a wrong-order pairing would fail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`57ee83e`](https://github.com/tsenoner/protspace/commit/57ee83e5ae34ff9de2abd46d6fe8f4c3f96878d5))

* test(stats): the kmeans_elbow subsample test asserted determinism at fixed row order only; add a row-permutation invariance test that locks in the id-canonical fix

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`4f66491`](https://github.com/tsenoner/protspace/commit/4f664912c9a12c3ee4f1acdb9a337a31936685da))

* test(stats): the annotation-validity determinism test reran with identical row order so couldn't catch a non-id-canonical subsample; add a row-permutation invariance test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`f70abdf`](https://github.com/tsenoner/protspace/commit/f70abdf69da0e58c17446dae21283487e7b7b414))

* test(stats): add annotation="" to carriage faith-row helper

_faith_row() built StatRow(...) without the now-required `annotation`
field, breaking 3 tests after the annotation-dimension schema change.
Faithfulness rows are not annotation-scoped, so annotation="".

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`145fdbf`](https://github.com/tsenoner/protspace/commit/145fdbf824c2e7244a9c0c5e5ba04a6a9fc89190))

* test: add 86 unit tests for pure-logic functions, bump umap-learn

Add tests for settings_converter (color conversion, sorting, state
roundtrip), H5 identifier parsing, pipeline utilities (method spec
parsing, header validation, annotation name resolution), bundle settings
serialization, data formatters, and DR config validation.

Bump umap-learn >=0.5.7 → >=0.5.10 to fix sklearn FutureWarning
(force_all_finite rename). Remove now-unnecessary FutureWarning
suppression from base_processor. Add pytest filterwarnings for remaining
harmless third-party warnings (sklearn MDS matmul, umap n_jobs).

Coverage: 42% → 46% (399 tests, 0 warnings).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`1cb85a6`](https://github.com/tsenoner/protspace/commit/1cb85a673490ed184e5ad5367f04373ae2bd6c3e))

* test(reducers): add comprehensive tests for all 6 DR methods

51 tests covering PCA, t-SNE, UMAP, PaCMAP, MDS, and LocalMAP:
- Per-method: output shape (2D/3D), NaN-free, get_params, determinism
- Cross-cutting (parametrized): finite output, float dtype, no Inf
- Float16 handling: verify upcast produces correct results
- Config validation: defaults, custom values, invalid inputs
- End-to-end: all methods through BaseProcessor.process_reduction

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`02cae7b`](https://github.com/tsenoner/protspace/commit/02cae7b3862f477539d8918988fda6e3c3725981))

* test(local-processor): update tests for public API

- Rename test class: TestLoadData → TestPublicMethods
- Update all test calls to use public method names
- Update test documentation to reflect public API
- Ensure tests mirror production usage patterns

All 19 tests passing. ([`cf8844b`](https://github.com/tsenoner/protspace/commit/cf8844babdb56eb1707d35802597a9cd254cabff))

* test: update tests for refactored architecture

- Update all test imports to new module paths
- Rewrite 21 tests to test new modular components directly
- Add tests for FeatureConfiguration, LengthBinner, FeatureMerger
- Add tests for FeatureWriter, DataFormatter, UniProtTransformer
- Fix mock patches to point to new module locations
- All 131 tests passing with 0 skipped ([`92be481`](https://github.com/tsenoner/protspace/commit/92be48101d3424ca5deecd4f14caad069e69ca9d))

* test(data): update UniProt feature retriever tests for unipressed

- Replace bioservices.UniProt mock with unipressed.UniprotkbClient mock
- Update test assertions to match UNIPROT_FEATURES (10 properties)
- Add test for organism_id and sequence in feature extraction
- Verify raw data storage format (bools as strings, etc.)
- Remove PROPERTIES_TO_STORE tests (consolidated into UNIPROT_FEATURES) ([`72b8790`](https://github.com/tsenoner/protspace/commit/72b87904853413e235cf86743bb4836b690504de))

* test(pytest): mark slow taxonomy tests for optional execution

- Add slow and integration pytest markers
- Mark taxonomy tests as slow (~13x faster test runs when skipped)
- Add tests/README.md with marker usage documentation ([`564b960`](https://github.com/tsenoner/protspace/commit/564b9601470e2be91a93e3a0191405317be2ddd5))

* test(taxonomy): replace mock tests with real NCBI data tests

Replace 21 mock-based unit tests (858 lines) with 12 real taxonomy
database tests (221 lines). Tests now verify actual NCBI taxonomy
integration for bacteria, archaea, eukaryotes, and viruses.

- 77% code reduction with better test quality
- Session-scoped fixture initializes database once
- Real data tests catch taxonomy structure changes ([`2805cc9`](https://github.com/tsenoner/protspace/commit/2805cc997848fde5bd732f41e41c478546ecb3be))

* test: fix ruff linting issues in test files

- Fix C401: Replace generator with set comprehension in test_feature_manager.py
- Fix F811: Resolve pytest fixture redefinition conflicts in test files
- Use temp_dir_path instead of temp_dir in local scopes to avoid conflicts
- Restore proper fixture arguments for test functions
- All 148 tests continue to pass successfully ([`b699aec`](https://github.com/tsenoner/protspace/commit/b699aec6b159ca3a18fa1be9b8c5c501057ff2ba))

* test: add comprehensive test suite for output formats and directory structures

- Add test_config.py with shared fixtures for all test modules
- Add test_output_combinations.py with 30+ tests for output scenarios
- Test bundled vs separate Parquet file generation
- Test JSON vs Parquet output formats
- Test keep_tmp flag and intermediate directory behavior
- Test output path determination logic for both local and query modes
- Verify proper cleanup of temporary files
- Test legacy JSON format compatibility ([`172aa31`](https://github.com/tsenoner/protspace/commit/172aa311c729761a152fa52329aa04f818cc88ef))

* test: clean up unused variables and imports

- Remove unused imports and variables from test files
- Fix unused function arguments by replacing with underscore
- Add missing imports that were accidentally removed during cleanup
- Ensure all test fixtures are properly imported
- All 148 tests continue to pass ([`eff3507`](https://github.com/tsenoner/protspace/commit/eff35077b945fae737c93b6809c024c9f236a373))

* test: update test imports for feature_retrievers module

Update all test files to import from the new feature_retrievers location:
- test_feature_manager.py
- test_interpro_feature_retriever.py
- test_taxonomy_feature_retriever.py
- test_uniprot_feature_retriever.py

All 127 tests passing. ([`b4c8bb5`](https://github.com/tsenoner/protspace/commit/b4c8bb53961596c22071298072c79a76c369b2ff))

* test(app): stabilize and refactor UI test suite

This commit introduces a comprehensive set of UI tests for the main application and resolves several stability issues.

- **Initial Setup**: Created `tests/test_app.py` to validate core application functionality, including loading, feature selection, and UI interactions.

- **Stabilization**:
  - Resolved `DuplicateIdError` and race conditions by replacing `time.sleep()` with robust, explicit waits.
  - Fixed flaky tests by using reliable selectors and waiting for specific UI states before making assertions.
  - Suppressed the `kaleido` `DeprecationWarning` in the `pytest` configuration to clean up test output.

- **Refactoring**:
  - Introduced `pytest` fixtures (`protspace_app`, `protspace_app_with_data`) to eliminate redundant app setup code.
  - Created a reusable `wait_for_element_attribute_to_contain` helper function to reliably handle polling for asynchronous style changes during animations, making the tests cleaner and more maintainable.

The resulting test suite is now stable, robust, and provides solid coverage for key user interactions. ([`405c420`](https://github.com/tsenoner/protspace/commit/405c420cbb59717297f548b13ef3c88dfaf0c908))

* test: add figures yaml files ([`bb1dbc8`](https://github.com/tsenoner/protspace/commit/bb1dbc8bb84585fe7959008ce57a3d03834ec263))

* test: add tests for the prepare_json script ([`ae703f2`](https://github.com/tsenoner/protspace/commit/ae703f2525d8ea2b8fa76629293e2fef4120e36f))

* test(scatter-plot): B7 characterization safety net (F-02,03,09,22,23,24,25,26,27)

Lock load-bearing WebGLRenderer + component cache/memo/race behavior before any
structural refactor touches the two god-files. Test-only; zero production diff.

- New mock-WebGL2 harness (test-support/mock-webgl2.ts) with context-unavailable,
  program-link-fail, missing-float-extensions, framebuffer-incomplete toggles.
- WebGLRenderer locks: sampled-slot signature cache (F-02), init-failure no-op/no-throw
  graceful degradation (F-03), context loss/restore + gamma fallback (F-09).
- Component locks: _scales same-length swap invalidation (F-22), numeric-recompute
  stale-job guard (F-23), duplicate-stack chunked compute job/cache guards (F-24),
  async tooltip-height measure race (F-25), _styleGettersCache lifecycle (F-26),
  _getVisibilityModel 8-field memo key (F-27).

Each lock passes on the unmodified tree and was proven non-vacuous (flip-one-expectation
=> FAIL => revert => PASS). F-09 missing-extensions case locks the true warn-count (0,
not the plan sketch's 1: ensureGL clears gammaPipelineAvailable before handleGammaFallback,
whose guard then bypasses console.warn). 31 new cases; core vitest 60->69 files, 1064->1095.

Gates green: type-check, core+utils vitest, build, lint (0 errors), knip. ([`4e4692d`](https://github.com/tsenoner/protspace/commit/4e4692de7bd1a1593ed66c30e9d6635e3ad16319))

* test(data-processor): pin null vs empty-set cull distinction ([`c1b1906`](https://github.com/tsenoner/protspace/commit/c1b1906488423af411fe84c67d288db2865bcbcb))

* test(scatter-plot): pin filter-hide order independence and swap reset

Add two new test suites to scatter-plot.filter-render.test.ts:

1.7 – filter × hide order-independence: verify that _plotData ids and
per-point opacities are identical whether filteredProteinIds/filtersActive
is established before or after hiddenAnnotationValues. Confirms that
legend-hide never culls points from _plotData and that the two channels
are orthogonal.

1.8 – dataset-swap filter reset: simulate the Lit updated() lifecycle by
calling updated(new Map([['data', oldData]])) directly on an unattached
element. Asserts that filtersActive is cleared to false, filteredProteinIds
is reset to [], and _plotData covers all proteins in the new dataset. ([`c96b8b8`](https://github.com/tsenoner/protspace/commit/c96b8b8ad13a2873a48c0b7861113913d654ba85))

* test(data-processor): pin query-filter and isolation composition ([`fbf141d`](https://github.com/tsenoner/protspace/commit/fbf141ddee078c84e7a3aac4ad7e1dfba9f63902))

* test(scatter-plot): pin hidden/selection/fading opacity semantics ([`fc83c17`](https://github.com/tsenoner/protspace/commit/fc83c177472f43f208c37a2daed39e6deee65df0))

* test(control-bar): cover null-min case for between readiness ([`91a0262`](https://github.com/tsenoner/protspace/commit/91a0262156b292364d791395ad4102f94dba5d51))

* test(protspace-prep): cover in-app rate limit and CORS ([`cd74c8b`](https://github.com/tsenoner/protspace/commit/cd74c8b1940ed3512737d5f5c828cd221419e0a1))

* test(explore): add cancel scenario and live FASTA prep playwright project

Splits the mocked end-to-end into two focused tests: one that exercises
the new Cancel button (asserting the bundle is never fetched and the
overlay closes) and one that completes the prep flow against the
mocked backend. Adds a `fasta-prep-live` playwright project that drives
a real Caddy + protspace-prep + Biocentral round-trip using a small
fixture FASTA, with a 6-minute timeout for cold starts. Playwright
baseURL now reads PLAYWRIGHT_BASE_URL so the live project can target
the dev origin (default localhost:8080) without editing the config.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`dfdcce9`](https://github.com/tsenoner/protspace/commit/dfdcce92df6079e2b137587b5b92e87bb7e0d66b))

* test(explore): playwright end-to-end for FASTA prep with mocked backend

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`45655e4`](https://github.com/tsenoner/protspace/commit/45655e4a35f49490ee3f91409eac2d967a7f1563))

* test(scatter-plot): cover duplicate-stack legend-hide and projection-switch regressions

Extend duplicate-stack-helpers with buildDuplicateStacks (a sync helper
that mirrors the chunked production algorithm) and the DuplicateStackPoint
type, then add Vitest coverage for the two failure modes from #121:

  - legend-hide: stacks must shrink, then disappear, as visible points
    are filtered out — proving the duplicate pass respects opacity-based
    filtering applied upstream in _buildQuadtree.
  - projection-switch: the same proteins under different projection
    coords must produce different stack sets — no leakage from the
    previous projection's groupings.

Also pins the UMAP-jitter case explicitly: two points with identical
embeddings but different UMAP coords must NOT form a stack, which is
the failure mode the cross-projection union-find used to produce. ([`308099b`](https://github.com/tsenoner/protspace/commit/308099b4db7254d06bf95440006aa184f21decb2))

* test(bundle): verify legacy includeShapes is dropped on extraction

Exercises the full extract path (createParquetBundle -> extractSettings ->
normalizeBundleSettings) to confirm a pre-issue-252 bundle carrying the
removed includeShapes flag parses cleanly and never surfaces the field. ([`10ded73`](https://github.com/tsenoner/protspace/commit/10ded73941359a43378c78db030745e916d81ade))

* test: drop includeShapes from bundle + numeric-binning fixtures ([`cdcb8dd`](https://github.com/tsenoner/protspace/commit/cdcb8dd507afffe2d692a26721b98aaa5eec62ab))

* test(persistence): clarify legacy-compat coverage in persistence tests ([`05e731a`](https://github.com/tsenoner/protspace/commit/05e731a2c49546027f02f5489bfca62ceeed2283))

* test(settings-validation): restore includeShapes in test fixture ([`e33f438`](https://github.com/tsenoner/protspace/commit/e33f438ebef1f9f48018cba109c334baa7f084e2))

* test(publish): assert fingerprint warning renders when state is stale ([`5b18adc`](https://github.com/tsenoner/protspace/commit/5b18adc00eeaa90cda8584c239154a4ec17c9edc))

* test(publish): cover rotated and zero-size overlay hit-testing ([`c80e5a7`](https://github.com/tsenoner/protspace/commit/c80e5a7952939336c5b193cc2c7aafbf600b83b4))

* test(publish): cover export-to-PNG end-to-end with DPI metadata check ([`c61bfbe`](https://github.com/tsenoner/protspace/commit/c61bfbe8336122d218db77c8dd25b75fcda64df5))

* test(utils): drop tautological export-utils suites ([`a601f6e`](https://github.com/tsenoner/protspace/commit/a601f6e7e14b6b7f5b8fc9c84397bff4229778ca))

* test(publish): add figure-editor e2e spec for geometric inset zoom

Closes the WebGL-renderer gap that jsdom can't cover. Three Playwright
tests run against the dev server:

1. inset content reflects the source rect region — finds a high-color
   cell on the main preview, sets the inset's source there, and asserts
   the inset's interior shows the same color family (proves the
   dataDomain + getRenderInfo translation lands on the right data).

2. Dot size slider scales the rendered point coverage — colored-pixel
   count at 5× is ≥1.5× the count at 1× (proves pointSizeReference
   actually multiplies dot pixel size).

3. High-frequency target resize does not stall — 20 rAF-paced target
   resizes in <2 s, modal still mounted after settle (proves the
   fast-path skip + rAF throttle path is wired).

Wired into the existing app/tests/playwright.config.ts as a new
"figure-editor" project. Not in CI by default — run with
`pnpm test:e2e`. Full suite ~15 s. ([`a34fa10`](https://github.com/tsenoner/protspace/commit/a34fa10064ecb60dd6753bea395f85b67781ab1d))

* test(publish): cover Inset.pointSizeScale + geometric inset render

Fill the gaps left by the previous commit: validator handling of
Inset.pointSizeScale (preserves valid, drops invalid), overlay-controller
default (newly drawn insets get 2×), and the modal's _captureInsetRenders
flow — render dims = target rect, cache on repeat call, fast-path skip
during high-frequency state churn, settle timer arming, and graceful
null-returns when the plot element doesn't expose the geometric-zoom
hooks. 9 new tests, 183 total in the publish suite. ([`9f2c5e7`](https://github.com/tsenoner/protspace/commit/9f2c5e769e45628c6a2b7866d15539d6b5992404))

* test(export): isolate exportCanvasAsPdf mocks; drop dead state fields ([`d547c66`](https://github.com/tsenoner/protspace/commit/d547c66739efdea0b609c5b8b209a40a1e8d06d8))

* test(utils): cover pHYs CRC32 and pre-existing-chunk stripping

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`6eb5f8c`](https://github.com/tsenoner/protspace/commit/6eb5f8c4d3c23b4054583386dfe1a9e85bc6efcf))

* test(load): exercise tooltip hover, tighten legend + console assertions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`2188a68`](https://github.com/tsenoner/protspace/commit/2188a68bafae1e74124a7cc6a56af2d5aefab9b6))

* test(load): restore sprot_50 large-bundle Playwright spec ([`01f2190`](https://github.com/tsenoner/protspace/commit/01f2190dfe6c5cfa3d5b6d0ed56a09a49e525a8f))

* test(tooltip): cover gene_name precedence; drop skipped helper tests ([`b4f1879`](https://github.com/tsenoner/protspace/commit/b4f18794174a7b6a04dc57489504c1dafe653386))

* test(data-loader): assert content mapping in Int32Array shape tests

Strengthens the new annotation_data shape tests to verify that
protein → index mappings round-trip correctly through the annotations
values list, including the synthetic NA index for missing slots.
Refactors two per-protein loops in legend.ts and scatter-plot.ts to
use getFirstAnnotationIndex on Int32Array storage, eliminating the
single-element wrapper allocation per iteration on the common case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`72d62bc`](https://github.com/tsenoner/protspace/commit/72d62bcff848db8f90ebaa9069ed36f093a9332f))

* test(explore): playwright spec for crash-loop recovery banner

Seeds OPFS with pending/success/3-attempt states and asserts the
banner appears (or doesn't) and disables Try again after 3 fails.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`e272bbb`](https://github.com/tsenoner/protspace/commit/e272bbb0a62768432a9501b1dbebba061040154b))

* test(numeric-binning): align assertions with batlow palette and quantile strategy defaults

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`d0a5f04`](https://github.com/tsenoner/protspace/commit/d0a5f048f6b82fdd5c9ca2069ae86e7d7745308f))

* test(loader): strengthen custom fixture assertions ([`1843df3`](https://github.com/tsenoner/protspace/commit/1843df3dfbb0b437df5af4252215d1e789e186d9))

* test(loader): cover custom annotation inference fixture ([`526c15b`](https://github.com/tsenoner/protspace/commit/526c15b2efa41e4a97121d563a477eac10cf2f65))

* test(publish): extract and test modal pure logic

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7531ae1`](https://github.com/tsenoner/protspace/commit/7531ae11089bbe0394f4ad46eab8912313eddb64))

* test(core): add null value tests for evaluateQuery ([`d5ddd72`](https://github.com/tsenoner/protspace/commit/d5ddd726cb2b1301ad6fbd531efb2a1db8233433))

* test(explore): add controller unit tests and fix stale timeout

Add unit tests for view-controller (13 tests) and load-queue (11 tests)
to complement existing E2E coverage. Guard the 800ms overlay timeout in
data-renderer against post-dispose execution.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5e9fe17`](https://github.com/tsenoner/protspace/commit/5e9fe1740a1d91841ff7efd0d063c919931f4673))

* test(scatter-plot): add lasso selection E2E tests

- Add lassoSelect() and setSelectionTool() test helpers
- Test lasso polygon selection at default zoom
- Test switching between rectangle and lasso tools
- Test that lasso with < 3 vertices preserves existing selection

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`4792548`](https://github.com/tsenoner/protspace/commit/47925484b8f3392181494f8974e3b9b4ffd6183a))

* test: consolidate duplicate helpers and remove redundant suite

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`f2448d9`](https://github.com/tsenoner/protspace/commit/f2448d90be9e32dc5382668636f4a3440bad3bc1))

* test(app): fix compact import chevron assertion ([`f2869e3`](https://github.com/tsenoner/protspace/commit/f2869e3fe99df29cefb149f8388a4ecf87c2c45d))

* test(tooltip,export): add N/A test coverage and extract tooltip helpers

Extract tooltip N/A filtering logic from private Lit component methods
into testable pure functions (protein-tooltip-helpers.ts). Add 22 unit
tests for tooltip helpers and 8 integration tests for exportProteinIds
visibility filtering. Remove unused SPECIAL_SLOTS.NA constant and use
toDisplayValue/toInternalValue consistently in tooltip rendering.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`eeb2ed8`](https://github.com/tsenoner/protspace/commit/eeb2ed81cf408c323a0960c36c5a5340e36d669d))

* test(perf): detect iterations from env var

Signed-off-by: Elias Kahl <contact@elias.works> ([`15ae8f8`](https://github.com/tsenoner/protspace/commit/15ae8f872b500d4c0d9d2786cfc22511c7426d8a))

* test(perf): auto detect cpu/gpu/ram for plot subtitle

Signed-off-by: Elias Kahl <contact@elias.works> ([`498e587`](https://github.com/tsenoner/protspace/commit/498e5871f0df5ca67ba4189127ba37faf962f231))

* test(perf): add overlay while tests are going on ([`9548c7b`](https://github.com/tsenoner/protspace/commit/9548c7b8e8e510dd041e65a1dde38e1f52fc1bb9))

* test(perf): automated performance testing ([`3972e01`](https://github.com/tsenoner/protspace/commit/3972e01aade07dbd862248a5cbc49cbac098ac5a))

* test(style-getters): fix N/A mocks to use __NA__ matching real data flow ([`ed9601d`](https://github.com/tsenoner/protspace/commit/ed9601dd63a36b8638dc158dab00719b2826882d))

* test(core): enable type checking for test files

- Remove **/*.test.ts from tsconfig exclude
- Fix ScatterplotData.annotation_data type: (number | number[])[]
- Update test mocks to match corrected types
- Add missing originalIndex to test fixtures ([`52ac3de`](https://github.com/tsenoner/protspace/commit/52ac3de686a980bbf28c5489dd45c4e7d02b165b))

* test: add test:ci scripts for CI/CD pipelines

Add test:ci script to all packages that runs vitest with --run flag
to exit after test completion instead of entering watch mode ([`3b37d9d`](https://github.com/tsenoner/protspace/commit/3b37d9d476b974c7eebe7e16a3d2dc95ff878476))

* test(legend): remove null from type annotations in data processor tests

Functions expect Map<string, number> and Array<[string, number]> since null
values are converted to __NA__ by toInternalValue() before reaching these functions ([`85f5e2b`](https://github.com/tsenoner/protspace/commit/85f5e2b8274af55497d9ca4543d03ed9cbddc1f4))

### Unknown

* Merge pull request #313 from tsenoner/migrate/cli-help-restructure

refactor(cli): restructure --help into intent panels + docs refresh (#67, #68) ([`ca8f4f4`](https://github.com/tsenoner/protspace/commit/ca8f4f416d7fa9562061a426f44a1b296ed48a97))

* Merge pull request #312 from tsenoner/refactor/monorepo

Merge protspace into the monorepo (apps/protspace) ([`dfb3a1e`](https://github.com/tsenoner/protspace/commit/dfb3a1eb715ae980828e8437432ee2b1120df08d))

* Merge main into refactor/monorepo: adopt e2e suite optimization (#307)

Brings main's optimize-e2e-suite work (PR #307) into the monorepo branch.
Git rename detection remapped every app/tests/* edit onto apps/web/tests/*;
the only genuine 3-way merges were:
- apps/web/tests/playwright.config.ts — kept the branch's REPO_ROOT
  '../../../' (apps/web sits one level deeper) over main's '../../'.
- .github/workflows/e2e.yml — took main's Playwright-cache-step removal
  while keeping the branch's apps/web report/result artifact paths.
- .gitignore — main's /playwright-report -> **/playwright-report.

GitHub flagged this as CONFLICTING because its rename detection gives up on
the +669k import diff; locally git resolves the app/ -> apps/web move cleanly.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`654339a`](https://github.com/tsenoner/protspace/commit/654339aa427298cee10165e46f6c37a2360f740f))

* Merge pull request #307 from tsenoner/perf/249-e2e-suite

perf(e2e): reduce suite runtime and flakiness ([`ac6fa79`](https://github.com/tsenoner/protspace/commit/ac6fa79309dda52c4037302dd3609b734c45fa6b))

* Merge main into refactor/monorepo; repoint v2 fixture path to apps/web

Brings in the 14 commits main gained since the branch diverged (v2 annotation
encoding #306, figure-editor fixes #294/#298). Clean textual merge. main's new
v2-roundtrip.test.ts referenced the pre-restructure app/tests/fixtures path;
repointed to apps/web/ so the merged tree's test:ci passes (this drift is why
the PR's Code Quality job — which tests the merge with base — was red).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`7cc4604`](https://github.com/tsenoner/protspace/commit/7cc460483f6dd3bfe344ddb83208971adbbe5658))

* Merge pull request #306 from tsenoner/feat/annotation-encoding-v2

feat: read bundle format v2 (decode percent-encoded annotation names) ([`d4478b6`](https://github.com/tsenoner/protspace/commit/d4478b602809b95065e8f81c4bcb6e62bbac6ee8))

* Merge pull request #298 from tsenoner/fix/figure-editor-default-view

fix(figure-editor): always render the default unzoomed view ([`5c08713`](https://github.com/tsenoner/protspace/commit/5c08713ec00872321935675ef56624b6087dbc01))

* Merge protspace re-sync: adopt protlabel workspace member

Deterministic filter-repo re-sync of upstream protspace. Upstream split the
EAT engine into a new `protlabel` distribution (apps/protspace/packages/
protlabel) and restructured protspace into its own uv workspace.

Resolve into the single monorepo workspace:
- root pyproject: add apps/protspace/packages/protlabel as a flat member
  (nested workspace roots are forbidden by uv)
- apps/protspace/pyproject: drop the nested [tool.uv.workspace]; keep
  protlabel source-pinned via [tool.uv.sources]; lock-step semantic-release
  version_toml (protspace + protlabel bump together); assets=[]/build_command=""
- drop the member apps/protspace/uv.lock; the root uv.lock is the single lock
- protspace + protlabel resolve at 4.7.0; prep -> protspace -> protlabel verified

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`61b6f36`](https://github.com/tsenoner/protspace/commit/61b6f365d863a137ca8b1f0046132ef69852dc77))

* Merge pull request #66 from tsenoner/feat/annotation-encoding-v2

feat: bundle format v2 — lossless annotation name encoding (#56, #57, #58) ([`cc1f40c`](https://github.com/tsenoner/protspace/commit/cc1f40cf009f1250db2bdce669acc47400e0bd6f))

* Merge remote-tracking branch 'origin/main' into feat/annotation-encoding-v2 ([`5426c94`](https://github.com/tsenoner/protspace/commit/5426c94a4103fe34620ffa270177a2c108b03872))

* Merge pull request #55 from tsenoner/feat/eat-transfer-backend

feat: protlabel EAT engine + protspace transfer subcommand ([`e12e7f8`](https://github.com/tsenoner/protspace/commit/e12e7f8dbcd4527e118045b53feb35b0e3fa7148))

* Merge branch 'main' into feat/eat-transfer-backend

Resolve three conflicts introduced by the projection-statistics feature (#61):

- pyproject.toml: main moved [project.scripts] to the top of the file while
  this branch appended [tool.uv.workspace]/[tool.uv.sources] after the old
  scripts location. Keep main's single top-level [project.scripts] and the
  workspace/sources config; drop the now-duplicate scripts table.
- data/io/bundle.py: both branches rewrote write_bundle. Keep this branch's
  atomic-write house style (buf + _check_no_delimiter + _atomic_write_bytes,
  matching the rest of the merged module) and layer in main's optional
  statistics 5th part with the zero-byte settings-slot invariant.
- test_base_data_processor.py: keep main's new unbundled-settings test and
  this branch's real-bundle integration test for test_save_output_bundled
  (main's mock-open variant is incompatible with the atomic-write path);
  standardize the lingering src.protspace import to protspace.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`4093c30`](https://github.com/tsenoner/protspace/commit/4093c30ed7c5dac91883df01b3be2db89304ad68))

* Merge branch 'main' into feat/eat-transfer-backend ([`99fedfa`](https://github.com/tsenoner/protspace/commit/99fedfa31c3d2d9d3d2f08be880be0f596acea53))

* Merge remote-tracking branch 'protspace-src/main' into refactor/monorepo ([`30c2922`](https://github.com/tsenoner/protspace/commit/30c2922a2f86ccc4858e8bd6ae793068b3375f28))

* Merge pull request #61 from tsenoner/feat/projection-statistics

feat(stats): projection statistics (cluster-validity + faithfulness) ([`5310804`](https://github.com/tsenoner/protspace/commit/531080455cf1690728981ab97b89955a696cbc7d))

* Merge pull request #65 from tsenoner/feat/annotation-cluster-validity

feat(stats): annotation-based cluster-validity + ARI/NMI agreement ([`dc815d0`](https://github.com/tsenoner/protspace/commit/dc815d0c195daf4a67aba36330ddc3206b496433))

* Merge pull request #63 from tsenoner/feat/projection-stats-extras

feat(stats): cluster-selection, silhouette-as-score, global faithfulness metrics ([`82c8c33`](https://github.com/tsenoner/protspace/commit/82c8c3396a40c2def5896ce8c09e7c89646d2415))

* Merge pull request #52 from tsenoner/feat/restore-jmb-2025-toxprot

Archive original JMB 2025 toxprot dataset for backwards compatibility ([`73ac1b3`](https://github.com/tsenoner/protspace/commit/73ac1b3e7165f93fa6ee208d0cccfee706fbf786))

* Merge pull request #50 from tsenoner/feat/regenerate-toxprot-demo

chore: regenerate toxprot demo bundle (ProtT5 + ESM2-650M, mature peptides) ([`3d107df`](https://github.com/tsenoner/protspace/commit/3d107df35f02f5b29b774f4535c7e922becc3609))

* Merge pull request #49 from tsenoner/docs/multi-dr-params-followup

docs: clarify multi-DR-params syntax and notebook gap ([`82b6560`](https://github.com/tsenoner/protspace/commit/82b65602254d383fea81eb5c52b43e4e0f76deba))

* Merge pull request #48 from tsenoner/feat/multi-dr-params

feat: support multiple DR parameter sets in a single prepare run ([`2306a85`](https://github.com/tsenoner/protspace/commit/2306a85746c48ec03cf3352d5e97712bdab1e714))

* Merge pull request #47 from tsenoner/docs/multi-input-merging

docs: document multi-input merging behavior ([`3233df1`](https://github.com/tsenoner/protspace/commit/3233df1b122f9e7957acae697cc6b19c0fdba46f))

* Merge pull request #45 from tsenoner/docs/git-workflow-convention

docs: add git workflow convention to CLAUDE.md ([`cc583bd`](https://github.com/tsenoner/protspace/commit/cc583bd7ef10579f1fb719be1fd8fa679ef1a008))

* Merge pull request #41 from tsenoner/feat/extend-annotations

feat: extend annotations, improve caching, and fix sequence handling ([`5cb91a4`](https://github.com/tsenoner/protspace/commit/5cb91a43ce378ad0f3a146e4711ce93542c19293))

* Merge pull request #39 from tsenoner/feat/replace-unipressed-with-direct-api

Replace unipressed with direct UniProt REST API calls ([`b54a9aa`](https://github.com/tsenoner/protspace/commit/b54a9aabda3737467c1046132964053f0eabf661))

* Merge pull request #37 from tsenoner/feat/replace-taxopy-with-uniprot-api

Replace taxopy with UniProt Taxonomy API ([`6208129`](https://github.com/tsenoner/protspace/commit/620812997d1f8bacdd0ac6da8bc7ccd2c5ddfea8))

* Merge pull request #35 from tsenoner/stage

Merge stage into main — CLI rewrite, audit fixes, docs overhaul ([`a130a82`](https://github.com/tsenoner/protspace/commit/a130a82bdb82bd09f83c714d9424bc74aa8d470e))

* Merge branch 'stage' of https://github.com/tsenoner/protspace into stage ([`e5321dc`](https://github.com/tsenoner/protspace/commit/e5321dc0768c6f5246307796ea7d441a9e506cec))

* Merge pull request #34 from tsenoner/stage

Robust reducers, test suite, and Colab UI overhaul ([`3dac039`](https://github.com/tsenoner/protspace/commit/3dac039ec4632aa92801bb438e094e310c94be71))

* Merge pull request #29 from tsenoner/stage

Merge stage: extended annotations, styling, and CLI improvements ([`62e0b72`](https://github.com/tsenoner/protspace/commit/62e0b729734ccec4f865bed17a97d89ee34da8e2))

* Merge branch 'stage' of https://github.com/tsenoner/protspace into stage ([`8fb2f5e`](https://github.com/tsenoner/protspace/commit/8fb2f5ea3a895aed6c62d34603cf98849e419eb8))

* Merge branch 'refactor/local-processor-improvements' into stage ([`ee3235f`](https://github.com/tsenoner/protspace/commit/ee3235f0e6ef9e3514747668329a4295e7296e8d))

* Merge branch 'stage' ([`857c879`](https://github.com/tsenoner/protspace/commit/857c87909b986cc21674891ea4337418f9173ac5))

* Merge remote-tracking branch 'origin/main' into stage ([`071a28e`](https://github.com/tsenoner/protspace/commit/071a28ebd49b915345cc7eddd74f60cf1dfe804e))

* Merge branch 'stage' ([`2147acd`](https://github.com/tsenoner/protspace/commit/2147acd34b41022202f483dd482caadde3400399))

* Merge branch 'stage' ([`c33e58c`](https://github.com/tsenoner/protspace/commit/c33e58c3949121f4aff3fd5cc2b5e523038580a6))

* Merge branch 'stage' ([`20d7555`](https://github.com/tsenoner/protspace/commit/20d75553db4294312f7caa0159f1a7f00d3792f9))

* Update jekyll-gh-pages.yml ([`c7e8336`](https://github.com/tsenoner/protspace/commit/c7e8336f65c38474c06065a403cff9455a65a14a))

* Update jekyll-gh-pages.yml ([`bd1d842`](https://github.com/tsenoner/protspace/commit/bd1d842441b5533be35a8e92d2250badc831a05c))

* Merge pull request #8 from tsenoner/improvement/ismb-landing

improvement: add ISMB poster landingpage ([`4c2e129`](https://github.com/tsenoner/protspace/commit/4c2e129c6ccec0434e31d3fb7b485f667a9d9520))

* improvement: add ISMB poster landingpage ([`535ffa0`](https://github.com/tsenoner/protspace/commit/535ffa05db4cdb8e28be9b4a8b4862e72aeff5b7))

* revert: manual version bump to prepare for semantic release ([`3758049`](https://github.com/tsenoner/protspace/commit/375804919efec9149bd7e380bf66a547d5110290))

* bump: version 2.1.0 → 2.2.0 (includes curl fix for pymmseqs build) ([`e24b707`](https://github.com/tsenoner/protspace/commit/e24b7075c2703369a7c618344522408dfaabd1e4))

* Update .gitignore and remove analysis.ipynb ([`f9f91af`](https://github.com/tsenoner/protspace/commit/f9f91aff4ff87abddd92ab9ddb5318d6f0837549))

* chor: update image generation to include PCA_3 projection

- Changed the projection list to use only "PCA_3" for image generation.
- Added support for HTML file format in the image output. ([`636f345`](https://github.com/tsenoner/protspace/commit/636f345cfbc4be29a3274b0ad9684984a22a6e17))

* improve code formatting with black and ruff ([`bc565a4`](https://github.com/tsenoner/protspace/commit/bc565a42f5292469335b01cb905aed0d761735da))

* Chore: Run Black and Ruff to improve code formatting and quality ([`3ade5d1`](https://github.com/tsenoner/protspace/commit/3ade5d1e7835532afdcddb308238c7588498cb4f))

* Merge branch 'stage' ([`29a14cb`](https://github.com/tsenoner/protspace/commit/29a14cb94e24408a689effd2669a3a889c5bb5b2))

* Rename class name ([`d67ba69`](https://github.com/tsenoner/protspace/commit/d67ba69fb4d98c36d327783217ff0e34ab0a2e9f))

* Merge branch 'main' into stage ([`05bc690`](https://github.com/tsenoner/protspace/commit/05bc690d2604ed7324101261ac2b191bafe600a5))

* Merge branch 'stage' of https://github.com/tsenoner/protspace into stage ([`a58ebe1`](https://github.com/tsenoner/protspace/commit/a58ebe139e270544c0d0e1848c2b3a65fb818f3f))

* Merge pull request #6 from heispv:develop

Extract and parse metadata from UniProt automatically ([`21410dd`](https://github.com/tsenoner/protspace/commit/21410ddfeed01537c36f90de1851e53995b0be4c))

* Merge branch 'pr/heispv/6' into stage ([`d48132b`](https://github.com/tsenoner/protspace/commit/d48132bd1adf9bb3b3cd5a9f0ccb84dbc0d09155))

* Add taxonomy fetcher, move uniprot fetcher to a separate file, update dependencies ([`e00086a`](https://github.com/tsenoner/protspace/commit/e00086a76b15634f940ee3dabd0af744494f09f9))

* Enhance CSV generation by modifying 'annotation_score' values before writing rows ([`2aaa9df`](https://github.com/tsenoner/protspace/commit/2aaa9dfda450e4c151c668710e8ea46b783fc481))

* Removing some prefixes ([`3396fa5`](https://github.com/tsenoner/protspace/commit/3396fa56a96d63a477489c3b7e1a60107efa2195))

* Using number of the seqs instead of batches for the progress bar ([`0696ef7`](https://github.com/tsenoner/protspace/commit/0696ef74ff668286e82b163170ab5b152cf61590))

* Update a package and sync uv lock ([`4e6bc7b`](https://github.com/tsenoner/protspace/commit/4e6bc7b2346945ccbd580d5eeede4823a5748938))

* Minor fix in the custom names arg ([`01e6b3a`](https://github.com/tsenoner/protspace/commit/01e6b3ac2a113cc6e32fa7eb92011ff7efa4a0a2))

* Resolve the logo issue in ui ([`7949220`](https://github.com/tsenoner/protspace/commit/7949220f4a1dbbd74e27eac0e0e8210396911d7a))

* Managing default uniprot headers to extract accession correctly ([`35377f0`](https://github.com/tsenoner/protspace/commit/35377f062ba2f3b0bad6221e6a79c7d27c6bf1e2))

* Updating args to use comma separated inputs ([`e974067`](https://github.com/tsenoner/protspace/commit/e9740675265f79b722a479f0194cb380114218b5))

* Minor import update ([`5767c39`](https://github.com/tsenoner/protspace/commit/5767c398c707541384ea6f654446178e6b74d696))

* Updates based on new modularization logic ([`3f06fe3`](https://github.com/tsenoner/protspace/commit/3f06fe3a21583eddfae37c54a4a56e26c76e8658))

* Adding server module ([`a0ce076`](https://github.com/tsenoner/protspace/commit/a0ce07691b0fa4e44dcf9a0501c593f70b131c44))

* Adding visualization module ([`7018638`](https://github.com/tsenoner/protspace/commit/70186381fbcf98ce92a7f9e72a83eb285562de7c))

* Creating ui module ([`275d07a`](https://github.com/tsenoner/protspace/commit/275d07ae4b3aed85974b53d0be2cac350fd7fed5))

* Moving data related files to data module ([`3def712`](https://github.com/tsenoner/protspace/commit/3def7122a0dbdbd83dd45bda0f10b6c15c37760b))

* Modified examples ([`30c977e`](https://github.com/tsenoner/protspace/commit/30c977e442793f1789e80b0760794f8fcb344462))

* Adding progress bar during data fetching through uniprot ([`3a49352`](https://github.com/tsenoner/protspace/commit/3a493529c17bb0f8d1dff47e9ec60e86d6eff6ff))

* Adding bioservices ([`f68ccac`](https://github.com/tsenoner/protspace/commit/f68ccacea497e505bc7d2a6403c254afe636dc72))

* Improved ProteinFeatureExtractor class, added batch size for request ([`c85207c`](https://github.com/tsenoner/protspace/commit/c85207c17c0b471e28fe8466851ee74479a9ce37))

* Moving reducers to another file ([`e8fc4fd`](https://github.com/tsenoner/protspace/commit/e8fc4fdd134aeb8258786bfdc238ecbb012cbe0a))

* Moving the available FEATURES to this file ([`f978d6b`](https://github.com/tsenoner/protspace/commit/f978d6be79252e3332de4a97a7684013ed630d0a))

* Adding a class for protein feature extraction from uniprot ([`f4ea50a`](https://github.com/tsenoner/protspace/commit/f4ea50a44db3af72cce570ad3d68a813f5a729a1))

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`8e4d3dc`](https://github.com/tsenoner/protspace/commit/8e4d3dcdd6d074163909476aff01effe5284b2c2))

* example(pfamExplorer): extend description ([`2c82001`](https://github.com/tsenoner/protspace/commit/2c82001727c8f60e8944fb4a505696769c3bcbe5))

* example(pfamExplorer): add option to download generated JSON file ([`8b468f7`](https://github.com/tsenoner/protspace/commit/8b468f70a9b2595b8de38b17fa10bf53f9b347c0))

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`19ea674`](https://github.com/tsenoner/protspace/commit/19ea6743290c83a8867da6d3574e4fb9318dcfad))

* Adding config file improvements (#5)

* Adding to_dict_by_method to DimensionReductionConfig

* Making parameter config matching case-insensitive

* Adding constraints to config fields

* Adding name to parameter dict

* Changing to_dict to parameters_by_method and returning List

* Adding separate key for parameter constraints

* Separating frontend dependencies to optional dependencies

* Adding frontend import error handling

* Changing param.lower() in parameter dict by method function

* Adding type hints to constraints

* Adding additional metadata constraints for parameters

* Adding experimental docstring extraction for method parameters

* Improving parameter description cleaning ([`4719e63`](https://github.com/tsenoner/protspace/commit/4719e63d9827659966f30e078abfeb734de84fc7))

* refactore: add quality check to prepare_json.py ([`1c689c9`](https://github.com/tsenoner/protspace/commit/1c689c9da044dcdf0dad2a6c256d5c5ce25d48d2))

* Update embedding generator ([`de7b3d3`](https://github.com/tsenoner/protspace/commit/de7b3d373d0b71acfce6c0006b27feefc917d681))

* Add forgotte change ([`798bb3d`](https://github.com/tsenoner/protspace/commit/798bb3d9d6a663befe0c9c1998f79675c264713a))

* Add navigation guide to 'Explore_ProtSpace.ipynb' ([`0efc990`](https://github.com/tsenoner/protspace/commit/0efc99048de17b6d787068d1b5ba0bc0435de46b))

* Make Marker config dependent on visualization dimension ([`d1415e7`](https://github.com/tsenoner/protspace/commit/d1415e7c60192409f123f0179aee59ed559ae476))

* Add note about Safari browser limitations for google colab ([`0444a3b`](https://github.com/tsenoner/protspace/commit/0444a3b6ce3d36d83ec9a11ecf88b3ff668cd960))

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`331471e`](https://github.com/tsenoner/protspace/commit/331471edc7c7c478ce19e95a972e020bbb543111))

* BREAKING CHANGE: release again ([`230910a`](https://github.com/tsenoner/protspace/commit/230910aed926c08b777e944ab308b154684224d4))

* Braking Change: Release ([`ff2b8e0`](https://github.com/tsenoner/protspace/commit/ff2b8e0c87ab05d9af5a829c8b73374af6412e22))

* hide installation progress in exploration jupyter ([`6e07e62`](https://github.com/tsenoner/protspace/commit/6e07e6210733923d3ae18af5f95ab91fe692f16f))

* update notebook: clean old cell ([`16c2a87`](https://github.com/tsenoner/protspace/commit/16c2a87ab72dc8a31cd0650d9c95fa53dfb48a18))

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`33c41b3`](https://github.com/tsenoner/protspace/commit/33c41b3da6b4db1907a9235308d695dd57593050))

* update readme links to lowercase protspace ([`9c9a0f7`](https://github.com/tsenoner/protspace/commit/9c9a0f7882aafdbf16689ca645e2fc8f5bdb1b38))

* Update .gitignore ([`d56dd86`](https://github.com/tsenoner/protspace/commit/d56dd8635c86a084d0a319925f8ad5d4d1bccdc8))

* Add example outputs ([`b16ea3e`](https://github.com/tsenoner/protspace/commit/b16ea3e57e01808001dd1ef18c4187bfabe8b614))

* Add data ([`1faabf8`](https://github.com/tsenoner/protspace/commit/1faabf828c46980b1c68a6d4430bcc57e1ee87c3))

* Clear notebook output ([`151d594`](https://github.com/tsenoner/protspace/commit/151d59430f05b02ca464551ce9526b07abb203d5))

* Update Pla2g2 data: rename + fic inequality ([`59de9e3`](https://github.com/tsenoner/protspace/commit/59de9e3b6b21b9c77d526722edb13b1168af6a24))

* Update Notebooks to be better for walkthrough ([`de441b6`](https://github.com/tsenoner/protspace/commit/de441b6060f5d665047c13eea2c6c95b1dab310b))

* Update README: pip install + explore ProtSpace notebook ([`9010a5d`](https://github.com/tsenoner/protspace/commit/9010a5dd539bbbe067eb384f8cc6f0dd287da468))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`fe82e65`](https://github.com/tsenoner/protspace/commit/fe82e654dc746fcfb45d35dc53d5238962b91bb3))

* add option to force SVG creation, also with many dots ([`bcb5c24`](https://github.com/tsenoner/protspace/commit/bcb5c2480346afc616107ebb75205e092e23d3bb))

* update noteboks to be more user friendly ([`6c36f60`](https://github.com/tsenoner/protspace/commit/6c36f609f5e7b5434802df7012cb798be81f1d15))

* update README.md ([`4291c18`](https://github.com/tsenoner/protspace/commit/4291c1809ff6d2d379231159d339342d633c7791))

* remove github action pythonversion test ([`793ee9b`](https://github.com/tsenoner/protspace/commit/793ee9bf9631db19eca15739ab2a3c4c459a0eb8))

* make images creation easier with a YAML config file ([`f57db60`](https://github.com/tsenoner/protspace/commit/f57db608417ed185b63b246f9412542e648724f4))

* update example and code to generate imgs from cli ([`38ef0d9`](https://github.com/tsenoner/protspace/commit/38ef0d913c27d9af5cea114a6459df97b5f60965))

* add notebook to create embeddings ([`e551b31`](https://github.com/tsenoner/protspace/commit/e551b31aaa4d0507f5d4f6453014ab2cd46fc3b0))

* remove foldseek and mmseqs GFP data ([`4a67782`](https://github.com/tsenoner/protspace/commit/4a67782d96b925b245fea53cb4dd1771f45a6619))

* add GFP data and output examples ([`8c88a69`](https://github.com/tsenoner/protspace/commit/8c88a69198315eb0899080036b92b6978152854a))

* add costum naming in prepare_json.py ([`2d2885d`](https://github.com/tsenoner/protspace/commit/2d2885d4a4c7b069ddd6bbbe18a974e6fcd0007b))

* reduce dot size on 3D plots ([`7bafd61`](https://github.com/tsenoner/protspace/commit/7bafd616c4264b385c8235788b9c29394de8ebca))

* add natural key sorting to legend ([`a243d8c`](https://github.com/tsenoner/protspace/commit/a243d8c16d69960195b190ca496497c8ad58cfe2))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`d479b33`](https://github.com/tsenoner/protspace/commit/d479b330d4bd2d17d2d043ea8649c8db3b9a7549))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`60f3a1b`](https://github.com/tsenoner/protspace/commit/60f3a1beb0d5b49134868eb60a18e94d2794061b))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`aa5dc4a`](https://github.com/tsenoner/protspace/commit/aa5dc4aacb4ee91362aa968c8f67090487505b00))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`c7a2ea8`](https://github.com/tsenoner/protspace/commit/c7a2ea86402f0cb45f77ccba84473cb99836a00b))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`0ffe792`](https://github.com/tsenoner/protspace/commit/0ffe79226f195e45c11ee2e59554f35acf7dcbba))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`852100b`](https://github.com/tsenoner/protspace/commit/852100b5f6c0b2428d677085b831889ab08a6d15))

* Add uv.lock as build asset to be commited ([`2f7bf42`](https://github.com/tsenoner/protspace/commit/2f7bf42b915e09edb1e51699753f0a5d0dbd10a6))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`3874f35`](https://github.com/tsenoner/protspace/commit/3874f35428a601e01c463b7a9d902d5317f19675))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`fe05fa9`](https://github.com/tsenoner/protspace/commit/fe05fa9d1f7784a6ed9497c014cf9d2ca0ad21a3))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`cc4e808`](https://github.com/tsenoner/protspace/commit/cc4e808073c2f799369bf19bc4ec2659351cbf8a))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`470b25a`](https://github.com/tsenoner/protspace/commit/470b25a3e6b8cb608b43226897a3054d8858d55a))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`ae02da6`](https://github.com/tsenoner/protspace/commit/ae02da6f3b6c1dd6ab584ca7b84e4ca64b652ca5))

* fix invalid yaml

fix: build process ([`10d1cad`](https://github.com/tsenoner/protspace/commit/10d1cad927dd1225e1665643655b3ca5169de377))

* fix pypi push action

fix: build process ([`8084c81`](https://github.com/tsenoner/protspace/commit/8084c8126045e1ee7ce4a54942abe16564c93eca))

* add python semantic release

chore: Add python build and push ([`c3dda05`](https://github.com/tsenoner/protspace/commit/c3dda05b281afe616be23d8605a56fea8ae215c6))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`1e44c66`](https://github.com/tsenoner/protspace/commit/1e44c66e29ef68edea4be6a5daf359db94b88755))

* ignore SyntaxWarning of biopython ([`840a630`](https://github.com/tsenoner/protspace/commit/840a630ad0a89ddb8cac48c3a5bcde4eb7c1504f))

* Only build on tags ([`7501256`](https://github.com/tsenoner/protspace/commit/75012568c795614b6d5133f152337cddf7021545))

* Docker build only on src changes ([`e64ba21`](https://github.com/tsenoner/protspace/commit/e64ba211de56b2246cacf86fd41a18522a6d6532))

* Create jekyll-gh-pages.yml ([`cd5300c`](https://github.com/tsenoner/protspace/commit/cd5300c8e09ec537e45e7c92f584342c6588300f))

* Version bump ([`e3d3ce1`](https://github.com/tsenoner/protspace/commit/e3d3ce1809d77099362e32d6bd9e8c7123f65392))

* Update README.md ([`0ee3e6d`](https://github.com/tsenoner/protspace/commit/0ee3e6dc9a0f2152571e9ebde3ad66ca3ebb0b17))

* Updated README.md ([`3f7717f`](https://github.com/tsenoner/protspace/commit/3f7717f0d1a284d40cf11815d75408bb7a15ecb8))

* Version Bump ([`f369c83`](https://github.com/tsenoner/protspace/commit/f369c837055dfd8fccc380886b000d9418f2d279))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`a2aa89d`](https://github.com/tsenoner/protspace/commit/a2aa89deb8777b7bb527987e6294658efebb0a3e))

* Remove unneccary __init__.py lines ([`15d4b6d`](https://github.com/tsenoner/protspace/commit/15d4b6d3899df744a3d7ea971ef41ca19e9f3a23))

* Updated dependencies ([`a2193e5`](https://github.com/tsenoner/protspace/commit/a2193e53dcc8bd57b53fc36c7700042a683d66c8))

* Add commandline parsing ([`360df52`](https://github.com/tsenoner/protspace/commit/360df52c189260980135c2b46c8445100bdf2a3b))

* Add render deploy hook ([`ee2487e`](https://github.com/tsenoner/protspace/commit/ee2487e065b6032a020a22074bb43b83950116a1))

* Merge pull request #4 from tsenoner/f-transition-uv

Add data to docker image ([`7984ea4`](https://github.com/tsenoner/protspace/commit/7984ea49b90b407987573bf043d25473615d0472))

* Add data to docker image ([`52c62ab`](https://github.com/tsenoner/protspace/commit/52c62ab1b7b05bdb26f7bcbe899a374ba45264fc))

* Merge pull request #3 from tsenoner/f-transition-uv

F transition uv ([`463b00c`](https://github.com/tsenoner/protspace/commit/463b00c8d50423840e73affe5d32b97c4cb1b675))

* Fix license ([`339c0d4`](https://github.com/tsenoner/protspace/commit/339c0d4e10d8b715ff43cd7bfb5be9a9b8b7d63e))

* Add Github Action to build image ([`4ae0006`](https://github.com/tsenoner/protspace/commit/4ae0006161b50308b5f703a3da62c2bdd0b28545))

* Add relevant labels ([`0035af7`](https://github.com/tsenoner/protspace/commit/0035af7662f09515c2c87a62e2d57b766dfba71e))

* fix docker deployment ([`1a6a71b`](https://github.com/tsenoner/protspace/commit/1a6a71b6ed70841a8f3581166e89375fc5277c09))

* Fix import in main from util to config ([`d951940`](https://github.com/tsenoner/protspace/commit/d9519402022b81b6f0ad258680f107b985d7dbc8))

* Update examples ([`e1c05c1`](https://github.com/tsenoner/protspace/commit/e1c05c1649f401e040e0c1fd1960940c180ea888))

* Merge branch 'main' into f-transition-uv ([`19e6b42`](https://github.com/tsenoner/protspace/commit/19e6b4258eafc16fc5baca401da09e483ca1cf2f))

* Correct deployment path name ([`e7bdaac`](https://github.com/tsenoner/protspace/commit/e7bdaaca7f1c1cd829de83ff0261f20ef0babaa5))

* Update Example images ([`6a37cd0`](https://github.com/tsenoner/protspace/commit/6a37cd073505563c1a760d0e975adfb5a2a736bc))

* Update Pla2g2 example data ([`146d7c7`](https://github.com/tsenoner/protspace/commit/146d7c7d8d360f4ea73cfab6d48fc82e525e52bd))

* Change example data to Pla2g2 ([`ee243b5`](https://github.com/tsenoner/protspace/commit/ee243b5231da2637acd881adf60ed630b1759c07))

* Add command ([`2b922db`](https://github.com/tsenoner/protspace/commit/2b922dbb7c1a67b137b458af35cb90e275918b93))

* Add dotenv ([`548a509`](https://github.com/tsenoner/protspace/commit/548a50944537567fd0c48bcbc0c55bd3ad87e193))

* Fix src layout ([`35f4afb`](https://github.com/tsenoner/protspace/commit/35f4afb2c66d20349daa378603cc0d74bb70890c))

* Update render config ([`456c450`](https://github.com/tsenoner/protspace/commit/456c450fd39453b6f787d34e7d3028bf7e099cde))

* Add dockerfile ([`7e42c7f`](https://github.com/tsenoner/protspace/commit/7e42c7f85a11522780dca84942821d13fca63b4a))

* Switch to Env variables for more dynamic config ([`dc43466`](https://github.com/tsenoner/protspace/commit/dc43466128eafb9e7e4bacf5e417b5e4ab4a62e1))

* Change uttils to config ([`4f9de4b`](https://github.com/tsenoner/protspace/commit/4f9de4b5dead6e6238e4b0e50ce692b3f1c855fb))

* Transition to uv ([`b7713d6`](https://github.com/tsenoner/protspace/commit/b7713d64414e9e6e5e9dc9d7812fb32f8a160eb2))

* Move for easier packaging ([`0e40617`](https://github.com/tsenoner/protspace/commit/0e40617cfb482109e2ceaa2ee87a204c3cd4d999))

* Rename to scripts ([`7f462c1`](https://github.com/tsenoner/protspace/commit/7f462c1f6c14466b7903c10ed23e19c563c5cf5a))

* Update LA image + add ProtSpace workflow ([`4b5a029`](https://github.com/tsenoner/protspace/commit/4b5a029bb24b346bd0aec8ce976ffa1ac552ac71))

* Remove old example file in base ([`9c0069c`](https://github.com/tsenoner/protspace/commit/9c0069ceafe3940734aa44db1d3e1e96bc7afb7a))

* Update merge script for manuscript ([`fdd2df7`](https://github.com/tsenoner/protspace/commit/fdd2df71c674e5aa46c85d2e7489194588e062b1))

* Add examples for pla2g2 and homo sapiens ([`b666d6b`](https://github.com/tsenoner/protspace/commit/b666d6b934ca3b4b8f621c0940c968eddc9d359a))

* Add homo sapiens data ([`87ddb66`](https://github.com/tsenoner/protspace/commit/87ddb6682b0d86c71da89ea4419616055beaae44))

* Remove pdb directories from Git tracking ([`b70132e`](https://github.com/tsenoner/protspace/commit/b70132e783d27b54e7c7e01647d50b7a5d733761))

* remove PDB by default in wsgi.py for gunicorn ([`332889f`](https://github.com/tsenoner/protspace/commit/332889fc956376b479ec082d4c536cb4bbb71207))

* Fix broaken marker style update ([`b1560ab`](https://github.com/tsenoner/protspace/commit/b1560ab4ef94084c06547272f587e5564d178b31))

* Implement PDB viewer and zip upload ([`d55981a`](https://github.com/tsenoner/protspace/commit/d55981aafa72ebddc8ae8bce95d0038a9e1bda3d))

* Fix multiple worker run with gunicorn using dcc.Store ([`64087ca`](https://github.com/tsenoner/protspace/commit/64087cae55fcebed8adb1d5fb5cd5debe1457a11))

* let render only install the needed dependencies ([`760fa12`](https://github.com/tsenoner/protspace/commit/760fa12c2a7db1b273f7a2e96a03d730c67790bc))

* move wsgi to protspace ([`9574c77`](https://github.com/tsenoner/protspace/commit/9574c771eed8732cb071d69f16b350d3cdfb8c57))

* add __init__.py to script ([`1d73cca`](https://github.com/tsenoner/protspace/commit/1d73cca097aab53f25253aa2c85fde0b511d1268))

* Move render.yaml to base ([`0330542`](https://github.com/tsenoner/protspace/commit/03305425563feebbd7b24de47fcf1617b11075c2))

* Set everything up for render ([`07af9c8`](https://github.com/tsenoner/protspace/commit/07af9c8aa2698f972d4f706913c982500d552923))

* add build.sh for render web service ([`104415b`](https://github.com/tsenoner/protspace/commit/104415bc4b91a574cb75aa79ff0d07d9c6211df8))

* Add Pla2g2 dataset ([`5e1f298`](https://github.com/tsenoner/protspace/commit/5e1f2986e8888aa5f8520e561dcca36817c0ff4b))

* Extend script to add colors and shapes ([`03fccb3`](https://github.com/tsenoner/protspace/commit/03fccb365789839d9d1b5746ecc6cabd871e24fe))

* Allow to append embedding spaces to existing JSON ([`6104f32`](https://github.com/tsenoner/protspace/commit/6104f325648a0d96dcfbe4aac1f8ea7b8a525d3c))

* Rename config to utils ([`faf9bda`](https://github.com/tsenoner/protspace/commit/faf9bdaade1d66ac53b1fc21f32cf7416c9121a0))

* Update examples ([`b44363f`](https://github.com/tsenoner/protspace/commit/b44363fea41a995d54801bdb11ada1407dc4dcd3))

* Update examples ([`cfeaef7`](https://github.com/tsenoner/protspace/commit/cfeaef74843a5917933f5e287d39032573f515a7))

* Add settings, download, and upload JSON button ([`6e3fc5c`](https://github.com/tsenoner/protspace/commit/6e3fc5cddccbd30dd769252d766bdbfc35a9820a))

* Update ProtSpace according to new JsonReader ([`4dd8076`](https://github.com/tsenoner/protspace/commit/4dd8076db79c16dcff492e402c5df14eb3ac4470))

* JsonReader updates marker color and shape ([`9dce939`](https://github.com/tsenoner/protspace/commit/9dce939e174bd3e9d2af56f1841fff8c1d6255dd))

* Move color and marker shape update to callbacks ([`e458ca2`](https://github.com/tsenoner/protspace/commit/e458ca28e92a87de945ed0e440dffd49104f0750))

* Legend in saved image is proportional to height ([`d4ecde6`](https://github.com/tsenoner/protspace/commit/d4ecde651d0d373c35e80d0565c70d11277c8443))

* Add script to generate h_sapiens manuscript img ([`6bae1c6`](https://github.com/tsenoner/protspace/commit/6bae1c6bbdcf165c1691b9855a4a6e080edb1ae7))

* Update examples ([`3075762`](https://github.com/tsenoner/protspace/commit/30757622a2be2ade79838171dd76bbdab7f946b8))

* Handle <NAN> colors properly ([`511155f`](https://github.com/tsenoner/protspace/commit/511155faced6be2f6351952a660ae0c0d45df0e2))

* update the LA embedding creating script ([`3c4c8ff`](https://github.com/tsenoner/protspace/commit/3c4c8ffb95e5945da574cbbf714bdcd43535a834))

* add script to download folcomp compressed structures ([`1567ba0`](https://github.com/tsenoner/protspace/commit/1567ba04de3d4f3068d6e7531b624319a53bc420))

* add script to create LA embeddings ([`b32b452`](https://github.com/tsenoner/protspace/commit/b32b45294b5d65d72ef2834575e3ceed22bbfc23))

* add examples for both hex and rbga colors ([`ad1fb63`](https://github.com/tsenoner/protspace/commit/ad1fb631dd86ff664543b71d1eae75ed82dd5832))

* Allow for costumized colors ([`a867f8d`](https://github.com/tsenoner/protspace/commit/a867f8d90b909a2afbe1914a4460cb02b52cfd35))

* Make the info key in the projections optional ([`8c002b3`](https://github.com/tsenoner/protspace/commit/8c002b39d45791f3bd43aab3a89874e529678806))

* Remove old notebook directory ([`a617d4e`](https://github.com/tsenoner/protspace/commit/a617d4edd88f56eaddadab1fc87642c98d3bfa13))

* Add notebook to explore ProtSpace w/o installation ([`18f80e7`](https://github.com/tsenoner/protspace/commit/18f80e799557ee0d7e0be83c053e3257671726a8))

* Have no output when running the app interactivelly

E.g. when running in a jupyter notebook or Google colab ([`76cad2e`](https://github.com/tsenoner/protspace/commit/76cad2e383e9bf5e87972bacac50572fc82eef86))

* Add some usecase examples ([`869437f`](https://github.com/tsenoner/protspace/commit/869437fe330bb714beba7d4b6314268b29a813e0))

* Restructure app for better mantainability ([`d185245`](https://github.com/tsenoner/protspace/commit/d1852450af125c050e32a00c73aad32e130f927c))

* add independent image generation ([`0747af8`](https://github.com/tsenoner/protspace/commit/0747af87ccd6217a87bb1bf4d990e35623a2b167))

* Update 3FTx.html file ([`5b977dc`](https://github.com/tsenoner/protspace/commit/5b977dc56c99f99b242a18905f9d1eca18ab69d6))

* Correct path to 3FTx.html in README.md ([`588c5fe`](https://github.com/tsenoner/protspace/commit/588c5fed43b3cbacc456c991787b648ddb56489d))

* Correct path to 3FTx.html in README.md ([`a8ef080`](https://github.com/tsenoner/protspace/commit/a8ef080b6c9d4bfed77bcf05835b8b5b53331bb4))

* Add example output to the README.md ([`6f896e2`](https://github.com/tsenoner/protspace/commit/6f896e293a53f6e91d9f102f44cd86a2d91ad838))

* Update README.md ([`790178a`](https://github.com/tsenoner/protspace/commit/790178a244ff99c93c393b19aa764d0ea6c594b4))

* Add structure protein display next to scatter plot ([`fe62af5`](https://github.com/tsenoner/protspace/commit/fe62af56e40bdc4f6b95e8190fae587f581625c2))

* Update Layout, add download and search functionality ([`4582ec9`](https://github.com/tsenoner/protspace/commit/4582ec959c47193d46d366bec2ad321d7b62b3a0))

* Restructure app and only keep what is necessary ([`7f55b88`](https://github.com/tsenoner/protspace/commit/7f55b882bc2524f7fdfa6b7681da8fa878c60424))

* Add basic version of the main app to visualize protein embeddings ([`1f06b5b`](https://github.com/tsenoner/protspace/commit/1f06b5b745b0904b26a5dcd12ff95defbde21369))

* Add script to load JSON file for the app to handle ([`7e16cc4`](https://github.com/tsenoner/protspace/commit/7e16cc418dc1de917809c3e62f11ea9f5ed7c138))

* Prepare data to a JSON format to be visulaized ([`7a44dab`](https://github.com/tsenoner/protspace/commit/7a44dab1470353f18269840d83f61771a30673d0))

* Create LICENSE ([`40a9d46`](https://github.com/tsenoner/protspace/commit/40a9d46c378ffb063c18f6830c4b83e8ee87d78d))

* Directory structure ([`2df8e06`](https://github.com/tsenoner/protspace/commit/2df8e065fbf175d16bf15778306819619fa6db7a))

* Remove .DS_Store and add it to .gitignore ([`72d9de3`](https://github.com/tsenoner/protspace/commit/72d9de3afa2425abfbb5e1f2be28442697002eab))

* Remove .DS_Store and add it to .gitignore ([`4a4ef5c`](https://github.com/tsenoner/protspace/commit/4a4ef5c1449eb821a1d51250dcdf267ba5dacd4d))

* Initial commit ([`b46a33f`](https://github.com/tsenoner/protspace/commit/b46a33f9dc3d86970e13b78851bcadf6dc227163))

* Merge pull request #291 from tsenoner/refactor/scatter-plot-part2

refactor(scatter-plot): decompose the component & WebGL renderer into focused modules ([`2ac7495`](https://github.com/tsenoner/protspace/commit/2ac7495aee0b9905e5679cb8dd375fe2708ff44a))

* Merge pull request #292 from tsenoner/feat/better_backend_error_reports

feat(errors): add trace id to bug reports and distinguish too-few sequences ([`1187d16`](https://github.com/tsenoner/protspace/commit/1187d16914f30d314f8cfacc2e0219247b8e07a8))

* Merge pull request #280 from tsenoner/fix/biocentral-error

fix: route Biocentral-unavailable failures to Colab ([`cf43bd6`](https://github.com/tsenoner/protspace/commit/cf43bd6ee4c06b2d4cee3d8dbe94a2e4910659aa))

* Merge branch 'main' into fix/biocentral-error ([`0a5ad61`](https://github.com/tsenoner/protspace/commit/0a5ad6108376b93cf50fdc35a318001d926ec877))

* fix local proxy for dev ([`58f70aa`](https://github.com/tsenoner/protspace/commit/58f70aa9a7bbb688111e89df6faf93b10e96e231))

* Merge pull request #284 from tsenoner/fix/legend-persistence-cath-split-feedback-button

Fix legend visibility persistence, CATH-Gene3D splitting, and Feedback button styling ([`c7f73cd`](https://github.com/tsenoner/protspace/commit/c7f73cd4e7e0b853e330bb570afc02243e10f6b7))

* Fix and speed up the e2e suite (numeric-binning query builder) (#274)

Repairs and parallelizes the Playwright e2e suite for the query builder, then reconciles it with main after merge: numeric range-input filtering (operator + min/max), friendly annotation labels, the filteredProteinIds/filterActive channel, and the unified visibility model. Addresses the #276 review follow-ups (monotonic dot-size ladder, per-bin tooltip assertion, url-view-state distinctness guard). Test-only — no production code changes. ([`adeb2dd`](https://github.com/tsenoner/protspace/commit/adeb2dd17f13fc293741f739fc0cf7ccdd02af35))

* Merge pull request #279 from tsenoner/feat/contac_link

feat: surface support inbox across the interface ([`e4c56cb`](https://github.com/tsenoner/protspace/commit/e4c56cbc61f784bd425316f130e0a2d66479af7a))

* Merge pull request #259 from tsenoner/refactor/control-bar-and-filtering

refactor: control bar cleanup and filtering improvements ([`35dcbd6`](https://github.com/tsenoner/protspace/commit/35dcbd69a88a60aa9b1f28d6cae381cb4352b78d))

* Merge origin/main into refactor/control-bar-and-filtering

Reconciles main's perf/573k SoA PlotData rewrite (Float32Array coords,
slot-based quadtree, projectionPlane mapping, decode worker) with this
branch's visibility-model and query-filter refactor:

- processVisualizationData: keeps main's SoA two-pass cull and plane
  mapping, adds the branch's visibleProteinIds id-membership filter to
  the survivors pass so kept slots retain GLOBAL originalIndices
  (signature: ..., projectionPlane, visibleProteinIds)
- _buildQuadtree / lasso / brush / hover / click: main's slot iteration
  routed through the branch's memoized visibility model (isInteractive)
- restored projectionPlane @property and its updated() triggers, and
  PlotDataPoint.z, which the auto-merge dropped
- _getVisiblePointCount (point-count chip) ported to slot iteration
- branch test fixtures ported to SoA (Float32Array + dimension);
  query-filter composition tests rewritten against PlotData ([`bcea473`](https://github.com/tsenoner/protspace/commit/bcea4730e944ee2566ffd5c6bcd832e0cdec1f64))

* Merge origin/main into refactor/control-bar-and-filtering

Brings in the multi-annotation hover tooltip, cross-projection duplicate
badge grouping, and the includeShapes/shape-rotation removal from main.

Conflict resolved in control-bar.ts: main inserted the `tooltipAnnotations`
property immediately before the `projectionPlane` property this branch
removed (3D plane selector teardown), so the two edits collided on adjacent
lines. Kept main's `tooltipAnnotations`; dropped `projectionPlane`.

The other five overlapping files (data-renderer.ts, control-bar/types.ts,
scatter-plot.ts, style-getters.test.ts, utils/types.ts) auto-merged as
disjoint hunks. Verified post-merge: type-check clean, 871 unit tests pass,
and a per-file 3-way semantic audit confirmed each result equals the union
of both branches' intent with no dropped or duplicated logic. ([`318148f`](https://github.com/tsenoner/protspace/commit/318148f527f1c2210b17493e9591ad1204069029))

* Merge pull request #272 from tsenoner/feat/organize-predicted-annotations

feat(annotations): mark predictions and surface per-annotation docs ([`5ce3341`](https://github.com/tsenoner/protspace/commit/5ce33415e44cecf99a0c33899e8dfbaad04adfde))

* Merge pull request #266 from tsenoner/perf/573k-swissprot-client-opt

perf(573K SwissProt): cut peak memory 3.5× and speedup data loading ([`a63f5b0`](https://github.com/tsenoner/protspace/commit/a63f5b0d4a18da5a17bcdf35150c67cb97a92299))

* Merge pull request #248 from tsenoner/feat/fasta-prep-backend

Feat/fasta prep backend ([`9a024fc`](https://github.com/tsenoner/protspace/commit/9a024fc45d7d37ef0d477d40d46906c16a0f2acc))

* Merge remote-tracking branch 'origin/main' into feat/fasta-prep-backend ([`5eef99d`](https://github.com/tsenoner/protspace/commit/5eef99d66cfbe8c885a13af96d1275a4068f60b5))

* Merge remote-tracking branch 'origin/main' into feat/fasta-prep-backend ([`f899cf6`](https://github.com/tsenoner/protspace/commit/f899cf68374fc1da16214ff95896cddd89f9bcbe))

* ops(prep): production deployment for FASTA prep backend on lab VM

- docker-compose.prod.yml: pin protspace-prep + caddy-ratelimit to GHCR images
  via PREP_TAG / CADDY_TAG, override compose to listen on 0.0.0.0:8080, and
  pass CORS_ALLOWED_ORIGIN through to Caddy.
- config/Caddyfile.prod: rate limit + 9 MB body cap on POST /api/prepare,
  CORS for the configured SPA origin, /healthz endpoint. The lab edge
  gateway terminates TLS upstream; this Caddy listens on plain HTTP.
- scripts/deploy-vm.sh + update-vm.sh: first-time deploy and routine update
  helpers driven by .env.
- .github/workflows/publish-images.yml: build and push protspace-prep and
  caddy-ratelimit images to GHCR on main, tags, and PRs touching the prep
  service or Caddy Dockerfile.
- Split Playwright e2e off the main CI workflow into a scheduled +
  label-gated workflow (run-e2e label or manual dispatch) so PR CI stays
  fast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`504f395`](https://github.com/tsenoner/protspace/commit/504f395f1d988c21ebf90e5df7fe81a40b757a61))

* Merge pull request #254 from tsenoner/feat/multi-annotation-tooltip-234

feat: multi-annotation hover tooltip (#234) ([`073c30d`](https://github.com/tsenoner/protspace/commit/073c30ddfa7e816a5fd1065e9b4bf81dfd4aa3d2))

* Merge pull request #264 from tsenoner/chore/issue-262-openspec-setup

chore(openspec): adopt OpenSpec as default spec-driven workflow ([`720e1e0`](https://github.com/tsenoner/protspace/commit/720e1e0778e59293f74ab9e5df926cd16e5e8e03))

* Merge pull request #223 from tsenoner/fix/enhancements

Enhancements: Z-order issue ([`fb9bda3`](https://github.com/tsenoner/protspace/commit/fb9bda3a42da318bec5f4e374f159b247ae21cb2))

* Merge branch 'main' into fix/enhancements ([`6044af2`](https://github.com/tsenoner/protspace/commit/6044af2d13ad17099e1c734bd280195933e0ebbf))

* Merge remote-tracking branch 'origin/main' into fix/enhancements ([`80cf182`](https://github.com/tsenoner/protspace/commit/80cf182cd45febb9f00cb881927931d8715196ad))

* Merge pull request #253 from tsenoner/refactor/issue-252-remove-include-shapes

refactor: remove "Include shapes" toggle (closes #252) ([`e09bc0f`](https://github.com/tsenoner/protspace/commit/e09bc0fae17661501dcd09703ce2a54d95537d93))

* Merge pull request #251 from tsenoner/fix/issue-222

fix issue 222 ([`e8ff919`](https://github.com/tsenoner/protspace/commit/e8ff919f596f66fea58dad103cca8c06de6b7ac2))

* Merge pull request #247 from tsenoner/docs/figure-editor-imagery

docs(explore): figure editor imagery + screenshot pipeline overhaul ([`48f1a4c`](https://github.com/tsenoner/protspace/commit/48f1a4cf90a91ad050391043405f1ef54f963f39))

* Merge pull request #246 from tsenoner/docs/tour-and-recovery

docs(explore): document Product Tour and Recovery Banner ([`ade6454`](https://github.com/tsenoner/protspace/commit/ade64543d538c1ba4c774d61c9edc4acc6293085))

* Merge pull request #245 from tsenoner/tour/copy-fixes

docs(tour): clarify Esc, Filter query builder, and Cmd/Ctrl+Click ([`b25b17b`](https://github.com/tsenoner/protspace/commit/b25b17b67f5e1e55d059b775bde86eb2e6113074))

* Merge pull request #244 from tsenoner/docs/accuracy-fixes

docs: small accuracy fixes (projection list, AlphaFold path, dev port) ([`ee1191e`](https://github.com/tsenoner/protspace/commit/ee1191e64e8fe6c13d05b6d0f339af368fe74d5c))

* Merge pull request #243 from tsenoner/tour/figure-editor-mention

docs(tour): mention Figure Editor in Export step ([`7de7c37`](https://github.com/tsenoner/protspace/commit/7de7c37c8fbcbcb3d33cacdb2db7b8d0c7870f2d))

* Revert "docs(plans): archive publish-editor review-fixes plan"

This reverts commit 15a8e1506575c7f44191a2ce51416f95a2e7fdc9. ([`469fa3a`](https://github.com/tsenoner/protspace/commit/469fa3a0a900baad7c7818968779f6b0917add77))

* Merge pull request #232 from tsenoner/feat/publish-editor

feat(publish): publication-ready figure editor ([`eb531c9`](https://github.com/tsenoner/protspace/commit/eb531c9862bb64414cd2c5b39cbc49ed64453ee2))

* Merge pull request #242 from tsenoner/fix/publish-editor-review-fixes

fix(publish): address PR #232 review (16 findings) ([`66ea8d2`](https://github.com/tsenoner/protspace/commit/66ea8d21f3d2e2b32228343de70323000f03dbba))

* Merge remote-tracking branch 'origin/main' into feat/publish-editor ([`280f8f8`](https://github.com/tsenoner/protspace/commit/280f8f8840303df279cee062e6f710ff0eaadd5c))

* Merge pull request #238 from tsenoner/fix/issue-218

fix(explore): keep structure errors inline ([`90ed1b1`](https://github.com/tsenoner/protspace/commit/90ed1b177921c2f9c312921ba7222f59c56d925e))

* Merge remote-tracking branch 'origin/main' into fix/issue-218

# Conflicts:
#	app/src/explore/notifications.ts ([`d52a4b1`](https://github.com/tsenoner/protspace/commit/d52a4b10f29ab402bfa9f723e4c93165ef48f194))

* Merge pull request #241 from tsenoner/fix/load-reliability-phase-2

fix(load): reliable large-bundle load (Phase 2 + 2.5) ([`7e2dbbb`](https://github.com/tsenoner/protspace/commit/7e2dbbb9f4af15b7602f0f547e8f86ff9c55519d))

* Merge pull request #240 from tsenoner/fix/load-reliability-phase-1

fix(load): crash-loop guard via OPFS lastLoadStatus + design docs ([`2297acf`](https://github.com/tsenoner/protspace/commit/2297acfce4e88c48f16b5441d7d6a2561c80be18))

* Merge pull request #228 from tsenoner/fix/issue-226-float-numeric-inference

fix(legend): NA-handling redesign + numeric type inference ([`7c355b1`](https://github.com/tsenoner/protspace/commit/7c355b168f48dd3077edcb4cfd22880b680ec1fd))

* Merge pull request #195 from tsenoner/t03i/issue151

Add an extract all button to the Other window on the button right ([`a2d5c92`](https://github.com/tsenoner/protspace/commit/a2d5c92e8f2312f23a2997eac25c1db93103ba11))

* [FEATURE] Add an extract all button to the Other window on the button right
Fixes #151 ([`c49155f`](https://github.com/tsenoner/protspace/commit/c49155fb62062683aa361b8d4b96881e7be33932))

* Merge pull request #203 from tsenoner/feat/query-builder-filter

feat(core): replace checkbox filter with query builder (#161) ([`b484ad4`](https://github.com/tsenoner/protspace/commit/b484ad43b8182446489ea9aeb16c6f63486fe7bf))

* Merge branch 'main' into feat/query-builder-filter

Resolve conflicts by keeping query-builder approach over old checkbox
filter. Add public applyProjectionSelection/applyAnnotationSelection
methods introduced in main's explore URL view state feature.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`afd0d95`](https://github.com/tsenoner/protspace/commit/afd0d95c2f154ac4302d2e20834e8d954726575d))

* Merge pull request #213 from tsenoner/fix/189-brush-extent-tracks-viewport

feat(scatter-plot): fix brush viewport extent and add lasso selection (#189, #208) ([`50e697b`](https://github.com/tsenoner/protspace/commit/50e697b1697246083618f609f06d65cddf035f0d))

* Merge remote-tracking branch 'origin/main' into fix/189-brush-extent-tracks-viewport

# Conflicts:
#	app/tests/dataset-reload.spec.ts
#	app/tests/playwright.config.ts ([`5c85b64`](https://github.com/tsenoner/protspace/commit/5c85b649615efc6d6123eecdec12dbbdff6b35b3))

* Merge pull request #214 from tsenoner/feat/explore-url-view-state

feat(explore): persist url-backed view state ([`6322bde`](https://github.com/tsenoner/protspace/commit/6322bdeb6a735bb325bc3d75b42a447c3fc461c8))

* Merge pull request #215 from tsenoner/165-feature-show-label-for-scores-in-tooltips-interpro---bitscore-uniprot---eco

feat(tooltip): add headers for bitscore and evidence annotations ([`d1edb90`](https://github.com/tsenoner/protspace/commit/d1edb9011c5041a431ae131d3f9285865b7468d3))

* Merge pull request #210 from tsenoner/fix/reject-wrong-file-extension

fix(core): reject files without .parquetbundle extension before loading ([`5e76b00`](https://github.com/tsenoner/protspace/commit/5e76b0089aa2b35959ed1215406155f05a285d0c))

* Merge pull request #211 from tsenoner/feat/cloudflare-analytics-privacy-policy

feat(app): add Cloudflare Web Analytics and privacy policy ([`ac42924`](https://github.com/tsenoner/protspace/commit/ac429243eb0728ed71fb7d37f9ee45e69f8481e2))

* Merge pull request #207 from tsenoner/fix/legend-empty-after-isolation-dataset-switch

fix(core): clear scatterplot isolation state on dataset load ([`5a046fe`](https://github.com/tsenoner/protspace/commit/5a046fef4f803f46642387f6e0fcd36e59c4a311))

* Merge pull request #201 from tsenoner/feat/generic-numeric-binning

Implement generic numeric legend binning ([`500f08f`](https://github.com/tsenoner/protspace/commit/500f08f883c114a4a35d62b45d60ecbbb8f17f86))

* Restore demo data and fixture phosphatase tests ([`03be379`](https://github.com/tsenoner/protspace/commit/03be379094235e10337e5335d06ba2021a624c86))

* Finish numeric legend review fixes ([`76c2ff0`](https://github.com/tsenoner/protspace/commit/76c2ff0aafd92f15b058909dafd15d4f83472b35))

* restore legend chip parity and drag ordering ([`2aa570d`](https://github.com/tsenoner/protspace/commit/2aa570d9957d3875ac0084c994030637f7f4b64c))

* Implement generic numeric legend binning ([`4a53f60`](https://github.com/tsenoner/protspace/commit/4a53f60c78bcaa67dc0b58213089f8fb8e4387bf))

* Merge pull request #204 from tsenoner/fix/projection-name-passthrough

fix(core): pass through projection names without reformatting ([`07c6871`](https://github.com/tsenoner/protspace/commit/07c68718e0bd8f1a5ba9e9a4eba16ad0ed0bd301))

* Merge pull request #199 from tsenoner/fix/192-opfs-private-browsing-guidance

refactor: unify messaging across app and components ([`bfac334`](https://github.com/tsenoner/protspace/commit/bfac334cd4c4ffeec987fcd393177ef5127a65c8))

* Merge pull request #180 from tsenoner/develop

Optimize loading, partially fix OOM crash, isolation mode fix, optional legend in export, improve canvas shapes ([`610f39a`](https://github.com/tsenoner/protspace/commit/610f39a346f3bdd4e0eaa5b09690245fae514ea8))

* Merge branch 'main' into develop ([`2414753`](https://github.com/tsenoner/protspace/commit/24147539abd3caf13a009981fb55a8273fa2b351))

* Merge pull request #193 from tsenoner/t03i/issue160

[FEATURE] Color the 3D structure by pLDDT value ([`f3a1441`](https://github.com/tsenoner/protspace/commit/f3a14411fef6e4b05e008e503efbb636e193baa0))

* [FEATURE] Color the 3D structure by pLDDT value
Fixes #160 ([`4fd8215`](https://github.com/tsenoner/protspace/commit/4fd821558fbeac227601f6034326c09bd67084ce))

* Merge pull request #132 from tsenoner/feat/129-add-knip

feat(build): add knip for unused code and dependency detection ([`22caf91`](https://github.com/tsenoner/protspace/commit/22caf91653bb54f7705ed34ca50aa2617b9e10ea))

* Merge pull request #191 from tsenoner/feat/176-persist-last-dataset-opfs

feat(app): persist imported datasets in OPFS ([`803759d`](https://github.com/tsenoner/protspace/commit/803759d703e96522399edca84b2465e21ce2ed04))

* Merge remote-tracking branch 'origin/main' into feat/176-persist-last-dataset-opfs

# Conflicts:
#	packages/core/src/components/control-bar/export-persistence-controller.ts
#	packages/core/src/components/legend/controllers/persistence-controller.ts ([`b9df022`](https://github.com/tsenoner/protspace/commit/b9df022b8b702b48f9f185a5db738880326529e3))

* Merge pull request #182 from tsenoner/fix/172-handle-all-evidence-codes

fix(core): handle all ECO/GO evidence codes in annotation parsing ([`04b3270`](https://github.com/tsenoner/protspace/commit/04b32703ba6bdf131a9e57afd29f8371662bbc17))

* Merge pull request #184 from tsenoner/feat/149-persist-export-options

feat(core): persist export options per annotation ([`8dd1a5d`](https://github.com/tsenoner/protspace/commit/8dd1a5db2d97ddcb38272706b3252ba42ba3656e))

* Merge remote-tracking branch 'origin/main' into feat/149-persist-export-options

# Conflicts:
#	app/src/demo/main.ts ([`704dd6d`](https://github.com/tsenoner/protspace/commit/704dd6d49826b5da7d580169f0f40dbe56590790))

* Merge pull request #181 from tsenoner/fix/178-reload-default-dataset-state

fix(app): always reset legend state on dataset load ([`f7e95dc`](https://github.com/tsenoner/protspace/commit/f7e95dcfa769cdee0f1ee397f5d095f7e4b820a6))

* Merge pull request #170 from tsenoner/feature/154-create-a-demo-introduction-for-users

feat: add interactive product tour for Explore page ([`b52ff8d`](https://github.com/tsenoner/protspace/commit/b52ff8d1dde24aa2c3312f95729646fa49792716))

* Merge pull request #168 from tsenoner/fix/post-merge

Fix/post merge ([`664c5f8`](https://github.com/tsenoner/protspace/commit/664c5f8071b674240a9d0db82a7e7c680db35386))

* Merge pull request #164 from tsenoner/t03i/issue153

feat(legend): <NA> marker behaviour is now the same as any other legend category ([`929e62d`](https://github.com/tsenoner/protspace/commit/929e62d0e4bfe88b1e281d565171efd1fd887855))

* Merge remote-tracking branch 'origin/main' into t03i/issue153 ([`a52cc35`](https://github.com/tsenoner/protspace/commit/a52cc35de1d52a9773c69dfa6768856465aaf3a6))

* Merge pull request #135 from tsenoner/chore/auto-performance-measurements ([`ae3d19d`](https://github.com/tsenoner/protspace/commit/ae3d19de6777bcddaf948c18a7a7f49f97870a1b))

* Merge pull request #159 from tsenoner/feat/data-management-update ([`a794ba9`](https://github.com/tsenoner/protspace/commit/a794ba99d8ecc4cfd2d3ad5d918c0676db10179f))

* Merge pull request #163 from tsenoner/docs/assets ([`92f43fb`](https://github.com/tsenoner/protspace/commit/92f43fbc9ed3bf7a5550de61d7f4109f77016de1))

* Merge remote-tracking branch 'origin/main' into docs/assets ([`0dad8ec`](https://github.com/tsenoner/protspace/commit/0dad8ec71aae0fcf1afa7b6c124ae9a9acd1ab23))

* Merge pull request #146 from tsenoner/fix/legend-component

Fix/legend component ([`29fe07c`](https://github.com/tsenoner/protspace/commit/29fe07cea128ab9e21996c09a304a2d5a169ab41))

* Revert "fix(legend): legend item sorting"

This reverts commit 251c10a32334e8941eece5e716b942a1858693f3. ([`aa7fb10`](https://github.com/tsenoner/protspace/commit/aa7fb10958f8b1c648c9cdaede6e273ac479dc17))

* Merge pull request #128 from tsenoner/feat/97-persist-in-parquetbundle

feat(core): add legend settings persistence in parquetbundle format ([`5d23cdb`](https://github.com/tsenoner/protspace/commit/5d23cdb0ef3fb69977543cbd6b02c89afe8b6d86))

* Merge remote-tracking branch 'origin/main' into feat/97-persist-in-parquetbundle

# Conflicts:
#	packages/core/src/components/data-loader/utils/conversion.ts
#	packages/core/src/components/legend/types.ts ([`a6daedd`](https://github.com/tsenoner/protspace/commit/a6daedd8cb0e1ca9243e8bf2575df8b31791f831))

* Merge pull request #103 from tsenoner/enhancements ([`e704f29`](https://github.com/tsenoner/protspace/commit/e704f29e389c65fb9669cfef033b1f8724b44563))

* Merge branch 'main' into enhancements ([`2198ea7`](https://github.com/tsenoner/protspace/commit/2198ea786ebb7716886d1955a4f3d1c0f14b0ca0))

* Merge branch 'main' into enhancements ([`b6097eb`](https://github.com/tsenoner/protspace/commit/b6097eb01eaceb01071e6c10dcc58ac741600da2))

* Merge branch 'main' into enhancements ([`34feaa8`](https://github.com/tsenoner/protspace/commit/34feaa873c4566b22c8656230cac84a9f6d47362))

* Merge branch 'main' into enhancements ([`5b1d818`](https://github.com/tsenoner/protspace/commit/5b1d81877d19bc5ae6821c30f9524d804260b643))

* Merge pull request #131 from tsenoner/fix/130-lint-staged-precommit

fix(build): use lint-staged in pre-commit hook ([`f0e9ba1`](https://github.com/tsenoner/protspace/commit/f0e9ba161faf85c46684430213edaf1d37738a63))

* Merge pull request #127 from tsenoner/refactor/css-architecture ([`b45b20f`](https://github.com/tsenoner/protspace/commit/b45b20fcc92861222e6b6fb1758f8a8d089567a7))

* Merge pull request #126 from tsenoner/t03i/issue114

docs: Update the current issue templates ([`e6a53a4`](https://github.com/tsenoner/protspace/commit/e6a53a4c53ec0ff3aef2201bbb3cc7183ceeab7e))

* Merge pull request #108 from tsenoner/t03i/issue73

feat(control-bar): integrate feature select component and enhance styling ([`edb46e7`](https://github.com/tsenoner/protspace/commit/edb46e7f74310b9fec53666e5afc26a3a16a3e3e))

* Merge pull request #125 from tsenoner/fix/96-sorting-and-NA

fix(legend): Fix N/A Value Handling and Legend Sorting ([`9823e47`](https://github.com/tsenoner/protspace/commit/9823e4728c132dfdf2598031e52d74d7aea09d6f))

* Merge branch 'main' into fix/96-sorting-and-NA ([`9255e2a`](https://github.com/tsenoner/protspace/commit/9255e2a9491fc4a7f1c42a37ec59e5be1f101a87))

* Merge pull request #106 from tsenoner/feature/improve-export-quality ([`a6c005f`](https://github.com/tsenoner/protspace/commit/a6c005f23a545349f258ce0ae7faf8e178513d95))

* Merge main into feature/improve-export-quality

Resolved conflicts by preferring main branch with minimal changes:
- Import SHAPE_PATH_GENERATORS and getLegendDisplayText from @protspace/utils
- Keep all main's accessibility features, constants, and implementation
- Maintain main's getLegendExportData return type and implementation ([`7769803`](https://github.com/tsenoner/protspace/commit/7769803170a1f57c5b57fb278c6453177f9fbf9e))

* Merge remote-tracking branch 'origin/main' into t03i/issue73 ([`bb444dd`](https://github.com/tsenoner/protspace/commit/bb444ddefe57e537518060b7b25c64f70ed7caca))

* Merge pull request #116 from tsenoner/feat/96-persist-legend-config

feat(legend): add dataset hash and localStorage persistence for legend ([`b855acc`](https://github.com/tsenoner/protspace/commit/b855accdcb5b591a75696ebaceb021cf22c0de2b))

* Merge latest main into feat/96-persist-legend-config ([`e7f7430`](https://github.com/tsenoner/protspace/commit/e7f743035e716371406ba514cf894d98cd84cce5))

* Merge pull request #119 from tsenoner/feature/113-feature-keyboard-shortcuts-for-selection-and-search

Feature/113 feature keyboard shortcuts for selection and search ([`30a34a1`](https://github.com/tsenoner/protspace/commit/30a34a1ad296c978f228ff472257e20a839e4c2e))

* Merge pull request #111 from tsenoner/legend-drag-idx

Legend drag idx ([`3e18ae7`](https://github.com/tsenoner/protspace/commit/3e18ae74ea96330fadaf74e455f330a877732c55))

* Refactor legend component: remove unnecessary blank lines and improve code readability in legend-utils.ts and legend.ts ([`2156f2f`](https://github.com/tsenoner/protspace/commit/2156f2f720719a94d206bc561abadb42f78d24ae))

* Merge pull request #105 from tsenoner/feature/improve-colorisation

Improve colorisation and shape distribution optimized for visible categories ([`599eec3`](https://github.com/tsenoner/protspace/commit/599eec378e50bbb5ae0f3f642171bad9873e2c88))

* Merge branch 'feat/docs-and-improvements' ([`32690f8`](https://github.com/tsenoner/protspace/commit/32690f8e75bf001b0c83f3673d8533dcb1b8a377))

* Merge pull request #98 from tsenoner/webgl

WebGL implementation, Adding some other features, Bug fixes ([`3d17fc2`](https://github.com/tsenoner/protspace/commit/3d17fc2b2e534f1af20dcac136f717485aa4eabf))

* update(index.html): revise meta description for clarity and focus on user journey ([`8762e4e`](https://github.com/tsenoner/protspace/commit/8762e4e781e4650894549f970cf658f123367b5c))

* Merge pull request #84 from tsenoner/peymanvahidi/issue55

Legend Improvements ([`a3c0a95`](https://github.com/tsenoner/protspace/commit/a3c0a95871ba0279c52949243593fc4b97816951))

* Merge branch 'main' into peymanvahidi/issue55 ([`479f107`](https://github.com/tsenoner/protspace/commit/479f107875d00a2f60e52e4ef5e4b0823762dbcc))

* Merge pull request #86 from tsenoner/landing-page

Landing Page ([`574b220`](https://github.com/tsenoner/protspace/commit/574b22054f64da377e09364c246569f9b722e503))

* Merge branch 'main' into landing-page ([`5e5bafe`](https://github.com/tsenoner/protspace/commit/5e5bafe89f17de1e291868d0dbd572ae7c08279b))

* Merge pull request #56 from tsenoner/chore/storybook

Deletes the entire examples/storybook/ directory, including all story files, configurations, and dependencies, streamlining the development environment. Empty values are now properly displayed as: "N/A". ([`4a377d9`](https://github.com/tsenoner/protspace/commit/4a377d91da523e664d764139d1abf80e924ecc10))

* Merge branch 'main' into chore/storybook

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`e1caab8`](https://github.com/tsenoner/protspace/commit/e1caab8057de8d442ab7c982a0e4df71f1da27b3))

* Merge pull request #85 from tsenoner/feat/scatterplot-zoom

refactor(scatter-plot): update zoom in to infinite ([`27a4ab1`](https://github.com/tsenoner/protspace/commit/27a4ab190157813895349cacd21842994c8ac6f1))

* Merge remote-tracking branch 'origin/main' into chore/storybook ([`6683045`](https://github.com/tsenoner/protspace/commit/6683045024f20ba14a519f090acaa9a538c50d84))

* Merge branch 'main' into chore/storybook

Signed-off-by: Tobias O <tobias.olenyi@tum.de> ([`a3ed43b`](https://github.com/tsenoner/protspace/commit/a3ed43b0e15028043028070b22fe8f83f1e4b02f))

* Merge pull request #81 from tsenoner/ui-improvements

UI improvements: Isolate Button & Popup Removal ([`5198d38`](https://github.com/tsenoner/protspace/commit/5198d382afa6189a75fea79203c41738012226b0))

* Merge pull request #80 from tsenoner/selection-rendering

Fixing Selection Rendering Performance ([`fed74fb`](https://github.com/tsenoner/protspace/commit/fed74fb957cc2bfd4768c8e971d5bb989e6bc908))

* Merge branch 'main' into selection-rendering ([`80d69ba`](https://github.com/tsenoner/protspace/commit/80d69baf886362dbd41e6e4d0b1bebadfb64a217))

* Merge pull request #77 from Moomboh/feat/multilabel-points

Multilabel Data Points ([`b8cd286`](https://github.com/tsenoner/protspace/commit/b8cd2869bdb4463ff066eb0dcd4ffa06efbf62e6))

* Merge pull request #79 from tsenoner/t03i/issue72

fix: reload legend when empty parquet file provided ([`a2524d8`](https://github.com/tsenoner/protspace/commit/a2524d87d44ab367b8b0222a147e6109bc6209b1))

* Merge branch 'feat/search-field' ([`10c63f8`](https://github.com/tsenoner/protspace/commit/10c63f8f10ecd2daad3f02938328a07fbdf68929))

* Merge remote-tracking branch 'origin/main' into feat/search-field ([`54a1f1e`](https://github.com/tsenoner/protspace/commit/54a1f1e3f3af021dd308ed7f6f9bef1204ab6faa))

* Merge pull request #61 from shayanzamiri/refactor/style-improvement ([`42de139`](https://github.com/tsenoner/protspace/commit/42de13929b870b647f2a7d7d7ad8e9770a6cf92b))

* fix(structure-viewer/control-bar/formating)

increase structure viewer's height, change import button's text and style, format and lint of the project. ([`175b6b4`](https://github.com/tsenoner/protspace/commit/175b6b473d3be83623c6f42682aa44c81981a149))

* Merge pull request #66 from tsenoner/feat/3d-beacons

feat: enhance StructureService with 3D Beacons API integration ([`9701873`](https://github.com/tsenoner/protspace/commit/97018731f05c0ed11a8989a056187d7e54fbb486))

* Merge remote-tracking branch 'origin/feat/alphafold-structure' ([`fd26159`](https://github.com/tsenoner/protspace/commit/fd26159981e6ef391bb99d7dff74e807067ef48e))

* Revert "refactor: update structure loading to use 3D-Beacons API"

This reverts commit 68056ad61f8d289d9dc426a5ac4a2e1cf3549eaf. ([`f7cec87`](https://github.com/tsenoner/protspace/commit/f7cec87bed627d308b113d46abd539478cb93a6d))

* Merge pull request #58 from tsenoner/feat/demo-real-data ([`fc40813`](https://github.com/tsenoner/protspace/commit/fc40813ed62de4ee0d93bea6b88373fbe2dd7138))

* Merge branch 'main' into feat/demo-real-data ([`fe618a6`](https://github.com/tsenoner/protspace/commit/fe618a66ea0a281fd5f652d92e4fe2be66bf2327))

* Merge pull request #57 from shayanzamiri/fix/style ([`3fbce87`](https://github.com/tsenoner/protspace/commit/3fbce874d4b4894ccdc2a605118a5aa484c15453))

* Merge branch 'main' into Fix/Style ([`044754f`](https://github.com/tsenoner/protspace/commit/044754ff87a35da5a146186dd17677a1f80c6fe8))

* Merge pull request #53 from tsenoner/refactor/update_readme

Update readme ([`ddb63f7`](https://github.com/tsenoner/protspace/commit/ddb63f7e4dba2f7097d296da87a9aa62bd9848e0))

* Merge branch 'main' into refactor/update_readme ([`545dd3d`](https://github.com/tsenoner/protspace/commit/545dd3dfa06d62b4640f99bdd0128d23792a2c40))

* Rename project from protspace_d3 to protspace_web ([`138b9ea`](https://github.com/tsenoner/protspace/commit/138b9ea867afb8271148dbcab2f606c3a37e9c58))

* Merge pull request #54 from tsenoner/example/notebook-run

feat(notebooks): add Jupyter notebook for data preparation ([`eb5de41`](https://github.com/tsenoner/protspace/commit/eb5de4193db82439d5acceb92a4363713b8a9378))

* fix(example):Visualization responsiveness modified ([`183757e`](https://github.com/tsenoner/protspace/commit/183757ef5e286bde953fecadcbaf4adc0fc41966))

* fix(example):right panel layout modified ([`52fa194`](https://github.com/tsenoner/protspace/commit/52fa194238bbc68aefde567b3a888b2bd6040186))

* Fix(legend): when legend items are too much it will scroll. ([`a3e83cb`](https://github.com/tsenoner/protspace/commit/a3e83cb29b76d2ad2fb9ff534ad1a5e899ed99df))

* Fix(legend):in the legend text, big words will wrap to the next line and some style bugs fixed ([`40c32cf`](https://github.com/tsenoner/protspace/commit/40c32cf9097949d9aed0ecbf21f8e796d8764266))

* Fix(control-bar):left controlbar options list's transparency's problem fixed. ([`5fff359`](https://github.com/tsenoner/protspace/commit/5fff35969c004e7018bc35f577edb957edbc01d8))

* Fix(example/html,Darkmode,control-bar):fixed example's scrollbar styles, fixed darkmode problem, fixed filter on right controlbar styles problem & overflow problem. ([`ac917c1`](https://github.com/tsenoner/protspace/commit/ac917c1dc0d95d8ed62f6a23a011f1610e18e201))

* Fix(Control-Bar):right control bar Reset button's Styles fixed ([`c89345c`](https://github.com/tsenoner/protspace/commit/c89345cc4deade5663547f6d57a0026c8c1b0303))

* Fix(control-bar):right control-bar's styles fixed ([`d370b93`](https://github.com/tsenoner/protspace/commit/d370b93d426fc497dd9f7b7c522d0d8aeafa42e3))

* fix(legend-setting):fixed some styles ([`bda8e77`](https://github.com/tsenoner/protspace/commit/bda8e775032c12613afbd32c517b2a536a58861a))

* fix(structure-viewer):header padding and close button size chaned ([`9c21b69`](https://github.com/tsenoner/protspace/commit/9c21b692bfa22865b61e27e61c85d7ed1f39d6f4))

* fix(control-bar):lef controls chevron replaced with a svg ([`0396c7c`](https://github.com/tsenoner/protspace/commit/0396c7c66f354fb549bc85deaf8dafe95abd35b3))

* Merge pull request #46 from tsenoner/feature/gokhan/split-feature

feat(scatter-plot, control-bar): implement data splitting functionality and enhance interaction ([`837fa48`](https://github.com/tsenoner/protspace/commit/837fa482aea87ba7dea55ec4448929ff7654d3fe))

* Resolve PR comments ([`73b5495`](https://github.com/tsenoner/protspace/commit/73b5495b65858148097286b27bd9304b1b793a78))

* Resolve PR comment ([`a5524a1`](https://github.com/tsenoner/protspace/commit/a5524a1c28087fe541aab726e4c32f4a2be962ea))

* Merge pull request #43 from tsenoner/enhancements

Adding new features and fixing some bugs from issues ([`64d5bdc`](https://github.com/tsenoner/protspace/commit/64d5bdca28f31ce748594d10847da329ca4f81f3))

* Merge pull request #37 from tsenoner/enhancement

feat(scatter-plot, legend): enhance visualization components with improved rendering and interaction

- Add canvas rendering with caching and style management
- Implement zoom size scale exponent for responsive point sizing
- Enhance legend with drag & drop support and sorting features
- Adjust stroke opacity for improved visual clarity
- Update default symbol sizes and add input field placeholders ([`5d9e545`](https://github.com/tsenoner/protspace/commit/5d9e545fe1467673b761702f954b44139b3a8516))

* Merge pull request #31 from tsenoner/bugfix/update-missing-structure-behaviour

refactor(structure-viewer): remove unused error message styles and clean up code ([`12a4af3`](https://github.com/tsenoner/protspace/commit/12a4af334d9773a071f0ab01ba801b26747249d2))

* Update README.md to refelect clean up ([`114edcd`](https://github.com/tsenoner/protspace/commit/114edcd6b0705244100b25bf5357e54cfe87cbd5))

* Merge pull request #18 from tsenoner/web-component

Updated Web-component, React app ([`feb3b84`](https://github.com/tsenoner/protspace/commit/feb3b84fe2a801247a2275aca19385a1fb7098e1))

* refactor the app completely ([`ec0d504`](https://github.com/tsenoner/protspace/commit/ec0d5048af8e063413d97e2327ba9e99d8fefb76))

* Move the styles to another file ([`f113e6a`](https://github.com/tsenoner/protspace/commit/f113e6ae2e2fd468626fdd148a323a8f68eeb765))

* Update development scripts in package.json for improved workflow ([`a676d5f`](https://github.com/tsenoner/protspace/commit/a676d5f29a16b407c2fa5091111af889b833ae3d))

* Change some styles ([`6a6b2bf`](https://github.com/tsenoner/protspace/commit/6a6b2bfe06f7520b56ab81e9900a1d961835a273))

* Refactor legend item visibility handling

- Double click will only show that feature
- if no items remain visible, all items are shown by default ([`18d747b`](https://github.com/tsenoner/protspace/commit/18d747b0ea9884dd6a6bc2c8bee43c43fe66dcb9))

* Update dependencies and configuration files ([`f5c0955`](https://github.com/tsenoner/protspace/commit/f5c0955659180814b9c2bc910a92144c050db394))

* Refactor mouse event handling in scatter plot component

- Introduced a new method to calculate local pointer position for improved tooltip accuracy during mouse over events. ([`80480ed`](https://github.com/tsenoner/protspace/commit/80480edd6e1b6462ce5ca18633e95550c8951388))

* Update dependencies and TypeScript configuration ([`2adb0b8`](https://github.com/tsenoner/protspace/commit/2adb0b86c0572006eefe9b03654be3dbf614f55d))

* Add utils package with core functionalities and visualization exports ([`3d7bc2f`](https://github.com/tsenoner/protspace/commit/3d7bc2ffb01d81843277838a69e41fa813006497))

* Enhance core package with new components and dependencies ([`72f0d51`](https://github.com/tsenoner/protspace/commit/72f0d51fbdb3c1f050d43c8cba81347e6f690eae))

* Add .parquetbundle file scatterplot example ([`466a435`](https://github.com/tsenoner/protspace/commit/466a43558fdf25590ec6c4495b01e2f92255d87b))

* Enhance scatterplot example with new features and optimizations

- Update the files based on the new updates ([`bb5f551`](https://github.com/tsenoner/protspace/commit/bb5f55104834ad2df01ae65a3b501ecd63007534))

* Update PULL_REQUEST_TEMPLATE.md ([`a39d7c0`](https://github.com/tsenoner/protspace/commit/a39d7c071bddf24a9ebd41700f5c56d567896230))

* Update PULL_REQUEST_TEMPLATE.md ([`0fb5d64`](https://github.com/tsenoner/protspace/commit/0fb5d644e8de6647b0cc07374759088d23cb01fd))

* Merge pull request #12 from tsenoner/feature/interactive-legend

Add interactive legend web component ([`2882c22`](https://github.com/tsenoner/protspace/commit/2882c222477365aca89125363f85bff1ab4216b7))

* Add changeset for legend component feature ([`4958e62`](https://github.com/tsenoner/protspace/commit/4958e6223a94772d73a2e7be5e6d6532bc6141c9))

* Add interactive legend web component with scatterplot integration

- Create protspace-legend web component using Lit framework
- Implement click interactions to toggle feature value visibility
- Remove reset button from scatterplot component, expose resetZoom() method
- Update example to demonstrate legend-scatterplot communication
- Add CLAUDE.md development guidance file

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com> ([`f946195`](https://github.com/tsenoner/protspace/commit/f94619506684aa2dcd37196b440043c7a36a6b36))

* Fix differentiation between highlighting and selecting, fix camera bug when double click in selection mode (#11)

* Fix differentiation between highlighting and selecting, fix camera bug when double click in selection mode ([`138b384`](https://github.com/tsenoner/protspace/commit/138b384c842a35aa3fbeb44121fe8b9876ca1a56))

* Merge pull request #9 from tsenoner/chore/refactor-repo

Refactor: Transition to Turborepo, Changesets, Storybook & New Structure ([`f086a54`](https://github.com/tsenoner/protspace/commit/f086a54f129431b8bbbbbc7445460e2322bc114f))

* Fix next.js integration (#10) ([`2f55685`](https://github.com/tsenoner/protspace/commit/2f55685432bbca938e1d3668d0b4a2882f677727))

* Remove vite from package.json ([`30d1ca5`](https://github.com/tsenoner/protspace/commit/30d1ca5d59adf1d3a908bfad33d4ab86f574ad24))

* Improve changeset description ([`0192be0`](https://github.com/tsenoner/protspace/commit/0192be0051508f7230fee324556ad397393663ef))

* Add PR template ([`792b3e0`](https://github.com/tsenoner/protspace/commit/792b3e08ab4bcb19350823f66e79dadaf6cf1eb9))

* Add example static site ([`02ff515`](https://github.com/tsenoner/protspace/commit/02ff515964dc4c5131d83889b3722c08eb2a4cca))

* Add Storybook ([`2ad6138`](https://github.com/tsenoner/protspace/commit/2ad61386987853842e57fbea258e9dd1f99e2a43))

* Update dependencies ([`976c152`](https://github.com/tsenoner/protspace/commit/976c15275f6a324afc4be1fed5ac13bd6388191d))

* Fix building issues ([`30e5fea`](https://github.com/tsenoner/protspace/commit/30e5fead15e01e2e0fdc0008306ae3f47fa99773))

* Merge pull request #8 from tsenoner/fix/gokhan/select-behaviour

feat(split-mode): implement split history management and UI updates ([`e5127e2`](https://github.com/tsenoner/protspace/commit/e5127e21ac5a4df7b50a0dde6f5b3d6d369c095b))

* Merge pull request #7 from tsenoner/fix/behaviour-when-AF2-structure-not-available

Enhance error handling for Mol* molecular viewer, fetching AF2 structures ([`9db0be2`](https://github.com/tsenoner/protspace/commit/9db0be23a8b225d1fe69082c7160118f46677aa3))

* Merge pull request #6 from tsenoner/fix/cannot-upload-different-session

Fix bug regarding session load and export correctly ([`29955cf`](https://github.com/tsenoner/protspace/commit/29955cf7ea07c6af9f65c8e2eddbf8fab837d959))

* Merge pull request #2 from tsenoner/feature/implement-main-functionalities

UI Enhancements and Export Functionality Improvements ([`56425df`](https://github.com/tsenoner/protspace/commit/56425df6b1f008c26070dc8077686e8cbf19be08))

*   feat: update issues and enhance header functionality

- Marked several issues as completed in the documentation, including improvements to image export quality and UX enhancements.
- Removed the share session functionality from the header component and adjusted the selected proteins display logic.
- Enhanced the header's styling and search input for better user experience.
- Updated the scatterplot component to clarify interaction instructions.
- Modified the structure viewer's tips for improved clarity on interaction methods. ([`ffb62b6`](https://github.com/tsenoner/protspace/commit/ffb62b61f98ee6eb11086403cd8109eae63204bd))

* data(example): add more sophisticated dat example ([`655914c`](https://github.com/tsenoner/protspace/commit/655914cf9c720ab0817096494a57b4b3a832651f))

* Remove legend data from data spec ([`d421114`](https://github.com/tsenoner/protspace/commit/d421114eeba280afc7004da312e617777622e46d))

* Update data schema and corresponding example file ([`c89805e`](https://github.com/tsenoner/protspace/commit/c89805e7a25c6436a1640e9ba0e654dabc4dc93b))

* Add .gitignore and README.md ([`6a34758`](https://github.com/tsenoner/protspace/commit/6a34758bcdf08693f3b1bea04c647d96b859aa00))

* Remove node_modules from Git tracking ([`460dbfa`](https://github.com/tsenoner/protspace/commit/460dbfaf2317a26fa3d0bedddbf0254946fb31b1))

* first commit ([`d72ca49`](https://github.com/tsenoner/protspace/commit/d72ca49c47c7f9bd1b5049668d081122ae6721c6))
