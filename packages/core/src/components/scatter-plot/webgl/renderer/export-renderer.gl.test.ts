// @vitest-environment jsdom
/**
 * The export path's GL allocation contract, against a mock context.
 *
 * `export-renderer.test.ts` deliberately covers only the pure-math seams, which
 * need no context and run under `node`. These need one, so they live here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PlotData, ScatterplotConfig } from '@protspace/utils';
import { ExportRenderer } from './export-renderer';
import { createMockCanvas, type MockGLOptions } from './test-support/mock-webgl2';

/**
 * `renderToCanvas` creates its own throwaway canvas, so the stub goes on the
 * prototype rather than on an instance the test owns.
 */
function stubOffscreenGL(opts: MockGLOptions) {
  const { gl } = createMockCanvas(opts);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) =>
    id === 'webgl2' ? gl : null) as HTMLCanvasElement['getContext']);
}

function plotData(length: number): PlotData {
  return {
    length,
    xs: new Float32Array(length),
    ys: new Float32Array(length),
    zs: null,
    originalIndices: null,
    proteinIds: new Array(length).fill('p'),
  };
}

const config: ScatterplotConfig = { width: 800, height: 600 };
const style = {
  getColors: () => ['#ff0000'],
  getPointSize: () => 6,
  getShape: () => 'circle',
  isPredicted: () => false,
  getDepth: () => 0,
  getOpacity: () => 1,
} as never;
const baseOptions = {
  selectionActive: false,
  transform: { x: 0, y: 0, k: 1 },
  gamma: 2.2,
} as never;

function exportAt(points: number) {
  return new ExportRenderer().renderToCanvas(plotData(points), config, style, {
    width: 400,
    height: 300,
    ...baseOptions,
  });
}

describe('ExportRenderer offscreen buffer allocation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws rather than exporting a figure drawn from storage that was never allocated', () => {
    // An out-of-memory bufferData raises into the GL error flag instead of
    // throwing, so the export used to draw from buffers that do not exist and
    // hand back a blank or half-populated PNG — saved, published, nothing logged.
    stubOffscreenGL({ driverBufferByteLimit: 1_000 });
    expect(() => exportAt(5_000)).toThrow(/could not allocate memory for .* points/);
  });

  it('keys on the error flag, not merely on reaching the check', () => {
    // Same path with no simulated limit. jsdom has no 2D context, so the export
    // still fails at the final drawImage copy — which is after the guard, so a
    // guard that fired unconditionally would surface the allocation message here.
    stubOffscreenGL({});
    expect(() => exportAt(5_000)).not.toThrow(/could not allocate memory for .* points/);
  });

  it('does not blame the buffers for an error raised before the uploads', () => {
    // The flag is sticky and context-wide: program compilation and linking run
    // on this context first, so without a drain their failure would be reported
    // as an out-of-memory point-buffer allocation.
    stubOffscreenGL({ driverTextureLimit: 1 });
    expect(() => exportAt(5_000)).not.toThrow(/could not allocate memory for .* points/);
  });
});

describe('ExportRenderer dot size', () => {
  afterEach(() => vi.restoreAllMocks());

  function exportedPointScale(transform: { x: number; y: number; k: number }) {
    const { gl } = createMockCanvas({});
    const pushed: Record<string, number> = {};
    Object.assign(gl!, {
      getUniformLocation: (_p: unknown, name: string) => ({ name }),
      uniform1f: (loc: { name: string }, v: number) => {
        pushed[loc.name] = v;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) =>
      id === 'webgl2' ? gl : null) as HTMLCanvasElement['getContext']);
    try {
      new ExportRenderer().renderToCanvas(plotData(10), config, style, {
        width: 400,
        height: 300,
        ...(baseOptions as object),
        transform,
      } as never);
    } catch {
      // jsdom has no 2D context for the final copy; the draw has already happened.
    }
    return pushed.u_pointScale;
  }

  it('draws the live 800x600 dot size scaled to a 400x300 output', () => {
    // live scale 0.90999 at k = 1, times the output ratio 0.5
    expect(exportedPointScale({ x: 0, y: 0, k: 1 })).toBeCloseTo(0.455, 3);
  });

  it('keeps the zoom-in growth of the live view', () => {
    expect(exportedPointScale({ x: 0, y: 0, k: 4 })).toBeCloseTo(0.64346, 4);
  });
});
