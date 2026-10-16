## Why

PR #549 deprecates reading 3-D projections and offers `protspace convert --flatten-3d`, which
keeps each 3-D projection's X and Y coordinates. Every message about it (the reading warning,
the `convert` help and output, the web notice and the docs) implies that this X/Y view is a
faithful 2-D projection. That holds only for PCA, whose first two axes of `pca3` equal `pca2` up
to the sign of each axis. UMAP, t-SNE, PaCMAP, LocalMAP and MDS optimise for the number of
dimensions they are given, so the X/Y view of their 3-D layout is that layout seen from one side:
points far apart along z can overlap, and it is not what `umap2` or `tsne2` would give.

## What Changes

- The 3-D reading warning, the `convert --flatten-3d` help, the line `convert` prints after
  flattening, and the warning `convert` prints when it keeps 3-D projections say that the X/Y
  view equals the 2-D projection only for PCA, and recommend recomputing with the 2-D method
  (e.g. `umap2`) when the embeddings are at hand. `--flatten-3d` stays on offer.
- The web app's 3-D notice says the same, and no longer says "To keep this view".
- `docs/guide/python-cli.md`, `docs/explore/control-bar.md`, `docs/explore/exporting.md` and
  `docs/guide/data-format.md` drop the claim that flattening keeps the picture unchanged.

No behaviour changes: what is read, written and flattened stays as it is.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deprecation-policy`: the 3-D reading warning, the web notice and the `convert` warning name
  what the X/Y view is and recommend recomputing with the 2-D method.

## Impact

- `apps/protspace/src/protspace/deprecations.py`, `apps/protspace/src/protspace/cli/convert.py`
- `apps/web/src/explore/notifications.ts` (and its test)
- The four docs pages above; tests that pin the wording
