/**
 * What the device allows, in one place: its texture limit, the sticky error flag
 * that says whether an allocation fit, and the point counts the renderer and the
 * export plan within.
 */

/**
 * The WebGL2 / GLES3 guaranteed minimum for `gl.MAX_TEXTURE_SIZE`.
 *
 * Doubles as the conservative fallback for a context that has not been probed
 * yet, or whose driver reports nonsense: planning against the floor can only
 * under-commit, never over-commit.
 */
export const MIN_MAX_TEXTURE_SIZE = 2048;

/** The smallest capacity the renderer and the export plan. */
export const MIN_CAPACITY = 1024;

/**
 * The most points the renderer draws, set by its widest vertex buffer: a_color,
 * at 16 bytes a point, fills 1 GiB here. WebGL2 has no query for the most a
 * buffer may hold, and Chrome refuses one just under 2 GiB (2^31 - 2^20 bytes,
 * measured on macOS), so this keeps a 2x margin rather than sitting on the edge.
 */
export const MAX_DRAWABLE_POINTS = 2 ** 26;

/**
 * The most points the mark texture holds: one texel a point, in rows as wide as
 * the device allows, and at most that many rows.
 */
export function maxMarkedPoints(maxTextureSize: number): number {
  return maxTextureSize ** 2;
}

/** Upper bound on {@link drainGlErrors}; far above any real driver's queue. */
const MAX_ERROR_DRAIN = 32;

/**
 * Read `gl.MAX_TEXTURE_SIZE`, falling back to the WebGL2 specification floor if
 * the driver returns something unusable. Costs a synchronous round-trip, so
 * callers cache it per context rather than re-asking per allocation.
 */
export function readMaxTextureSize(gl: WebGL2RenderingContext): number {
  return sanitizeMaxTextureSize(gl.getParameter(gl.MAX_TEXTURE_SIZE));
}

/**
 * Coerce a reported or host-supplied texture limit to a usable number. Shared
 * with the export path, which receives the live context's limit as a plain
 * number rather than reading it itself.
 */
export function sanitizeMaxTextureSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? value
    : MIN_MAX_TEXTURE_SIZE;
}

/**
 * Clear the GL error flag.
 *
 * The flag is sticky and context-wide: nothing else in the renderer drains it,
 * so without this an allocation check reports the first error raised anywhere in
 * the context's lifetime and misattributes it to the call being checked. Draining
 * immediately before an allocating call is what makes the check after it mean
 * "this call failed".
 */
export function drainGlErrors(gl: WebGL2RenderingContext): void {
  // Explicitly bounded rather than "bounded in practice": a conformant driver
  // keeps a short queue and returns NO_ERROR once it is empty, but this runs on
  // the main thread, and a context that keeps reporting the same code — lost,
  // proxied, instrumented — would freeze the tab in a `while`. Overshooting the
  // queue only means the next check may inherit one stale error; never hanging.
  for (let i = 0; i < MAX_ERROR_DRAIN && gl.getError() !== gl.NO_ERROR; i++) {
    /* discard */
  }
}
