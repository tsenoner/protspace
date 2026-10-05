## ADDED Requirements

### Requirement: Benchmark datasets come from a pinned release

The benchmark SHALL read its datasets from the gitignored `perf/datasets/` directory, populated by `pnpm perf:fetch` from the `perf-datasets` GitHub release, and SHALL NOT depend on the example catalog or on bundles the application serves. The release SHALL keep every bundle formerly served under `apps/web/public/data/` under its original file name, together with the manuscript's 113K β-lactamase bundle and the 832-protein phosphatase EAT bundle. `pnpm perf:fetch` SHALL verify each file's byte count and sha256 against a committed checksum list and SHALL fail on any mismatch. A dataset whose file is missing SHALL be recorded as that dataset's error, naming `pnpm perf:fetch`, and SHALL NOT discard the rest of the run.

#### Scenario: Original dataset ids keep working

- **WHEN** a developer runs `pnpm perf:fetch` and then the benchmark with `PERF_DATASETS=venom_eat_stats,573K_swissprot`
- **THEN** both datasets load from `perf/datasets/` under their original names and are measured

#### Scenario: A corrupted download

- **WHEN** a fetched perf dataset's sha256 differs from the committed checksum list
- **THEN** `pnpm perf:fetch` fails and names the file

#### Scenario: A dataset was never fetched

- **WHEN** the benchmark runs a dataset whose file is absent from `perf/datasets/`
- **THEN** the results file records that dataset's error, naming `pnpm perf:fetch`, and the other datasets are still measured

#### Scenario: The example catalog changes

- **WHEN** an example is added to or removed from the Import-menu catalog
- **THEN** the benchmark's dataset list and files are unchanged
