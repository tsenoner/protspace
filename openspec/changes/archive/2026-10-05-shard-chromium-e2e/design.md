## Context

The Chromium job runs every default project except the Firefox/WebKit compatibility ones. Wall time is about (summed test-seconds / 2 workers) × 1.09, because both workers stay busy and none of the specs are serial.

## Decisions

- **Two shards, by test count.** `fullyParallel` lets Playwright's `--shard` split individual tests into contiguous groups in project order. At two shards the groups carry 418 vs 442 test-seconds with today's suite, so no weighting is needed. When a shard runs past about 5 min, add a matrix entry rather than raising `workers`.
- **Per-shard reports, no merge job.** Each shard uploads its HTML report and traces under its own artifact name. A blob-report merge job would add a serial step of about 1 min to every run, only to join two reports.
- **`fail-fast: false`.** A failure in one shard should not cancel the other and hide its failures.

## Alternatives rejected

- **3 workers on one runner:** about 35% slower per test and red 3/3 times in PR #423.
- **Larger runners:** paid even for public repos.
- **Merging reports with the blob reporter:** see above. Revisit if the per-shard reports prove awkward.
