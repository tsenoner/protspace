import { describe, expect, it } from 'vitest';
import {
  COMPACT_MEDIA,
  DESKTOP_MIN_WIDTH as CORE_DESKTOP_MIN_WIDTH,
  LANDSCAPE_PHONE_MAX_HEIGHT as CORE_LANDSCAPE_PHONE_MAX_HEIGHT,
  LANDSCAPE_PHONE_MEDIA,
  PHONE_MAX_WIDTH as CORE_PHONE_MAX_WIDTH,
  PHONE_MEDIA,
} from '../../../../packages/core/src/utils/breakpoints';
import {
  DESKTOP_MIN_WIDTH,
  LANDSCAPE_PHONE_MAX_HEIGHT,
  LAYOUT_QUERIES,
  PHONE_MAX_WIDTH,
} from './layout-defaults';

/**
 * The shell's layout modes (layout-defaults.ts) and the breakpoints shadow-DOM styles read
 * (core's utils/breakpoints.ts) are two copies of one decision (design decision 17): the app's
 * module stays a leaf with its own literals, and this keeps the two equal.
 */
describe('layout breakpoints', () => {
  it('the app and core agree on the three numbers', () => {
    expect(CORE_PHONE_MAX_WIDTH).toBe(PHONE_MAX_WIDTH);
    expect(CORE_DESKTOP_MIN_WIDTH).toBe(DESKTOP_MIN_WIDTH);
    expect(CORE_LANDSCAPE_PHONE_MAX_HEIGHT).toBe(LANDSCAPE_PHONE_MAX_HEIGHT);
  });

  it("core's phone and landscape queries are the app's modes", () => {
    expect(PHONE_MEDIA).toBe(LAYOUT_QUERIES.phone);
    expect(LANDSCAPE_PHONE_MEDIA).toBe(LAYOUT_QUERIES.landscape);
  });

  it('the compact query is the phone mode or the landscape mode', () => {
    expect(COMPACT_MEDIA).toBe(`${PHONE_MEDIA}, ${LAYOUT_QUERIES.landscape}`);
  });
});
