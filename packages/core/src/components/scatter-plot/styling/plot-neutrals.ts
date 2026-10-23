import { NA_DEFAULT_COLOR } from '@protspace/utils';
import { NEUTRAL_VALUE_COLOR } from '../config';

/**
 * The greys the plot draws neutral points with: Other values, and N/A values whose colour is the
 * default `NA_DEFAULT_COLOR`. The live view takes them from the theme; an export always uses
 * the light ones, so a figure is the same in both themes.
 */
export interface PlotNeutrals {
  readonly other: string;
  readonly na: string;
}

/** The light greys, which are also the data's own colours for Other and N/A. */
export const LIGHT_NEUTRALS: PlotNeutrals = Object.freeze({
  other: NEUTRAL_VALUE_COLOR,
  na: NA_DEFAULT_COLOR,
});

const sameColor = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether two sets of greys draw the same colours (compared trimmed, ignoring letter case). */
export function sameNeutrals(a: PlotNeutrals, b: PlotNeutrals): boolean {
  return a === b || (sameColor(a.other, b.other) && sameColor(a.na, b.na));
}
