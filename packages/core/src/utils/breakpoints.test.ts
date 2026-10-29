import { describe, expect, it } from 'vitest';
import {
  COMPACT_MEDIA,
  DESKTOP_MIN_WIDTH,
  LANDSCAPE_PHONE_MAX_HEIGHT,
  LANDSCAPE_PHONE_MEDIA,
  PHONE_MAX_WIDTH,
  PHONE_MEDIA,
} from './breakpoints';

describe('breakpoints', () => {
  it('builds the queries from the numbers', () => {
    expect(PHONE_MEDIA).toBe(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    expect(LANDSCAPE_PHONE_MEDIA).toBe(
      `(orientation: landscape) and (max-height: ${LANDSCAPE_PHONE_MAX_HEIGHT}px) and (max-width: ${DESKTOP_MIN_WIDTH - 1}px)`,
    );
    expect(COMPACT_MEDIA).toBe(`${PHONE_MEDIA}, ${LANDSCAPE_PHONE_MEDIA}`);
  });
});
