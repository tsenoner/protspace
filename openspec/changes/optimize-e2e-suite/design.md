## Context

Issue #249 was opened when the Playwright suite ran serially. PR #274 enabled full parallelism and reduced a local run from roughly 37 minutes to a few minutes, but the current two-worker Actions job still averages and medians 14.3 minutes. From 25 scheduled runs after that change, 6 failed; 17 of the 19 successful runs required a retry, leaving only 2 clean runs.

The current default inventory is 116 logical scenarios and 152 Playwright executions. The multiplier comes from running all 18 `url-view-state` scenarios in Chromium, Firefox, and WebKit. In a representative clean CI run, `numeric-binning`, the three URL projects, and `dataset-reload` consumed 82.5% of aggregate worker time.

Static and runtime inspection found four avoidable costs:

1. Non-tour tests pre-disable the product tour but repeatedly wait 1.5–3 seconds for that absent dialog. Numeric-binning alone performs at least 126 such probes, costing at least 378 aggregate seconds.
2. Four `page.waitForFunction` calls pass `{ timeout, polling }` as the predicate argument rather than the third options argument. The intended operation limit is therefore ignored; one OPFS first-attempt failure consumed the full 180-second slow-test budget in both local and CI evidence.
3. Browser-engine compatibility coverage is mixed with application behavior coverage. Pure URL normalization and exact notification duplicates are exercised through full app loads despite focused Vitest coverage or a stronger E2E scenario already existing.
4. The shared OPFS readiness helper returns when persisted files first exist, before the metadata status necessarily changes from `pending` to `success`. Navigating in that window causes the recovery flow to reject an otherwise valid dataset as unfinished.

Constraints include real WebGL/OPFS behavior that cannot be represented completely in jsdom, documented support for Chromium/Firefox/Safari, CPU-bound SwiftShader rendering on hosted runners, and the need to retain targeted `--project=<name>` developer commands.

## Goals / Non-Goals

**Goals:**

- Make absence checks non-blocking and all operation-specific waits genuinely bounded.
- Suppress the product tour before the first navigation in every non-tour project.
- Retain full Chromium coverage for critical user journeys and representative Firefox/WebKit compatibility coverage.
- Remove only evidence-backed duplication or assertions that belong at a lower test layer.
- Convert runner-speed assertions into deterministic correctness assertions.
- Make the default suite inventory honest by excluding fixture-dependent heavyweight tests unless explicitly requested.
- Measure the same full-suite command before and after the change and keep the suite green without local retries.

**Non-Goals:**

- Changing application behavior, public APIs, or production dependencies.
- Rewriting every existing Playwright helper or consolidating all Chromium projects.
- Increasing CI worker count or introducing matrix sharding before cheaper work is measured; sharding would trade wall time for additional billed compute and duplicated setup.
- Modifying the separate documentation-capture or WebGL benchmark Playwright suites.
- Removing real WebGL, file import/export, browser history, persistence, or recovery journeys merely to hit a duration target.

## Decisions

### Decision: Seed tour suppression through Playwright storage state

The shared `use.storageState` will contain `driver.overviewTour=true` for the configured base origin. The dedicated `product-tour` project will override it with empty storage so first-visit behavior remains covered. This allows affected specs to navigate once instead of navigating, mutating localStorage, and navigating again.

The shared `dismissTourIfPresent` remains as defensive cleanup but uses immediate `isVisible()` probes. Absence is the expected state and MUST NOT be represented by a positive wait that times out.

**Alternative considered:** keep per-spec `addInitScript` hooks. Rejected because duplicate hooks and local helpers caused the current deterministic wait tax and make the exception for product-tour harder to audit.

### Decision: Pass polling options in the actual Playwright options position

For predicates without an argument, calls use `waitForFunction(fn, undefined, options)`. Existing predicates with an argument keep the documented three-argument form. This preserves the current condition while enforcing its intended timeout.

**Alternative considered:** convert every wait to `expect.poll`. Rejected for this change because it creates broad helper churn without additional runtime value; focused conversions remain reasonable when a wait is otherwise being redesigned.

### Decision: Wait for persisted data to reach its semantic readiness state

`waitForPersistedExploreDataset` will require both persisted files and finalized metadata. Current-schema metadata must report `lastLoadStatus: 'success'`; schema v1 remains accepted because it predates status tracking and represents data completed under the previous persistence implementation.

**Alternative considered:** increase the subsequent Explore data-load timeout. Rejected because failure evidence showed the recovery banner for a `pending` dataset, not a restore that merely needed more processing time. Waiting on successful finalization removes the race at its source.

### Decision: Separate application coverage from engine compatibility coverage

The full URL-state suite continues in Chromium. Firefox and WebKit projects use `grep` against explicit compatibility tags. Both execute four representative journeys:

- applying a valid deep link and preserving it across refresh;
- normalizing duplicate, empty, and partially invalid view params without polluting history;
- pushing URL state and restoring it across browser back/forward navigation;
- importing a dropped bundle through the scatterplot/runtime boundary.

Firefox additionally executes the OPFS persist/reload journey under `@opfs-browser`. Chromium covers it through the complete suite; the pinned Playwright WebKit build does not provide a usable OPFS implementation, so listing it there would create a permanent skip rather than coverage. The targeted matrix therefore covers query parsing, application wiring, refresh, History API behavior, file transfer, engine-specific navigation, and every usable filesystem implementation in the pinned Playwright browser builds. Queueing, instrumentation, and legend persistence remain covered in Chromium, where the complete application suite runs.

**Alternative considered:** full tri-browser nightly and Chromium-only PR runs. Rejected because the current scheduled job is itself the slow and flaky path; 27 of the 36 extra executions validate application cases rather than engine differences, and WebKit-only history/legend repeats account for the dominant flake cluster.

### Decision: Prune by demonstrated overlap, not by raw test count

The first pruning pass is limited to:

- exact duplicate notification/export scenarios in `dataset-reload` where a later scenario has stronger assertions;
- a synthetic normalized `data-error` copy check already covered by notification unit tests, while retaining the real invalid-file import journey;
- multiple pure URL-normalization E2Es already exhaustively covered in `url-state.test.ts`, consolidating duplicate-key, empty-value, and partial-validity wiring into one table-driven browser journey;
- merging paired state-reset assertions that share the same setup and action.

Large numeric/selection migrations are deferred. Although the audit found substantial lower-layer overlap, moving them safely requires component-level replacements and is a separate follow-up rather than an unreviewable deletion batch.

### Decision: Correctness suites do not enforce shared-runner micro-benchmarks

The figure-editor rapid-resize scenario will assert that the final geometry is applied and a usable preview remains after a burst of updates. It retains a generous ten-second stall watchdog, but does not enforce the old two-second micro-benchmark on a shared SwiftShader runner. The threshold was not a stable product invariant: recent hosted runs repeatedly exceeded it while completing the interaction, including retry failures on June 28 and July 6 and a first-attempt failure on July 11. This change therefore makes no figure-editor performance-SLO claim; if the product defines one later, it should be measured in hardware-controlled performance tooling rather than this correctness suite.

### Decision: Heavy fixture coverage is opt-in and retries are diagnostic

The large-bundle project will be present only when `RUN_LARGE_BUNDLE_E2E=1`, and the live FASTA project only when `RUN_LIVE_E2E=1`. Exact comparisons prevent values such as `0` from accidentally enabling an opt-in project. A missing fixture or live backend will therefore not appear as a permanently skipped or failing default scenario.

Retries will be `1` in CI and `0` locally. Local failures should surface immediately; CI retains one trace-producing retry while `failOnFlakyTests` ensures that a test which passes only on retry still fails the run. This preserves diagnostic artifacts without allowing instability to appear green, while the reduced compatibility matrix removes the two most frequent WebKit retry sources.

### Decision: Do not add sharding in this change

The two-worker scheduler is already close to its theoretical aggregate-work bound. Sharding could halve wall time but would duplicate dependency installation, browser installation, build, and server startup across jobs and increase Actions consumption. It remains a measured follow-up if the optimized suite still exceeds the team's desired nightly budget.

The Playwright browser-binary cache will be removed because upstream guidance states restore time is comparable to download time and Linux dependencies must still be installed.

## Risks / Trade-offs

- **A browser-specific regression may occur outside the targeted compatibility journeys.** → Cover refresh/history and file transfer in every supported engine, cover OPFS in each engine that exposes it, and expand the tagged set only when a defect demonstrates another browser-specific risk.
- **Shared storage state could mask a first-run tour regression outside its project.** → Override storage state to empty in `product-tour` and keep its complete lifecycle suite.
- **Removing duplicate E2Es could lose a subtly stronger assertion.** → Compare bodies before removal, retain/merge unique integration assertions, and verify deterministic transformation assertions at a focused lower layer before removing browser repetition.
- **A lower timeout can expose a real slow operation.** → Treat timeout failures as actionable signal; use operation-specific limits and traces instead of returning to the test-level 180-second fallback.
- **Local runtime varies with WebGL contention.** → Compare execution count, aggregate duration, first-attempt outcomes, and wall time using the same machine/command; do not claim CI improvement until Actions executes the pushed branch.

## Migration Plan

1. Commit the validated OpenSpec artifacts on `perf/249-e2e-suite`.
2. Apply execution-hygiene changes and run focused projects plus the entire default suite; compare with the 392.8-second local baseline.
3. Commit and push that no-coverage-loss chunk.
4. Apply cross-browser tags, duplicate merges, deterministic figure assertion, and opt-in heavyweight selection.
5. Validate inventory, focused browser projects, full E2E, and `pnpm precommit`; commit and push the second chunk.
6. Rollback is commit-by-commit: the execution-hygiene and coverage-policy changes remain independently revertible.

## Open Questions

- What nightly wall-time budget should trigger a future sharding change? This requires team cost/latency preference and post-change Actions evidence; it does not block the current optimization.
