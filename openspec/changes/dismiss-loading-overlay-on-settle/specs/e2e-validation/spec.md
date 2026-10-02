## MODIFIED Requirements

### Requirement: Conditional cleanup and polling are bounded

An E2E helper that conditionally dismisses an optional UI element SHALL return without a positive wait when the element is absent. Every operation-specific `waitForFunction` timeout SHALL be passed as Playwright options rather than as predicate data. A persisted-dataset readiness helper SHALL wait for successful load finalization rather than file presence alone. A helper that waits for a condition the scenario requires SHALL NOT discard that wait's failure, for example through `.catch(() => {})`.

#### Scenario: Optional tour UI is absent

- **WHEN** a helper checks for a product-tour dialog that is not visible
- **THEN** the helper returns immediately without consuming an absence timeout

#### Scenario: An Explore data condition never becomes true

- **WHEN** `waitForExploreDataLoad` does not observe plot data within its operation timeout
- **THEN** the helper fails at that operation timeout instead of inheriting a larger test-level timeout

#### Scenario: Persisted files exist while their load status is pending

- **WHEN** an imported dataset has been written to OPFS but its metadata has not reached `success`
- **THEN** the persistence readiness helper continues waiting
- **AND** a reload does not race into the unfinished-dataset recovery path

#### Scenario: A required overlay wait times out

- **WHEN** a helper waits for the loading overlay to be removed and it is still present at the deadline
- **THEN** the helper fails at that deadline rather than returning as if the overlay had cleared

## ADDED Requirements

### Requirement: Explore load waits observe overlay removal and plot data

An E2E helper that waits for an Explore dataset load SHALL require both plot data on `#myPlot` (a non-empty protein list, or exactly the expected protein count when one is given) and the absence of `#progressive-loading`, and SHALL then wait one animation frame before returning. Load waits SHALL poll at 100 ms and SHALL NOT use a fixed delay as load completion. Load-wait helpers SHALL be defined once in `apps/web/tests/helpers/explore.ts` rather than copied into spec files.

#### Scenario: Plot data is present while the overlay is still shown

- **WHEN** `#myPlot` already holds the new proteins and the loading overlay is still in the document
- **THEN** the load wait keeps waiting

#### Scenario: A spec waits for a specific protein count

- **WHEN** a spec waits for the plot to hold a given number of proteins
- **THEN** it uses the shared helper with that count rather than a local `waitForFunction` copy

#### Scenario: The overlay is removed

- **WHEN** the overlay is gone and the plot holds the expected data
- **THEN** the helper returns after one animation frame, so the scatterplot's point index has been rebuilt

### Requirement: CI provisions browsers per job

The E2E CI workflow SHALL select each job's Playwright projects through `E2E_BROWSERS` so that every default project runs in exactly one job. The Chromium job SHALL run on the bare runner and install only the Chromium headless shell, without system packages. The Firefox and WebKit job SHALL run in the Playwright container image whose version matches the installed `@playwright/test`, and SHALL fail before running tests when the two versions differ.

#### Scenario: Browser selection is unset

- **WHEN** `E2E_BROWSERS` is unset
- **THEN** Playwright lists every default project

#### Scenario: The CI jobs together cover the default projects

- **WHEN** the projects selected by `E2E_BROWSERS=chromium` and by `E2E_BROWSERS=firefox,webkit` are listed
- **THEN** the two lists are disjoint and their union equals the list with `E2E_BROWSERS` unset

#### Scenario: The Chromium job sets up its browser

- **WHEN** the Chromium job installs its browser
- **THEN** it installs no apt packages

#### Scenario: The container image and the test runner drift apart

- **WHEN** `@playwright/test` is upgraded without updating the Firefox/WebKit job's container image tag
- **THEN** that job fails at its version check, naming both versions, before any test runs
