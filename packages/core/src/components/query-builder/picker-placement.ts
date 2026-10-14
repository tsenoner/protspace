/** Where a fixed picker opens against its trigger, and the height it may take. */
export interface PickerPlacement {
  /** Set when it opens below the trigger. */
  top?: number;
  /** Set when it opens above: the distance from the screen's bottom edge, so it grows upward. */
  bottom?: number;
  left: number;
  room: number;
}

const GAP = 4;
const MARGIN = 8;
/** More than the picker's full height (search input plus a 15rem list). */
const MAX_ROOM = 320;
const MAX_WIDTH = 280;

/**
 * Below the trigger unless it lacks room there and above has more, like the kit's `flip`. The
 * picker gets `room` as `--picker-room` and caps its height to it, so on a phone the list scrolls
 * inside the screen instead of running off it.
 */
export function placePicker(
  trigger: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
): PickerPlacement {
  const below = viewport.height - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  const left = Math.max(MARGIN, Math.min(trigger.left, viewport.width - MARGIN - MAX_WIDTH));
  if (below < MAX_ROOM && above > below) {
    return { bottom: viewport.height - trigger.top + GAP, left, room: Math.min(above, MAX_ROOM) };
  }
  return { top: trigger.bottom + GAP, left, room: Math.max(0, Math.min(below, MAX_ROOM)) };
}

export function pickerStyle(p: PickerPlacement): string {
  const edge = p.bottom !== undefined ? `bottom:${p.bottom}px` : `top:${p.top}px`;
  return `${edge};left:${p.left}px;--picker-room:${p.room}px`;
}

export function placePickerAt(trigger: Element): PickerPlacement {
  return placePicker(trigger.getBoundingClientRect(), {
    width: innerWidth,
    height: innerHeight,
  });
}
