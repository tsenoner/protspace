import { describe, it, expect } from 'vitest';
import { computeViewportWindow, buildViewKey } from './duplicate-stack-viewport';
import { zoomIdentity } from 'd3';

const config = { width: 800, height: 600, margin: { top: 10, right: 20, bottom: 30, left: 40 } };

describe('computeViewportWindow', () => {
  it('matches the inline invertX/invertY + min/max math at identity transform', () => {
    const padding = 60;
    const t = zoomIdentity; // x=0,y=0,k=1 → invertX(v)=v, invertY(v)=v
    const w = computeViewportWindow(t, config, padding);
    // left = margin.left - padding = -20 ; right = width - margin.right + padding = 840
    // top = margin.top - padding = -50 ; bottom = height - margin.bottom + padding = 630
    expect(w).toEqual({ minX: -20, maxX: 840, minY: -50, maxY: 630 });
  });

  it('inverts the zoom transform (k=2, translate 100/50) and orders min<=max', () => {
    const padding = 100;
    const t = zoomIdentity.translate(100, 50).scale(2); // invertX(v)=(v-100)/2
    const w = computeViewportWindow(t, config, padding);
    expect(w.minX).toBeLessThanOrEqual(w.maxX);
    expect(w.minY).toBeLessThanOrEqual(w.maxY);
    expect(w.minX).toBeCloseTo((config.margin.left - padding - 100) / 2, 6);
    expect(w.maxX).toBeCloseTo((config.width - config.margin.right + padding - 100) / 2, 6);
  });

  it('respects the padding parameter (larger padding ⇒ wider window)', () => {
    const a = computeViewportWindow(zoomIdentity, config, 60);
    const b = computeViewportWindow(zoomIdentity, config, 100);
    expect(b.minX).toBeLessThan(a.minX);
    expect(b.maxX).toBeGreaterThan(a.maxX);
  });
});

describe('buildViewKey', () => {
  it('matches the exact `${round(x)}|${round(y)}|${k.toFixed(3)}|${w}|${h}` template', () => {
    const t = zoomIdentity.translate(12.4, -7.6).scale(1.5);
    expect(buildViewKey(t, 800, 600)).toBe('12|-8|1.500|800|600');
  });

  it('rounds translate but fixes k to 3 decimals so sub-pixel pans reuse the cache', () => {
    const a = buildViewKey(zoomIdentity.translate(0.2, 0.2).scale(1), 800, 600);
    const b = buildViewKey(zoomIdentity.translate(-0.2, -0.2).scale(1), 800, 600);
    expect(a).toBe(b); // both round to 0|0
  });
});
