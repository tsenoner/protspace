/**
 * Shared DuplicateStackOverlayController fixture for the controller suites, so
 * the capture and enable-gate tests build the controller over the same live
 * geometry and deps instead of maintaining copies that can drift apart.
 */
import { vi } from 'vitest';
import * as d3 from 'd3';
import type { PlotData } from '@protspace/utils';
import { DuplicateStackOverlayController } from '../duplicate-stack-overlay-controller';
import { PointGridIndex } from '../../interaction/point-grid-index';
import { tenPointPD } from './plot-data-fixtures';

type OverlayGroup = d3.Selection<SVGGElement, unknown, null, undefined>;

export function makeControllerFixture(
  opts: {
    isEnabled?: () => boolean;
    pd?: PlotData;
    visibleSlots?: number[] | null;
    overlayGroup?: OverlayGroup;
  } = {},
) {
  const pd = opts.pd ?? tenPointPD();
  const visibleSlots =
    opts.visibleSlots === undefined
      ? Array.from({ length: pd.length }, (_, i) => i)
      : opts.visibleSlots;
  // Identity-ish live scales: data [0,100] → base pixels [0,100].
  const scales = {
    x: d3.scaleLinear().domain([0, 100]).range([0, 100]),
    y: d3.scaleLinear().domain([0, 100]).range([0, 100]),
  };
  const pointIndex = new PointGridIndex();
  pointIndex.setScales(scales);
  if (visibleSlots) pointIndex.rebuild(pd, visibleSlots);
  const config = {
    width: 800,
    height: 600,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
  };
  const deps = {
    getOverlayGroup: () => opts.overlayGroup ?? null,
    getBadgesCanvas: () => undefined,
    getTransform: () => d3.zoomIdentity,
    getConfig: () => config,
    getScales: () => scales,
    getPlotData: () => pd,
    getPointGridIndex: () => pointIndex,
    getVisibleSlots: vi.fn(() => visibleSlots),
    isEnabled: opts.isEnabled ?? (() => true),
    isSelectionMode: () => false,
    getColor: () => '#000000',
    onPointActivate: () => {},
    onHover: () => {},
    onHoverEnd: () => {},
  };
  const controller = new DuplicateStackOverlayController(
    deps as unknown as ConstructorParameters<typeof DuplicateStackOverlayController>[0],
  );
  return { controller, deps, pd };
}
