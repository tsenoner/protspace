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

## 4. Verification and Delivery

- [x] 4.1 Verify the default and opt-in project inventories with Playwright `--list` commands.
- [x] 4.2 Run focused Chromium, Firefox, and WebKit projects for all changed scenarios.
- [x] 4.3 Run the complete default E2E suite without local retries and compare execution count, aggregate duration, wall time, and flaky outcomes with baseline.
- [x] 4.4 Run `pnpm precommit` and validate the OpenSpec change strictly.
- [x] 4.5 Review the final diff for unrelated changes and update this task list with observed validation results.
- [x] 4.6 Commit coherent validated chunks and push `perf/249-e2e-suite` to origin.

Chunk B result: the default inventory is 109 executions across 10 files, with 15 Chromium URL-state scenarios and two tagged scenarios in each non-Chromium project. `RUN_LARGE_BUNDLE_E2E=1` lists the heavyweight scenario while unset or `0` excludes it. All 33 changed browser journeys passed in 42.8 seconds, and the complete default suite passed 109/109 on first attempts in 89.4 seconds with no skips or flakes. Versus baseline, wall time fell 77% (392.8 to 89.4 seconds), aggregate worker time fell 68% (1,417.6 to 452.5 seconds), and execution count fell 28% (152 to 109). Validation also included 133 passing app unit tests (one intentional skip), strict OpenSpec validation, the full repository pre-commit gate, and three independent no-finding reviews after the reviewers' documentation-precision feedback was resolved.
