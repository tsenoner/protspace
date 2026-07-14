## 1. EAT data model and normalization

- [x] 1.1 Add shared `PredictedCell`/EAT types, naming and metadata helpers, display
      materialization, provenance accessors, and focused unit tests.
- [x] 1.2 Normalize valid companion triples in small, optimized, and separated conversion paths;
      exclude the reserved namespace; create union categories and synthetic confidence data; test
      missing, invalid, curated-precedence, prediction-only, and legacy cases.
- [x] 1.3 Thread prediction cells through slicing and dataset hashing, including alignment and
      prediction-sensitive fingerprint tests.
- [x] 1.4 Reconstruct curated bases and all three companions in the bundle writer, omit synthetic
      confidence keys, and add raw/materialized lossless round-trip tests.

## 2. Persisted controls and application state

- [x] 2.1 Extend bundle settings types, validation, normalization, EAT-only write gating, and tests
      for defaults, valid fields, and independently invalid optional fields.
- [x] 2.2 Add accessible EAT overlay and threshold controls, event/auto-sync contracts, conditional
      enablement, dataset reset behavior, responsive styling, and component tests.
- [x] 2.3 Apply embedded EAT settings on dataset load and export current EAT settings from the app,
      with controller tests.

## 3. Overlay semantics and publication rendering

- [x] 3.1 Integrate effective EAT category materialization into scatter-plot caches and invalidation,
      preserving numeric, filter, isolation, and data-change behavior with tests.
- [x] 3.2 Extend the authoritative visibility model with confidence and threshold semantics, memo
      keys, precedence, hit-testing, and boundary tests.
- [x] 3.3 Carry an explicit predicted flag through style getters, shared live/export WebGL staging,
      buffers, attribute layout, and signed-distance shaders; verify hollow geometry and live/export
      parity with unit tests.
- [x] 3.4 Add tooltip provenance, reliability-index wording/bar, EAT legend subsection and live
      constrained-view counts, plus rendering and accessibility tests.

## 4. Provenance connectors

- [x] 4.1 Implement and unit-test a dedicated connector overlay controller for id lookup,
      plane-mapped/scaled geometry, dashed non-scaling lines, summaries, missing endpoints, and
      rerender-versus-transform behavior.
- [x] 4.2 Add scatter-plot connector APIs, endpoint highlighting, projection/plane/filter/isolation
      recomputation, empty-click/Escape/close/deselect clearing, status UI, styles, and component
      tests.
- [x] 4.3 Add app interaction wiring with a per-data/per-annotation inverted source index,
      active-column lookup, visible-view filtering, deterministic confidence ordering, 20-line cap,
      and interaction tests.

## 5. Real-data and end-to-end verification

- [x] 5.1 Add the supplied phosphatase EAT bundle as a compact test fixture and verify real decoder
      normalization, counts, confidence range, sources, reserved-column hiding, and round-trip.
- [x] 5.2 Add browser coverage for toggle/threshold keyboard behavior, filled-versus-hollow output,
      tooltip, legend counts, predicted/source connectors, fan-out status, dismissal, projection
      changes, and image export.
- [x] 5.3 Run targeted suites throughout, then full Vitest/E2E coverage and `pnpm precommit`; resolve
      every local failure before publishing.

## 6. Publication and review closure

- [x] 6.1 Push `agent/277-eat-overlay` and open a draft PR with a validated semantic title, links to
      #277 and #300, scientific behavior summary, design decisions, screenshots, and test evidence.
- [x] 6.2 Commission an independent review in another Codex task, require actionable findings to be
      left as GitHub review comments, and address or explicitly resolve every thread. Review task
      `019f6045-1eea-76c3-88a2-e8148db39f38` posted four actionable threads; commit `02d8faf`
      added regressions for all four, replied with evidence, and resolved every thread.
- [x] 6.3 Monitor new GitHub feedback and CI, diagnose and fix failures locally before pushing, and
      finish with all review threads resolved and all required checks green. PR #315 code quality
      and documentation checks passed on `02d8faf`; manually dispatched full Playwright run
      29328322734 passed on the same SHA because the PR workflow's `run-e2e` label is unavailable.

## 7. Independent review remediation

- [x] 7.1 Serialize categorical annotations with v2 structural encoding, positional evidence/score
      suffixes, and footer version metadata; add a golden v2 EAT write/reload regression comparing
      all per-protein annotation sets and companion channels.
- [x] 7.2 Cache provenance interactable-view membership by stable scatter-view identity, invalidate
      on authoritative visibility changes, and test repeated clicks plus hidden endpoints in both
      directions.
- [x] 7.3 Report unannotated EAT cells explicitly and test the three-way population invariant for
      full, filtered, and isolated views.
- [x] 7.4 Restrict confidence-threshold input to visibility/style redraw work and add call-count
      regressions excluding quadtree rebuild and `data-change` recount paths.
- [x] 7.5 Run targeted and required full verification, push the remediation commits, reply to and
      resolve all five review threads with evidence, and re-fetch thread-aware review state. Commit
      `bd4904d` passed 1,751 unit tests with one intentional skip, the focused real-EAT Playwright
      regression, strict OpenSpec validation, and `pnpm precommit`; all five threads were answered
      and resolved, and the subsequent thread-aware fetch found zero unresolved or new comments.

## 8. Follow-up review remediation

- [x] 8.1 Pre-order each cached provenance source list once, resolve repeated high-fan-out clicks
      with a single visibility/count scan and bounded 20-pair allocation, and add a large structural
      regression that rejects per-click sort/filter allocation.
- [x] 8.2 Clear active connectors on authoritative legend-interactivity changes, correct
      interactable-cache membership keys for zero `baseOpacity`, `selectedOpacity`, and
      `fadedOpacity` tiers while preserving the all-positive fast path, and add lifecycle/cache
      regressions.
- [x] 8.3 Capability-gate the complete EAT control group for non-EAT datasets, retain accessible
      fieldset/labels for supported datasets using existing control-bar patterns, remove both
      PR-added emoji occurrences, and add rendered component/browser assertions.
- [x] 8.4 Verify the checked-in fixture byte-for-byte against the issue #277 comment 4902936797
      asset and run the focused real phosphatase EAT Playwright flow with recorded archive and bundle
      SHA-256 evidence.
- [ ] 8.5 Run targeted suites, type/lint/strict OpenSpec, `pnpm test:ci`, focused linked-data
      Playwright, and `pnpm precommit`; commit and push coherently, update the PR description, reply
      to and resolve all four threads with immutable evidence, and re-fetch thread-aware state.
