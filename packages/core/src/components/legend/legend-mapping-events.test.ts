import { describe, it, expect } from 'vitest';
import {
  isLegendColorMappingDetail,
  isLegendZOrderDetail,
  type LegendColorMappingDetail,
  type LegendZOrderDetail,
} from './legend-mapping-events';

describe('legend-mapping-events guards (INV-07)', () => {
  it('accepts a full color-mapping detail', () => {
    const d: LegendColorMappingDetail = {
      colorMapping: { A: '#ff0000' },
      shapeMapping: { A: 'circle' },
      colorOnly: false,
    };
    expect(isLegendColorMappingDetail(d)).toBe(true);
  });

  it('rejects a color-mapping detail missing shapeMapping', () => {
    expect(isLegendColorMappingDetail({ colorMapping: { A: '#fff' } })).toBe(false);
  });

  it('rejects null / non-object', () => {
    expect(isLegendColorMappingDetail(null)).toBe(false);
    expect(isLegendColorMappingDetail(undefined)).toBe(false);
    expect(isLegendZOrderDetail('nope')).toBe(false);
  });

  it('accepts a full z-order detail', () => {
    const d: LegendZOrderDetail = { zOrderMapping: { A: 0, B: 1 } };
    expect(isLegendZOrderDetail(d)).toBe(true);
  });

  it('rejects a z-order detail with no zOrderMapping', () => {
    expect(isLegendZOrderDetail({})).toBe(false);
  });
});
