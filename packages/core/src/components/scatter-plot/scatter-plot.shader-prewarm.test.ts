/**
 * @vitest-environment jsdom
 *
 * The plot starts compiling its shaders when it builds the renderer (at first update, before the
 * data arrives) so the compile overlaps data loading instead of blocking the first render.
 */
import { vi, describe, it, expect, afterEach } from 'vitest';
import { createMockCanvas } from './webgl/renderer/test-support/mock-webgl2';

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

type Internals = HTMLElement & { _createWebglRenderer(): void };

afterEach(() => vi.restoreAllMocks());

describe('scatter-plot shader prewarm', () => {
  it('compiles both programs when the renderer is built, and reads nothing back yet', () => {
    const { canvas, gl } = createMockCanvas();
    const compile = vi.spyOn(gl as unknown as { compileShader: () => void }, 'compileShader');
    const status = vi.spyOn(
      gl as unknown as { getShaderParameter: () => boolean },
      'getShaderParameter',
    );
    const el = document.createElement('protspace-scatterplot') as Internals;
    Object.defineProperty(el, '_canvas', { configurable: true, get: () => canvas });

    el._createWebglRenderer();

    expect(compile).toHaveBeenCalledTimes(4);
    expect(status).not.toHaveBeenCalled();
  });
});
