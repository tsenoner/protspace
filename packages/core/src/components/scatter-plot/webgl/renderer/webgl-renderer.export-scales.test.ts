// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ExportRenderer } from './export-renderer';
import { makeRenderer as makeFixtureRenderer, plotDataFrom } from './test-support/renderer-fixture';

const pd = plotDataFrom([0, 1], [0, 1]);
const config = { width: 800, height: 600 };

function makeRenderer() {
  return makeFixtureRenderer({}, undefined, { getConfig: () => config }).renderer;
}

describe('WebGLRenderer.createExportScales (facade pass-through, #301/#302)', () => {
  it('returns null before anything has been rendered', () => {
    expect(makeRenderer().createExportScales(400, 300)).toBeNull();
  });

  it('after render(), delegates to ExportRenderer.createExportScales with the last-rendered data + live config', () => {
    const r = makeRenderer();
    r.render(pd);
    const got = r.createExportScales(400, 300);
    const want = ExportRenderer.createExportScales(config, pd, 400, 300);
    expect(got).not.toBeNull();
    expect(got!.x.domain()).toEqual(want!.x.domain());
    expect(got!.x.range()).toEqual(want!.x.range());
    expect(got!.y.domain()).toEqual(want!.y.domain());
    expect(got!.y.range()).toEqual(want!.y.range());
  });
});
