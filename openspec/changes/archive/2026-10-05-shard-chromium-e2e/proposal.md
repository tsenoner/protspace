## Why

After main gained #496's example-datasets spec, the Chromium E2E suite grew from 122 to 156 tests. Its job took 8m43s on PR #503 (run on an AMD EPYC 7763, 902 summed test-seconds). The suite is CPU-bound on SwiftShader WebGL, and a 4-vCPU runner takes at most 2 workers: PR #423 measured every test about 35% slower at 3. More workers on one runner don't help; more runners do.

## What Changes

- The Chromium E2E job becomes a two-way matrix. Each shard runs `pnpm test:e2e --shard=<i>/<n>` with `E2E_BROWSERS=chromium`, on the bare runner and with only the headless shell installed, as before.
- Each shard uploads its own report (`playwright-report-chromium-<i>`). `fail-fast: false` lets every shard finish, so a red run lists all its failures.
- The `e2e-validation` requirement "CI provisions browsers per job" now says every default test, rather than every default project, runs in exactly one job, and covers the Chromium shards.

## Capabilities

### Modified Capabilities

- `e2e-validation`: "CI provisions browsers per job" covers sharded Chromium jobs.

## Impact

- `.github/workflows/e2e.yml` only. Setup (checkout, install, build) now runs once per shard, adding about 1 min of runner time per extra shard.
- With the current tests, the two shards carry about 418 and 442 test-seconds (measured from run 37323580234's per-test durations against `--list --shard`), so each finishes in roughly 4-5 min on the slower runner type.
- No required status checks reference the old job name (`main` has none).
