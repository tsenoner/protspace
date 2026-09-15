/**
 * @vitest-environment jsdom
 *
 * Issue #453: `WebglRenderPerfRunner` reads the scatter-plot host through an
 * untyped `as any` bridge, so when a field it depends on moves off the host
 * nothing fails at build time — the runner just spins. `_zoom` / `_svgSelection`
 * moved into `PlotInteractionController` (both `private`), and the readiness gate
 * `_waitForHostFullyLoaded` waited out its full 10-minute timeout ever since,
 * while `_applyZoomScale` / `_applyZoomTranslate` degraded to silent no-ops.
 *
 * These tests lock the two OBSERVABLE consequences rather than any field name,
 * so they survive whichever shape the fix takes (host getters, a typed
 * `PerfHost` bridge like `_interactionHost()`, …):
 *   1. the gate resolves promptly against a real, loaded host;
 *   2. the runner's zoom helpers actually move the plot.
 *
 * They deliberately drive the runner instance the HOST owns (`_webglRenderPerf`)
 * rather than constructing one, so a change to the runner's constructor
 * arguments is exercised too.
 *
 * jsdom has no WebGL, but that does not block this: `WebGLRenderer`'s constructor
 * only wires a `ContextLossController` and defers GL acquisition, so
 * `_webglRenderer` is non-null here and the gate's other conditions are all
 * satisfiable. The renderer logs "WebGL2 not available" on render; that is
 * expected and irrelevant to the readiness contract.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import { PlotInteractionController } from './interaction/plot-interaction-controller';
import type { PlotInteractionHost } from './interaction/plot-interaction-controller';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';
import type { ProtspaceScatterplot } from './scatter-plot';
import type { PerfRecorder, PerfScenarioName, PerfScenarioRun } from './webgl-render-perf';

/**
 * Private surface of `WebglRenderPerfRunner` these tests drive directly. The
 * recorder shapes come from the module under test rather than being redeclared
 * structurally, so a reshape there fails this file at build time instead of
 * letting it keep compiling against a private copy — the same silent-drift
 * failure mode #453 was.
 */
type PerfRunnerInternals = {
  _waitForHostFullyLoaded(timeoutMs: number): Promise<void>;
  _applyZoomScale(scaleFactor: number): void;
  _applyZoomTranslate(dx: number, dy: number): void;
  _recorder: PerfRecorder | null;
  _beginScenario(
    name: PerfScenarioName,
    iterations: number,
    active?: boolean,
  ): PerfScenarioRun | null;
  _endScenario(): void;
};

type PerfHostInternals = ProtspaceScatterplot & {
  _webglRenderPerf: PerfRunnerInternals;
  _interaction: PlotInteractionController | null;
};

/**
 * Budget for the readiness gate on a host that IS loaded. Readiness is reached
 * before the gate's first loop iteration, so it resolves after a single pass
 * (one `await updateComplete` + one 16ms sleep) — measured at 54-59ms locally.
 * 500ms leaves ~9x headroom on a loaded CI runner while still failing in under a
 * second instead of the runner's real 10-minute timeout.
 */
const GATE_BUDGET_MS = 500;

/**
 * Budget for the negative control. The gate can only ever reject there, so this
 * is pure wall-clock cost — keep it just above one loop iteration.
 */
const NEVER_READY_BUDGET_MS = 150;

/** Six proteins, one categorical annotation — enough for a non-empty `_plotData`. */
function makeFamilyData(): VisualizationData {
  const families = ['A', 'A', 'A', 'B', 'B', 'B'];
  const coords = new Float32Array(families.length * 2);
  families.forEach((_, i) => {
    coords[i * 2] = i;
    coords[i * 2 + 1] = i;
  });
  return {
    protein_ids: families.map((_, i) => `p${i}`),
    projections: [{ name: 'umap', data: coords, dimension: 2 }],
    annotations: {
      fam: {
        values: families,
        colors: families.map((v) => (v === 'A' ? '#ff0000' : '#00ff00')),
        shapes: families.map(() => 'circle'),
      },
    },
    annotation_data: {
      fam: families.map((v) => [families.indexOf(v)]),
    },
  } as unknown as VisualizationData;
}

const mounted: HTMLElement[] = [];

/**
 * Connect a scatter-plot so Lit's `firstUpdated` runs for real — that is where
 * the interaction controller is constructed and initialized and where the WebGL
 * renderer is built, i.e. the exact lifecycle the readiness gate waits on.
 */
async function mountScatter(data: VisualizationData | null): Promise<PerfHostInternals> {
  const sp = document.createElement('protspace-scatterplot') as PerfHostInternals;
  if (data) {
    sp.data = data;
    sp.selectedAnnotation = 'fam';
  }
  document.body.appendChild(sp);
  mounted.push(sp);
  await sp.updateComplete;
  return sp;
}

/** The main group's `transform` attribute is the public read-back of an applied zoom. */
function mainGroupTransform(sp: PerfHostInternals): string | null {
  return sp._interaction?.mainGroup?.attr('transform') ?? null;
}

/**
 * Open the recording window that `runWebGLRenderPerfMeasurements` opens per
 * scenario. `start()` returns null unless a scenario is active, so without this
 * every render below would be measured as nothing at all — which is precisely
 * the state the benchmark was stuck in.
 */
function beginRecordingScenario(
  runner: PerfRunnerInternals,
  name: PerfScenarioName,
): PerfScenarioRun {
  runner._recorder = {
    runId: 'host-contract',
    iterations: 1,
    passSeq: 0,
    lastRenderEndTs: 0,
    activeScenario: null,
    scenarios: [],
  };
  const scenario = runner._beginScenario(name, 1);
  if (!scenario) throw new Error('failed to begin perf scenario');
  return scenario;
}

function endRecording(runner: PerfRunnerInternals) {
  runner._endScenario();
  runner._recorder = null;
}

/** applyZoom defers its render into a RAF, so the pass lands a frame later. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('WebglRenderPerfRunner ↔ scatter-plot host contract (#453)', () => {
  afterEach(() => {
    while (mounted.length) mounted.pop()?.remove();
    vi.restoreAllMocks();
  });

  it('the readiness gate resolves once the host has loaded', async () => {
    const sp = await mountScatter(makeFamilyData());

    // Rejects with 'timed out waiting for data to fully load' whenever any field
    // the gate reads has drifted off the host — in production that reject is 10
    // minutes away, which is why `pnpm perf` looks like a hang rather than a failure.
    await expect(
      sp._webglRenderPerf._waitForHostFullyLoaded(GATE_BUDGET_MS),
    ).resolves.toBeUndefined();
  });

  it('the readiness gate still rejects on a host that never loads data', async () => {
    // Negative control for the data half of the gate: it must stay a real gate
    // rather than resolve on anything that is merely mounted.
    const sp = await mountScatter(null);

    await expect(
      sp._webglRenderPerf._waitForHostFullyLoaded(NEVER_READY_BUDGET_MS),
    ).rejects.toThrow(/timed out waiting for data to fully load/);
  });

  it('the readiness gate rejects when the interaction layer was never initialized', async () => {
    // Negative control for the half that actually drifted. The `data: null` host
    // above fails the gate on `host.data` alone, so it stays red even with the
    // zoom condition deleted — on its own it does NOT make "delete the failing
    // condition" a non-fix. This host has every other condition satisfied, so the
    // gate can only reject by consulting the interaction layer.
    const sp = await mountScatter(makeFamilyData());

    // Exactly the shape #453 produced: a non-null controller carrying null zoom
    // state, because `initialize()` early-returns when the host has no SVG.
    const uninitialized = new PlotInteractionController({
      getSvg: () => undefined,
    } as unknown as PlotInteractionHost);
    uninitialized.initialize();
    expect(uninitialized.isZoomReady).toBe(false);

    sp._interaction?.teardown();
    sp._interaction = uninitialized;

    await expect(
      sp._webglRenderPerf._waitForHostFullyLoaded(NEVER_READY_BUDGET_MS),
    ).rejects.toThrow(/timed out waiting for data to fully load/);
  });

  it('a programmatic zoom moves the plot and records a render pass', async () => {
    const sp = await mountScatter(makeFamilyData());
    const runner = sp._webglRenderPerf;
    const scenario = beginRecordingScenario(runner, 'zoomInOut');
    try {
      // `_runZoomInOutScenario` drives every zoom through this helper; when the
      // d3 zoom handle is unreachable it returns at its guard and the scenario
      // silently measures nothing. The `resetZoom()` that the first `data`
      // assignment triggers is a 750ms transition from identity to identity, so
      // it never competes with the value asserted here.
      runner._applyZoomScale(3);
      expect(mainGroupTransform(sp)).toMatch(/scale\(3\)/);

      // The transform is written synchronously but the render is deferred into a
      // RAF, so a regression that breaks only the render path would leave every
      // assertion above green while making zoomInOut measure nothing.
      await nextFrame();

      // Assert the TRIGGER, not the count: an unrelated 'plot' pass can land in
      // the same frame, so `passes.length > 0` would stay green with the zoom
      // render path dead — the exact regression this is here to catch.
      expect(scenario.passes.map((p) => p.trigger)).toContain('zoom');
      expect(scenario.passes.find((p) => p.trigger === 'zoom')?.renderedPoints).toBe(6);
    } finally {
      endRecording(runner);
    }
  });

  it('a programmatic pan moves the plot and records a render pass', async () => {
    const sp = await mountScatter(makeFamilyData());
    const runner = sp._webglRenderPerf;
    const scenario = beginRecordingScenario(runner, 'dragCanvas');
    try {
      // `_runDragCanvasScenario` pans through this helper.
      const before = mainGroupTransform(sp);
      runner._applyZoomTranslate(50, 20);
      expect(mainGroupTransform(sp)).not.toBe(before);

      await nextFrame();
      // 'zoom', not a pan-specific trigger: applyZoom is the single call site for
      // both gestures, so d3-driven pans are recorded under the same trigger.
      expect(scenario.passes.map((p) => p.trigger)).toContain('zoom');
    } finally {
      endRecording(runner);
    }
  });
});
