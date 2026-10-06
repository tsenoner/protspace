# perf-checks Specification

## Purpose

The Playwright perf checks that drive the real Explore UI: flag-gated work counters in core, a
headless counts gate with committed budgets that runs with the e2e suite (`pnpm perf:counts`), and a
headed timing mode on the real GPU that compares builds interleaved (`pnpm perf`). The
cross-browser WebGL suite (`webgl-perf-harness`) stays beside it as `pnpm perf:webgl`.

## Requirements

### Requirement: Perf counters SHALL cost nothing without the URL flag

Core SHALL keep its perf counters as `null` unless the page URL carries the `perfCounters` query
parameter, and every call site SHALL do no work beyond a null check when they are `null`. With the
flag, the counters SHALL be reachable as `window.__protspacePerfCounters` and SHALL count full GPU
re-stages (with their position and style parts and their time), renders, drawn points, scatter-plot
data processing, point-grid rebuilds, and legend updates and rebuilds.

#### Scenario: A normal page load

- **WHEN** Explore loads without `perfCounters` in the URL
- **THEN** the counters are `null` and `window.__protspacePerfCounters` is undefined

#### Scenario: A flagged page load

- **WHEN** Explore loads with `?perfCounters=1` and the demo dataset renders
- **THEN** the re-stage, render, data-processing and legend counters are above zero and the drawn
  count equals the number of points drawn by the last render

### Requirement: The counts gate SHALL drive the real UI and settle by quiescence

`pnpm perf:counts` SHALL drive each segment through Playwright input on the rendered UI, not
through calls into the page. Before and after each segment it SHALL wait until the counters and the
uploaded byte total stay unchanged for at least two animation frames and 200 ms, and SHALL fail the
segment when that does not happen within 3 s (60 s in timing mode, where one interaction on a
large dataset can keep the page busy for seconds). It SHALL NOT use fixed sleeps to settle.

#### Scenario: A render loop

- **WHEN** a segment leaves the plot rendering on every frame
- **THEN** settling hits its cap and the segment fails naming the counters that kept changing

### Requirement: Counts above budget SHALL fail

Each segment's counts SHALL be compared with `apps/web/tests/perf/budgets.json`. A count above its
budget SHALL fail the run; a count below its budget SHALL pass and be reported as tightenable; a
`null` budget SHALL only be reported. Timings SHALL NOT be budgeted. With `PERF_UPDATE_BUDGETS=1`
the gate SHALL run the segments three times and write the maximum of each count as its budget.

#### Scenario: An extra re-stage

- **WHEN** a change makes an annotation switch re-stage once more than its budget
- **THEN** `pnpm perf:counts` fails and the report marks the cell

#### Scenario: Camera moves

- **WHEN** the camera segment drags and wheels the plot
- **THEN** zero bytes are uploaded, nothing re-stages, and the drawn count equals the protein count

### Requirement: A segment's reset SHALL restore the plot's pixels

Every segment that changes view state SHALL end with a reset through the UI, and a screenshot of the
plot taken before the segment SHALL equal one taken after the reset.

#### Scenario: A projection switch and back

- **WHEN** the projection is switched and switched back
- **THEN** the plot's pixels match the ones before the switch

### Requirement: Timing mode SHALL compare builds interleaved and clean up its server

`pnpm perf` SHALL run the counts segments headed in Chromium and report per-segment medians of
input-to-next-paint, the longest long-animation-frame, main-thread busy time, re-stage time and
frame gaps. It SHALL drop the first run as warm-up. With `--compare` it SHALL alternate runs between
the two builds within one session. When it started a preview server, it SHALL stop it on normal
exit, failure and SIGINT or SIGTERM, and SHALL NOT use or stop ports 8080 or 8091.

#### Scenario: Interrupted run

- **WHEN** the user presses Ctrl-C during a timing run that started its own preview server
- **THEN** the server process is gone when `pnpm perf` exits
