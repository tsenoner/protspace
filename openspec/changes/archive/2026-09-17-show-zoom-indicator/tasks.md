## 1. Regression Tests (RED)

- [x] 1.1 Add a focused jsdom component test that drives the real scatterplot host transform callback, verifies the full count/marker presentation as a polite status, and observes that additional zoomed-in frames do not run another plot render.
- [x] 1.2 Add a focused Playwright project and test that locates the chip by its status role, wheel-zooms the loaded Explore scatterplot, verifies the complete spaced `N points · Zoomed in` presentation, double-clicks to reset, and observes the status return to the point count alone.
- [x] 1.3 Run both focused tests against the unmodified implementation and record that they fail because the zoom marker is absent.
- [x] 1.4 Run the accessibility regression against the review head and record that it fails because the chip has no polite status semantics.

## 2. Minimal Implementation (GREEN)

- [x] 2.1 Add a reactive boolean zoom-boundary state while keeping `_transform` non-reactive, and rely on Lit's boolean change detection to deduplicate repeated same-side transforms.
- [x] 2.2 Append `· Zoomed in` to the existing point-count chip only while the boolean state is true, and expose the chip as a polite status.
- [x] 2.3 Run both focused tests and record that they pass.

## 3. Verification and Publication

- [x] 3.1 Repeat the original browser reproduction and confirm the marker appears above identity and disappears after reset with no new relevant console errors.
- [x] 3.2 Run the affected core and Playwright test projects, then run `pnpm precommit`.
- [x] 3.3 Validate the OpenSpec change and review the final diff for issue-only scope.

## 4. Adversarial Review Follow-up

- [x] 4.1 Rewrite the boundary-scheduling regression around Lit's `isUpdatePending` signal and add a failing regression showing marker-only updates must not redraw WebGL.
- [x] 4.2 Add a failing regression for near-identity floating-point residue from symmetric wheel accumulation.
- [x] 4.3 Render the count and conditional marker as one exact text run and remove the marker-only gap styling and query-hook spans.
- [x] 4.4 Run focused component and browser tests, strict OpenSpec validation, and the repository precommit checks.
