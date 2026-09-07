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

Apple M4, 10 logical cores, `navigator.deviceMemory` 16, macOS. Chrome 149.0.7827.55 headed via
Playwright, viewport 1920x1080, `devicePixelRatio` 1, `MAX_TEXTURE_SIZE` 16384.
GPU string: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`.

Both runs are the same machine, the same session, minutes apart, on `perf/parquetbundle-v3` at
`eb237b14` with no density code.

## Render passes, `durationMs` (CPU submission time, nothing waits for the GPU)

573,649 points in every pass of both runs. `drawnPoints === renderedPoints === 573649` everywhere,
so nothing was truncated.

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

|                                   |          v3 |          v2 |
| --------------------------------- | ----------: | ----------: |
| `load.loadDurationMs`             |     6,778.6 |    20,266.6 |
| `load.heapAfterLoad.usedBytes`    | 282,618,195 | 539,648,402 |
| `load.peakUsedDuringLoadBytes`    | 282,606,655 | 539,636,838 |
| `load.heapSteady.usedBytes`       | 282,618,951 | 539,649,158 |
| CDP sidecar `peakJSHeapUsedBytes` | 145,636,760 | 436,555,508 |

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

| Scenario           | median `durationMs` before |  after | median `gpuSyncedMs` after |
| ------------------ | -------------------------: | -----: | -------------------------: |
| `annotationChange` |                     186.30 | 190.55 |                     208.80 |
| `zoomInOut`        |                       0.70 |   0.60 |                      16.00 |
| `dragCanvas`       |                       1.00 |   0.80 |                      17.60 |
| `clickPoint`       |                     414.90 | 409.50 |                     428.25 |
| `zoomFarOut`       |                    not run |   1.00 |                      24.55 |
| `dragContinuous`   |                    not run |   1.30 |                      10.70 |

The two hoists remove one blocking `getAttribLocation` and one blocking `checkFramebufferStatus`
per frame. Camera medians move by 0.1 to 0.2 ms in their favour, which is at the edge of the
run-to-run spread on this machine, so treat the hoists as cheap hygiene rather than a measured win:
the reason to keep them is that both calls are driver round-trips that stall the CPU, and the
density passes will add per-frame GL work on top.

**The number that changes the picture is `gpuSyncedMs`.** At 573K the CPU is done submitting a
camera frame in under a millisecond while the GPU takes 16 to 25 ms to draw it: `zoomInOut` 0.60 ms
CPU against 16.00 ms synced, `zoomFarOut` 1.00 against 24.55 (max 51.50). Every earlier baseline in
this repo, this file's own tables above included, reports only the sub-millisecond half. So the
frame budget at 573K is already close to spent before any density pass exists, and a density budget
has to be argued against the 16 to 25 ms figure, not against 1 ms.

`dragContinuous` records 600 passes for 10 iterations (60 animation frames each) with a median
inter-frame interval of 11.20 ms. That interval is measured with the perf sync in place, so it
includes the deliberate GPU stall and is not a frame rate the product would see; it is a
before-and-after number for the same harness.

Camera scenarios (`zoomInOut`, `zoomFarOut`, `dragCanvas`, `dragContinuous`) upload 0 bytes in every
one of their 760 passes, and `drawnPoints === renderedPoints` in every pass of every scenario.
