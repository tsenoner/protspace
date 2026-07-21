import { describe, it, expect } from 'vitest';
import {
  computeTooltipStyle,
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
