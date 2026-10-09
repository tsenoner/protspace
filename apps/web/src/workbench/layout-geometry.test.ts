import { describe, expect, it } from 'vitest';
import {
  clampSidebarToWindow,
  fractionStep,
  plotRightInset,
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
