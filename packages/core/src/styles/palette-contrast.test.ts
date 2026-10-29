import { COLOR_SCHEMES } from '@protspace/utils';
import { describe, expect, it } from 'vitest';
import { contrast, tokensOf } from '../test-support/contrast';

/**
 * Design decision 16: category palettes do not change in dark; the defaults must still read on
 * the dark plot background. Kelly's 21 colours are the default and need 2:1 (it trades contrast for
 * count); the other categorical palettes 3:1 (WCAG 1.4.11 for graphics). Gradients are out of
 * scope: their dark stops are meant to sink.
 */
const PLOT_BG = tokensOf(":root[data-theme='dark']").get('--ps-plot-bg')!;

const GATES = {
  kellys: 2,
  okabeIto: 3,
  tolBright: 3,
  set2: 3,
  dark2: 3,
  tableau10: 3,
} as const;
type Gated = keyof typeof GATES;

/**
 * Colours below their gate, kept because a palette is a published standard. On the dark plot the
 * point shader gives a point below 2:1 against the background a light rim instead of the darkened
 * one (point-shaders.ts), so these near-black colours stay bounded and visible; light mode and
 * exports keep the darkened rim. Pinned in scatter-plot.theme.browser.test.ts.
 * Only shrinks: the last test fails while a listed colour passes.
 */
const ALLOWED: Record<Gated, readonly string[]> = {
  kellys: ['#2B3D26', '#222222'], // Dark Olive Green 1.6:1, Very Dark Gray 1.2:1
  okabeIto: ['#000000'], // 1.1:1
  tolBright: [],
  set2: [],
  dark2: [],
  tableau10: [],
};

/** The palette's colours below its gate on the dark plot background, in palette order. */
const below = (id: Gated): string[] =>
  (COLOR_SCHEMES[id] as readonly string[]).filter(
    (colour) => contrast(colour, PLOT_BG) < GATES[id],
  );

describe('default palettes on the dark plot background', () => {
  it('the dark plot background is #0b1120', () => {
    expect(PLOT_BG).toBe('#0b1120');
  });

  it("Kelly's colours reach 2:1 on the dark plot background, except the allow-listed #2B3D26 and #222222", () => {
    expect(below('kellys')).toEqual([...ALLOWED.kellys]);
  });

  it.each(['okabeIto', 'tolBright', 'set2', 'dark2', 'tableau10'] as const)(
    "Okabe-Ito, Tol Bright, Set2, Dark2 and Tableau 10 reach 3:1, except Okabe-Ito's #000000 (%s)",
    (id) => {
      expect(below(id)).toEqual([...ALLOWED[id]]);
    },
  );

  it('every allow-listed colour is really below its gate', () => {
    for (const id of Object.keys(ALLOWED) as Gated[])
      for (const colour of ALLOWED[id]) {
        expect(COLOR_SCHEMES[id] as readonly string[], `${colour} is in ${id}`).toContain(colour);
        expect(contrast(colour, PLOT_BG), `${id} ${colour}`).toBeLessThan(GATES[id]);
      }
  });
});
