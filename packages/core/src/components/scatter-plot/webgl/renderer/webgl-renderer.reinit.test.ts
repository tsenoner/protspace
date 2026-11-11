// @vitest-environment jsdom
//
// The renderer used to rebuild its GL state and recompile both programs whenever a per-frame
// validity check failed, which happened on every call before the first stage (30 times while the
// explore page loaded its data). Guard that no call re-initialises a live context.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeRenderer, plotData } from './test-support/renderer-fixture';

describe('WebGLRenderer context reuse before the first stage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps one set of programs across every call that runs before data arrives', () => {
    const { renderer, gl } = makeRenderer();
    const link = vi.spyOn(gl as unknown as { linkProgram: () => void }, 'linkProgram');

    renderer.clear();
    renderer.clear();
    renderer.render(plotData(0));
    renderer.render(plotData(0));

    expect(link).toHaveBeenCalledTimes(2); // point + gamma, once
  });

  it('keeps them after the first stage too', () => {
    const { renderer, gl } = makeRenderer();
    const link = vi.spyOn(gl as unknown as { linkProgram: () => void }, 'linkProgram');

    renderer.clear();
    renderer.render(plotData(3));
    renderer.render(plotData(3));

    expect(link).toHaveBeenCalledTimes(2);
  });
});
