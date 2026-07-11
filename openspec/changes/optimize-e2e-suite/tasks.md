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

Chunk A result: all 152 executions remained listed; the same-machine full run passed in 165.0 seconds versus the 392.8-second baseline (58% less wall time), and aggregate worker time fell from 1,417.6 to 761.7 seconds. Numeric-binning stayed 41/41 green while its aggregate time fell from 555.1 to 124.8 seconds (77% less).

## 3. Coverage and Reliability Policy

- [ ] 3.1 Tag the deep-link refresh and History API restore journeys as `@cross-browser`; filter Firefox and WebKit projects to the tagged set.
- [ ] 3.2 Merge or remove exact dataset notification/export duplicates while retaining every unique user-visible assertion.
- [ ] 3.3 Remove redundant pure URL-normalization E2Es while retaining an application-level canonicalization journey.
- [x] 3.4 Replace the figure-editor absolute timing assertion with final-geometry and rendered-preview assertions.
- [ ] 3.5 Make the large-bundle project conditional on `RUN_LARGE_BUNDLE_E2E=1` and document the opt-in beside the project.
- [ ] 3.6 Use CI-only retry and remove the Playwright browser-binary cache from the E2E workflow.

## 4. Verification and Delivery

- [ ] 4.1 Verify the default and opt-in project inventories with Playwright `--list` commands.
- [ ] 4.2 Run focused Chromium, Firefox, and WebKit projects for all changed scenarios.
- [ ] 4.3 Run the complete default E2E suite without local retries and compare execution count, aggregate duration, wall time, and flaky outcomes with baseline.
- [ ] 4.4 Run `pnpm precommit` and validate the OpenSpec change strictly.
- [ ] 4.5 Review the final diff for unrelated changes and update this task list with observed validation results.
- [ ] 4.6 Commit coherent validated chunks and push `perf/249-e2e-suite` to origin.
