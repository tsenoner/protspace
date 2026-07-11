## ADDED Requirements

### Requirement: Non-tour E2E scenarios start without the product tour

The default Playwright context for every non-tour project SHALL contain the persisted product-tour completion state before its first application navigation. The dedicated product-tour project SHALL start with empty persisted state so first-visit behavior remains testable.

#### Scenario: A regular E2E scenario opens Explore

- **WHEN** a scenario outside the product-tour project navigates to `/explore`
- **THEN** the product-tour overlay is suppressed before application initialization
- **AND** the scenario does not require a preparatory navigation solely to mutate localStorage

#### Scenario: A product-tour scenario opens Explore

- **WHEN** a scenario in the product-tour project navigates to `/explore` with empty project storage state
- **THEN** the first-visit product tour can auto-start and be validated

### Requirement: Conditional cleanup and polling are bounded

An E2E helper that conditionally dismisses an optional UI element SHALL return without a positive wait when the element is absent. Every operation-specific `waitForFunction` timeout SHALL be passed as Playwright options rather than as predicate data. A persisted-dataset readiness helper SHALL wait for successful load finalization rather than file presence alone.

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

### Requirement: Browser compatibility coverage is explicit

The default E2E suite SHALL execute all retained critical application journeys in Chromium. Firefox and WebKit SHALL execute only explicit compatibility scenarios. Both SHALL cover a deep-link refresh journey, consolidated duplicate/empty/partial-invalid URL normalization, a History API back/forward journey, and scatterplot file-drop/runtime wiring. Firefox SHALL additionally cover OPFS persistence through `@opfs-browser`; WebKit SHALL omit that scenario while the pinned Playwright build does not provide a usable OPFS implementation.

#### Scenario: Listing the default URL projects

- **WHEN** Playwright lists the Chromium, Firefox, and WebKit URL-state projects
- **THEN** Chromium includes the complete retained URL-state suite
- **AND** Firefox and WebKit each include only the tagged compatibility journeys
- **AND** unusable WebKit OPFS coverage is excluded rather than reported as a permanent skip

#### Scenario: A bundle crosses browser-owned import boundaries

- **WHEN** the compatibility projects are listed
- **THEN** Chromium, Firefox, and WebKit include the scatterplot file-drop/runtime journey
- **AND** Chromium and Firefox include the OPFS persist/reload journey

### Requirement: E2E coverage targets user-visible integration boundaries

E2E scenarios SHALL be retained for behavior that depends on browser engines, real WebGL, filesystem persistence, navigation/history, file transfer, or cross-component application wiring. Pure transformation cases and exact duplicate application journeys MUST be covered at the lowest effective layer and MUST NOT require duplicate full-browser scenarios.

#### Scenario: Two scenarios exercise the same notification journey

- **WHEN** one scenario is an exact duplicate and another contains all of its user-visible assertions plus stronger integration assertions
- **THEN** the stronger E2E scenario is retained
- **AND** the duplicate is removed or merged

#### Scenario: A synthetic event checks deterministic notification copy

- **WHEN** an E2E directly dispatches a normalized event only to check message mapping already covered by focused unit tests
- **THEN** the real user-triggered integration journey is retained
- **AND** the deterministic copy assertion remains at the lower layer instead of requiring another full-browser scenario

#### Scenario: URL normalization is exhaustively unit-tested

- **WHEN** a URL case tests only deterministic query normalization already covered by focused unit tests
- **THEN** the default suite consolidates duplicate-key, empty-value, and partial-validity wiring into one table-driven full-application journey

### Requirement: Correctness tests use deterministic outcomes

The correctness E2E suite MUST prioritize observable final state over shared-runner elapsed time. It MAY use a generous stall watchdog; tight performance thresholds SHALL live in dedicated performance tooling.

#### Scenario: Figure-editor geometry receives rapid updates

- **WHEN** the test applies a burst of target-geometry updates
- **THEN** the final requested geometry is present
- **AND** the preview remains rendered and usable
- **AND** a coarse watchdog detects a nonresponsive interaction without enforcing the old two-second micro-benchmark

### Requirement: Heavyweight and live suites are explicit

An E2E project that requires a local heavyweight fixture or live service not present in a normal checkout SHALL be excluded from the default project list and SHALL require its environment opt-in to equal `1` exactly.

#### Scenario: The default suite is listed without the large fixture

- **WHEN** `RUN_LARGE_BUNDLE_E2E` is unset
- **THEN** the large-bundle project is absent rather than reported as a skipped default test

#### Scenario: A developer opts into the large fixture suite

- **WHEN** `RUN_LARGE_BUNDLE_E2E=1` and the documented fixture is available
- **THEN** Playwright includes the large-bundle project

#### Scenario: A false-like value is supplied for the live suite

- **WHEN** `RUN_LIVE_E2E=0`
- **THEN** Playwright excludes the live FASTA project

#### Scenario: A developer opts into the live suite

- **WHEN** `RUN_LIVE_E2E=1`
- **THEN** Playwright includes the live FASTA project

### Requirement: Retries remain diagnostic

The E2E configuration SHALL run with no retries during normal local development and SHALL permit at most one retry in CI, where the retry produces trace diagnostics without allowing a flaky test to pass the overall run.

#### Scenario: A local E2E scenario fails

- **WHEN** `CI` is unset and a Playwright scenario fails
- **THEN** the failure is reported without rerunning the scenario

#### Scenario: A CI E2E scenario fails on its first attempt

- **WHEN** `CI` is set and a Playwright scenario fails on its first attempt
- **THEN** Playwright may retry it once with first-retry trace capture enabled
- **AND** the overall run fails even if the retry passes
