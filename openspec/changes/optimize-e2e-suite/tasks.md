## 1. Baseline and Scope

- [x] 1.1 Record the current default inventory (116 logical scenarios / 152 executions) and a same-machine full-suite baseline (392.8 seconds, including one flaky retry).
- [x] 1.2 Analyze recent Actions runs and identify the dominant runtime and flake clusters.
- [x] 1.3 Define the E2E/lower-layer and Chromium/cross-browser coverage boundaries in the proposal, design, and `e2e-validation` spec.

## 2. Execution Hygiene

- [x] 2.1 Seed product-tour completion through default Playwright storage state and preserve empty state for the product-tour project.
- [x] 2.2 Make shared tour cleanup non-blocking and remove the numeric-binning duplicate helper/setup.
- [x] 2.3 Correct every two-argument `waitForFunction` call that mistakenly passes timeout options as predicate data.
- [x] 2.4 Remove preparatory app navigations used only to mutate product-tour localStorage or clear already-isolated browser storage.
- [x] 2.5 Run focused projects and the default suite, then record the no-coverage-loss runtime comparison.

Chunk A result (tasks 2.1–2.5): all 152 executions remained listed; the same-machine full run passed in 165.0 seconds versus the 392.8-second baseline (58% less wall time), and aggregate worker time fell from 1,417.6 to 761.7 seconds. Numeric-binning stayed 41/41 green while its aggregate time fell from 555.1 to 124.8 seconds (77% less).

- [x] 2.6 As a Chunk B reliability follow-up, wait for OPFS metadata finalization before treating a persisted dataset as reload-ready.

## 3. Coverage and Reliability Policy

- [x] 3.1 Tag the deep-link refresh and History API restore journeys as `@cross-browser`; filter Firefox and WebKit projects to the tagged set.
- [x] 3.2 Merge exact dataset notification/export duplicates and keep deterministic notification-copy coverage at the focused unit layer.
- [x] 3.3 Remove redundant pure URL-normalization E2Es while retaining an application-level canonicalization journey.
- [x] 3.4 Replace the figure-editor absolute timing assertion with final-geometry and rendered-preview assertions.
- [x] 3.5 Make the large-bundle project conditional on `RUN_LARGE_BUNDLE_E2E=1` and document the opt-in beside the project.
- [x] 3.6 Use CI-only retry and remove the Playwright browser-binary cache from the E2E workflow.
- [x] 3.7 Preserve the audited coverage boundary by consolidating three URL edge variants into one cross-browser journey, running file-drop wiring in all three engines, running OPFS persistence in Chromium/Firefox, and retaining a coarse figure-editor stall watchdog.
- [x] 3.8 Require exact opt-in values, align the live-suite run instructions and report ignore path, fail CI on retry-only passes, and remove the duplicate figure-editor watchdog assertion found during final audit.
- [x] 3.9 Replace the flaky WebKit protocol traversal with in-document History API synchronization, assert exact URLs, and retain first-attempt failure traces.

## 4. Verification and Delivery

- [x] 4.1 Verify the default and opt-in project inventories with Playwright `--list` commands.
- [x] 4.2 Run focused Chromium, Firefox, and WebKit projects for all changed scenarios.
- [x] 4.3 Run the complete default E2E suite without local retries and compare execution count, aggregate duration, wall time, and flaky outcomes with baseline.
- [x] 4.4 Run `pnpm precommit` and validate the OpenSpec change strictly.
- [x] 4.5 Review the final diff for unrelated changes and update this task list with observed validation results.
- [x] 4.6 Commit coherent validated chunks and push `perf/249-e2e-suite` to origin.

Chunk B result: the default inventory is 109 executions across 10 files, with 15 Chromium URL-state scenarios and two tagged scenarios in each non-Chromium project. `RUN_LARGE_BUNDLE_E2E=1` lists the heavyweight scenario while unset or `0` excludes it. All 33 changed browser journeys passed in 42.8 seconds, and the complete default suite passed 109/109 on first attempts in 89.4 seconds with no skips or flakes. Versus baseline, wall time fell 77% (392.8 to 89.4 seconds), aggregate worker time fell 68% (1,417.6 to 452.5 seconds), and execution count fell 28% (152 to 109). Validation also included 133 passing app unit tests (one intentional skip), strict OpenSpec validation, the full repository pre-commit gate, and three independent no-finding reviews after the reviewers' documentation-precision feedback was resolved.

Coverage follow-up result: the default inventory is 115 executions. Chromium runs all 16 retained URL journeys; Firefox runs four `@cross-browser` journeys plus the supported `@opfs-browser` journey; WebKit runs the four supported `@cross-browser` journeys without a permanent OPFS skip. The three removed URL edge variants now execute as independently named steps with a fresh page per variant in one cross-browser journey, and the figure-editor resize scenario retains a runner-side ten-second stall watchdog alongside its deterministic geometry/preview assertions. A two-worker, zero-retry local run passed 115/115 on first attempts in 222.5 seconds; the formerly flaky WebKit journey also passed 5/5 repeated zero-retry runs. The inventory remains 24% smaller than the 152-execution baseline while preserving the audited behavior and available-engine coverage boundaries.

Final completion-audit result: `RUN_LIVE_E2E=0` excludes the live project while `RUN_LIVE_E2E=1` includes it, and CI resolves to one retry with `failOnFlakyTests` enabled. The complete CI-mode suite passed 115/115 on first attempts in 3.7 minutes with no flakes or skips. The repository precommit gate, strict OpenSpec validation, 1,685 JavaScript tests (plus one pre-existing intentional skip), and 81 preparation-service tests also passed. Independent final audits found no correctness or maintainability blocker; coverage wording distinguishes preserved unique behavior from intentionally reduced browser repetition and from the removed, historically unstable two-second runner threshold.

Flaky-gate follow-up result: the first exact-head GitHub run correctly failed when WebKit's protocol-level `page.goBack()` returned without traversing and the test passed only on retry. The uploaded report isolated the 13-millisecond no-op, while the retry traversed in 539 milliseconds; ten isolated and ten paired zero-retry repetitions found no deterministic application defect. The test now drives `history.go()` in the document, awaits `popstate` and the exact URL, and retains a first-attempt WebKit trace on CI. All four WebKit compatibility journeys then passed five repeated zero-retry runs (20/20) in 1.6 minutes, and the complete CI-mode suite passed 115/115 on first attempts in 3.9 minutes with no flakes or skips.
