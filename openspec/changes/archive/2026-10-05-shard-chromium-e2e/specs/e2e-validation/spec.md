## MODIFIED Requirements

### Requirement: CI provisions browsers per job

The E2E CI workflow SHALL select each job's Playwright projects through `E2E_BROWSERS` and split the Chromium tests across parallel shard jobs with Playwright's `--shard`, so that every default test runs in exactly one job. Each Chromium shard SHALL run on the bare runner and install only the Chromium headless shell, without system packages. The Firefox and WebKit job SHALL run in the Playwright container image whose version matches the installed `@playwright/test`, and SHALL fail before running tests when the two versions differ.

#### Scenario: Browser selection is unset

- **WHEN** `E2E_BROWSERS` is unset
- **THEN** Playwright lists every default project

#### Scenario: The CI jobs together cover the default tests

- **WHEN** the tests selected by each Chromium shard (`E2E_BROWSERS=chromium --shard=<i>/<n>`) and by `E2E_BROWSERS=firefox,webkit` are listed
- **THEN** the lists are pairwise disjoint and their union equals the list with `E2E_BROWSERS` unset

#### Scenario: The Chromium job sets up its browser

- **WHEN** a Chromium shard installs its browser
- **THEN** it installs no apt packages

#### Scenario: A Chromium shard fails

- **WHEN** a test in one Chromium shard fails
- **THEN** the other shards still run to completion and report their own results

#### Scenario: The container image and the test runner drift apart

- **WHEN** `@playwright/test` is upgraded without updating the Firefox/WebKit job's container image tag
- **THEN** that job fails at its version check, naming both versions, before any test runs
