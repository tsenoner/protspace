import { describe, it, expect } from 'vitest';
import { createDefaultPublishState } from './publish-state';

describe('publish-state', () => {
  describe('createDefaultPublishState', () => {
    it('creates a valid default state', () => {
      const state = createDefaultPublishState();
      expect(state.preset).toBe('flexible');
      expect(state.widthPx).toBe(2048);
      expect(state.heightPx).toBe(1024);
      expect(state.dpi).toBe(300);
      expect(state.format).toBe('png');
      expect(state.background).toBe('white');
      expect(state.overlays).toEqual([]);
      expect(state.insets).toEqual([]);
    });

    it('applies base settings from export options', () => {
      const state = createDefaultPublishState({
        imageWidth: 3000,
        imageHeight: 2000,
        legendWidthPercent: 30,
        legendFontSizePx: 20,
      });
      expect(state.widthPx).toBe(3000);
      expect(state.heightPx).toBe(2000);
      expect(state.legend.widthPercent).toBe(30);
      expect(state.legend.fontSizePx).toBe(20);
    });

    it('defaults legend to visible, right position, multi-column overflow', () => {
      const state = createDefaultPublishState();
      expect(state.legend.visible).toBe(true);
      expect(state.legend.position).toBe('right');
      expect(state.legend.overflow).toBe('multi-column');
      expect(state.legend.columns).toBe(1);
    });

    it('defaults resample to true', () => {
      expect(createDefaultPublishState().resample).toBe(true);
    });

    it('defaults aspectLocked to true', () => {
      expect(createDefaultPublishState().aspectLocked).toBe(true);
    });

    it('defaults unit to mm', () => {
      expect(createDefaultPublishState().unit).toBe('mm');
    });
  });
});

describe('size mode in state', () => {
  it('defaults sizeMode to flexible', () => {
    const state = createDefaultPublishState();
    expect(state.sizeMode).toBe('flexible');
  });
});

describe('legend free position', () => {
  it('defaults legendFreePos to undefined', () => {
    const state = createDefaultPublishState();
    expect(state.legend.freePos).toBeUndefined();
  });
});
