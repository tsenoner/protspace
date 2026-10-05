# e2e-validation Specification

## Purpose

What the Playwright suite is responsible for proving, and the discipline that keeps it trustworthy: scenarios start from a known state, waits are bounded, browser coverage is stated rather than implied, outcomes are deterministic, and retries stay a diagnostic signal instead of a way to pass a flaky test.

## Requirements

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

#### Scenario: WebKit exercises History API compatibility

- **WHEN** the WebKit compatibility project runs its navigation journeys
- **THEN** the History API journey awaits browser-native `popstate` for back and forward traversal
- **AND** it verifies both the exact traversed URL and the applied application view
- **AND** a first-attempt WebKit failure retains its trace diagnostics

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

An E2E project that requires a local heavyweight fixture, a downloaded example bundle or a live service not present in a normal checkout SHALL be excluded from the default project list and SHALL require its environment opt-in to equal `1` exactly. The large-bundle project SHALL read the Swiss-Prot bundle from the `perf-datasets` copy fetched by `pnpm perf:fetch`. The `examples-live` project SHALL open every catalog example from the files fetched by `pnpm examples:fetch`, assert that each opens on its `defaultView` with no URL write and no drift warning, and capture the documentation thumbnails.

#### Scenario: The default suite is listed without the large fixture

- **WHEN** `RUN_LARGE_BUNDLE_E2E` is unset
- **THEN** the large-bundle project is absent rather than reported as a skipped default test

#### Scenario: A developer opts into the large fixture suite

- **WHEN** `RUN_LARGE_BUNDLE_E2E=1` and `pnpm perf:fetch` has downloaded the Swiss-Prot bundle
- **THEN** Playwright includes the large-bundle project

#### Scenario: The default suite is listed without the live examples

- **WHEN** `RUN_EXAMPLES_E2E` is unset
- **THEN** the `examples-live` project is absent

#### Scenario: A developer opts into the live examples suite

- **WHEN** `RUN_EXAMPLES_E2E=1` after `pnpm examples:fetch`
- **THEN** Playwright includes the `examples-live` project, which opens each catalog example on its `defaultView` and writes its thumbnail

#### Scenario: A false-like value is supplied for the live suite

- **WHEN** `RUN_LIVE_E2E=0`
- **THEN** Playwright excludes the live FASTA project

#### Scenario: A developer opts into the live suite

- **WHEN** `RUN_LIVE_E2E=1`
- **THEN** Playwright includes the live FASTA project

### Requirement: Retries remain diagnostic

The E2E configuration SHALL run with no retries during normal local development and SHALL permit at most one retry in CI, where a failing attempt produces trace diagnostics without allowing a flaky test to pass the overall run.

#### Scenario: A local E2E scenario fails

- **WHEN** `CI` is unset and a Playwright scenario fails
- **THEN** the failure is reported without rerunning the scenario

#### Scenario: A CI E2E scenario fails on its first attempt

- **WHEN** `CI` is set and a Playwright scenario fails on its first attempt
- **THEN** Playwright may retry it once with either first-failure or first-retry trace capture enabled
- **AND** the overall run fails even if the retry passes

### Requirement: Explore load waits observe overlay removal and plot data

An E2E helper that waits for an Explore dataset load SHALL require both plot data on `#myPlot` (a non-empty protein list; exactly the expected protein count when one is given; or, for a replacement dataset of unknown size, a count different from the one read before the load started) and the absence of `#progressive-loading`, and SHALL then wait one animation frame before returning. Load waits SHALL poll at 100 ms and SHALL NOT use a fixed delay as load completion. Load-wait helpers SHALL be defined once in `apps/web/tests/helpers/explore.ts` rather than copied into spec files.

#### Scenario: Plot data is present while the overlay is still shown

- **WHEN** `#myPlot` already holds the new proteins and the loading overlay is still in the document
- **THEN** the load wait keeps waiting

#### Scenario: A spec waits for a specific protein count

- **WHEN** a spec waits for the plot to hold a given number of proteins
- **THEN** it uses the shared helper with that count rather than a local `waitForFunction` copy

#### Scenario: A spec replaces a dataset of unknown size

- **WHEN** a spec imports a dataset whose protein count it does not know
- **THEN** it passes the count read before the import, and the wait cannot pass on the dataset it replaces

#### Scenario: The overlay is removed

- **WHEN** the overlay is gone and the plot holds the expected data
- **THEN** the helper returns after one animation frame, so the scatterplot's point index has been rebuilt

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

### Requirement: E2E scenarios do not depend on the product example catalog

The default E2E suite SHALL load its startup dataset from a pinned fixture in `apps/web/tests/fixtures/`, selected through an environment variable that the Playwright web server sets, rather than from the product's startup demo. Every catalog example a scenario loads SHALL be routed to a fixture that contains that entry's `defaultView` names, so the curated view resolves without a drift warning; those fixtures SHALL be derived from the pinned fixtures by a committed script. Scenarios that test history or race mechanics SHALL name the annotation and projection explicitly rather than rely on an example's content. No default scenario SHALL read a bundle from `apps/web/public/`, and no default scenario SHALL download a release-hosted example.

#### Scenario: The product demo is replaced

- **WHEN** the startup demo at `apps/web/public/data.parquetbundle` is regenerated with different content
- **THEN** the default E2E suite still loads the pinned demo fixture and its count-, column- and legend-dependent assertions are unaffected

#### Scenario: A role fixture is derived, not hand-edited

- **WHEN** a role fixture no longer holds a `defaultView` name its example needs
- **THEN** it is regenerated by the committed derivation script, and that script's `--check` mode, which CI runs, fails while a committed fixture differs from what it writes

#### Scenario: A routed example opens on its curated view

- **WHEN** a scenario chooses a catalog example that is routed to its fixture
- **THEN** the example opens on its `defaultView` and no default-view drift warning is logged

#### Scenario: A startup-URL abort

- **WHEN** a scenario aborts or fetches the startup dataset to control load order
- **THEN** it matches the URL through the shared startup-URL helper, so the abort still matches when the startup URL changes
