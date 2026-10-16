import { describe, expect, it } from 'vitest';
import {
  clampFloatRect,
  clampLegendFraction,
  clampSidebarToWindow,
  clampSidebarWidth,
  floatStep,
  fractionStep,
  moveFloatRect,
  plotRightInset,
  resizeFloatRect,
  sidebarStep,
  splitSidebar,
} from './layout-geometry';

describe('splitSidebar', () => {
  it('splitSidebar honours the fraction within the 120 and 220 px minimums', () => {
    expect(splitSidebar(600, 0.5)).toEqual({ legend: 300, structure: 300 });
    expect(splitSidebar(600, 0.1)).toEqual({ legend: 120, structure: 480 });
    expect(splitSidebar(600, 0.8)).toEqual({ legend: 380, structure: 220 });
  });

  it('a short sidebar keeps the legend at its minimum', () => {
    expect(splitSidebar(300, 0.5)).toEqual({ legend: 120, structure: 180 });
    expect(splitSidebar(300, 0.8)).toEqual({ legend: 120, structure: 180 });
    expect(splitSidebar(80, 0.5)).toEqual({ legend: 80, structure: 0 });
  });
});

describe('clampLegendFraction', () => {
  it('clampLegendFraction keeps the stored range and the pixel minimums under the 9 px divider', () => {
    // 509 px leaves 500 under the divider: the structure keeps 220, so the legend at most 280.
    expect(clampLegendFraction(0.9, 509)).toBeCloseTo(280 / 500, 10);
    expect(clampLegendFraction(0.5, 509)).toBeCloseTo(0.5, 10);
    // The legend keeps 120 px.
    expect(clampLegendFraction(0.2, 509)).toBeCloseTo(120 / 500, 10);
    // Within the stored 0.2–0.8 when the column has no height yet.
    expect(clampLegendFraction(0.9, 0)).toBe(0.8);
    expect(clampLegendFraction(0.1, 9)).toBe(0.2);
  });
});

describe('clampSidebarWidth', () => {
  it('clampSidebarWidth rounds and keeps 240 up to the cap', () => {
    expect(clampSidebarWidth(500, 427)).toBe(427);
    expect(clampSidebarWidth(300.4, 480)).toBe(300);
    expect(clampSidebarWidth(100, 480)).toBe(240);
  });
});

describe('fractionStep', () => {
  it('fractionStep moves 5 %, or 20 % with Shift', () => {
    expect(fractionStep('ArrowUp', false)).toBeCloseTo(-0.05, 10);
    expect(fractionStep('ArrowDown', false)).toBeCloseTo(0.05, 10);
    expect(fractionStep('ArrowUp', true)).toBeCloseTo(-0.2, 10);
    expect(fractionStep('ArrowDown', true)).toBeCloseTo(0.2, 10);
    expect(fractionStep('ArrowLeft', false)).toBe(0);
    expect(fractionStep('Enter', true)).toBe(0);
  });
});

describe('clampSidebarToWindow', () => {
  it('clampSidebarToWindow keeps the plot at 480 px', () => {
    expect(clampSidebarToWindow(300, 1280)).toBe(300);
    expect(clampSidebarToWindow(480, 1280)).toBe(480);
    // 1000 − 44 (rail) − 480 (plot) leaves the sidebar 476 px.
    expect(clampSidebarToWindow(480, 1000)).toBe(476);
    expect(clampSidebarToWindow(300, 951)).toBe(300);
    expect(clampSidebarToWindow(480, 951)).toBe(427);
    // Narrower still, the sidebar keeps its own 240 px minimum.
    expect(clampSidebarToWindow(300, 700)).toBe(240);
  });
});

describe('sidebarStep', () => {
  it('sidebarStep handles arrows, Shift, Home and End within 240–480', () => {
    expect(sidebarStep('ArrowLeft', false, 300)).toBe(316);
    expect(sidebarStep('ArrowRight', false, 300)).toBe(284);
    expect(sidebarStep('ArrowLeft', true, 300)).toBe(364);
    expect(sidebarStep('ArrowRight', true, 300)).toBe(240);
    expect(sidebarStep('ArrowLeft', false, 476)).toBe(480);
    expect(sidebarStep('Home', false, 300)).toBe(240);
    expect(sidebarStep('End', true, 300)).toBe(480);
    expect(sidebarStep('Tab', false, 300)).toBe(300);
  });
});

describe('plotRightInset', () => {
  it('plotRightInset moves the plot once per toggle', () => {
    expect(plotRightInset('open', 300)).toBe(344);
    // Closing widens the plot at once, under the sidebar that is still sliding out.
    expect(plotRightInset('closing', 300)).toBe(44);
    expect(plotRightInset('collapsed', 300)).toBe(44);
    // Opening slides the sidebar in over the plot; the plot narrows only once it is open.
    expect(plotRightInset('opening', 300)).toBe(44);
  });
});

describe('clampFloatRect', () => {
  // The plot area at 1280 × 720 with the sidebar open: 1280 − 300 − 44 by 720 − 48 − 44.
  const area = { width: 936, height: 628 };

  it('clampFloatRect defaults above the selection bar', () => {
    // 14 px from the right edge; 64 px from the bottom, clear of the bar's 12 px offset and
    // 38 px height (Copy IDs and Clear stay clickable).
    expect(clampFloatRect(null, area)).toEqual({ x: 582, y: 204, width: 340, height: 360 });
  });

  it('a stored card keeps its place', () => {
    // Only the default moved: a card the user placed low over the bar stays there.
    const low = { x: 582, y: 254, width: 340, height: 360 };
    expect(clampFloatRect(low, area)).toEqual(low);
  });

  it('on a plot too short for the card above the bar, the default sits at the top', () => {
    expect(clampFloatRect(null, { width: 936, height: 400 })).toEqual({
      x: 582,
      y: 0,
      width: 340,
      height: 360,
    });
  });

  it('keeps a card inside a plot that shrank', () => {
    const card = { x: 500, y: 200, width: 340, height: 360 };
    expect(clampFloatRect(card, area)).toEqual(card);
    expect(clampFloatRect(card, { width: 656, height: 508 })).toEqual({
      x: 316,
      y: 148,
      width: 340,
      height: 360,
    });
    expect(clampFloatRect({ ...card, x: 5000, y: -300 }, area)).toEqual({
      x: 596,
      y: 0,
      width: 340,
      height: 360,
    });
  });

  it('enforces the 280 × 240 minimum', () => {
    expect(clampFloatRect({ x: 10, y: 10, width: 100, height: 50 }, area)).toEqual({
      x: 10,
      y: 10,
      width: 280,
      height: 240,
    });
    // A plot area smaller than the minimum: the card fills it.
    expect(clampFloatRect(null, { width: 250, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 200,
    });
  });
});

describe('floatStep', () => {
  it('floatStep moves 16 px, or 64 px with Shift', () => {
    expect(floatStep('ArrowLeft', false)).toEqual({ dx: -16, dy: 0 });
    expect(floatStep('ArrowDown', false)).toEqual({ dx: 0, dy: 16 });
    expect(floatStep('ArrowUp', true)).toEqual({ dx: 0, dy: -64 });
    expect(floatStep('ArrowRight', true)).toEqual({ dx: 64, dy: 0 });
    expect(floatStep('Enter', false)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('moveFloatRect and resizeFloatRect', () => {
  const area = { width: 936, height: 628 };
  const card = { x: 500, y: 200, width: 340, height: 360 };

  it('moveFloatRect moves the card and keeps it inside the plot area', () => {
    expect(moveFloatRect(card, -16, 64, area)).toEqual({ ...card, x: 484, y: 264 });
    expect(moveFloatRect(card, -1000, 0, area)).toEqual({ ...card, x: 0 });
    expect(moveFloatRect(card, 1000, 1000, area)).toEqual({ ...card, x: 596, y: 268 });
  });

  it('resizeFloatRect keeps the top-left corner and stops at the plot area', () => {
    expect(resizeFloatRect(card, 200, 200, area)).toEqual({
      x: 500,
      y: 200,
      width: 436,
      height: 428,
    });
    expect(resizeFloatRect(card, 16, -16, area)).toEqual({ ...card, width: 356, height: 344 });
    // The 280 × 240 minimum holds when shrinking.
    expect(resizeFloatRect(card, -1000, -1000, area)).toEqual({ ...card, width: 280, height: 240 });
  });
});
