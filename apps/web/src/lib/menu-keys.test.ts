import { describe, expect, it } from 'vitest';
import { isOutsidePress, menuKeyAction } from './menu-keys';

describe('menuKeyAction', () => {
  it('the arrows move with wrap; Home and End jump', () => {
    expect(menuKeyAction('ArrowDown', 3, 0)).toEqual({ focus: 1 });
    expect(menuKeyAction('ArrowDown', 3, 2)).toEqual({ focus: 0 });
    expect(menuKeyAction('ArrowUp', 3, 0)).toEqual({ focus: 2 });
    expect(menuKeyAction('Home', 3, 2)).toEqual({ focus: 0 });
    expect(menuKeyAction('End', 3, 0)).toEqual({ focus: 2 });
  });

  it('ArrowDown with no entry focused goes to the first', () => {
    expect(menuKeyAction('ArrowDown', 3, -1)).toEqual({ focus: 0 });
  });

  it('Escape closes back to the button; Tab closes and lets focus move on', () => {
    expect(menuKeyAction('Escape', 3, 1)).toEqual({ close: true, refocus: true });
    expect(menuKeyAction('Tab', 3, 1)).toEqual({ close: true, refocus: false });
  });

  it('other keys do nothing', () => {
    expect(menuKeyAction('a', 3, 1)).toBeNull();
    expect(menuKeyAction('Enter', 3, 1)).toBeNull();
  });
});

describe('isOutsidePress', () => {
  const element = (...inside: unknown[]) =>
    ({ contains: (node: unknown) => inside.includes(node) }) as unknown as Element;

  it('is outside only when no element contains the target', () => {
    const target = {};
    const event = { target } as unknown as Event;
    expect(isOutsidePress(event, element(), element())).toBe(true);
    expect(isOutsidePress(event, element(), element(target))).toBe(false);
    expect(isOutsidePress(event, null, undefined)).toBe(true);
  });
});
