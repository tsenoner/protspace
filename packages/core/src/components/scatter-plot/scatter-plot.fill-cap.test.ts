/**
 * @vitest-environment jsdom
 *
 * A `fillMaxWidth` cap at or above the plot's width caps nothing, so moving it between such values
 * must not render or rebuild the point index: the app moves the cap with the window and the
 * sidebar, and each move used to cost a second render behind the plot's own resize render.
 *
 * The element is never appended; the config merge and the render decision are called directly.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createPlot, fakeFrames, type PlotInternals } from './test-support/plot-fixture';

describe('fillMaxWidth: a cap that reaches no edge draws nothing', () => {
  let sp: PlotInternals;
  let requestRender: ReturnType<typeof vi.fn>;
  let scheduleRebuild: ReturnType<typeof vi.fn>;

  /** Sets `config` and runs the two steps of the update that decide what it costs. */
  const setConfig = (config: PlotInternals['config']) => {
    const previous = sp.config;
    sp.config = config;
    const changed = new Map<string, unknown>([['config', previous]]);
    sp._reconcileConfigMerge(changed);
    sp._reconcileSelectionOverlays(changed);
  };

  beforeEach(() => {
    fakeFrames();
    sp = createPlot();
    setConfig({ width: 800, height: 600, fillPlot: true });
    requestRender = vi.fn();
    sp._renderLoop.request = requestRender;
    scheduleRebuild = vi.fn();
    sp._pointGrid.scheduleRebuild = scheduleRebuild;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('neither renders nor rebuilds when the cap moves between values at or above the width', () => {
    setConfig({ width: 800, height: 600, fillPlot: true, fillMaxWidth: 800 });
    setConfig({ width: 800, height: 600, fillPlot: true, fillMaxWidth: 1200 });
    setConfig({ width: 800, height: 600, fillPlot: true, fillMaxWidth: undefined });

    expect(requestRender).not.toHaveBeenCalled();
    expect(scheduleRebuild).not.toHaveBeenCalled();
  });

  it('renders and rebuilds when the cap comes below the width', () => {
    setConfig({ width: 800, height: 600, fillPlot: true, fillMaxWidth: 600 });

    expect(requestRender).toHaveBeenCalled();
    expect(scheduleRebuild).toHaveBeenCalled();
  });

  it('renders when another key changes with the cap', () => {
    setConfig({ width: 800, height: 600, fillPlot: true, fillMaxWidth: 1200, pointSize: 30 });

    expect(requestRender).toHaveBeenCalled();
  });
});
