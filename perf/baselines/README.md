# Perf baselines

Dated copies of `perf/test-results/chrome/webgl-perf-*/webgl-perf-suite-chrome*.json`. Playwright
deletes the output directory of every selected project at the start of the next run, so a run worth
comparing against has to be copied here immediately.
The JSON files are gitignored (machine-specific, ~45K lines); this README keeps the numbers.

| File                                                                      | Produced by                                                                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `2026-09-07-573K_swissprot_v3-chrome.json`                                | `PERF_DATASETS=573K_swissprot_v3 PERF_ITERATIONS=10 pnpm perf --project=chrome`                                       |
| `2026-09-07-573K_swissprot_v3-chrome-cdp.json`                            | the CDP heap sidecar of the same run                                                                                  |
| `2026-09-07-573K_swissprot-chrome.json`                                   | the same command with `PERF_DATASETS=573K_swissprot` (the v2 bundle)                                                  |
| `2026-09-07-573K_swissprot_v3-chrome.post-harness.json`                   | the v3 command again after the Phase 0 harness changes                                                                |
| `2026-10-05-573K_swissprot-chrome.headless-{main,branch}-run{1,2,3}.json` | `PERF_DATASETS=573K_swissprot PERF_ITERATIONS=10 pnpm perf --project=chrome` (headless, the default since `aa84a65d`) |
| `2026-10-05-573K_swissprot-chrome.headed-{main,branch}-run{1,2,3}.json`   | the same command, headed, on the same commits, minutes earlier                                                        |
| `...-cdp.json` beside each 2026-10-05 file                                | the CDP heap sidecar of that run                                                                                      |

Note the invocation: under pnpm 10 a `--` is forwarded to the script verbatim, so the older
`pnpm perf -- --project=chrome` reaches Playwright as a positional filter and selects all three
browser projects. Write `pnpm perf --project=chrome`.

The `573K_swissprot_v3` runs, here and in the sections below, predate the manifest-driven harness
and cannot be re-run as written. The v3 bundle was a local file on `perf/parquetbundle-v3`, never
committed and not an asset of the `perf-datasets` release, and the harness now serves only what
[`../datasets.manifest.json`](../datasets.manifest.json) lists: it answers
`573K_swissprot_v3.parquetbundle` with 404 ("not a perf dataset") and records a failure, whatever
sits in `perf/datasets/`. Re-running them needs a `573K_swissprot_v3` manifest record and its
release asset first (see [`../README.md`](../README.md)). The v2 command still works after
`pnpm perf:fetch --only 573K_swissprot`.

## 2026-10-05 baseline (headless, Apple M4 Pro)

The current reference. Use it, not the sections after it, for any `loadDurationMs` comparison: it
is the first record taken after `dismiss-loading-overlay-on-settle` (PR #503) removed the 800 ms
"Ready to explore!" hold and the 500 ms overlay fade, which the load timing used to include.

### Machine and commits

Apple M4 Pro, 14 logical cores (`hardwareConcurrency` 14; `navigator.deviceMemory` reports its cap
of 32), macOS 26.5. Google Chrome 154.0.8037.95 (`userAgentData.highEntropy.fullVersionList`),
stable channel, **headless** via Playwright `channel: 'chrome'`, viewport 1920x1080,
`devicePixelRatio` 1, `MAX_TEXTURE_SIZE` 16384. GPU string, identical in all twelve runs:
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)`, so headless rendered on the
hardware GPU, not SwiftShader.

| Side     | Commit                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`   | `33e9cd96` (origin/main), with the one-line headless edit of `aa84a65d` applied uncommitted                                                              |
| `branch` | `aa84a65d` (`ci/e2e-speed`, PR #503) headless; `91b92dac` headed, which differs from `aa84a65d` only in `perf/playwright.config.ts` and `perf/README.md` |

Dataset `573K_swissprot` (the v2 bundle, 44.9 MB, 573,649 proteins), 10 iterations. Three runs per
side, strictly sequential and alternating main, branch, main, branch, main, branch. **Every figure
below is the median of the three per-run values of that statistic** (so a mean is the median of
three per-run means, a p95 the median of three per-run p95s); `n` is per run. p95 is nearest-rank,
as above. No run recorded a failure or a skipped dataset.

### Render passes, branch

`durationMs` (CPU submission time) and `gpuSyncedMs` (the same window held until the GPU finishes):

| Scenario           |   n |   mean | median |    p95 |    max | `gpuSyncedMs` median |    p95 |    max |
| ------------------ | --: | -----: | -----: | -----: | -----: | -------------------: | -----: | -----: |
| `annotationChange` |  20 | 203.61 | 192.55 | 423.10 | 427.30 |               200.25 | 433.00 | 434.90 |
| `zoomInOut`        |  20 |   0.63 |   0.60 |   0.80 |   0.90 |                 4.95 |   7.90 |   9.20 |
| `zoomFarOut`       |  20 |   0.83 |   0.80 |   1.10 |   1.20 |                 7.40 |  12.50 |  31.50 |
| `dragCanvas`       | 120 |   0.67 |   0.70 |   0.80 |   0.90 |                 5.00 |   8.90 |  11.50 |
| `dragContinuous`   | 600 |   0.96 |   0.90 |   1.30 |   4.00 |                 3.10 |   4.30 |  11.20 |
| `densityZoom`      |  20 |   0.93 |   0.95 |   1.20 |   1.30 |                 6.95 |  12.20 |  14.50 |
| `contourDrag`      | 600 |   1.01 |   1.00 |   1.30 |   6.40 |                 3.70 |   4.30 |  22.20 |
| `clickPoint`       |  10 | 395.39 | 396.20 | 404.20 | 404.20 |               408.80 | 413.20 | 413.20 |

`drawnPoints === renderedPoints === 573649` in every pass of every run. Every camera scenario
uploaded 0 bytes per pass; `annotationChange` uploaded `0`, `25240556` or `43598828` and
`clickPoint` `25240556`, as before. Dropping the first 20 frames of the sustained drags moves their
`gpuSyncedMs` median by less than 0.05 ms (3.10 and 3.70). The M4 Pro draws a warm 573K frame in
about 3 ms against the M4's 10 to 12 ms, so do not compare `gpuSyncedMs` across the two machines.

### Load and heap, branch

|                                   |      branch |
| --------------------------------- | ----------: |
| `load.loadDurationMs`             |    12,184.2 |
| `load.heapAfterLoad.usedBytes`    | 531,917,989 |
| `load.peakUsedDuringLoadBytes`    | 536,823,839 |
| `load.heapSteady.usedBytes`       | 531,918,809 |
| CDP sidecar `peakJSHeapUsedBytes` | 459,954,704 |

Each row is its own median, so the rows can come from different runs.

### Before and after the overlay change (main vs branch, headless)

|                       | main (`33e9cd96`)                           | branch (`aa84a65d`)                         | Δ median |
| --------------------- | ------------------------------------------- | ------------------------------------------- | -------: |
| `load.loadDurationMs` | **13,613.5** (14,130.5, 13,613.5, 12,811.6) | **12,184.2** (13,201.5, 11,925.6, 12,184.2) | −1,429.3 |
| headed, same commits  | **13,739.7** (14,450.0, 13,512.4, 13,739.7) | **12,249.8** (13,028.4, 12,249.8, 12,168.6) | −1,489.9 |

Per-run values in run order. The medians drop by the 1,300 ms of hold and fade that were removed,
within noise, headed and headless alike. Single runs do overlap (main's third run, 12,811.6, is
faster than the branch's first, 13,201.5): run-to-run spread on this machine is about 1.3 s, as big as
the effect, so a load comparison needs at least three alternating runs per side.

Render passes, `durationMs` mean / median / p95, and `gpuSyncedMs` median:

| Scenario           |   n | main                     | branch                   | main GPU | branch GPU |
| ------------------ | --: | ------------------------ | ------------------------ | -------: | ---------: |
| `annotationChange` |  20 | 207.96 / 195.40 / 430.30 | 203.61 / 192.55 / 423.10 |   202.80 |     200.25 |
| `zoomInOut`        |  20 | 0.71 / 0.70 / 0.90       | 0.63 / 0.60 / 0.80       |     4.95 |       4.95 |
| `zoomFarOut`       |  20 | 0.77 / 0.70 / 1.10       | 0.83 / 0.80 / 1.10       |     7.35 |       7.40 |
| `dragCanvas`       | 120 | 0.76 / 0.70 / 1.10       | 0.67 / 0.70 / 0.80       |     5.05 |       5.00 |
| `dragContinuous`   | 600 | 0.92 / 0.90 / 1.20       | 0.96 / 0.90 / 1.30       |     2.90 |       3.10 |
| `densityZoom`      |  20 | 0.83 / 0.85 / 1.10       | 0.93 / 0.95 / 1.20       |     6.10 |       6.95 |
| `contourDrag`      | 600 | 1.06 / 1.00 / 1.40       | 1.01 / 1.00 / 1.30       |     3.70 |       3.70 |
| `clickPoint`       |  10 | 399.36 / 400.20 / 412.20 | 395.39 / 396.20 / 404.20 |   409.10 |     408.80 |

No render change, as expected: the branch touches `apps/web/src/explore/` (overlay, data renderer
sequencing, dataset controller) and tests, not `packages/core`. The per-run ranges of the two sides
overlap everywhere except the `densityZoom` GPU median: 5.35 to 6.40 ms on main, 6.80 to 7.45 on the
branch (+0.85 ms). That is an isolated-frame scenario at n = 20, the branch changes no draw code, and
the headed runs of the same commits show 6.40 against 6.65, so read it as noise, as the 2026-09-25
section below did a −0.8 ms `densityZoom` shift. `dragContinuous`, the one scenario where a
sub-millisecond shift is measurable, has per-run GPU medians 2.9, 2.9, 2.9 on main and 3.4, 3.1, 2.5
on the branch.

### Headed vs headless (same commits)

The headed runs (`headed-*`, all six before the headless ones) give, as medians of three:

| Metric                                 | main headed | main headless | branch headed | branch headless |
| -------------------------------------- | ----------: | ------------: | ------------: | --------------: |
| `load.loadDurationMs`                  |    13,739.7 |      13,613.5 |      12,249.8 |        12,184.2 |
| `annotationChange` median `durationMs` |      187.60 |        195.40 |        190.75 |          192.55 |
| `clickPoint` median `durationMs`       |      386.00 |        400.20 |        398.70 |          396.20 |
| `zoomFarOut` median `durationMs`       |        1.20 |          0.70 |          1.20 |            0.80 |
| `dragCanvas` median `durationMs`       |        1.10 |          0.70 |          1.10 |            0.70 |
| `dragCanvas` median `gpuSyncedMs`      |        7.90 |          5.05 |          7.75 |            5.00 |
| `zoomInOut` median `gpuSyncedMs`       |        4.95 |          4.95 |          4.95 |            4.95 |
| `dragContinuous` median `gpuSyncedMs`  |        2.50 |          2.90 |          2.60 |            3.10 |
| `contourDrag` median `gpuSyncedMs`     |        3.60 |          3.70 |          3.60 |            3.70 |

Load, the CDP heap peak, `annotationChange`, `clickPoint`, `zoomInOut` and the two sustained drags
are comparable across the two modes: the per-run ranges overlap. `heapAfterLoad` overlaps on main
(518 to 532 MB headed, 519 to 532 MB headless) but not on the branch (517 to 518 MB headed, 524 to
535 MB headless), a 3% gap to keep in mind before reading a heap change of that size. Headless is **not** comparable for the
isolated-frame camera scenarios. `dragCanvas` reads about 2.8 ms lower in `gpuSyncedMs` (per-run
medians 6.80 to 8.15 headed, 4.80 to 5.40 headless) and 0.4 ms lower in `durationMs` (1.1 to 1.3
headed, 0.6 to 0.7 headless), with no overlap on either commit; `zoomFarOut` `durationMs` drops by a
similar 0.4 to 0.5 ms in the medians, with one overlapping run. So compare headless runs with
headless runs for the camera scenarios, and treat the headed sections below as a different
measurement, besides being a different machine.

## Earlier baselines (Apple M4, headed)

Every section from here on was recorded on an Apple M4 with Chrome headed, before the suite went
headless by default, and before the overlay change for its load numbers.

## Machine

Apple M4, 10 logical cores, `navigator.deviceMemory` 16, macOS. Google Chrome 152.0.7977.83 headed
via Playwright (stable channel), viewport 1920x1080, `devicePixelRatio` 1, `MAX_TEXTURE_SIZE` 16384.
GPU string: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`.

The browser version comes from `results[0].metadata.userAgentData.highEntropy.fullVersionList`
(entry `Google Chrome`). Do not read it from `metadata.userAgent`: that is Playwright's
`devices['Desktop Chrome']` descriptor, which reports 149 and `Windows NT 10.0` on this Mac.
The viewport is from `perf/playwright.config.ts`; the JSON records `screen` (1920x1080) but no
viewport of its own.

Both runs are the same machine, the same session, minutes apart, on `perf/parquetbundle-v3` at
`eb237b14` with no density code.

## Render passes, `durationMs` (CPU submission time, nothing waits for the GPU)

573,649 points in every pass of both runs. `drawnPoints === renderedPoints === 573649` everywhere,
so nothing was truncated. p95 is nearest-rank (the `ceil(0.95 n)`-th sorted sample), not
interpolated.

### v3 bundle (`573K_swissprot_v3`, 36.4 MB)

| Scenario           |   n |   mean | median |    p95 |    max |
| ------------------ | --: | -----: | -----: | -----: | -----: |
| `annotationChange` |  20 | 245.41 | 186.30 | 594.60 | 641.30 |
| `zoomInOut`        |  20 |   1.73 |   0.70 |   1.30 |  20.80 |
| `dragCanvas`       | 120 |   1.08 |   1.00 |   1.70 |   6.20 |
| `clickPoint`       |  10 | 417.18 | 414.90 | 435.30 | 435.30 |

### v2 bundle (`573K_swissprot`, 44.9 MB)

| Scenario           |   n |   mean | median |    p95 |    max |
| ------------------ | --: | -----: | -----: | -----: | -----: |
| `annotationChange` |  20 | 209.40 | 186.75 | 452.40 | 506.30 |
| `zoomInOut`        |  20 |   1.70 |   0.70 |   1.50 |  19.80 |
| `dragCanvas`       | 120 |   1.23 |   1.10 |   1.70 |  14.40 |
| `clickPoint`       |  10 | 406.29 | 405.50 | 423.60 | 423.60 |

The two bundles render identically, which is the point: v3 changed the decode, not the draw. Render
medians differ by less than the run-to-run spread; the p95 and max columns are dominated by the
first iteration of each scenario.

## `uploadedBytes` per pass

Identical in both runs:

| Scenario           | `uploadedBytes` values seen |
| ------------------ | --------------------------- |
| `zoomInOut`        | `0` only                    |
| `dragCanvas`       | `0` only                    |
| `annotationChange` | `0`, `25240556`, `43598828` |
| `clickPoint`       | `25240556`                  |

A camera move uploads nothing, which is the #456 gate. `annotationChange` and `clickPoint` restage
colours, so they upload by design.

## Load and heap

|                                   |          v3 |                         v2 |
| --------------------------------- | ----------: | -------------------------: |
| `load.loadDurationMs`             |     6,778.6 |                   20,266.6 |
| `load.heapAfterLoad.usedBytes`    | 282,618,195 |                539,648,402 |
| `load.peakUsedDuringLoadBytes`    | 282,606,655 |                539,636,838 |
| `load.heapSteady.usedBytes`       | 282,618,951 |                539,649,158 |
| CDP sidecar `peakJSHeapUsedBytes` | 145,636,760 | 436,555,508 (not retained) |

Only the v3 sidecar file was copied here; the v2 number is recorded above but its file was deleted
by the next run.

`loadDurationMs` covers the whole demo load, not just the bundle decode: fetch over the dev server,
decode, staging and the readiness gate. The CDP sidecar samples out of process every ~200 ms and can
miss a synchronous peak, so it reads lower than the in-page `performance.memory` numbers.

These load numbers predate `dismiss-loading-overlay-on-settle` and were taken on an Apple M4,
headed. The readiness gate waits for the loading overlay to be removed, and that removal used to
come after an 800 ms hold plus a 500 ms fade on every dataset over 1,000 proteins. It now comes
right after the post-load work. Compare a newer `loadDurationMs` against
[the 2026-10-05 baseline](#2026-10-05-baseline-headless-apple-m4-pro), not against these.

For reference, the pre-v3 record from 2026-05-31 (v2 bundle, same class of machine, `uploadedBytes`
did not exist yet) had load 27,232 ms and a CDP peak of 813,786,683 B.

## Post-harness delta (Task 0.6)

`2026-09-07-573K_swissprot_v3-chrome.post-harness.json` is the same v3 command re-run after the
Phase 0 harness landed: `gpuSyncedMs`, the `dragContinuous` and `zoomFarOut` scenarios, and the two
per-frame GL queries hoisted out of the frame (the gamma quad's `getAttribLocation` and the render
path's `checkFramebufferStatus`). Load 6,522.2 ms, heap after load 283,118,529 B, CDP peak
158,276,028 B, all within the spread of the pre-harness run.

| Scenario                     | median `durationMs` before |  after | median `gpuSyncedMs` after | max `gpuSyncedMs` |
| ---------------------------- | -------------------------: | -----: | -------------------------: | ----------------: |
| `annotationChange`           |                     186.30 | 190.55 |                     208.80 |            655.80 |
| `zoomInOut`                  |                       0.70 |   0.60 |                      16.00 |             27.20 |
| `dragCanvas`                 |                       1.00 |   0.80 |                      17.60 |             33.50 |
| `clickPoint`                 |                     414.90 | 409.50 |                     428.25 |            444.80 |
| `zoomFarOut`, out to k = 0.1 |                    not run |   0.80 |                      37.50 |             51.50 |
| `zoomFarOut`, back to k = 1  |                    not run |   1.05 |                      10.60 |             12.30 |
| `dragContinuous`             |                    not run |   1.30 |                      10.70 |             28.30 |

`zoomFarOut` is reported per phase because it is bimodal and a single median describes neither half.
The scenario alternates `zoomBy(0.1)` then `zoomBy(10)` once per iteration, so ordered by `seq` the
even-indexed passes are the k = 0.1 frame and the odd-indexed ones the return to k = 1:
`[51.5, 9.2, 38.5, 9.4, 37.2, 11.2, ...]`. The combined median, 24.55 ms, is a value no frame ever
took.

That split also kills the premise the scenario was written on. k = 0.1 is the MOST expensive point
frame, not the cheapest: `gl_PointSize` is a per-vertex attribute and does not scale with k
(`export-shaders.ts`), so zooming out packs all 573K sprites into about 1% of the screen and
same-pixel overdraw serialises the alpha blending. It is still the right scenario to watch, for the
opposite reason: it is both the worst `off` frame and where a density accumulate saturates.
`zoomInOut` shows the same signature (k = 3 median 13.60 ms against k = 1 median 18.25 ms).

The two hoists remove one blocking `getAttribLocation` and one blocking `checkFramebufferStatus`
per frame. Camera medians move by 0.1 to 0.2 ms in their favour, which is at the edge of the
run-to-run spread on this machine, so treat the hoists as cheap hygiene rather than a measured win:
the reason to keep them is that both calls are driver round-trips that stall the CPU, and the
density passes will add per-frame GL work on top.

**The number that changes the picture is `gpuSyncedMs`.** At 573K the CPU is done submitting a
camera frame in under a millisecond while the GPU takes 10 to 37 ms to draw it: `zoomInOut` 0.60 ms
CPU against 16.00 ms synced, `zoomFarOut` 0.80 against 37.50 (max 51.50). Every earlier baseline in
this repo, this file's own tables above included, reports only the sub-millisecond half. So the
frame budget at 573K is already close to spent before any density pass exists, and a density budget
has to be argued against those figures, not against 1 ms.

Two caveats on which figure to use. The isolated-frame scenarios (`zoomInOut`, `dragCanvas`,
`zoomFarOut`) wait for an idle window plus a 16 ms poll sleep between steps, so they measure a GPU
that has clocked down: pass 0 of every scenario runs 10 to 14 ms above its own steady state.
`dragContinuous` is the only warm, sustained series here. Dropping its first 20 frames leaves
n = 580 with median 10.70 ms, p95 13.50, sigma 1.91 and a standard error of the median near 0.10 ms,
which makes it the one scenario where a sub-millisecond regression is measurable at all.

`dragContinuous` records exactly 600 passes for 10 iterations (60 animation frames each, one render
per pan) with a median inter-frame interval of 11.20 ms. That interval is measured with the perf sync in place, so it
includes the deliberate GPU stall and is not a frame rate the product would see; it is a
before-and-after number for the same harness.

Camera scenarios (`zoomInOut`, `zoomFarOut`, `dragCanvas`, `dragContinuous`) upload 0 bytes in every
one of their 760 passes, and `drawnPoints === renderedPoints` in every pass of every scenario.

## Per-category contours (2026-09-25)

`2026-09-25-573K_swissprot_v3-chrome.contour-merged.json` is the v3 command on the merged contour
(the commit before "feat(webgl): per-category contours", with the `contourDrag` scenario already in
place); `...contour-per-category.json` is the same command after the per-category contours landed. Same machine and session, minutes apart. Median
`gpuSyncedMs`, the first 20 frames of the two sustained drags dropped (n = 580):

| Scenario                | merged | per-category |
| ----------------------- | -----: | -----------: |
| `dragContinuous`        |  12.30 |        12.40 |
| `contourDrag`           |  15.10 |        15.10 |
| `densityZoom` (heatmap) |  13.45 |        12.65 |

`contourDrag` moves by 0.00 ms against a +1.0 ms gate. A third run with
`DENSITY_CONTOUR_GRID_DIVISOR = 1` (per-category fields at the old sampling, not kept) measured
`contourDrag` 15.30. `densityZoom` is an isolated-frame scenario (n = 20), so its -0.8 ms is spread,
not a change: the heatmap passes are the same shaders. Every camera pass uploaded 0 bytes.

These numbers are historical: the heatmap style and `DENSITY_CONTOUR_GRID_DIVISOR` were removed
later in the same PR, and the contour grid is now a fixed 512 cells on the long side of the plot.
