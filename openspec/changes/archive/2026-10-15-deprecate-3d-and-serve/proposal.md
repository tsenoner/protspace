## Why

Two parts of the Python package are kept alive only for a shrinking set of users: 3-D projections (`-m umap3`, `pca3`, …), which the web viewer shows only as their X/Y view, and `protspace serve`, the legacy Dash viewer behind the `protspace[frontend]` extra, whose remaining reasons to exist are offline viewing and 3-D. The maintainer has decided both go in protspace 5.0.0, and that 5.0.0 also stops _reading_ 3-D projections (today every reader shows them as their X/Y view). So that nobody is stranded with old files, `protspace convert` survives 5.0.0 as the upgrade path: it keeps its own reader for v1/v2 bundles and 3-D projections and writes v3 with 2-D projections. Users need a release cycle of warnings before that, and the repo needs something that stops 5.0.0 from shipping with either still in it: a deprecation that only lives in prose is forgotten at the bump, as the v1/v2 bundle read deprecation (also due in 5.0.0) would be today.

**Tracking issue:** #544 (milestone v5.0.0).

## What Changes

- Requesting any 3-D method (a method whose dimension suffix is `3`) in `protspace prepare` or `protspace project` logs one deprecation warning per run naming the requested 3-D methods, the removal version and the 2-D replacement. The projection still runs. `prepare` parses `-m` before any embedding starts, so on a FASTA or `-q` input the warning, and any malformed-spec error, come before the embeddings. `-m` help and the docs mark 3-D methods deprecated.
- `protspace serve` is marked deprecated in `--help` and prints a deprecation warning pointing to https://protspace.app/explore (the bundle is read in the browser and never uploaded) before it starts. It still works. The root `--help` quick start stops suggesting it.
- Reading a bundle that holds 3-D projections is deprecated too. Python's bundle readers (and `protspace stats` on a projection directory) log one warning per read naming the 3-D projections, the removal version and `protspace convert --flatten-3d`. The web app shows a non-blocking notice when a user imports such a bundle: 3-D projections are shown as their X/Y view, reading them ends in 5.0.0, and `protspace convert` turns them into 2-D.
- `protspace convert --flatten-3d` rewrites each 3-D projection as a 2-D one holding its X/Y coordinates (the picture the web viewer shows today), renamed with an `(X/Y)` suffix and marked `flattened_from_3d` in its metadata so it is not mistaken for a 2-D fit; quality figures computed on the 3-D layout are dropped. It works on v3 inputs as well as v1/v2. Without the flag, `convert` warns when its input holds 3-D projections; in 5.0.0 flattening becomes automatic.
- `protspace convert` keeps its legacy reader in 5.0.0 by design. It is not a registry entry, and the release gate does not ask for it to be removed. The `parquetbundle-v3` change's 5.0.0 follow-up (task 6.2, Migration Plan) is amended to say so, and its task 5.5 asks it to carve `--flatten-3d` out of its `bundle-conversion` rule that a v3 input is left untouched before it archives.
- A single deprecation registry in the package holds each deprecation's feature, removal version and warning text; every deprecation warning takes its text and version from it. The existing v1/v2 bundle read deprecation (`parquetbundle-v3`) joins it, so its removal version is enforced the same way.
- A test pins the web app's own statements of the removal versions (the legacy-format notice, the 3-D notice and the decoder's deprecation notes, in TypeScript) to the registry, so the two languages cannot name different releases.
- A unit test fails when the package's own version reaches any registry entry's removal version.
- The release workflow computes the next version with semantic-release's read-only `--print` before cutting a release, and a small script fails the job, listing what must be removed, when that version reaches a registry entry's removal version. When no release is due the gate passes.
- Docs (`docs/guide/python-cli.md` including its "Upgrading from v4.4" note, `docs/guide/data-format.md`, `docs/explore/control-bar.md`, `docs/explore/exporting.md`, `apps/protspace/README.md`, `apps/protspace/docs/cli.md`), `apps/protspace/CLAUDE.md` and `AGENTS.md` describe the deprecations, the registry and the gate. The Colab notebooks already request 2-D methods only and need no change.

Nothing is removed in this change, and nothing here is breaking: the removal itself is a later, deliberately breaking change for 5.0.0.

## Capabilities

### New Capabilities

- `deprecation-policy`: how protspace announces a scheduled removal (one registry, one warning text, CLI help markers) and how its release process refuses to ship a version that still holds a feature past its removal version; lists the deprecations currently scheduled (producing 3-D projections, `protspace serve`, reading v1/v2 bundles, reading 3-D projections) and the upgrade path that outlives them (`protspace convert`, including `--flatten-3d`).

### Modified Capabilities

None. No existing spec covers projection methods, the local viewer or the release workflow.

## Impact

- New `apps/protspace/src/protspace/deprecations.py` (stdlib only), `apps/protspace/scripts/check_deprecations.py`, and tests for both.
- `data/io/bundle.py` readers warn on 3-D projections; `convert_bundle` gains `flatten_3d` and reports what it did; `cli/convert.py` gains `--flatten-3d`; `cli/stats.py` warns on 3-D projections.
- Web: `apps/web/src/explore/notifications.ts` (3-D notice) and `dataset-controller.ts` (shows it for user imports), with unit and e2e tests.
- `openspec/changes/parquetbundle-v3/` task 6.2 and its Migration Plan step 4: convert keeps reading v1/v2 in 5.0.0; new unticked task 5.5: carve `--flatten-3d` out of its `bundle-conversion` requirement before archiving.
- `data/processors/pipeline.py` (`parse_methods_arg` warns; a method without a dimension suffix gets a clear error), `cli/prepare.py` (parses `-m` before embedding), `cli/serve.py`, `cli/app.py` (quick start), `cli/common_options.py` (`-m` help only), `data/io/bundle.py` (removal version read from the registry; message unchanged).
- `.github/workflows/protspace-release.yml` gains one step before `semantic-release version`; `protspace-ci.yml` adds that workflow and the three TypeScript files the pin reads to its path filter, because tests read them.
- Users of 3-D methods or `serve` see a new WARNING line; exit codes and outputs are unchanged, except that a malformed `-m` spec given to `prepare` is now a usage error (exit 2, before any embedding) instead of a logged error (exit 1) after it.
- From the next PR after the version reaches 5.0.0, the unit test fails until the removals land; a release computing 5.0.0 fails its gate.
