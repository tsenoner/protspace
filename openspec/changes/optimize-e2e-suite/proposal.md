## Why

The Playwright suite for issue #249 is no longer fully serial, but it still averages 14.3 minutes on the two-worker CI runner and produces unreliable signal: 6 of 25 recent scheduled runs failed, while 17 of the 19 successful runs passed only after a retry. Measured execution data shows deterministic setup waits, incorrectly unbounded polling, repeated cross-browser scenarios, and duplicated coverage are consuming most of the remaining time.

## What Changes

- Remove deterministic product-tour absence waits and redundant setup navigations while preserving the dedicated product-tour coverage.
- Correct Playwright polling calls so operation-level timeout budgets are actually enforced and failed attempts cannot silently consume the test-level timeout.
- Keep the complete critical-path suite on Chromium while limiting Firefox and WebKit to explicit browser-compatibility smoke journeys.
- Remove or merge E2E scenarios whose behavior is already covered by a stronger scenario in the same suite or by focused unit/component tests.
- Replace the figure-editor's shared-runner wall-clock benchmark with a deterministic responsiveness/correctness assertion.
- Treat fixture-dependent large-bundle coverage as an explicit opt-in suite instead of reporting a permanently skipped default test.
- Keep retry artifacts diagnostic, with retries enabled in CI but not during normal local development.

## Capabilities

### New Capabilities

- `e2e-validation`: Defines the default E2E coverage boundary, browser-compatibility smoke policy, deterministic waiting rules, opt-in heavyweight coverage, and runtime/reliability expectations.

### Modified Capabilities

<!-- No existing specification defines the repository's E2E validation policy. -->

## Impact

- **Playwright configuration:** `app/tests/playwright.config.ts`
- **Shared E2E helpers:** `app/tests/helpers/explore.ts`
- **App E2E scenarios:** product-tour suppression, URL view state, dataset reload/notifications, figure editor, and large-bundle project selection under `app/tests/`
- **Workflow:** `.github/workflows/e2e.yml` browser installation/cache behavior
- **Product behavior and public APIs:** unchanged
- **Dependencies:** no new runtime or test dependencies
