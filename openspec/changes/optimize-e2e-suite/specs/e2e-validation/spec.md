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

An E2E helper that conditionally dismisses an optional UI element SHALL return without a positive wait when the element is absent. Every operation-specific `waitForFunction` timeout SHALL be passed as Playwright options rather than as predicate data.

#### Scenario: Optional tour UI is absent

- **WHEN** a helper checks for a product-tour dialog that is not visible
- **THEN** the helper returns immediately without consuming an absence timeout

#### Scenario: An Explore data condition never becomes true

- **WHEN** `waitForExploreDataLoad` does not observe plot data within its operation timeout
- **THEN** the helper fails at that operation timeout instead of inheriting a larger test-level timeout

### Requirement: Browser compatibility coverage is explicit

The default E2E suite SHALL execute all retained critical application journeys in Chromium. Firefox and WebKit SHALL execute only scenarios explicitly tagged `@cross-browser`, and the tagged set SHALL cover a deep-link refresh journey and a History API back/forward journey.

#### Scenario: Listing the default URL projects

- **WHEN** Playwright lists the Chromium, Firefox, and WebKit URL-state projects
- **THEN** Chromium includes the complete retained URL-state suite
- **AND** Firefox and WebKit each include only the tagged compatibility journeys

### Requirement: E2E coverage targets user-visible integration boundaries

E2E scenarios SHALL be retained for behavior that depends on browser engines, real WebGL, filesystem persistence, navigation/history, file transfer, or cross-component application wiring. Pure transformation cases and exact duplicate application journeys MUST be covered at the lowest effective layer and MUST NOT require duplicate full-browser scenarios.

#### Scenario: Two scenarios exercise the same notification journey

- **WHEN** one scenario is an exact duplicate and another contains all of its user-visible assertions plus stronger integration assertions
- **THEN** the stronger E2E scenario is retained
- **AND** the duplicate is removed or merged

#### Scenario: URL normalization is exhaustively unit-tested

- **WHEN** a URL case tests only deterministic query normalization already covered by focused unit tests
- **THEN** the default suite retains at most one full-application integration case for that normalization class

### Requirement: Correctness tests use deterministic outcomes

The correctness E2E suite MUST assert observable final state rather than absolute shared-runner elapsed time. Performance thresholds SHALL live in dedicated performance tooling.

#### Scenario: Figure-editor geometry receives rapid updates

- **WHEN** the test applies a burst of target-geometry updates
- **THEN** the final requested geometry is present
- **AND** the preview remains rendered and usable
- **AND** the correctness test does not fail solely because a shared runner exceeds an absolute millisecond threshold

### Requirement: Heavyweight fixture suites are explicit

An E2E project that requires a local heavyweight fixture not present in a normal checkout SHALL be excluded from the default project list and SHALL require an explicit environment opt-in.

#### Scenario: The default suite is listed without the large fixture

- **WHEN** `RUN_LARGE_BUNDLE_E2E` is unset
- **THEN** the large-bundle project is absent rather than reported as a skipped default test

#### Scenario: A developer opts into the large fixture suite

- **WHEN** `RUN_LARGE_BUNDLE_E2E=1` and the documented fixture is available
- **THEN** Playwright includes the large-bundle project

### Requirement: Retries remain diagnostic

The E2E configuration SHALL run with no retries during normal local development and SHALL permit at most one retry in CI, where the retry produces trace diagnostics.

#### Scenario: A local E2E scenario fails

- **WHEN** `CI` is unset and a Playwright scenario fails
- **THEN** the failure is reported without rerunning the scenario

#### Scenario: A CI E2E scenario fails on its first attempt

- **WHEN** `CI` is set and a Playwright scenario fails on its first attempt
- **THEN** Playwright may retry it once with first-retry trace capture enabled
