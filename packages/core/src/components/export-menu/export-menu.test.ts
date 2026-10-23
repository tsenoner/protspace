import { describe, expect, it } from 'vitest';
import { EXPORT_DEFAULTS } from './export-defaults';

describe('EXPORT_DEFAULTS', () => {
  it('has correct default values', () => {
    expect(EXPORT_DEFAULTS.FORMAT).toBe('png');
    expect(EXPORT_DEFAULTS.IMAGE_WIDTH).toBe(2048);
    expect(EXPORT_DEFAULTS.IMAGE_HEIGHT).toBe(1024);
    expect(EXPORT_DEFAULTS.LEGEND_WIDTH_PERCENT).toBe(20);
    expect(EXPORT_DEFAULTS.LEGEND_FONT_SIZE_PX).toBe(15);
    expect(EXPORT_DEFAULTS.BASE_FONT_SIZE).toBe(24);
    expect(EXPORT_DEFAULTS.MIN_LEGEND_FONT_SIZE_PX).toBe(8);
    expect(EXPORT_DEFAULTS.MAX_LEGEND_FONT_SIZE_PX).toBe(120);
    expect(EXPORT_DEFAULTS.LOCK_ASPECT_RATIO).toBe(true);
  });

  it('defaults INCLUDE_LEGEND to true', () => {
    expect(EXPORT_DEFAULTS.INCLUDE_LEGEND).toBe(true);
  });
});
