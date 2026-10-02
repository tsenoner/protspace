# webgl-perf-harness Specification

## Purpose

What the WebGL render benchmark guarantees about its own measurements, and how it fails. The harness drives the real application in a headed GPU browser, so most of what it guarantees is about keeping everything that is not the measurement out of the measured window: a genuine ready state before it starts, the real interaction path rather than a shortcut that skips d3's transform datum, and no overlay, third-party request, or reload-support write painting or running while a scenario is timed. The rest is about failure being legible — the benchmark reads its host through untyped reach-ins that have drifted twice under refactors, and it sweeps datasets deliberately large enough that the largest is expected to fail, so a run must bound every wait against a budget that composes with the enclosing harness, degrade one failing dataset to a recorded error rather than losing the sweep, and stay impossible to confuse with an empty run that measured nothing.

## Requirements

### Requirement: Readiness is gated on the interaction layer, not on host fields

The benchmark's readiness gate SHALL determine that programmatic zoom is available by asking the
interaction layer, and SHALL NOT read zoom state off the scatter-plot host. The controller's
existence alone SHALL NOT satisfy the gate: the host assigns the controller before calling
`initialize()`, and `initialize()` returns early when the host has no SVG, so a non-null controller
can carry null zoom state indefinitely.

#### Scenario: A loaded plot reaches the ready state

- **WHEN** the gate runs against a scatter-plot that has data, plot geometry, an SVG, scales, a
  renderer, and an initialized interaction layer
- **THEN** the gate resolves promptly rather than waiting out its timeout

#### Scenario: A plot that never receives data

- **WHEN** the gate runs against a scatter-plot whose data is never assigned
- **THEN** the gate rejects at its timeout with an error naming the wait it gave up on

#### Scenario: The interaction layer exists but was never initialized

- **WHEN** the controller was constructed but `initialize()` did not wire zoom to an SVG
- **THEN** the gate treats zoom as unavailable rather than as ready

### Requirement: Zoom and pan scenarios drive the real interaction path

The zoomInOut and dragCanvas scenarios SHALL apply their transforms through d3's zoom behaviour, so
the transform datum d3 stores on the SVG node stays authoritative and the render they measure is
the one a user gesture would trigger. They SHALL NOT apply transforms by a route that updates the
rendered transform without updating that datum.

#### Scenario: A programmatic zoom moves the plot

- **WHEN** the benchmark scales the view by a factor
- **THEN** the rendered transform changes accordingly and a render pass is recorded

#### Scenario: A programmatic pan moves the plot

- **WHEN** the benchmark translates the view
- **THEN** the rendered transform changes accordingly and a render pass is recorded

#### Scenario: A scenario restores the pre-run transform

- **WHEN** a zoom or pan scenario finishes and restores the transform it saved
- **THEN** the view returns to its pre-scenario state and a subsequent user gesture continues from
  that state rather than jumping to a stale one

### Requirement: A failing dataset SHALL NOT discard the run

The suite SHALL record a per-dataset failure and continue to the next dataset, and SHALL still emit
its results file containing every dataset that succeeded. A single dataset that throws SHALL NOT
prevent the results of already-measured datasets from being written.

#### Scenario: One dataset of several fails

- **WHEN** a dataset fails to load or measure and other datasets succeed
- **THEN** the results file is emitted, contains the successful datasets' measurements, and records
  the failing dataset with its error

#### Scenario: Every dataset fails

- **WHEN** no dataset produces measurements
- **THEN** the results file is still emitted, recording every failure, and validation fails the run
  on it rather than the harness reporting only that no file arrived

### Requirement: Dataset loading waits SHALL be bounded by a shared budget

Every wait in the dataset load path SHALL fail at a deadline with an error identifying the dataset
and the condition that was not met, and the waits for one dataset SHALL share a single budget
rather than each holding its own. That budget, and the budget for the run as a whole, SHALL be
sized so the suite emits its results file before the enclosing harness's download wait and test
timeout expire.

#### Scenario: A dataset load never finalizes

- **WHEN** a load is initiated and the application never reaches a loaded state for it
- **THEN** the wait fails at its deadline, naming the dataset and the unmet condition, rather than
  blocking indefinitely

#### Scenario: A sweep runs out of time

- **WHEN** the run's budget expires before every dataset has been measured
- **THEN** the results file is emitted with the datasets that were never reached recorded as
  skipped, rather than the harness failing with an opaque timeout that names nothing

### Requirement: An abandoned load SHALL NOT contaminate the next dataset

A load abandoned at its deadline SHALL NOT be able to satisfy any wait belonging to a later
dataset, and every recorded measurement SHALL be attributable to the dataset that produced it. The
suite SHALL treat abandoning a load as distinct from a load that failed cleanly, because the
abandoned one is still running.

#### Scenario: An abandoned load finalizes later

- **WHEN** a load times out, the suite moves on, and the abandoned load then completes
- **THEN** its completion does not satisfy any wait for the dataset that followed it

#### Scenario: Measurements are attributed

- **WHEN** a dataset's measurements are recorded
- **THEN** they were taken against the data that dataset loaded, not against data left behind by a
  previous one

### Requirement: An empty run SHALL NOT pass validation

The benchmark's validation SHALL reject a results file whose scenarios recorded no measurements,
and SHALL reject one that recorded a dataset error. Asserting only that scenario names are present
SHALL NOT be sufficient.

#### Scenario: Scenarios are present but recorded nothing

- **WHEN** the results file lists every expected scenario but a scenario recorded no passes
- **THEN** validation fails rather than reporting a green run

#### Scenario: A dataset error was captured

- **WHEN** the results file records a dataset that failed
- **THEN** validation fails and surfaces that dataset's error

### Requirement: The host-runner coupling SHALL be covered by a test

A test SHALL assert the benchmark runner's observable contract with the scatter-plot host, and
SHALL run in the unit suite that gates frontend changes. It SHALL assert behavior rather than the
names of host members, so that relaxing the readiness gate cannot make it pass. It SHALL assert the
render pass a zoom or pan records, not only the transform it leaves behind.

#### Scenario: A refactor moves state the runner depends on

- **WHEN** state the benchmark relies on moves out of the host or stops being populated
- **THEN** the test fails in CI on that change rather than at the next manual benchmark run

#### Scenario: The gate is weakened instead of repaired

- **WHEN** a readiness condition is deleted rather than repointed at its new owner
- **THEN** a test still fails, because readiness is asserted together with the zoom behavior it
  is supposed to guarantee

#### Scenario: A zoom moves the plot but renders nothing

- **WHEN** a zoom or pan updates the rendered transform without the deferred render it should
  trigger
- **THEN** the test fails, because it asserts a render pass carrying that gesture's trigger rather
  than merely that some pass was recorded

### Requirement: No overlay SHALL paint over the canvas during a measured window

The benchmark SHALL leave the canvas unobscured while it measures: its browser context SHALL start
with the product tour already marked complete, and the harness's own progress overlay SHALL NOT
paint over the canvas or animate during a measured window. Tour suppression SHALL be configured in
the harness rather than by a branch in application code.

#### Scenario: A benchmark run opens the application

- **WHEN** the benchmark navigates to the explore view and loads its first dataset
- **THEN** no product-tour overlay appears at any point during the run

#### Scenario: A normal first visit

- **WHEN** a user opens the explore view for the first time outside the benchmark
- **THEN** the product tour still auto-starts

#### Scenario: The harness's own progress overlay is up

- **WHEN** a scenario is being measured while the suite's progress overlay is shown
- **THEN** the overlay paints nothing over the canvas and runs no animation, while still reporting
  progress and absorbing stray input

#### Scenario: The page loads third-party analytics

- **WHEN** the application's analytics beacon would load and report during a measured window
- **THEN** the harness blocks it, so neither its script nor its request runs while measuring

### Requirement: The measured load window SHALL NOT carry reload-support persistence

A benchmark load SHALL NOT be recorded as a user import, so the application does not copy the
bundle into the Origin Private File System before rendering it. That copy is awaited inside the
interval reported as `loadDurationMs`, so at the bundle sizes this harness exists to probe it is
the dominant term in the measurement rather than a detail of it; on WebKit it also fails outright.
A run SHALL likewise leave any dataset the developer had persisted for reload untouched. This
SHALL be arranged by the harness, not by a benchmark branch in application code.

#### Scenario: A dataset is measured

- **WHEN** the benchmark loads a dataset and records its load duration
- **THEN** no copy of the bundle is written to the Origin Private File System during that interval

#### Scenario: A developer had a dataset persisted for reload

- **WHEN** a benchmark sweep runs in a profile that already has an imported dataset persisted
- **THEN** that dataset is still the one restored on the next normal visit

#### Scenario: A user imports a dataset normally

- **WHEN** a user imports a dataset outside the benchmark
- **THEN** it is still persisted for reload support

### Requirement: A run SHALL leave no server behind and SHALL NOT destroy earlier results

The harness SHALL terminate the development server it started, so a subsequent run is not blocked
by it, and SHALL keep each browser's results in its own output directory so that re-running one
browser does not delete another's. It SHALL start its own server rather than reusing one it did
not start, because the packages the application loads are built by that server's task.

#### Scenario: Two runs in succession

- **WHEN** a run completes and another is started
- **THEN** the second run starts its own server, rather than failing because the first run's server
  is still holding the port

#### Scenario: One browser is re-run after a full sweep

- **WHEN** a run is scoped to a single browser after a sweep that produced results for all of them
- **THEN** the other browsers' results from the earlier sweep are still present afterwards
