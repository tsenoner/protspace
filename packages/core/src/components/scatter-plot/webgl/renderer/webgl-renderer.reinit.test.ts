// @vitest-environment jsdom
//
// A real driver reports a name that has never been bound as not-an-object: `isTexture` is false
// for a fresh texture until something binds it. The renderer's validity check asks `isTexture`
// of the label texture, which nothing binds until the first stage. The mock answers `true`
// unconditionally, which hid the consequence: every `ensureGL` before the first stage found the
// state "dead", threw it away and recompiled both programs — 30 times while the explore page
// loaded its data.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeRenderer, plotData } from './test-support/renderer-fixture';

/** Make `isTexture` answer like a driver: only for textures bound at least once. */
function bindingAwareTextures(gl: Record<string, unknown>) {
  const bound = new Set<unknown>();
  gl.bindTexture = (_target: number, texture: unknown) => {
    if (texture) bound.add(texture);
  };
  gl.isTexture = (texture: unknown) => bound.has(texture);
}

describe('WebGLRenderer context reuse before the first stage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps one set of programs across every call that runs before data arrives', () => {
    const { renderer, gl } = makeRenderer();
    bindingAwareTextures(gl as unknown as Record<string, unknown>);
    const link = vi.spyOn(gl as unknown as { linkProgram: () => void }, 'linkProgram');

    renderer.clear();
    renderer.clear();
    renderer.render(plotData(0));
    renderer.render(plotData(0));

    expect(link).toHaveBeenCalledTimes(2); // point + gamma, once
  });

  it('keeps them after the first stage too', () => {
    const { renderer, gl } = makeRenderer();
    bindingAwareTextures(gl as unknown as Record<string, unknown>);
    const link = vi.spyOn(gl as unknown as { linkProgram: () => void }, 'linkProgram');

    renderer.clear();
    renderer.render(plotData(3));
    renderer.render(plotData(3));

    expect(link).toHaveBeenCalledTimes(2);
  });
});
