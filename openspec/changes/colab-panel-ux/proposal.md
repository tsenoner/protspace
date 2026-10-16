## Why

An external user ran the Preparation notebook in Colab (dark mode) on 5,035 proteins with an
ESM2-650M `.h5`, a custom CSV and non-UniProt IDs, and hit three bugs and a run of friction:

- The install cell upgraded numpy on disk while Colab had the old one loaded; its import check
  passed and Generate then failed on a numpy internals error until a manual restart.
- The perplexity slider went to 500 while protspace accepts 5 to 50, so t-SNE failed at Generate.
- The EAT cell ran an unguarded k=1 transfer: with references that were all toxins, every
  unknown protein became a toxin, with no distance cutoff and no neighbour report to show it.
- Collapsed section titles were near-black on dark grey; a stale "No file received" message sat
  under a newly uploaded path; every failure printed the same unrelated troubleshooting list;
  log lines told Colab users to pass CLI flags; a UniProt fetch ran for IDs that cannot match;
  the EAT target list stayed empty until a manual reload; and a session restart lost every
  setting.

## What Changes

- The install cell (both Colab notebooks) stops with a restart message naming each package pip
  changed under an already-imported module, and keeps stopping until the session restarts.
- Every Methods slider stays within the range `DimensionReductionConfig` accepts; perplexity is an
  integer slider from 5 to 50.
- The EAT cell calibrates a distance cutoff (`auto`, as `protspace transfer --max-distance auto`)
  by default, offers a numeric cutoff, no cutoff, and leaving distant queries unpredicted, keeps
  k, reports how many queries were distant, and offers the neighbour report as a TSV download.
  Under a released protspace without these options it says so and runs the plain transfer.
- The panel: contrast that holds in Colab's light and dark modes for ipywidgets 7 and 8; a status
  card that says what runs, what failed with advice for that failure, and where the bundle went;
  CLI wording in log lines translated to the panel's controls; a _Fetch annotations again_ box;
  no UniProt fetch when no ID is an accession (CSV only when a CSV is given); the EAT column list
  refreshed after each Generate; settings kept in the runtime and restored after a restart; tabs
  named by what they take.

## Capabilities

### New Capabilities

- `notebook-annotation-transfer`: how the Preparation notebook's EAT cell transfers labels: the
  default distance cutoff, the distant-query option, the neighbour report, and the fallback for a
  released protspace without them.

### Modified Capabilities

- `notebook-input-handling`: the install cell's stale-module check, slider bounds, failure
  advice, panel wording, the non-UniProt-ID path, and settings that survive a restart.

## Impact

- `apps/protspace/notebooks/ProtSpace_Preparation.ipynb`, `ProtSpace_Transfer.ipynb` (install cell)
- `apps/protspace/tests/test_notebooks.py`
- `docs/guide/data-preparation.md`, `docs/explore/eat.md`, `apps/protspace/CLAUDE.md`
- No package code changes: the notebook uses `run_transfer`'s existing `max_distance`,
  `skip_distant` and `report` arguments and `write_report`.
