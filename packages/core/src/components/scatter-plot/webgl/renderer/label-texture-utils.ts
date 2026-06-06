import { resolveColor } from '../color-utils';

/**
 * Fill the per-point label-color texels used for multi-label "pie" rendering.
 *
 * Single-label points (and 0-label) are colored directly from the per-point color buffer
 * in the shader and NEVER sample the label texture, so we skip them entirely. For
 * multi-label points we write only the actual label slices (`0..count-1`, capped at
 * `maxLabels`), not all `maxLabels` slots.
 *
 * Texture layout: each point owns `maxLabels` RGBA texels at byte offset
 * `idx * maxLabels * 4`. Bytes are 0..255 (RGBA8); the shader normalizes on sample.
 */
export function fillLabelColorTexels(
  labelColorData: Uint8Array,
  idx: number,
  pointColors: readonly string[],
  maxLabels: number,
): void {
  if (pointColors.length <= 1) return; // single-label points use v_color; texels unused
  const count = Math.min(pointColors.length, maxLabels);
  for (let j = 0; j < count; j++) {
    const [lr, lg, lb] = resolveColor(pointColors[j]);
    const texIndex = (idx * maxLabels + j) * 4;
    if (texIndex < labelColorData.length) {
      labelColorData[texIndex] = Math.round(lr * 255);
      labelColorData[texIndex + 1] = Math.round(lg * 255);
      labelColorData[texIndex + 2] = Math.round(lb * 255);
      labelColorData[texIndex + 3] = 255;
    }
  }
}
