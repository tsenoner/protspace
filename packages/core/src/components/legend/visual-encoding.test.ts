import { describe, it, expect, beforeEach } from 'vitest';
import { getVisualEncoding, SlotTracker, SPECIAL_SLOTS } from './visual-encoding';

describe('visual-encoding', () => {
  describe('getVisualEncoding', () => {
    it('returns special color for Other category', () => {
      const encoding = getVisualEncoding(0, 'Other');
      expect(encoding.color).toBe('#999999');
      expect(encoding.shape).toBe('circle');
    });

    it('treats "N/A" display name like a regular category in slot assignment', () => {
      const encoding = getVisualEncoding(1, 'N/A');
      // NA no longer has special color logic in getVisualEncoding;
      // the legend processor handles the NA_DEFAULT_COLOR override.
      expect(encoding.color).not.toBe('#DDDDDD');
      // Default shape is always circle.
      expect(encoding.shape).toBe('circle');
    });

    it('cycles through colors for regular categories', () => {
      const encoding0 = getVisualEncoding(0);
      const encoding1 = getVisualEncoding(1);
      expect(encoding0.color).not.toBe(encoding1.color);
    });

    it('always uses circle as the default shape', () => {
      for (let i = 0; i < 6; i++) {
        expect(getVisualEncoding(i).shape).toBe('circle');
      }
    });

    it('wraps around colors after palette exhausted', () => {
      const colors: string[] = [];
      for (let i = 0; i < 50; i++) {
        colors.push(getVisualEncoding(i).color);
      }
      const firstColor = colors[0];
      const repeatIndex = colors.findIndex((c, i) => i > 0 && c === firstColor);
      expect(repeatIndex).toBeGreaterThan(0);
    });
  });

  describe('SlotTracker', () => {
    let tracker: SlotTracker;

    beforeEach(() => {
      tracker = new SlotTracker();
    });

    describe('getSlot', () => {
      it('returns special slot for Other and regular slot for N/A', () => {
        expect(tracker.getSlot('Other')).toBe(SPECIAL_SLOTS.OTHER);
        expect(tracker.getSlot('N/A')).toBe(0);
      });

      it('assigns incrementing slots to new categories', () => {
        expect(tracker.getSlot('category1')).toBe(0);
        expect(tracker.getSlot('category2')).toBe(1);
        expect(tracker.getSlot('category3')).toBe(2);
      });

      it('returns same slot for same category', () => {
        const slot1 = tracker.getSlot('category1');
        const slot2 = tracker.getSlot('category1');
        expect(slot1).toBe(slot2);
      });

      it('reuses freed slots', () => {
        tracker.getSlot('category1'); // slot 0
        tracker.getSlot('category2'); // slot 1
        tracker.freeSlot('category1');
        expect(tracker.getSlot('category3')).toBe(0); // reuses slot 0
      });
    });

    describe('freeSlot', () => {
      it('does not free Other but frees N/A like a regular category', () => {
        tracker.getSlot('N/A'); // slot 0
        tracker.freeSlot('Other');
        tracker.freeSlot('N/A');
        expect(tracker.getSlot('newCategory')).toBe(0);
      });

      it('maintains sorted order of freed slots', () => {
        tracker.getSlot('a'); // 0
        tracker.getSlot('b'); // 1
        tracker.getSlot('c'); // 2
        tracker.freeSlot('c'); // free 2
        tracker.freeSlot('a'); // free 0
        expect(tracker.getSlot('new1')).toBe(0);
        expect(tracker.getSlot('new2')).toBe(2);
      });
    });

    describe('reassignSlots', () => {
      it('assigns slots in order to visible categories', () => {
        tracker.reassignSlots(['cat1', 'cat2', 'cat3']);
        expect(tracker.getSlot('cat1')).toBe(0);
        expect(tracker.getSlot('cat2')).toBe(1);
        expect(tracker.getSlot('cat3')).toBe(2);
      });

      it('ignores only Other during reassignment', () => {
        tracker.reassignSlots(['cat1', 'Other', 'N/A']);
        expect(tracker.getSlot('cat1')).toBe(0);
        expect(tracker.getSlot('Other')).toBe(SPECIAL_SLOTS.OTHER);
        expect(tracker.getSlot('N/A')).toBe(1);
      });
    });

    describe('reset', () => {
      it('clears all assigned slots', () => {
        tracker.getSlot('category1');
        tracker.getSlot('category2');
        tracker.reset();
        expect(tracker.isEmpty()).toBe(true);
        expect(tracker.getSlot('newCategory')).toBe(0);
      });
    });

    describe('isEmpty', () => {
      it('returns true for new tracker', () => {
        expect(tracker.isEmpty()).toBe(true);
      });

      it('returns false after assigning a slot', () => {
        tracker.getSlot('category1');
        expect(tracker.isEmpty()).toBe(false);
      });

      it('returns true when only Other is requested', () => {
        tracker.getSlot('Other');
        expect(tracker.isEmpty()).toBe(true);
      });

      it('returns false when N/A is requested', () => {
        tracker.getSlot('N/A');
        expect(tracker.isEmpty()).toBe(false);
      });
    });
  });
});
