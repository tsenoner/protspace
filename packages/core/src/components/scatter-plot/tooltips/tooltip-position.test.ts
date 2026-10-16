import { describe, it, expect } from 'vitest';
import {
  computeTooltipStyle,
  computeTouchTooltipStyle,
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

  it('keeps clear of the host chrome along the bottom and top edges', () => {
    // A selection bar covers the bottom 80 px: top = 600 - 80 - 15 - 120 = 385
    const input = { ...base, y: 580, height: 120, viewportHeight: 600 };
    expect(computeTooltipStyle(input, { top: 0, bottom: 80 })).toBe(
      'left: 215px; top: 385px; --protspace-tooltip-effective-width: 350px;',
    );
    expect(computeTooltipStyle({ ...base, y: 30 }, { top: 40, bottom: 0 })).toContain(
      `top: ${40 + TOOLTIP_EDGE_PADDING}px;`,
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
  const pad = TOOLTIP_EDGE_PADDING;
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
        expect(left).toBeGreaterThanOrEqual(pad);
        expect(left + width).toBeLessThanOrEqual(374 - pad);
        expect(top).toBeGreaterThanOrEqual(pad);
        expect(top + phone.height).toBeLessThanOrEqual(400 - pad);
      }
    }
  });

  it('takes a narrower card width it is given, and centres that card on the protein', () => {
    const { left, width } = box(computeTouchTooltipStyle({ ...phone, x: 200, width: 240 }));
    expect(width).toBe(240);
    expect(left + width / 2).toBe(200);
    // Never wider than the room the plot leaves.
    expect(box(computeTouchTooltipStyle({ ...phone, viewportWidth: 200, width: 240 })).width).toBe(
      200 - 2 * pad,
    );
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
    expect(box(computeTouchTooltipStyle({ ...short, y: 160 })).top).toBe(pad);
    expect(box(computeTouchTooltipStyle({ ...short, y: 110 })).top).toBe(250 - 140 - pad);
  });

  it("keeps the card clear of the host's chrome by the insets it is given", () => {
    // A phone: the tool strip covers the plot's left 56 px; the status corner and the selection
    // bar its bottom 90 px.
    const insets = { top: 0, right: 0, bottom: 90, left: 56 };
    for (const x of [2, 20, 187, 372]) {
      for (const y of [2, 20, 150, 300, 398]) {
        const { left, top, width } = box(computeTouchTooltipStyle({ ...phone, x, y }, insets));
        expect(left).toBeGreaterThanOrEqual(56 + pad);
        expect(left + width).toBeLessThanOrEqual(374 - pad);
        expect(top).toBeGreaterThanOrEqual(pad);
        expect(top + phone.height).toBeLessThanOrEqual(400 - 90 - pad);
      }
    }
    // The card narrows to the room the strip leaves.
    expect(box(computeTouchTooltipStyle(phone, insets)).width).toBe(374 - 56 - 2 * pad);
    // A top and a right inset hold the same way.
    const { left, top, width } = box(
      computeTouchTooltipStyle(
        { ...phone, x: 372, y: 2 },
        { top: 40, right: 30, bottom: 0, left: 0 },
      ),
    );
    expect(top).toBeGreaterThanOrEqual(40 + pad);
    expect(left + width).toBeLessThanOrEqual(374 - 30 - pad);
  });

  it('rests the card on the bottom inset when below would end inside it', () => {
    const tall = { ...phone, height: 200 };
    const insets = { top: 0, right: 0, bottom: 62, left: 0 };
    expect(box(computeTouchTooltipStyle({ ...tall, y: 100 }, insets)).top).toBe(100 + 16);
    // Below would end inside the inset (166 + 200 > 400 - 62 - 15): the card rests on it instead.
    expect(box(computeTouchTooltipStyle({ ...tall, y: 150 }, insets)).top).toBe(
      400 - 62 - pad - 200,
    );
  });

  it('caps a card taller than the room between the insets to that room', () => {
    // A phone on its side: a 360 px plot whose bottom 98 px the status corner and the selection
    // bar cover. The room is 360 − 98 − 2 × 15 = 232 px, less than the 400 px card.
    const style = computeTouchTooltipStyle(
      { x: 200, y: 180, height: 400, viewportWidth: 500, viewportHeight: 360 },
      { top: 0, right: 0, bottom: 98, left: 0 },
    );
    expect(style).toContain('top: 15px');
    expect(style).toContain('--protspace-tooltip-max-height: 232px');
  });

  it('never covers the protein in a plot taller than twice the card and its gaps', () => {
    // 400 ≥ 2 × (140 + 16 + 15): above or below always fits.
    for (let y = 0; y <= 400; y += 5) {
      expect(covers(computeTouchTooltipStyle({ ...phone, y }), 187, y, 140)).toBe(false);
    }
  });
});
