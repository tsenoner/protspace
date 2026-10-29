import { describe, it, expect } from 'vitest';
import {
  MIN_MAX_TEXTURE_SIZE,
  drainGlErrors,
  maxMarkedPoints,
  readMaxTextureSize,
  sanitizeMaxTextureSize,
} from './device-limits';

const NO_ERROR = 0;
const INVALID_VALUE = 0x0501;

/** A GL stub that reports `maxTextureSize` and raises `errors` one per `getError`, then NO_ERROR. */
function stubGL(opts: { maxTextureSize?: unknown; errors?: () => number } = {}) {
  let reads = 0;
  const gl = {
    NO_ERROR,
    MAX_TEXTURE_SIZE: 0x0d33,
    getParameter: () => opts.maxTextureSize,
    getError: () => {
      reads++;
      return opts.errors?.() ?? NO_ERROR;
    },
  };
  return { gl: gl as unknown as WebGL2RenderingContext, reads: () => reads };
}

describe('sanitizeMaxTextureSize', () => {
  it('falls back to the spec floor for anything unusable', () => {
    for (const bad of [undefined, null, NaN, Infinity, 0, -1, '4096']) {
      expect(sanitizeMaxTextureSize(bad)).toBe(MIN_MAX_TEXTURE_SIZE);
    }
  });

  it('passes a usable limit through', () => {
    expect(sanitizeMaxTextureSize(4096)).toBe(4096);
  });
});

describe('readMaxTextureSize', () => {
  it('reads the device limit', () => {
    expect(readMaxTextureSize(stubGL({ maxTextureSize: 16384 }).gl)).toBe(16384);
  });

  it('substitutes the spec floor when the driver reports nonsense', () => {
    expect(readMaxTextureSize(stubGL({ maxTextureSize: null }).gl)).toBe(MIN_MAX_TEXTURE_SIZE);
  });
});

describe('drainGlErrors', () => {
  it('reads the queued errors and stops once the flag is clear', () => {
    const queue = [INVALID_VALUE, INVALID_VALUE];
    const { gl, reads } = stubGL({ errors: () => queue.shift() ?? NO_ERROR });
    drainGlErrors(gl);
    expect(queue).toEqual([]);
    expect(reads()).toBe(3);
  });

  it('gives up on a context that never clears', () => {
    const { gl, reads } = stubGL({ errors: () => INVALID_VALUE });
    drainGlErrors(gl);
    expect(reads()).toBe(32);
  });
});

describe('maxMarkedPoints', () => {
  it('fits a texel per point in a square of the device limit', () => {
    expect(maxMarkedPoints(2048)).toBe(2048 * 2048);
  });
});
