/**
 * Geometry planning for the multi-label ("pie chart") colour atlas.
 *
 * The atlas is an RGBA8 texture holding `stride` texels per point — one per
 * label slice. Its size therefore grows with the renderer's point capacity, so
 * it is the one GPU resource whose dimensions can exceed what the device
 * accepts. `gl.MAX_TEXTURE_SIZE` bounds *both* dimensions, and the historical
 * layout pinned width at 2048 and let height do all the growing, which is the
 * least favourable arrangement against a square limit.
 *
 * This module is pure and GL-free: it is the single place the live renderer and
 * the export renderer derive atlas geometry, so the two cannot drift.
 */

/** Label slices a point can carry at full fidelity. */
export const MAX_LABELS = 8;

/**
 * The WebGL2 / GLES3 guaranteed minimum for `gl.MAX_TEXTURE_SIZE`.
 *
 * Doubles as the conservative fallback for a context that has not been probed
 * yet, or whose driver reports nonsense: planning against the floor can only
 * under-commit, never over-commit.
 */
export const MIN_MAX_TEXTURE_SIZE = 2048;

/**
 * Candidate atlas widths, narrowest first. The narrowest is the spec floor
 * itself, so it is the one width every conformant device supports — and it is
 * also the historical `LABEL_TEXTURE_WIDTH`, which is what makes a device with
 * ample limits allocate byte-identical geometry to the one it allocated before
 * this module existed.
 */
export const ATLAS_WIDTHS = [MIN_MAX_TEXTURE_SIZE, 4096, 8192] as const;

/**
 * Slice counts to fall back through, widest first. The floor is 2, not 1,
 * because `eat-annotation-overlay` requires a two-label cell to render both of
 * its hues in live *and* exported markers — a single slice would satisfy no
 * scenario that dropping the atlas entirely does not.
 */
const STRIDE_LADDER = [MAX_LABELS, 4, 2] as const;

export interface LabelAtlasPlan {
  /** Texture width in texels. */
  width: number;
  /** Texture height in texels. */
  height: number;
  /** Texels reserved per point, i.e. the maximum slices a marker can show. */
  stride: number;
  /** Points this plan covers; the shader refuses to sample beyond it. */
  pointCapacity: number;
  /** Bytes of backing store (RGBA8). */
  byteLength: number;
}

/**
 * Plan the smallest atlas that covers `capacity` points on a device reporting
 * `maxTextureSize`.
 *
 * Full stride is preferred over a narrow texture: the loops run stride-outer,
 * width-inner, so fidelity is only reduced once *no* supported width can hold
 * the full slice count. That ordering is deliberate — the reverse would re-lay
 * out the majority of devices, which are unconstrained, in order to help the
 * minority that are.
 *
 * Returns `null` when even the floor stride cannot fit, which the caller must
 * treat as "render dominant colours, tell the user" rather than as a reason to
 * drop points.
 */
export function planLabelAtlas(
  capacity: number,
  maxTextureSize: number,
  /**
   * Upper bound on the stride, used by the export renderer to inherit the live
   * view's fidelity so a figure carries the same segmentation the user saw.
   * A null bound means "no atlas at all".
   */
  maxStride: number | null = MAX_LABELS,
): LabelAtlasPlan | null {
  if (!Number.isFinite(maxTextureSize) || maxTextureSize < 1) return null;
  if (!Number.isFinite(capacity) || capacity < 1) return null;
  if (maxStride === null || maxStride < 1) return null;

  for (const stride of STRIDE_LADDER) {
    if (stride > maxStride) continue;
    for (const width of ATLAS_WIDTHS) {
      if (width > maxTextureSize) break;
      const height = Math.ceil((capacity * stride) / width);
      if (height <= maxTextureSize) {
        return {
          width,
          height,
          stride,
          pointCapacity: capacity,
          byteLength: width * height * 4,
        };
      }
    }
  }
  return null;
}
