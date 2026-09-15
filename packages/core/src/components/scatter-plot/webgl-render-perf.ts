import * as d3 from 'd3';
import type { PlotData, PlotDataPoint, VisualizationData } from '@protspace/utils';
import { materializePlotDataPoint } from '@protspace/utils';
// Type-only: nothing here needs the class at runtime. The reverse edge
// (plot-interaction-controller.ts -> RenderWebGLTrigger) is `import type` as well,
// so neither module pulls the other into the runtime graph.
import type { PlotInteractionController } from './interaction/plot-interaction-controller';

const PERF_MEASURE_ITERATIONS = 10;
/**
 * Default budget for the readiness gate. Only a default: a caller sweeping many
 * datasets under an enclosing deadline (the in-page perf suite) passes what is
 * left of the dataset's budget instead, so the gate cannot spend ten minutes
 * inside a window that has less than that to give.
 */
const PERF_READY_TIMEOUT_MS = 10 * 60_000;
const PERF_MEASURE_ZOOM_FACTOR = 3;
const PERF_MEASURE_PAN_DISTANCE_PX = 160;
const PERF_MEASURE_PAN_STEPS = 6;
const PERF_GLOBAL_RESULTS_KEY = '__protspaceWebGLRenderPerfMeasurements';

export type RenderWebGLTrigger = 'zoom' | 'plot' | 'unknown';

export type PerfScenarioName = 'annotationChange' | 'zoomInOut' | 'dragCanvas' | 'clickPoint';

export type PerfRenderPass = {
  seq: number;
  trigger: RenderWebGLTrigger;
  startTs: number;
  endTs: number;
  durationMs: number;
  /**
   * Points handed to the renderer. NOT the count drawn — see `drawnPoints`.
   * Kept as-is because the jsdom host-contract test asserts it against a
   * six-point fixture, and in jsdom `render()` early-returns before any drawn
   * count exists.
   */
  renderedPoints: number;
  /**
   * Points the renderer actually drew. Lower than `renderedPoints` exactly when
   * the staging clamp truncated, which is the state that used to be silent.
   */
  drawnPoints: number;
  /**
   * Bytes pushed to the GPU during this pass. For a pan or a zoom this must be
   * zero: the camera is a shader uniform, so motion cannot require an upload.
   * That is the #456 regression gate, and unlike a wall-clock threshold it is
   * machine-independent.
   */
  uploadedBytes: number;
};

export type PerfScenarioRun = {
  name: PerfScenarioName;
  iterations: number;
  startTs: number;
  endTs: number;
  passes: PerfRenderPass[];
  skippedReason?: string;
};

export type PerfDatasetInfo = {
  id: string;
  url?: string;
  proteinCount?: number;
};

export type PerfRunOptions = {
  download?: boolean;
  dataset?: PerfDatasetInfo;
  /**
   * Budget for the readiness gate, defaulting to PERF_READY_TIMEOUT_MS. Callers
   * running under their own deadline pass what remains of it, so this wait
   * cannot outlive the window that owns it.
   */
  readyTimeoutMs?: number;
};

type PerfMeasurementResult = {
  createdAt: string;
  iterations: number;
  metadata: Record<string, unknown>;
  dataset?: PerfDatasetInfo;
  scenarios: PerfScenarioRun[];
};

export type PerfRecorder = {
  runId: string;
  iterations: number;
  passSeq: number;
  lastRenderEndTs: number;
  activeScenario: PerfScenarioRun | null;
  scenarios: PerfScenarioRun[];
};

type PerfPassToken = {
  trigger: RenderWebGLTrigger;
  startTs: number;
};

export class WebglRenderPerfRunner {
  private _recorder: PerfRecorder | null = null;
  private _autoRunConsumed = false;
  private _autoRunInFlight = false;

  constructor(private readonly _host: unknown) {}

  public start(trigger: RenderWebGLTrigger): PerfPassToken | null {
    if (!this._recorder?.activeScenario) return null;
    return { trigger, startTs: performance.now() };
  }

  public stop(
    token: PerfPassToken | null,
    renderedPoints: number,
    drawnPoints: number,
    uploadedBytes: number,
  ) {
    if (!token) return;
    const recorder = this._recorder;
    const scenario = recorder?.activeScenario;
    if (!recorder || !scenario) return;

    const endTs = performance.now();
    recorder.lastRenderEndTs = endTs;
    scenario.passes.push({
      seq: recorder.passSeq++,
      trigger: token.trigger,
      startTs: token.startTs,
      endTs,
      durationMs: endTs - token.startTs,
      renderedPoints,
      drawnPoints,
      uploadedBytes,
    });
  }

  public maybeAutoRunFromUrl() {
    if (this._autoRunConsumed || this._autoRunInFlight) return;
    const enabled = new URLSearchParams(window.location.search).get('webglPerf') === '1';
    if (!enabled) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g.__protspaceWebglPerfSuiteInFlight || g.__protspaceWebglPerfSuiteConsumed) {
      this._autoRunConsumed = true;
      return;
    }

    this._autoRunConsumed = true;
    this._autoRunInFlight = true;
    void this.runWebGLRenderPerfMeasurements()
      .catch((err) => {
        setTimeout(() => {
          throw err;
        });
      })
      .finally(() => {
        this._autoRunInFlight = false;
      });
  }

  public async runWebGLRenderPerfMeasurements(
    iterations: number = PERF_MEASURE_ITERATIONS,
    options: PerfRunOptions = {},
  ): Promise<PerfMeasurementResult | null> {
    if (this._recorder) return null;
    const runId = (globalThis.crypto as unknown as { randomUUID?: () => string })?.randomUUID?.();
    this._recorder = {
      runId: runId || `run-${Date.now()}`,
      iterations,
      passSeq: 0,
      lastRenderEndTs: 0,
      activeScenario: null,
      scenarios: [],
    };

    const createdAt = new Date().toISOString();
    try {
      const metadata = await this._collectPerfMetadata();
      const dataset = this._collectDatasetInfo(options.dataset);
      await this._waitForHostFullyLoaded(options.readyTimeoutMs ?? PERF_READY_TIMEOUT_MS);

      await this._runAnnotationChangeScenario(iterations);
      await this._runZoomInOutScenario(iterations);
      await this._runDragCanvasScenario(iterations);
      await this._runClickPointScenario(iterations);

      const scenarios = this._recorder?.scenarios ?? [];
      const result: PerfMeasurementResult = {
        createdAt,
        iterations,
        metadata,
        dataset,
        scenarios,
      };

      const existing = (window as unknown as Record<string, unknown>)[PERF_GLOBAL_RESULTS_KEY];
      const arr = Array.isArray(existing) ? (existing as unknown[]) : [];
      arr.push(result);
      (window as unknown as Record<string, unknown>)[PERF_GLOBAL_RESULTS_KEY] = arr;

      if (options.download !== false) {
        const safeCreatedAt = result.createdAt.split(':').join('-');
        const filename = `protspace-webgl-render-perf-${safeCreatedAt}.json`;
        this._downloadJson(filename, result);
      }

      return result;
    } finally {
      this._recorder = null;
    }
  }

  private _hostAny() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this._host as any;
  }

  /**
   * The host's interaction controller, or null before firstUpdated(). Still a
   * reach-in, but a *typed* one: everything past it is the controller's public
   * API, so the next extraction cannot silently strip the runner the way moving
   * `_zoom` / `_svgSelection` off the host did (#453).
   */
  private _interaction(): PlotInteractionController | null {
    return this._hostAny()._interaction as PlotInteractionController | null;
  }

  /**
   * The interaction controller, or a throw. The host assigns `_interaction` once
   * and never nulls it (`disconnectedCallback` tears down without clearing the
   * field), so today this can only fire if the reach-in name above drifts — and
   * driving the zoom scenarios through `?.` instead would turn that drift into a
   * silent no-op that skews the transform the *following* scenarios measure
   * from, which is exactly the failure mode #453 was.
   */
  private _requireInteraction(): PlotInteractionController {
    const interaction = this._interaction();
    if (!interaction)
      throw new Error('WebGL perf runner: interaction controller went away mid-run');
    return interaction;
  }

  private _collectDatasetInfo(explicit?: PerfDatasetInfo): PerfDatasetInfo | undefined {
    const host = this._hostAny();
    const proteinCount = (host?.data as VisualizationData | undefined)?.protein_ids?.length;

    const base = explicit ?? this._inferDatasetInfoFromUrl();
    if (!base) {
      return typeof proteinCount === 'number' ? { id: 'unknown', proteinCount } : undefined;
    }

    return {
      ...base,
      proteinCount: typeof base.proteinCount === 'number' ? base.proteinCount : proteinCount,
    };
  }

  private _inferDatasetInfoFromUrl(): PerfDatasetInfo | undefined {
    const params = new URLSearchParams(window.location.search);
    const dataset = params.get('dataset');
    if (dataset) {
      return { id: dataset, url: `/data/${dataset}.parquetbundle` };
    }

    const datasetUrl = params.get('datasetUrl');
    if (datasetUrl) {
      const id = (() => {
        try {
          const u = new URL(datasetUrl, window.location.href);
          const last = u.pathname.split('/').filter(Boolean).pop() || '';
          return last.replace(/\.parquetbundle$/i, '').replace(/\.parquet$/i, '') || 'unknown';
        } catch {
          return 'unknown';
        }
      })();
      return { id, url: datasetUrl };
    }

    return undefined;
  }

  /**
   * Readiness first, deadline second — for the same reason the perf suite's
   * `waitUntil` is written that way. `timeoutMs` is no longer a fixed ten
   * minutes: a caller sweeping datasets under a shared budget passes what is
   * LEFT of it, which is routinely at or near zero once a large bundle has just
   * finished loading. A `while (elapsed < timeoutMs)` head would then report
   * "timed out waiting for data to fully load" for a host it never once looked
   * at — failing a dataset that had in fact loaded.
   */
  private async _waitForHostFullyLoaded(timeoutMs: number) {
    const startTs = performance.now();
    for (;;) {
      await (this._hostAny().updateComplete ?? Promise.resolve());
      await this._sleep(16);
      const host = this._hostAny();
      // _plotData is a PlotData SoA container (not an array since MODEL-O1); its
      // `length` field is the populated point count.
      const plotData = host._plotData as { length?: number } | undefined;
      if (
        host.data &&
        !!plotData &&
        typeof plotData.length === 'number' &&
        plotData.length > 0 &&
        host._svg &&
        // Not `_interaction != null` — see isZoomReady's doc for why.
        this._interaction()?.isZoomReady &&
        host._scales &&
        host._webglRenderer
      ) {
        return;
      }
      if (performance.now() - startTs >= timeoutMs) {
        throw new Error('WebGL perf runner: timed out waiting for data to fully load');
      }
    }
  }

  private async _waitForNextRender(prevSeq: number, timeoutMs: number): Promise<boolean> {
    const startTs = performance.now();
    while (performance.now() - startTs < timeoutMs) {
      await this._sleep(16);
      const current = this._recorder?.passSeq ?? 0;
      if (current > prevSeq) return true;
    }
    return false;
  }

  private async _waitForRenderIdle(quietWindowMs: number, timeoutMs: number): Promise<boolean> {
    const startTs = performance.now();
    while (performance.now() - startTs < timeoutMs) {
      await this._sleep(16);
      const lastEnd = this._recorder?.lastRenderEndTs ?? 0;
      if (lastEnd > 0 && performance.now() - lastEnd >= quietWindowMs) return true;
    }
    return false;
  }

  private _beginScenario(name: PerfScenarioName, iterations: number, active: boolean = true) {
    if (!this._recorder) return null;
    const scenario: PerfScenarioRun = {
      name,
      iterations,
      startTs: performance.now(),
      endTs: performance.now(),
      passes: [],
    };
    if (active) this._recorder.activeScenario = scenario;
    this._recorder.scenarios.push(scenario);
    return scenario;
  }

  private _endScenario() {
    if (!this._recorder?.activeScenario) return;
    this._recorder.activeScenario.endTs = performance.now();
    this._recorder.activeScenario = null;
  }

  private async _sleep(ms: number) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async _collectPerfMetadata(): Promise<Record<string, unknown>> {
    const nav = navigator as unknown as {
      userAgent?: string;
      platform?: string;
      language?: string;
      languages?: string[];
      hardwareConcurrency?: number;
      deviceMemory?: number;
      maxTouchPoints?: number;
      userAgentData?: {
        brands?: Array<{ brand: string; version: string }>;
        mobile?: boolean;
        platform?: string;
        getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
      };
      connection?: Record<string, unknown>;
    };

    const uaData = nav.userAgentData;
    let uaHighEntropy: Record<string, unknown> | undefined;
    try {
      uaHighEntropy = uaData?.getHighEntropyValues
        ? await uaData.getHighEntropyValues([
            'architecture',
            'bitness',
            'model',
            'platformVersion',
            'uaFullVersion',
            'fullVersionList',
          ])
        : undefined;
    } catch {
      uaHighEntropy = undefined;
    }

    let webglInfo: Record<string, unknown> | undefined;
    try {
      const canvas = this._hostAny()._canvas as HTMLCanvasElement | undefined;
      const gl = (canvas?.getContext('webgl2') || canvas?.getContext('webgl')) as
        | WebGLRenderingContext
        | WebGL2RenderingContext
        | null;
      if (gl) {
        const info: Record<string, unknown> = {
          version: gl.getParameter(gl.VERSION),
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          // Bounds the label atlas, and therefore the largest dataset that can be
          // drawn with full multi-value markers. Recorded so the cross-device perf
          // corpus becomes evidence about the real distribution of this limit,
          // which we currently have none of.
          maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        };
        const debugExt = gl.getExtension('WEBGL_debug_renderer_info') as {
          UNMASKED_VENDOR_WEBGL: number;
          UNMASKED_RENDERER_WEBGL: number;
        } | null;
        if (debugExt) {
          info.unmaskedVendor = gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL);
          info.unmaskedRenderer = gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL);
        }
        webglInfo = info;
      }
    } catch {
      webglInfo = undefined;
    }

    const perfMemory = (performance as unknown as { memory?: Record<string, unknown> }).memory;
    return {
      userAgent: nav.userAgent,
      platform: nav.platform,
      languages: nav.languages,
      language: nav.language,
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemory: (nav as unknown as { deviceMemory?: number }).deviceMemory,
      maxTouchPoints: nav.maxTouchPoints,
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        width: window.screen?.width,
        height: window.screen?.height,
        availWidth: window.screen?.availWidth,
        availHeight: window.screen?.availHeight,
        colorDepth: window.screen?.colorDepth,
        pixelDepth: window.screen?.pixelDepth,
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgentData: uaData
        ? {
            brands: uaData.brands,
            mobile: uaData.mobile,
            platform: uaData.platform,
            highEntropy: uaHighEntropy,
          }
        : undefined,
      connection: (navigator as unknown as { connection?: Record<string, unknown> }).connection,
      webgl: webglInfo,
      performanceMemory: perfMemory,
    };
  }

  private _downloadJson(filename: string, data: unknown) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async _runAnnotationChangeScenario(iterations: number) {
    const host = this._hostAny();
    const data = host.data as VisualizationData | null;
    if (!data) throw new Error('WebGL perf runner: missing data for annotationChange scenario');
    const annotations = Object.keys(data.annotations || {});
    if (annotations.length < 2) throw new Error('WebGL perf runner: need at least 2 annotations');

    const a0 = host.selectedAnnotation as string;
    const a1 = annotations.find((a) => a !== a0) || annotations[0];
    if (!a1 || a1 === a0) throw new Error('WebGL perf runner: could not pick alternate annotation');

    this._beginScenario('annotationChange', iterations);

    let current = a0;
    for (let i = 0; i < iterations; i++) {
      const next = current === a0 ? a1 : a0;
      const prevSeq = this._recorder?.passSeq ?? 0;
      host.selectedAnnotation = next;
      await host.updateComplete;
      const rendered = await this._waitForNextRender(prevSeq, 2000);
      if (rendered) await this._waitForRenderIdle(10, 2000);
      current = next;
    }

    this._endScenario();
    if (host.selectedAnnotation !== a0) {
      const prevSeq = this._recorder?.passSeq ?? 0;
      host.selectedAnnotation = a0;
      await host.updateComplete;
      const rendered = await this._waitForNextRender(prevSeq, 2000);
      if (rendered) await this._waitForRenderIdle(10, 2000);
    }
  }

  private _applyZoomScale(scaleFactor: number) {
    this._requireInteraction().zoomBy(scaleFactor);
  }

  private _applyZoomTranslate(dx: number, dy: number) {
    this._requireInteraction().panBy(dx, dy);
  }

  private async _runZoomInOutScenario(iterations: number) {
    const host = this._hostAny();
    if (!this._interaction()?.isZoomReady)
      throw new Error('WebGL perf runner: missing zoom support for zoomInOut scenario');

    const prevSelectionMode = !!host.selectionMode;
    if (prevSelectionMode) {
      host.selectionMode = false;
      await host.updateComplete;
    }

    const originalTransform = host._transform ?? d3.zoomIdentity;

    this._beginScenario('zoomInOut', iterations);
    for (let i = 0; i < iterations; i++) {
      let prevSeq = this._recorder?.passSeq ?? 0;
      this._applyZoomScale(PERF_MEASURE_ZOOM_FACTOR);
      let rendered = await this._waitForNextRender(prevSeq, 2000);
      if (rendered) await this._waitForRenderIdle(10, 2000);

      prevSeq = this._recorder?.passSeq ?? 0;
      this._applyZoomScale(1 / PERF_MEASURE_ZOOM_FACTOR);
      rendered = await this._waitForNextRender(prevSeq, 2000);
      if (rendered) await this._waitForRenderIdle(10, 2000);
    }
    this._endScenario();

    const prevSeq = this._recorder?.passSeq ?? 0;
    this._requireInteraction().setTransform(originalTransform);
    const rendered = await this._waitForNextRender(prevSeq, 2000);
    if (rendered) await this._waitForRenderIdle(10, 2000);

    if (prevSelectionMode !== !!host.selectionMode) {
      host.selectionMode = prevSelectionMode;
      await host.updateComplete;
    }
  }

  private async _runDragCanvasScenario(iterations: number) {
    const host = this._hostAny();
    if (!this._interaction()?.isZoomReady)
      throw new Error('WebGL perf runner: missing zoom support for dragCanvas scenario');

    const prevSelectionMode = !!host.selectionMode;
    if (prevSelectionMode) {
      host.selectionMode = false;
      await host.updateComplete;
    }

    const originalTransform = host._transform ?? d3.zoomIdentity;

    this._beginScenario('dragCanvas', iterations);
    const stepDx = PERF_MEASURE_PAN_DISTANCE_PX / PERF_MEASURE_PAN_STEPS;
    const stepDy = stepDx * 0.6;
    for (let i = 0; i < iterations; i++) {
      for (let s = 0; s < PERF_MEASURE_PAN_STEPS; s++) {
        const prevSeq = this._recorder?.passSeq ?? 0;
        this._applyZoomTranslate(stepDx, stepDy);
        const rendered = await this._waitForNextRender(prevSeq, 2000);
        if (rendered) await this._waitForRenderIdle(10, 2000);
      }

      for (let s = 0; s < PERF_MEASURE_PAN_STEPS; s++) {
        const prevSeq = this._recorder?.passSeq ?? 0;
        this._applyZoomTranslate(-stepDx, -stepDy);
        const rendered = await this._waitForNextRender(prevSeq, 2000);
        if (rendered) await this._waitForRenderIdle(10, 2000);
      }
    }
    this._endScenario();

    const prevSeq = this._recorder?.passSeq ?? 0;
    this._requireInteraction().setTransform(originalTransform);
    const rendered = await this._waitForNextRender(prevSeq, 2000);
    if (rendered) await this._waitForRenderIdle(10, 2000);

    if (prevSelectionMode !== !!host.selectionMode) {
      host.selectionMode = prevSelectionMode;
      await host.updateComplete;
    }
  }

  private _dispatchSvgClickAt(svgX: number, svgY: number) {
    const svg = this._hostAny()._svg as SVGSVGElement | undefined;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: rect.left + svgX,
        clientY: rect.top + svgY,
      }),
    );
  }

  private async _runClickPointScenario(iterations: number) {
    const host = this._hostAny();
    const scales = host._scales as { x: (v: number) => number; y: (v: number) => number } | null;
    const svg = host._svg as SVGSVGElement | undefined;
    if (!scales || !svg)
      throw new Error('WebGL perf runner: missing svg/scales for clickPoint scenario');

    const width = host._mergedConfig?.width as number;
    const height = host._mergedConfig?.height as number;
    const transform = (host._transform as { x: number; y: number; k: number }) ?? d3.zoomIdentity;

    const getPointsForRendering = host._getPointsForRendering as (() => PlotData) | undefined;
    const candidates: PlotData = getPointsForRendering
      ? getPointsForRendering.call(host)
      : (host._plotData as PlotData);
    const getOpacity = host._getOpacity as ((p: PlotDataPoint) => number) | undefined;

    const clickable: PlotDataPoint[] = [];
    for (let i = 0; i < candidates.length && clickable.length < 2; i++) {
      const p = materializePlotDataPoint(candidates, i);
      if (getOpacity && getOpacity.call(host, p) === 0) continue;
      const px = scales.x(p.x);
      const py = scales.y(p.y);
      const sx = transform.x + transform.k * px;
      const sy = transform.y + transform.k * py;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      if (sx < 0 || sx > width || sy < 0 || sy > height) continue;
      clickable.push(p);
    }
    if (clickable.length === 0) throw new Error('WebGL perf runner: no clickable points found');

    this._beginScenario('clickPoint', iterations);
    for (let i = 0; i < iterations; i++) {
      const p = clickable[i % clickable.length];
      const px = scales.x(p.x);
      const py = scales.y(p.y);
      const sx = transform.x + transform.k * px;
      const sy = transform.y + transform.k * py;
      const prevSeq = this._recorder?.passSeq ?? 0;
      this._dispatchSvgClickAt(sx, sy);
      const rendered = await this._waitForNextRender(prevSeq, 2000);
      if (rendered) await this._waitForRenderIdle(10, 2000);
    }
    this._endScenario();

    if (Array.isArray(host.selectedProteinIds) && host.selectedProteinIds.length > 0) {
      const prevSeq = this._recorder?.passSeq ?? 0;
      host.selectedProteinIds = [];
      await host.updateComplete;
      const rendered = await this._waitForNextRender(prevSeq, 2000);
      if (rendered) await this._waitForRenderIdle(10, 2000);
    }
  }
}
