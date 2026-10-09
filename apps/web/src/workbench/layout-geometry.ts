/**
 * Pure geometry of the workbench's sidebar column. Sizes here are shell literals, not tokens
 * (design decision 5); the stored layout's ranges live in explore/layout-defaults.ts.
 */

import {
  LEGEND_FRACTION,
  MIN_PLOT_WIDTH,
  RAIL_WIDTH,
  SIDEBAR_WIDTH,
} from '../explore/layout-defaults';

/** The legend keeps at least this much of the sidebar column's height. */
export const LEGEND_MIN_HEIGHT = 120;
/** The docked structure keeps at least this much, under the divider. */
export const STRUCTURE_MIN_HEIGHT = 220;
/** The divider's height; the legend and the docked structure share the column's height minus it. */
export const DIVIDER_HEIGHT = 9;
/** One arrow key moves the divider by this share of the column; Shift moves four times as far. */
const FRACTION_STEP = 0.05;

/**
 * How `height` px of the sidebar column (the divider's own height left out) split between the
 * legend and the docked structure for the legend's `fraction`: the fraction's share, with the
 * legend at least 120 px and the structure at least 220 px. When the column cannot hold both, the
 * legend gets 120 px (or all of it) and the structure the rest. workbench.css computes the same
 * clamp for `--wb-legend-height`; the divider uses this one to store what it shows.
 */
export function splitSidebar(
  height: number,
  fraction: number,
): { legend: number; structure: number } {
  const total = Math.max(0, height);
  const legend =
    total < LEGEND_MIN_HEIGHT + STRUCTURE_MIN_HEIGHT
      ? Math.min(LEGEND_MIN_HEIGHT, total)
      : Math.min(Math.max(total * fraction, LEGEND_MIN_HEIGHT), total - STRUCTURE_MIN_HEIGHT);
  return { legend, structure: total - legend };
}

/**
 * The legend fraction a column `columnHeight` px tall shows for a requested one: within the stored
 * range, then within splitSidebar's pixel minimums at this height, so what the divider stores is
 * what the user saw.
 */
export function clampLegendFraction(requested: number, columnHeight: number): number {
  const fraction = Math.min(LEGEND_FRACTION.max, Math.max(LEGEND_FRACTION.min, requested));
  const available = columnHeight - DIVIDER_HEIGHT;
  if (available <= 0) return fraction;
  return splitSidebar(available, fraction).legend / available;
}

/** The divider's step for a key: ArrowUp gives the legend 5 % less, ArrowDown 5 % more; 0 otherwise. */
export function fractionStep(key: string, shift: boolean): number {
  const step = shift ? 4 * FRACTION_STEP : FRACTION_STEP;
  if (key === 'ArrowUp') return -step;
  if (key === 'ArrowDown') return step;
  return 0;
}

/** One arrow key moves the sidebar edge this many pixels; Shift moves four times as far. */
const WIDTH_STEP = 16;

/**
 * The sidebar width to render in a window this wide: the stored width, narrowed so the plot keeps
 * 480 px beside the sidebar and the 44 px rail, but never below the sidebar's 240 px minimum.
 * Render only: the store keeps the user's width for a wider window.
 */
export function clampSidebarToWindow(width: number, windowWidth: number): number {
  return Math.min(width, Math.max(SIDEBAR_WIDTH.min, windowWidth - RAIL_WIDTH - MIN_PLOT_WIDTH));
}

/** A sidebar width in whole pixels, within 240 px and `maxWidth` (the window's cap, at most 480). */
export function clampSidebarWidth(value: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(SIDEBAR_WIDTH.min, Math.round(value)));
}

/**
 * The width the sidebar edge's keys ask for (the WAI-ARIA window splitter): ArrowLeft widens the
 * sidebar by 16 px and ArrowRight narrows it, four times as far with Shift; Home and End go to 240
 * and 480 px. Other keys keep `width`. The result stays within 240–480.
 */
export function sidebarStep(key: string, shift: boolean, width: number): number {
  const step = shift ? 4 * WIDTH_STEP : WIDTH_STEP;
  let next = width;
  if (key === 'ArrowLeft') next = width + step;
  else if (key === 'ArrowRight') next = width - step;
  else if (key === 'Home') next = SIDEBAR_WIDTH.min;
  else if (key === 'End') next = SIDEBAR_WIDTH.max;
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, next));
}

/** Where the sidebar is in its slide: settled open or collapsed, or sliding either way. */
export type SidebarPhase = 'open' | 'opening' | 'closing' | 'collapsed';

/**
 * The plot's right inset: the sidebar and the rail while open, the rail alone otherwise. Opening
 * slides the sidebar over the plot and narrows the plot only once it is open; closing widens the
 * plot at once, under the sliding sidebar. Either way the plot's box changes once (decision 4).
 */
export function plotRightInset(phase: SidebarPhase, width: number): number {
  return phase === 'open' ? width + RAIL_WIDTH : RAIL_WIDTH;
}
