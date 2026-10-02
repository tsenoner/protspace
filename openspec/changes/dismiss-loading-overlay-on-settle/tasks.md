## 1. Error-path dismissal

- [x] 1.1 Dismiss the overlay as the first action of `handleDataError`, on every branch including
      `AbortError`, except a failed persisted dataset that falls back to the demo dataset: keep it
      up through the demo fetch and dismiss after recovery only if no load is running.
- [x] 1.2 Dismiss the overlay in `handleDataLoaded`'s catch path.
- [x] 1.3 Unit tests in the existing `dataset-controller` test files: a failed load, an aborted
      load and a post-load failure each dismiss the overlay; a failed persisted dataset keeps it up
      through the demo fallback, dismisses it when no demo load starts, and dismisses it before
      releasing to a newer queued load.
- [x] 1.4 E2E: in `dataset-reload.spec.ts`, "dataset load failures show a toast instead of a
      browser dialog" asserts `#progressive-loading` has count 0 after the toast.

## 2. Dismiss on settle, no hold, no fade

- [x] 2.1 Delete the 800 ms hold and the "Ready to explore!" step from `loadData`.
- [x] 2.2 Remove the small-dataset early hide and the `finally` hide from `loadData`.
- [x] 2.3 Dismiss in `handleDataLoaded`'s `finally`, after the post-load work and
      `markLastLoadStatus`, before `resolvePendingLoadFinalization`; skip it on the stale-result
      early return; still dismiss when `loadData` returns `null` or the controller is disposed.
- [x] 2.4 Make `update(false)` remove the element synchronously; delete `overlayRemovalTimeout`
      and adjust `dispose`.
- [x] 2.5 Check the FASTA paths (`runtime.ts` hides on FASTA error; FASTA success enters a normal
      load), the other readers of `#progressive-loading`, and the perf harness.
- [x] 2.6 Unit tests: a small dataset is not dismissed before render; dismissal follows the
      post-load work; a stale result does not dismiss; removal is synchronous.

## 3. Canonical E2E load helpers

- [x] 3.1 `waitForExploreDataLoad(page, { timeout, proteinCount?, changedFrom? })` in
      `apps/web/tests/helpers/explore.ts`: plot data present (or the exact count), overlay count
      0 with no swallowed failure, 100 ms polling, then one animation frame.
- [x] 3.2 Make `waitForProteinCount` the same helper with a count.
- [x] 3.3 Migrate local copies and `polling: 500` waits across `apps/web/tests` and remove
      `.catch(() => {})` on overlay waits, including `waitForExploreInteractionReady`.
- [x] 3.4 Keep the product-tour 1500 ms negative wait only if it is still needed, and say why.
- [x] 3.5 Check `scripts/docs-screenshots` for waits on the fade.

## 4. CI

- [x] 4.1 Replace the hard-coded test counts in `.github/workflows/e2e.yml` comments with wording
      that does not go stale.

## 5. Verification

- [ ] 5.1 `pnpm precommit`, `pnpm format:check` and `pnpm test:ci` pass.
- [ ] 5.2 `E2E_BROWSERS=chromium` and `E2E_BROWSERS=firefox,webkit` E2E runs pass locally.
- [ ] 5.3 The PR records the perf-harness baseline shift.
