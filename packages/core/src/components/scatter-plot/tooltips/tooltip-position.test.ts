import { describe, it, expect } from 'vitest';
import {
  computeTooltipStyle,
  computeTouchTooltipStyle,
  TOUCH_TOOLTIP_BOTTOM_RESERVE,
  TOOLTIP_EDGE_PADDING,
  TOOLTIP_MAX_WIDTH,
  TOOLTIP_ANCHOR_OFFSET_X,
  TOOLTIP_ANCHOR_OFFSET_Y,
  TOOLTIP_FALLBACK_HEIGHT,
  effectiveTooltipWidth,
  type TooltipStyleInput,
} from './tooltip-position';

const base: TooltipStyleInput = {
  x: 200,
  y: 200,
  height: 120, // measured/estimated tooltip height
  viewportWidth: 800,
  viewportHeight: 600,
};

describe('computeTooltipStyle', () => {
  it('places the tooltip to the lower-right of the cursor in the open interior', () => {
    // left = x + ANCHOR_OFFSET_X (no flip); top = y - ANCHOR_OFFSET_Y (no clamp)
    expect(computeTooltipStyle(base)).toBe(
      'left: 215px; top: 140px; --protspace-tooltip-effective-width: 350px;',
    );
  });

  it('flips to the left side (translateX(-100%)) when it would overflow the right edge', () => {
    // x + ANCHOR_OFFSET_X + MAX_WIDTH > viewportWidth → flip
    const input = { ...base, x: 700, viewportWidth: 800 };
    // left = x - ANCHOR_OFFSET_X = 685; transform appended
    expect(computeTooltipStyle(input)).toBe(
      'left: 685px; top: 140px; --protspace-tooltip-effective-width: 350px; transform: translateX(-100%);',
    );
  });

  it('clamps the left edge to padding when the un-flipped anchor goes off the left', () => {
    // not flipped, left = x + ANCHOR_OFFSET_X < EDGE_PADDING → left = EDGE_PADDING
    const input = { ...base, x: -100 };
    expect(computeTooltipStyle(input)).toBe(
      `left: ${TOOLTIP_EDGE_PADDING}px; top: 140px; --protspace-tooltip-effective-width: 350px;`,
    );
  });

  it('clamps the flipped tooltip so its left edge stays on-screen', () => {
    // flipped AND left - MAX_WIDTH < EDGE_PADDING → left = MAX_WIDTH + EDGE_PADDING
    const input = { ...base, x: 360, viewportWidth: 360 };
    expect(computeTooltipStyle(input)).toBe(
      'left: 345px; top: 140px; --protspace-tooltip-effective-width: 330px; transform: translateX(-100%);',
    );
  });

  it('lifts the top up when the tooltip would run off the bottom edge', () => {
    // top + height > viewportHeight - padding → top = viewportHeight - height - padding
    const input = { ...base, y: 580, height: 120, viewportHeight: 600 };
    // top = 600 - 120 - 15 = 465
    expect(computeTooltipStyle(input)).toBe(
      'left: 215px; top: 465px; --protspace-tooltip-effective-width: 350px;',
    );
  });

  it('clamps the top down to padding when the cursor is near the top edge', () => {
    const input = { ...base, y: 30 }; // y - 60 = -30 < padding
    expect(computeTooltipStyle(input)).toBe(
      `left: 215px; top: ${TOOLTIP_EDGE_PADDING}px; --protspace-tooltip-effective-width: 350px;`,
    );
  });

  it('uses the responsive border-box width for 320 and 360 px viewports', () => {
    expect(effectiveTooltipWidth(320)).toBe(290);
    expect(effectiveTooltipWidth(360)).toBe(330);
    expect(computeTooltipStyle({ ...base, x: 300, viewportWidth: 320 })).toContain(
      'left: 305px; top: 140px; --protspace-tooltip-effective-width: 290px;',
    );
  });

  it('exposes the calibrated constants used by the component', () => {
    expect(TOOLTIP_EDGE_PADDING).toBe(15);
    expect(TOOLTIP_MAX_WIDTH).toBe(350);
    expect(TOOLTIP_ANCHOR_OFFSET_X).toBe(15);
    expect(TOOLTIP_ANCHOR_OFFSET_Y).toBe(60);
    expect(TOOLTIP_FALLBACK_HEIGHT).toBe(160);
  });
});

describe('computeTouchTooltipStyle', () => {
  // A phone plot, 374 × 400: the card is effectiveTooltipWidth(374) = 344 px wide.
  const phone: TooltipStyleInput = {
    x: 187,
    y: 300,
    height: 140,
    viewportWidth: 374,
    viewportHeight: 400,
  };
  const box = (style: string) => {
    const num = (name: string) => Number(new RegExp(`${name}: (-?[\\d.]+)px`).exec(style)![1]);
    return {
      left: num('left'),
      top: num('top'),
      width: num('--protspace-tooltip-effective-width'),
    };
  };
  const covers = (style: string, x: number, y: number, height: number) => {
    const b = box(style);
    return x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + height;
  };

  it('uses the hover tooltip width', () => {
    expect(box(computeTouchTooltipStyle(phone)).width).toBe(effectiveTooltipWidth(374));
  });

  it('keeps the card inside the plot for a tap near each edge', () => {
    for (const x of [2, 187, 372]) {
      for (const y of [2, 20, 200, 390, 398]) {
        const { left, top, width } = box(computeTouchTooltipStyle({ ...phone, x, y }));
        expect(left).toBeGreaterThanOrEqual(TOOLTIP_EDGE_PADDING);
        expect(left + width).toBeLessThanOrEqual(374 - TOOLTIP_EDGE_PADDING);
        expect(top).toBeGreaterThanOrEqual(TOOLTIP_EDGE_PADDING);
        expect(top + phone.height).toBeLessThanOrEqual(400 - TOUCH_TOOLTIP_BOTTOM_RESERVE);
      }
    }
  });

  it('centres the card on the protein when the plot has room', () => {
    const wide = { ...phone, x: 400, viewportWidth: 800 };
    const { left, width } = box(computeTouchTooltipStyle(wide));
    expect(left + width / 2).toBe(400);
  });

  it('places the card above the protein, clear of the finger, when it fits', () => {
    expect(box(computeTouchTooltipStyle(phone)).top).toBe(300 - 16 - 140);
  });

  it('places the card below the protein when there is no room above', () => {
    expect(box(computeTouchTooltipStyle({ ...phone, y: 60 })).top).toBe(60 + 16);
  });

  it('puts the card against the plot edge farther from the protein when neither side fits', () => {
    const short = { ...phone, viewportHeight: 250 };
    expect(box(computeTouchTooltipStyle({ ...short, y: 160 })).top).toBe(TOOLTIP_EDGE_PADDING);
    expect(box(computeTouchTooltipStyle({ ...short, y: 60 })).top).toBe(
      250 - 140 - TOUCH_TOOLTIP_BOTTOM_RESERVE,
    );
  });

  it('keeps the card clear of the selection bar a tap shows at the plot bottom', () => {
    // A tap selects its protein, so the bar (50 px under a coarse pointer, 12 px up) shows too.
    expect(TOUCH_TOOLTIP_BOTTOM_RESERVE).toBe(62);
    const tall = { ...phone, height: 200 };
    expect(box(computeTouchTooltipStyle({ ...tall, y: 100 })).top).toBe(100 + 16);
    // Below would end in the bar's strip (166 + 200 > 338): the card rests on the strip instead.
    expect(box(computeTouchTooltipStyle({ ...tall, y: 150 })).top).toBe(
      400 - 200 - TOUCH_TOOLTIP_BOTTOM_RESERVE,
    );
  });

  it('never covers the protein in a plot taller than twice the card and its gaps', () => {
    // 400 ≥ 2 × (140 + 16 + 15): above or below always fits.
    for (let y = 0; y <= 400; y += 5) {
      expect(covers(computeTouchTooltipStyle({ ...phone, y }), 187, y, 140)).toBe(false);
    }
  });
});
