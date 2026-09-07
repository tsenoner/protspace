# Perf baselines

Dated copies of `perf/test-results/chrome/webgl-perf-*/webgl-perf-suite-chrome*.json`. Playwright
deletes the output directory of every selected project at the start of the next run, so a run worth
comparing against has to be copied here immediately.

| File                                                    | Produced by                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `2026-09-07-573K_swissprot_v3-chrome.json`              | `PERF_DATASETS=573K_swissprot_v3 PERF_ITERATIONS=10 pnpm perf --project=chrome` |
| `2026-09-07-573K_swissprot_v3-chrome-cdp.json`          | the CDP heap sidecar of the same run                                            |
| `2026-09-07-573K_swissprot-chrome.json`                 | the same command with `PERF_DATASETS=573K_swissprot` (the v2 bundle)            |
| `2026-09-07-573K_swissprot_v3-chrome.post-harness.json` | the v3 command again after the Phase 0 harness changes                          |

Note the invocation: under pnpm 10 a `--` is forwarded to the script verbatim, so the older
`pnpm perf -- --project=chrome` reaches Playwright as a positional filter and selects all three
browser projects. Write `pnpm perf --project=chrome`.

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
