import type { HostMessageEventDetail } from '../../events';

/**
 * Why the renderer is running below full capability.
 *
 * Every one of these was previously either silent or console-only, on hardware
 * that never said anything was out of range.
 */
export type RendererDegradedReason =
  /** The label atlas had to drop slices per point to fit `gl.MAX_TEXTURE_SIZE`. */
  | 'reduced-label-detail'
  /** No atlas geometry fits the device at all; markers render in dominant colours. */
  | 'label-atlas-unsupported'
  /** The driver refused the atlas allocation (`INVALID_VALUE` or equivalent). */
  | 'label-atlas-allocation-failed'
  /** The driver reported out-of-memory allocating the atlas. */
  | 'label-atlas-out-of-memory'
  /** An allocating vertex-buffer upload failed; the atlas is released to retry smaller. */
  | 'point-buffer-allocation-failed'
  /** The gamma-correct pipeline is unavailable, so blending happens in sRGB. */
  | 'gamma-pipeline-unavailable';

export interface RendererDegradedContext {
  reason: RendererDegradedReason;
  /** `gl.MAX_TEXTURE_SIZE` as reported by the device. */
  maxTextureSize: number;
  /** Label slices per marker now in effect; 0 when no atlas is allocated. */
  stride: number;
  /**
   * Points the renderer had capacity allocated for when the reduction took
   * effect. This is the number the atlas is sized from, so it is what explains
   * the reduction — it is the session's high-water capacity, which can exceed
   * the currently loaded dataset.
   */
  pointCount: number;
  /** Free-text detail for reasons that carry one (e.g. the gamma fallback's cause). */
  detail?: string;
}

export interface RendererDegradedDetail extends HostMessageEventDetail<
  'scatter-plot',
  'warning',
  RendererDegradedContext
> {}

const MESSAGES: Record<RendererDegradedReason, (c: RendererDegradedContext) => string> = {
  'reduced-label-detail': (c) =>
    `Multi-value markers show up to ${c.stride} segments instead of 8: this device's maximum ` +
    `texture size (${c.maxTextureSize}) cannot hold the full colour table for ${c.pointCount.toLocaleString()} points. ` +
    `Every point is still drawn.`,
  'label-atlas-unsupported': (c) =>
    `Multi-value markers show a single dominant colour: this device's maximum texture size ` +
    `(${c.maxTextureSize}) cannot hold a colour table for ${c.pointCount.toLocaleString()} points. Every point is still drawn.`,
  'label-atlas-allocation-failed': () =>
    'The graphics driver refused the multi-value colour table. Markers show a single dominant colour; every point is still drawn.',
  'label-atlas-out-of-memory': () =>
    'The graphics driver ran out of memory for the multi-value colour table. Markers show a single dominant colour; every point is still drawn.',
  'point-buffer-allocation-failed': (c) =>
    `The graphics driver refused to allocate memory for ${c.pointCount.toLocaleString()} points. ` +
    `Multi-value markers now show a single dominant colour to free memory, and rendering will retry.`,
  'gamma-pipeline-unavailable': (c) =>
    'Colour blending is running in sRGB rather than linear light, so overlapping points may look slightly darker than intended.' +
    // The cause is the only actionable part of this one — without it the message
    // says a pipeline is missing but not which capability the device lacks.
    (c.detail ? ` (${c.detail})` : ''),
};

export function createRendererDegradedDetail(
  context: RendererDegradedContext,
): RendererDegradedDetail {
  return {
    message: MESSAGES[context.reason](context),
    severity: 'warning',
    source: 'scatter-plot',
    context,
  };
}
