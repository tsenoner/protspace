/**
 * Pure geometry of the workbench's sidebar column. Sizes here are shell literals, not tokens
 * (design decision 5); the stored layout's ranges live in explore/layout-defaults.ts.
 */

/** The legend keeps at least this much of the sidebar column's height. */
const LEGEND_MIN_HEIGHT = 120;
/** The docked structure keeps at least this much, under the divider. */
const STRUCTURE_MIN_HEIGHT = 220;
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

/** The divider's step for a key: ArrowUp gives the legend 5 % less, ArrowDown 5 % more; 0 otherwise. */
export function fractionStep(key: string, shift: boolean): number {
  const step = shift ? 4 * FRACTION_STEP : FRACTION_STEP;
  if (key === 'ArrowUp') return -step;
  if (key === 'ArrowDown') return step;
  return 0;
}
