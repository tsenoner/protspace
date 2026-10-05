## 1. Workflow

- [x] 1.1 Turn the Chromium job into a `shard: [1, 2]` matrix that runs `pnpm test:e2e --shard=<i>/<n>` with `fail-fast: false` and per-shard report artifacts.
- [x] 1.2 actionlint and prettier are clean.

## 2. Verification

- [x] 2.1 The two shards' `--list` outputs are disjoint, and together they equal the unsharded `E2E_BROWSERS=chromium` list.
- [x] 2.2 Both shards pass in CI, with wall times recorded in the PR: runs 37334779820 (workflow 322 s; shards 278 s and 316 s) and 37334798171 (277 s; shards 272 s and 204 s).
