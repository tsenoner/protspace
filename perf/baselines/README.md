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

Filled in after the Phase 0 harness lands; see `2026-09-07-573K_swissprot_v3-chrome.post-harness.json`.
