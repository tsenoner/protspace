## Why

The monorepo merge put the `.parquetbundle` producer (`apps/protspace`, Python) and its consumer (`packages/core` data-loader, TypeScript) in one repository for the first time. Nothing tests the path between them.

Each side is tested only against itself: `bundle-roundtrip.test.ts` and `v2-roundtrip.test.ts` cover TypeScript writer → TypeScript reader, and `apps/protspace/tests/test_bundle_*.py` cover Python writer → Python reader. The Python → TypeScript direction — the path every real user dataset takes through `apps/prep` — is covered only by `.parquetbundle` blobs committed under `apps/web/public/data/` and `apps/web/tests/fixtures/`, which no process regenerates when either side changes.

The formats have already drifted. `write_bundle` emits 3 to 5 parts; `extractRowsFromParquetBundle` rejects anything other than 3 or 4. A bundle produced by `protspace bundle -s <statistics>` cannot be opened by the web application. No test reports this.

CI cannot report it either. `ci.yml` uses `paths-ignore: apps/protspace/**` and `protspace-ci.yml` uses `paths: apps/protspace/**`, so the two suites are mutually exclusive by construction: a pull request that changes the Python writer never runs the TypeScript suite, and a pull request that changes the TypeScript reader never runs the Python suite. A contract test added to either existing workflow would be skipped by exactly the change most likely to break it.

## What Changes

- Add a contract test suite that generates bundles at test time with the real `protspace bundle` CLI and reads them with the real `extractRowsFromParquetBundle`, so no bundle fixture is committed and none can go stale.
- Cover four bundle layouts in one generator run: 3-part, 4-part with settings, 5-part with settings and statistics, and 5-part with the zero-byte settings sentinel that Python writes when statistics are present without settings.
- Use an annotation payload that exercises the v2 encoding contract — percent-encoded labels, a `;` multi-hit cell, a numeric column containing a null, and a 3D projection — rather than only part layout.
- Widen the TypeScript reader to accept and ignore a trailing statistics part, resolving the existing drift in favor of the producer.
- Run the suite as its own vitest project rather than a guarded test inside `packages/core`, so it either runs or the job fails, with no silent skip when `uv` is absent.
- Add a dedicated workflow whose path filter is the union of producer, consumer, and test paths, so the job runs for a change to either side.

## Capabilities

### New Capabilities

- `bundle-format-contract`: Defines the `.parquetbundle` layout both languages must agree on, the generated-not-committed fixture rule, the payload the contract must exercise, and the CI trigger boundary that makes the check unavoidable.

### Modified Capabilities

<!-- No existing specification defines the cross-language bundle format contract. -->

## Non-goals

- **The TypeScript → Python direction.** Bundles exported by `packages/utils/src/parquet/bundle-writer.ts` and re-opened in the Python tooling are out of scope. The harness added here is reversible for that direction later; the immediate risk is the pipeline direction.
- **Validating `protspace annotate` / `protspace project` output.** The generator hand-writes the input parquets that those stages would produce. Their column layout is a second, narrower contract this change does not cover.
- **Reading statistics in the web application.** Part 5 is tolerated and ignored, not parsed.

## Impact

- **New contract suite:** `tests/contract/` (Python generator, TypeScript spec, vitest project config)
- **Reader:** `packages/core/src/components/data-loader/utils/bundle.ts` part-count validation
- **Workflow:** new `.github/workflows/bundle-contract.yml`
- **Root scripts:** a `test:contract` entry in `package.json`
- **Product behavior:** unchanged except that 5-part bundles become loadable
- **Dependencies:** no new runtime or test dependencies
