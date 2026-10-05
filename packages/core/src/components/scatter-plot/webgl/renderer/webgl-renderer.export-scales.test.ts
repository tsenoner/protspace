// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ExportRenderer } from './export-renderer';
import type { PlotData } from '@protspace/utils';
import { makeRenderer } from './test-support/renderer-fixture';

const pd: PlotData = {
  length: 2,
  xs: new Float32Array([0, 1]),
  ys: new Float32Array([0, 1]),
  zs: null,
  originalIndices: null,
  proteinIds: ['p0', 'p1'],
};
const config = { width: 800, height: 600 };

describe('WebGLRenderer.createExportScales (facade pass-through, #301/#302)', () => {
  it('returns null before anything has been rendered', () => {
    const { renderer } = makeRenderer({ getConfig: () => config });
    expect(renderer.createExportScales(400, 300)).toBeNull();
  });

  it('after render(), delegates to ExportRenderer.createExportScales with the last-rendered data + live config', () => {
    const { renderer: r } = makeRenderer({ getConfig: () => config });
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
