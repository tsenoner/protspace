import { describe, expect, it } from 'vitest';
import { pickerStyle, placePicker } from './picker-placement';

const trigger = (top: number, left = 20, height = 28) => ({
  top,
  bottom: top + height,
  left,
});

describe('placePicker', () => {
  it('opens below a trigger with room under it', () => {
    const p = placePicker(trigger(100), { width: 1200, height: 900 });
    expect(p).toEqual({ top: 132, left: 20, room: 320 });
  });

  it('opens above a trigger near the bottom of a phone, capped to the room there', () => {
    const p = placePicker(trigger(517), { width: 375, height: 667 });
    // 667 − 545 − 4 − 8 = 110 below; 517 − 4 − 8 = 505 above.
    expect(p).toEqual({ bottom: 154, left: 20, room: 320 });
  });

  it('caps the room below when below still wins', () => {
    const p = placePicker(trigger(300), { width: 375, height: 600 });
    expect(p).toEqual({ bottom: 304, left: 20, room: 288 });
    const q = placePicker(trigger(200), { width: 375, height: 600 });
    expect(q).toEqual({ top: 232, left: 20, room: 320 });
  });

  it('keeps the left edge on screen for a trigger near the right', () => {
    expect(placePicker(trigger(100, 300), { width: 375, height: 667 }).left).toBe(87);
    expect(placePicker(trigger(100, 2), { width: 375, height: 667 }).left).toBe(8);
  });

  it('writes the side it opens from and the room as a custom property', () => {
    expect(pickerStyle({ top: 132, left: 20, room: 320 })).toBe(
      'top:132px;left:20px;--picker-room:320px',
    );
    expect(pickerStyle({ bottom: 154, left: 20, room: 200 })).toBe(
      'bottom:154px;left:20px;--picker-room:200px',
    );
  });
});
