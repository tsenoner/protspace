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
- [x] 8.5 Run targeted suites, type/lint/strict OpenSpec, `pnpm test:ci`, focused linked-data
      Playwright, and `pnpm precommit`; commit and push coherently, update the PR description, reply
      to and resolve all four threads with immutable evidence, and re-fetch thread-aware state.
      Implementation commit `794563c` passed 1,757 unit tests with one intentional skip, the exact
      issue-linked phosphatase Playwright flow, strict OpenSpec validation, and staged precommit.
      All four threads were answered with immutable evidence and resolved; the subsequent
      thread-aware fetch found zero unresolved threads and no new comments.

## 9. Exact-head edge remediation

- [x] 9.1 Give generated confidence annotations explicit runtime identity, allocate a collision-safe
      internal key, serialize real suffix-sharing annotations, and add EAT/non-EAT v1/v2 lossless
      round-trip regressions.
- [x] 9.2 Add dataset-scoped connector lookup invalidation that releases retained plot/map state
      without sacrificing stable-view reuse, with controller and scatter lifecycle regressions.
- [x] 9.3 Revalidate connector endpoints after connector-owned highlighting and suppress zero-
      selected-opacity pairs, with an authoritative lifecycle regression.
- [x] 9.4 Apply normalized embedded EAT settings after OPFS dataset resets with documented embedded-
      settings precedence and a controller restore regression.
- [x] 9.5 Run targeted and full verification, preserve the exact linked fixture and emoji-free diff,
      push coherent commits, update PR evidence, reply to and resolve all four threads, and re-fetch
      thread-aware state. Implementation commit `903a6dd` passed 1,765 unit tests with one
      intentional skip, the exact issue-linked phosphatase Playwright flow, strict OpenSpec
      validation, and staged precommit. The linked fixture retained SHA-256 `06bacd7a...9ba33`, the
      added-line emoji audit returned zero matches, all four threads were answered and resolved,
      the subsequent thread-aware fetch found zero unresolved or new comments, and exact-head code
      quality/documentation CI passed in run 29334857815.

## 10. Materialization and inactive-view remediation

- [x] 10.1 Preserve generated confidence runtime identity through numeric materialization and add a
      selected-confidence export/reload regression proving no synthetic wire column or duplicate
      runtime annotation.
- [x] 10.2 Observe exact `PlotData` identity before inactive connector-render returns, release stale
      view references without rebuilding, and add stable-versus-replaced lifecycle coverage.
- [x] 10.3 Run targeted and full verification, preserve the linked fixture and emoji-free diff,
      push coherent commits, update PR evidence, reply to and resolve both threads, and re-fetch
      thread-aware state. Implementation commit `938d37b` passed 1,767 unit tests with one
      intentional skip, the exact issue-linked phosphatase Playwright flow, strict OpenSpec
      validation, and staged precommit. The linked fixture retained SHA-256 `06bacd7a...9ba33`,
      the added-line emoji audit returned zero matches, both threads were answered with immutable
      evidence and resolved, the subsequent thread-aware fetch found zero unresolved or new
      comments, and exact-head code quality/documentation CI passed in run 29336232132.

## 11. Post-monorepo owner feedback remediation

- [x] 11.1 Move the EAT controls after annotation selection, gate them by the selected EAT base,
      mark EAT-capable dropdown rows accessibly, and add synchronized range/percentage threshold
      entry with component and responsive regressions.
- [x] 11.2 Preserve ordered decoded labels for multi-valued EAT cells, materialize every label,
      expose all labels in tooltips, serialize structural v2 companions losslessly, and add exact
      `O88488`/`P0C5E4` real-fixture plus focused round-trip regressions.
- [x] 11.3 Increase the shared live/export hollow-ring width while retaining point-size
      responsiveness; verify shader parity and exact-fixture encoded output. D10/13.3 subsequently
      bounded that response to preserve small-marker interiors.
- [x] 11.4 Validate the existing raw-confidence filter workflow and zoom-transformed provenance
      endpoint behavior with code, unit, and rendered evidence; do not add duplicate state unless
      either hypothesis fails.
- [x] 11.4a Thread the click detail's global `originalIndex` into provenance resolution, remove the
      dataset-wide protein-id map, and distinguish legend-ineligible endpoints from filtered or
      isolated unavailable endpoints in both click directions with accessible-status regressions.
- [x] 11.4b Reuse the shared EAT threshold default in settings restoration and cover settings that
      omit only the optional threshold.
- [x] 11.4c Encode opaque prediction source ids at the Python producer boundary and migrate legacy
      v1 categorical cells structurally before stamping transfer output as v2; cover reserved
      characters from CLI output through web normalization and connector resolution.
- [x] 11.5 Run targeted checks, full current `pnpm precommit`, full applicable suites, strict
      OpenSpec, exact linked-data Playwright, monorepo CI-equivalent checks, fixture hashes, and the
      no-emoji-added audit before committing and publishing remediation.
- [x] 11.6 Fetch the latest remote head, commit coherently with #277/#300 references, push explicitly
      to `origin HEAD:agent/277-eat-overlay`, update the PR exact-head evidence, reply to every new
      comment/thread with immutable SHA and tests, and re-fetch thread-aware unresolved state.
      Implementation commit `d53bc50e0a8d287bd5a3adf6b34e32602817c143` was pushed after confirming
      its parent matched the remote head. All seven reviewer threads and the owner summary received
      immutable-SHA/test evidence; all seven threads were resolved, the PR description was updated,
      and the subsequent GraphQL fetch found zero unresolved threads or new comments/reviews.

## 12. Final-head CI and overlap remediation

- [x] 12.1 Seed the configured ARPACK PCA solver rather than relying on its random starting vector,
      report the effective random state, and require byte-identical repeated output so Python 3.10,
      3.11, and 3.12 exercise genuinely deterministic behavior instead of a widened tolerance.
- [x] 12.2 Keep known off-view provenance candidates disjoint from drawable pairs and add an
      integrated predicted-query to filtered-source resolver/overlay regression that reports one
      unavailable connection exactly once.
- [x] 12.2a Preserve compact single-value annotation storage with sparse multi-hit overrides and
      add a million-row structural regression proving retained boxing scales only with exceptional
      rows.
- [x] 12.2b Derive EAT capability markers and controls from the stable loaded dataset while keeping
      current counts/rendering slice-based; cover filtered and isolated zero-prediction slices.
- [x] 12.2c Reuse one stable protein-index order across numeric and EAT hashing and add a 500k-row
      sparse-track regression that rejects per-track row-object materialization and sorting.
- [x] 12.2d Classify dense, typed, and sparse annotation storage through one shared multi-label guard
      so sparse multi-hit EAT rows keep incompatible legend shape selection disabled; cover the
      four-label materialized fixture shape without scanning the full protein column.
- [x] 12.2e Retain a bounded semantic provenance click independently of current view membership,
      count off-view candidates once, and cover filter/isolation expansion in both click directions
      plus overlay materialization when an endpoint re-enters the view.
- [x] 12.2f Re-resolve the active semantic source click through the cached confidence ordering when
      filter/isolation membership changes, so off-view top-ranked candidates do not consume the
      20-line visible cap; cover hide-top-20, promotion, expansion, and explicit dismissal.
- [x] 12.2g When either endpoint leaves the view, materialize only drawable pairs and count every
      unavailable semantic connection independently of the 20-line cap; cover clicked-source and
      predicted-query directions under filtering and isolation without full candidate allocation.
- [x] 12.3 Run focused and full verification, mandated precommit, strict OpenSpec, exact EAT
      Playwright, push coherent commits, reply to and resolve the new review threads with immutable
      evidence, and update exact-head PR evidence. Implementation commits
      `39176526fbf2b1b855b59084d3156b4d24591d5a`,
      `d21e7df175bf02845c8112bc8f04ad54de86505e`,
      `4b4592b510cf7d3885d0c2720555ef97cb1ea187`, and
      `c4221bed78352b24a2c42f5303a217fb39ccecc3` passed 1,804 Vitest assertions
      (one intentional skip), 761 Python tests, precommit, CI-equivalent quality/build, strict
      OpenSpec validation, exact linked-fixture Playwright, the unchanged fixture hash, and the
      added-line emoji audit. Immutable closure replies:
      [off-view overlap](https://github.com/tsenoner/protspace/pull/315#discussion_r3586366341),
      [sparse storage](https://github.com/tsenoner/protspace/pull/315#discussion_r3586366845),
      [stable capability](https://github.com/tsenoner/protspace/pull/315#discussion_r3586366842),
      [bounded hashing](https://github.com/tsenoner/protspace/pull/315#discussion_r3586371389),
      [sparse multi-label gating](https://github.com/tsenoner/protspace/pull/315#discussion_r3586461946),
      [retained off-view identity](https://github.com/tsenoner/protspace/pull/315#discussion_r3586461939),
      [visible fan-out cap](https://github.com/tsenoner/protspace/pull/315#discussion_r3586535410),
      and
      [exact semantic unavailable totals](https://github.com/tsenoner/protspace/pull/315#discussion_r3586600267).
      Independent validation reported implementation head
      `c4221bed78352b24a2c42f5303a217fb39ccecc3` technically clean; its automatic code
      quality, documentation, lint, and Python 3.10/3.11/3.12 checks were green. The
      post-resolution thread-aware GraphQL fetch found zero unresolved threads.
- [ ] 12.4 Receive an explicit clean independent review pinned to the exact final pushed
      documentation head.
- [ ] 12.5 Require every normal required GitHub CI check to pass on the exact final pushed
      documentation head.
- [ ] 12.6 Run and require an explicit EAT Playwright workflow to pass on the exact final pushed
      documentation head.

## 13. Exact-fixture UX follow-up

- [x] 13.1 Replace unexplained “Unannotated” copy with “No annotation” and selected-annotation help
      that defines the class as neither observed nor transferred; cover the exact population
      partition and an isolated no-annotation protein.
- [x] 13.2 Clarify that the EAT threshold emphasizes rather than filters, retain synchronized range
      and percentage inputs immediately after Annotation, and expose the dim-not-remove behavior in
      visible and accessible copy.
- [x] 13.3 Bound the shared live/export predicted-ring width so small and dense markers retain a
      visible hollow centre without changing their encoded diameter; add shader and rendered
      regressions.
- [x] 13.4 Keep provenance endpoint positions data-space-bound but compensate halo radius for zoom
      so its screen-space diameter remains constant; add controller and exact-fixture zoom coverage.
- [x] 13.5 Wrap every structured transferred tooltip label to complete text and update conservative
      tooltip sizing/placement coverage for multi-line EC descriptions.
- [ ] 13.6 Run focused checks, strict OpenSpec, exact-fixture desktop/mobile rendered QA, the full
      mandated `pnpm precommit`, and PR checks before publishing immutable closure evidence.
