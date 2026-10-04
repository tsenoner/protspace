## Context

Explore's costs live in interactions: switching annotation or projection, legend clicks, camera
moves, resize, search and import. The old suite timed synthetic calls into the page. The lab used
during the 2026-09-30 profiling drove the real UI and counted work per interaction, which is what
found the redundant re-stages. This change keeps the lab's method and drops its weak points.

## Goals / Non-Goals

**Goals:**

- A deterministic gate that runs in CI in about a minute and fails when an interaction does more
  work than it did on main.
- A manual timing mode that answers "is B faster than A" on one laptop despite power-state noise.
- Probes that cannot vanish silently after a refactor.

**Non-Goals:**

- Timing budgets, multi-browser timing, a GPU CI runner.

## Decisions

### Counters are flag-gated module state, not marks or events

`perfCounters` is `null` unless the page URL has `perfCounters`; each call site is
`if (perfCounters) perfCounters.x++`. No allocation, no `performance.mark`, nothing to tree-shake.
The object is exposed as `window.__protspacePerfCounters` for the spec. Alternative considered:
monkey-patching private methods from the test, as the lab did. Rejected because a rename
(`QuadtreeIndex` → `PointGridIndex`) silently turns the probe into zero.

The `load` segment also asserts that the counters it relies on are non-zero, so a probe that a
refactor disconnects fails the run instead of passing at zero.

### GL counts come from the public WebGL2 prototype

`gl.is*`, synchronous reads (`getError`, `get*Parameter`, `readPixels`) and `bufferData` /
`bufferSubData` byte lengths are counted by wrapping `WebGL2RenderingContext.prototype` in an init
script. These are platform names, so no app change can hide them.

### Settle by quiescence, not sleeps

`settle()` waits until counters and uploaded bytes stay unchanged for at least two animation
frames and 200 ms, capped at 3 s. The 200 ms covers the grid-rebuild frame and the legend's
debounces. Hitting the cap fails the segment: something is rendering in a loop.

### Resets double as pixel round trips

Each segment's reset returns the UI to its prior state, and a screenshot of `#myPlot` before the
segment must equal one after the reset. This catches a reset that leaves state behind, which would
otherwise skew every later segment's counts.

### Budgets are recorded, not hand-written

`PERF_UPDATE_BUDGETS=1` runs the segments three times and writes the maximum per key. Actual above
budget fails; below budget passes with a "tighten" note. Timings are never budgeted.

### Timing mode interleaves builds

`--compare` loads A and B in the same session and alternates segment runs A, B, A, B, so a change
in power state hits both. The first run is warm-up and dropped; medians are reported as B/A.

## Risks / Trade-offs

- [Counts miss a slowdown that does the same number of calls] → timing mode covers it manually;
  `restageMs` is reported alongside counts.
- [SwiftShader in CI renders differently from a GPU] → counts are identical; pixel checks compare a
  page with itself, never with a stored image.
- [Removing Firefox/Safari timing] → engine regressions were never caught by the old suite either
  (no budgets); the e2e suite still exercises both engines functionally.
