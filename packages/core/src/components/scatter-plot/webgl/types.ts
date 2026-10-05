import type { PlotData, PlotDataPoint } from '@protspace/utils';
import type { StagePointStyleArrays } from './renderer/stage-point';

// ScalePair is owned by @protspace/utils (data-processor `createScales`); re-export
// it here so webgl code importing `ScalePair` from this module still resolves.
export type { ScalePair } from '@protspace/utils';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface WebGLStyleGetters {
  getColors: (point: PlotDataPoint) => string[];
  getPointSize: (point: PlotDataPoint) => number;
  getOpacity: (point: PlotDataPoint) => number;
  getDepth: (point: PlotDataPoint) => number;
  getShape: (point: PlotDataPoint) => string;
  isPredicted: (point: PlotDataPoint) => boolean;
  /**
   * Whether the selected annotation stores more than one value for any protein.
   * Gates allocation of the multi-label colour atlas, which is 32 B/point and is
   * never sampled when this is false.
   */
  isMultilabel: () => boolean;
  /**
   * Resolve the style inputs once for a staging pass over every point. Optional:
   * without it the renderer stages through the per-point getters above, which
   * write the same buffers, only slower.
   */
  createStylePass?: () => PointStylePass;
  /**
   * The marks the live view draws over the points of `pd`, or null when none
   * are. With marks, the getters above style every point as if none were
   * marked, so changing the marks re-stages nothing.
   */
  getPointMarks?: (pd: PlotData) => PointMarks | null;
}

/**
 * A selection or highlight, drawn on the GPU: a point that is not hidden takes
 * `marked` or `unmarked` as its opacity, and the marked points draw on top of the
 * rest, as staging orders and draws a selection.
 */
export interface PointMarks {
  /** 1 for each marked slot of the plot data, 0 for the rest. */
  readonly slots: Uint8Array;
  readonly marked: number;
  readonly unmarked: number;
}

/** Record id of a slot whose style is not in the records table. */
export const PER_POINT_STYLE = -1;

/**
 * Style shared by every point with the same record id. The scatter plot keys
 * records by category code, so they can also be uploaded as a per-category table.
 */
export interface PointStyleRecords {
  /** `getColors` of a point with this record. */
  readonly colors: readonly (readonly string[])[];
  /** `getShape` of a point with this record. */
  readonly shapes: readonly string[];
  /** `getPointSize`, the same for every point of the pass. */
  readonly pointSize: number;
  /**
   * What the first `count` records are keyed by: record `c` is category code `c`
   * of `values` (then N/A, then no value), in the slots `rows` assigns. Any pass
   * with the same `values`, `rows` and `count` gives a slot the same one of
   * those ids, so it can restyle staged slots without staging them again.
   */
  readonly codes?: {
    readonly values: readonly unknown[];
    readonly rows: object;
    readonly count: number;
  };
}

/** What {@link PointStylePass.resolve} writes per plot slot. Capacity-sized. */
export interface SlotStyleScratch {
  /** `getOpacity`. */
  readonly opacity: Float64Array;
  /** `composePaintDepth(getDepth, getOpacity, isPredicted)`. */
  readonly depth: Float32Array;
  /** Record id, or {@link PER_POINT_STYLE}. */
  readonly record: Int32Array;
  /** `isPredicted` as 0 or 1, read for slots that have a record. */
  readonly predicted: Uint8Array;
  /**
   * `getOpacity` as if the legend hid nothing, for slots with a record. Only a
   * pass with `hiddenRecords` writes it.
   */
  readonly base: Float64Array;
}

/** One staging pass: every per-point style input, resolved once per pass. */
export interface PointStylePass {
  /** Read after `resolve`, which may add records. */
  readonly records: PointStyleRecords;
  /** Fill `out` for slots `[0, count)` of `pd`. */
  resolve(pd: PlotData, count: number, out: SlotStyleScratch): void;
  /**
   * Per record, whether the legend hides its points (opacity 0), read after
   * `resolve`. A pass that has it also writes `base`, so the hiding can be
   * applied per record: `opacity` is `base`, or 0 where the record is hidden.
   */
  readonly hiddenRecords?: readonly boolean[];
  /**
   * Write the style channels of a slot `resolve` marked {@link PER_POINT_STYLE}.
   * A pass that gives every slot a record has none.
   */
  stageSlot?(
    target: StagePointStyleArrays,
    idx: number,
    pd: PlotData,
    slot: number,
    opacity: number,
  ): void;
}

/**
 * Framebuffer resources for offscreen rendering
 */
export interface FramebufferResources {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  depthBuffer: WebGLRenderbuffer;
  width: number;
  height: number;
}

/** Attribute locations for the point shader program. */
export interface PointAttribLocations {
  dataPosition: number;
  size: number;
  color: number;
  depth: number;
  labelCount: number;
  shape: number;
  predicted: number;
  /** Record id into the per-record style table, or -1. */
  record: number;
  /** Where a projection switch drew the point (MORPH_GLSL). */
  prevPosition: number;
}

/** Uniform locations for the point shader program. */
export interface PointUniformLocations {
  resolution: WebGLUniformLocation | null;
  transform: WebGLUniformLocation | null;
  dpr: WebGLUniformLocation | null;
  morph: WebGLUniformLocation | null;
  pointScale: WebGLUniformLocation | null;
  gamma: WebGLUniformLocation | null;
  knockoutColor: WebGLUniformLocation | null;
  labelColors: WebGLUniformLocation | null;
  labelTextureSize: WebGLUniformLocation | null;
  maxLabels: WebGLUniformLocation | null;
  /** Points the label atlas covers; 0 disables the multi-label branch entirely. */
  labelAtlasCapacity: WebGLUniformLocation | null;
  recordStyle: WebGLUniformLocation | null;
  recordStyleOn: WebGLUniformLocation | null;
  marks: WebGLUniformLocation | null;
  marksOn: WebGLUniformLocation | null;
  markPass: WebGLUniformLocation | null;
  markedOpacity: WebGLUniformLocation | null;
  unmarkedOpacity: WebGLUniformLocation | null;
}

// ============================================================================
// Configuration Constants
// ============================================================================

/** Default gamma value (standard sRGB) */
export const DEFAULT_GAMMA = 2.2;
