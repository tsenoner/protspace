/**
 * Staging through a {@link PointStylePass}, shared by the live render path and the
 * off-screen export so both write the same buffers.
 *
 * The pass resolves every slot's opacity, paint depth and style record in one
 * loop. Each record is packed once with {@link packPointStyle}, and every slot
 * copies its record's packed channels.
 */

import type { PlotData } from '@protspace/utils';
import type { PointStylePass, PointStyleRecords, ScalePair, SlotStyleScratch } from '../types';
import { linearAxis, mapLinear } from './rescale';
import { buildPaintOrder } from './point-staging';
import { packPointStyle, type StagePointArrays, type StagePointStyleArrays } from './stage-point';

/** What a pass writes, plus the depth sort's second buffer. All capacity-sized. */
interface PassScratch extends SlotStyleScratch {
  readonly sortScratch: Uint32Array;
}

export function createPassScratch(capacity: number): PassScratch {
  return {
    opacity: new Float64Array(capacity),
    depth: new Float32Array(capacity),
    record: new Int32Array(capacity),
    predicted: new Uint8Array(capacity),
    base: new Float64Array(capacity),
    sortScratch: new Uint32Array(capacity),
  };
}

export interface PackedRecords {
  /** Each record packed as a staged point would be, at the record's index. */
  channels: StagePointStyleArrays;
  /** Colours per record: a record with more than one owns label texels. */
  colorCounts: Uint32Array;
}

export function packRecords(
  records: PointStyleRecords,
  target: StagePointStyleArrays,
): PackedRecords {
  const n = records.colors.length;
  const colorCounts = new Uint32Array(n);
  let anyMulti = false;
  for (let r = 0; r < n; r++) {
    colorCounts[r] = records.colors[r].length;
    if (colorCounts[r] > 1) anyMulti = true;
  }
  const channels: StagePointStyleArrays = {
    colors: new Float32Array(n * 4),
    sizes: new Float32Array(n),
    labelCounts: new Float32Array(n),
    shapes: new Float32Array(n),
    predicted: new Float32Array(n),
    labelColorData:
      anyMulti && target.labelColorData ? new Uint8Array(n * target.maxLabels * 4) : null,
    maxLabels: target.maxLabels,
  };
  for (let r = 0; r < n; r++) {
    packPointStyle(channels, r, records.colors[r], records.shapes[r], records.pointSize, 1, false);
  }
  return { channels, colorCounts };
}

/**
 * Write the style channels of `slot` at index `idx`, copied from its record's
 * packed channels. With `target.recordIds` the renderer applies the legend's
 * hiding per record, so the slot also takes its record id, and its opacity as
 * if nothing were hidden. Its opacity is `base`, or 0 where hidden (see
 * `hiddenRecords`), so only a zero needs `base` read.
 */
function stageSlotStyle(
  target: StagePointStyleArrays,
  idx: number,
  scratch: SlotStyleScratch,
  packed: PackedRecords,
  slot: number,
): void {
  const r = scratch.record[slot];
  let opacity = scratch.opacity[slot];
  const ids = target.recordIds;
  if (ids) {
    ids[idx] = r;
    if (opacity === 0) opacity = scratch.base[slot];
  }
  const { channels } = packed;
  const c = idx * 4;
  const rc = r * 4;
  target.colors[c] = channels.colors[rc];
  target.colors[c + 1] = channels.colors[rc + 1];
  target.colors[c + 2] = channels.colors[rc + 2];
  target.colors[c + 3] = Math.min(1, Math.max(0, opacity));
  target.sizes[idx] = channels.sizes[r];
  target.labelCounts[idx] = channels.labelCounts[r];
  target.shapes[idx] = channels.shapes[r];
  target.predicted[idx] = scratch.predicted[slot];

  // The texels fillLabelColorTexels writes for a point with more than one colour.
  const texels = target.labelColorData;
  const colorCount = packed.colorCounts[r];
  if (!texels || colorCount <= 1) return;
  const recordTexels = channels.labelColorData!;
  const { maxLabels } = target;
  const n = Math.min(colorCount, maxLabels);
  for (let j = 0; j < n; j++) {
    const to = (idx * maxLabels + j) * 4;
    if (to >= texels.length) continue;
    const from = (r * maxLabels + j) * 4;
    texels[to] = recordTexels[from];
    texels[to + 1] = recordTexels[from + 1];
    texels[to + 2] = recordTexels[from + 2];
    texels[to + 3] = recordTexels[from + 3];
  }
}

/**
 * Stage slots `[0, count)` of `pd` far -> near: resolve the pass, sort by paint
 * depth (see {@link buildPaintOrder}), then write each slot at its sorted index.
 * Returns the selection cut and the records as packed. `onStaged` sees every
 * slot once, in draw order.
 */
export function stageInPaintOrder(
  target: StagePointArrays,
  pass: PointStylePass,
  scratch: PassScratch,
  order: Uint32Array,
  pd: PlotData,
  scales: ScalePair,
  count: number,
  selectionActive: boolean,
  onStaged?: (slot: number, opacity: number) => void,
): { selectedStartIndex: number; packed: PackedRecords } {
  pass.resolve(pd, count, scratch);
  const packed = packRecords(pass.records, target);
  const { opacity, depth } = scratch;
  const { xs, ys } = pd;
  const xAxis = linearAxis(scales.x);
  const yAxis = linearAxis(scales.y);

  const plan = buildPaintOrder(
    order,
    depth,
    count,
    selectionActive,
    (k, slot) => {
      const slotOpacity = opacity[slot];
      onStaged?.(slot, slotOpacity);
      // Positions are pre-scaled; depth is indexed by slot, NOT by k.
      target.dataPositions[k * 2] = mapLinear(xAxis, xs[slot]);
      target.dataPositions[k * 2 + 1] = mapLinear(yAxis, ys[slot]);
      target.depths[k] = depth[slot];
      stageSlotStyle(target, k, scratch, packed, slot);
      return slotOpacity;
    },
    scratch.sortScratch,
  );
  return { selectedStartIndex: plan.selectedStartIndex, packed };
}

/**
 * Re-write the style channels of the first `count` slots of an earlier
 * {@link stageInPaintOrder} over `src`, leaving positions and depths alone.
 * `slotCount` is the count that staging resolved, so every slot in `order` is
 * resolved again. Returns the records as packed.
 */
export function restageStyles(
  target: StagePointStyleArrays,
  pass: PointStylePass,
  scratch: PassScratch,
  order: Uint32Array,
  src: PlotData,
  slotCount: number,
  count: number,
  onStaged?: (slot: number, opacity: number) => void,
): PackedRecords {
  pass.resolve(src, slotCount, scratch);
  const packed = packRecords(pass.records, target);
  for (let i = 0; i < count; i++) {
    const slot = order[i];
    onStaged?.(slot, scratch.opacity[slot]);
    stageSlotStyle(target, i, scratch, packed, slot);
  }
  return packed;
}
