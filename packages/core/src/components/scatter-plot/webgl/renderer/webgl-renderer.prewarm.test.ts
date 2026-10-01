// @vitest-environment jsdom
//
// Shader compilation off the first-render path: `prewarm()` hands both programs to the driver
// (with KHR_parallel_shader_compile on) as soon as the renderer exists, and the first render
// only reads the results back. Without a prewarm, both programs still start before either is read.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeRenderer, plotData } from './test-support/renderer-fixture';

type SpyGl = Record<string, ReturnType<typeof vi.fn>>;

/** Records the order of the calls that matter: starting a compile versus reading its result. */
function record(gl: SpyGl) {
  const calls: string[] = [];
  for (const name of [
    'compileShader',
    'linkProgram',
    'getShaderParameter',
    'getProgramParameter',
  ]) {
    const original = gl[name] as unknown as (...a: unknown[]) => unknown;
    (gl as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
      calls.push(name);
      return original(...a);
    };
  }
  const getExtension = vi.spyOn(gl as unknown as { getExtension: () => unknown }, 'getExtension');
  return { calls, getExtension };
}

const count = (calls: string[], name: string) => calls.filter((c) => c === name).length;

describe('WebGLRenderer shader prewarm', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts both programs without reading any result', () => {
    const { renderer, gl } = makeRenderer();
    const { calls, getExtension } = record(gl);

    renderer.prewarm();

    expect(getExtension).toHaveBeenCalledWith('KHR_parallel_shader_compile');
    expect(count(calls, 'compileShader')).toBe(4);
    expect(count(calls, 'linkProgram')).toBe(2);
    expect(count(calls, 'getShaderParameter')).toBe(0);
    expect(count(calls, 'getProgramParameter')).toBe(0);
  });

  it('turns the prewarmed programs into the first draw without compiling again', () => {
    const { renderer, gl } = makeRenderer();
    const { calls } = record(gl);
    const draw = vi.spyOn(gl as unknown as { drawArrays: () => void }, 'drawArrays');

    renderer.prewarm();
    renderer.render(plotData(3));

    expect(count(calls, 'compileShader')).toBe(4);
    expect(count(calls, 'linkProgram')).toBe(2);
    expect(count(calls, 'getShaderParameter')).toBe(4);
    expect(count(calls, 'getProgramParameter')).toBe(2);
    expect(draw).toHaveBeenCalled();
  });

  it('is idempotent', () => {
    const { renderer, gl } = makeRenderer();
    const { calls } = record(gl);
    renderer.prewarm();
    renderer.prewarm();
    expect(count(calls, 'compileShader')).toBe(4);
  });

  it('does nothing once a context is already in use', () => {
    const { renderer, gl } = makeRenderer();
    renderer.render(plotData(3));
    const { calls } = record(gl);
    renderer.prewarm();
    expect(calls).toEqual([]);
  });

  it('without a prewarm still starts both programs before reading either', () => {
    const { renderer, gl } = makeRenderer();
    const { calls } = record(gl);

    renderer.render(plotData(3));

    const firstRead = calls.findIndex((c) => c.startsWith('get'));
    expect(calls.slice(0, firstRead)).toEqual([
      'compileShader',
      'compileShader',
      'linkProgram',
      'compileShader',
      'compileShader',
      'linkProgram',
    ]);
  });

  it('is silent when WebGL2 is unavailable, leaving the report to the first render', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderer } = makeRenderer({ contextUnavailable: true });

    renderer.prewarm();
    expect(errors).not.toHaveBeenCalled();

    renderer.render(plotData(3));
    expect(errors).toHaveBeenCalledWith('WebGL2 not available');
  });

  it('still surfaces a link failure on the first render', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { renderer, gl } = makeRenderer({ failProgramLink: true });
    const draw = vi.spyOn(gl as unknown as { drawArrays: () => void }, 'drawArrays');

    renderer.prewarm();
    expect(errors).not.toHaveBeenCalled();
    expect(() => renderer.render(plotData(3))).not.toThrow();

    expect(errors).toHaveBeenCalledWith('Program link error:', '');
    expect(draw).not.toHaveBeenCalled();
  });

  it('releases the programs when destroyed before ever rendering', () => {
    const { renderer, gl } = makeRenderer();
    const deleteProgram = vi.spyOn(gl as unknown as { deleteProgram: () => void }, 'deleteProgram');

    renderer.prewarm();
    renderer.destroy();

    expect(deleteProgram).toHaveBeenCalledTimes(2);
  });
});
