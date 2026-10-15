## Why

Two parts of the Python package are kept alive only for a shrinking set of users: 3-D projections (`-m umap3`, `pca3`, …), which the web viewer shows only as their X/Y view, and `protspace serve`, the legacy Dash viewer behind the `protspace[frontend]` extra, whose remaining reasons to exist are offline viewing and 3-D. The maintainer has decided both go in protspace 5.0.0. Users need a release cycle of warnings before that, and the repo needs something that stops 5.0.0 from shipping with either still in it: a deprecation that only lives in prose is forgotten at the bump, as the v1/v2 bundle read deprecation (also due in 5.0.0) would be today.

**Tracking issue:** #544 (milestone v5.0.0).

## What Changes

- Requesting any 3-D method (a method whose dimension suffix is `3`) in `protspace prepare` or `protspace project` logs one deprecation warning per run naming the requested 3-D methods, the removal version and the 2-D replacement. The projection still runs. `-m` help and the docs mark 3-D methods deprecated.
- `protspace serve` is marked deprecated in `--help` and prints a deprecation warning pointing to https://protspace.app/explore (the bundle is read in the browser and never uploaded) before it starts. It still works. The root `--help` quick start stops suggesting it.
- A single deprecation registry in the package holds each deprecation's feature, removal version and warning text; every deprecation warning takes its text and version from it. The existing v1/v2 bundle read deprecation (`parquetbundle-v3`) joins it, so its removal version is enforced the same way.
- A test pins the web app's own statements of the v1/v2 removal version (the legacy-format notice and the decoder's deprecation notes, in TypeScript) to the registry, so the two languages cannot name different releases.
- A unit test fails when the package's own version reaches any registry entry's removal version.
- The release workflow computes the next version with semantic-release's read-only `--print` before cutting a release, and a small script fails the job, listing what must be removed, when that version reaches a registry entry's removal version. When no release is due the gate passes.
- Docs (`docs/guide/python-cli.md`, `docs/guide/data-format.md`, `apps/protspace/README.md`), `apps/protspace/CLAUDE.md` and `AGENTS.md` describe the deprecations, the registry and the gate. The Colab notebooks already request 2-D methods only and need no change.

Nothing is removed in this change, and nothing here is breaking: the removal itself is a later, deliberately breaking change for 5.0.0.

## Capabilities

### New Capabilities

- `deprecation-policy`: how protspace announces a scheduled removal (one registry, one warning text, CLI help markers) and how its release process refuses to ship a version that still holds a feature past its removal version; lists the deprecations currently scheduled (3-D projections, `protspace serve`, reading v1/v2 bundles).

### Modified Capabilities

None. No existing spec covers projection methods, the local viewer or the release workflow.

## Impact

- New `apps/protspace/src/protspace/deprecations.py` (stdlib only), `apps/protspace/scripts/check_deprecations.py`, and tests for both.
- `data/processors/pipeline.py` (`parse_methods_arg` warns), `cli/serve.py`, `cli/app.py` (quick start), `cli/common_options.py` (`-m` help only), `data/io/bundle.py` (removal version read from the registry; message unchanged).
- `.github/workflows/protspace-release.yml` gains one step before `semantic-release version`; `protspace-ci.yml` adds that workflow and the three TypeScript files the pin reads to its path filter, because tests read them.
- Users of 3-D methods or `serve` see a new WARNING line; exit codes and outputs are unchanged.
- From the next PR after the version reaches 5.0.0, the unit test fails until the removals land; a release computing 5.0.0 fails its gate.
