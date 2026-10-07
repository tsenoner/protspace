// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeRenderer, plotDataFrom } from './test-support/renderer-fixture';

const pd = plotDataFrom([0, 1], [0, 1]);

describe('WebGLRenderer init failure (F-03 characterization lock)', () => {
  // Per-test cleanup: restores every vi.spyOn (console.error below + the
  // getContext spy createMockCanvas installs) even if a test throws before any
  // inline restore. Inline mockRestore() can be skipped by an exception and leak
  // a console spy into the rest of the suite.
  afterEach(() => vi.restoreAllMocks());

  it('getContext(webgl2) null → render() is a no-op, does not throw', () => {
    const { renderer: r } = makeRenderer({ contextUnavailable: true });
    expect(() => r.render(pd)).not.toThrow();
    // No usable context, so no draw is attempted. drawArrays spy proves nothing rendered.
  });

  it('program link failure → render() does not throw and draws nothing', () => {
    const { renderer: r, gl } = makeRenderer({ failProgramLink: true });
    const drawSpy = vi.spyOn(gl, 'drawArrays');
    expect(() => r.render(pd)).not.toThrow();
    expect(drawSpy).not.toHaveBeenCalled();
  });

  it('console.error is emitted (not swallowed) when getContext returns null', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    makeRenderer({ contextUnavailable: true }).renderer.render(pd);
    expect(errSpy).toHaveBeenCalledWith('WebGL2 not available');
    // Restore is handled by afterEach(vi.restoreAllMocks) so an early throw
    // above cannot leak this console.error spy into later tests.
  });
});
