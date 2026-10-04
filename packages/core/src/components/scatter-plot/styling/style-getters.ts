import { NEUTRAL_VALUE_COLOR } from '../config';
import type { PlotDataPoint, VisualizationData } from '@protspace/utils';
import {
  getProteinAnnotationCount,
  getProteinAnnotationIndexAt,
  getProteinAnnotationValues,
  isMultilabelAnnotationDataCached,
  isNumericAnnotation,
  normalizeShapeName,
  toInternalValue,
} from '@protspace/utils';
import type { PointStylePass } from '../webgl/types';
import { composePaintDepth, SELECTED_OPACITY_THRESHOLD } from '../webgl/renderer/point-staging';
import { computeVisibilityModel } from './visibility-model';
import type { VisibilityModel } from './visibility-model';
import { CategoryStyles, createCategoryStylePass } from './style-pass';

export interface StyleConfig {
  selectedProteinIds: string[];
  highlightedProteinIds: string[];
  selectedAnnotation: string;
  hiddenAnnotationValues: string[];
  otherAnnotationValues: string[];
  /**
   * Optional legend-driven z-order mapping: annotation value key -> rank (0 = top).
   * Used to break overlap ties deterministically without CPU-sorting.
   */
  zOrderMapping?: Record<string, number> | null;
  /**
   * Optional legend-driven color mapping: annotation value key -> hex color.
   * When provided, colors are determined by the legend (frequency-sorted).
   * When null, falls back to annotation.colors from the data.
   */
  colorMapping?: Record<string, string> | null;
  /**
   * Optional legend-driven shape mapping: annotation value key -> shape name.
   * When provided, shapes are determined by the legend (frequency-sorted).
   * When null, all categories render as circles.
   */
  shapeMapping?: Record<string, string> | null;
  sizes: {
    base: number;
  };
  opacities: {
    base: number;
    selected: number;
    faded: number;
  };
  eatOverlayEnabled?: boolean;
}

export function createStyleGetters(
  data: VisualizationData | null,
  styleConfig: StyleConfig,
  model?: VisibilityModel,
) {
  // Single authority for per-point opacity semantics. The component passes a
  // shared, memoized model; direct callers (tests included) omit it and one is
  // computed from the existing style-config inputs.
  const visibility =
    model ??
    computeVisibilityModel({
      data,
      selectedAnnotation: styleConfig.selectedAnnotation,
      hiddenAnnotationValues: styleConfig.hiddenAnnotationValues,
      selectedProteinIds: styleConfig.selectedProteinIds,
      highlightedProteinIds: styleConfig.highlightedProteinIds,
      opacities: styleConfig.opacities,
    });

  // Precompute fast lookup structures. `hiddenKeysSet` is a COLOR semantic
  // (getColors drops hidden values' colors), not an opacity one.
  const hiddenKeysSet = new Set(
    (styleConfig.hiddenAnnotationValues || []).map((v) => toInternalValue(v)),
  );
  const otherValuesSet = new Set(styleConfig.otherAnnotationValues || []);

  // Precompute value -> color and value -> shape for the selected annotation
  const annotation =
    data && styleConfig.selectedAnnotation
      ? data.annotations[styleConfig.selectedAnnotation]
      : undefined;
  const isNumeric = isNumericAnnotation(annotation);

  // Whether the SELECTED annotation stores more than one value for any protein.
  //
  // Deliberately storage-shaped, not colour-shaped. A colour-shaped test would
  // read false whenever hiding collapses every point to one colour, and the atlas
  // would then be released exactly one un-hide before it is needed again.
  //
  // Computed here, over the same `data` binding the colour getters close over, so
  // the answer is exactly as fresh as the colours it gates — it can go stale only
  // if the getters themselves have, and it can only ever over-report.
  const annotationData =
    data && styleConfig.selectedAnnotation
      ? data.annotation_data?.[styleConfig.selectedAnnotation]
      : undefined;
  const multilabel = annotationData ? isMultilabelAnnotationDataCached(annotationData) : false;

  // What `getProteinAnnotationValues` resolves for the selected annotation, read in
  // place: the shape and depth getters run per point and need no array of it.
  const labels = annotation && Array.isArray(annotation.values) ? annotation.values : null;
  const labelRows = labels ? annotationData : undefined;
  const valueCountOf = (proteinIdx: number): number =>
    labelRows ? getProteinAnnotationCount(labelRows, proteinIdx) : 0;
  const valueOf = (proteinIdx: number, k: number): string =>
    toInternalValue(labels![getProteinAnnotationIndexAt(labelRows!, proteinIdx, k)]);
  const valueToColor = new Map<string, string>();
  const valueToShape = new Map<string, string>();

  // Priority: legend colorMapping > annotation.colors from data
  const colorMap = styleConfig.colorMapping;
  const shapeMap = styleConfig.shapeMapping;

  if (colorMap) {
    // Use legend-provided color mapping (frequency-sorted)
    for (const [key, color] of Object.entries(colorMap)) {
      valueToColor.set(key, color);
    }
  } else if (annotation && Array.isArray(annotation.values)) {
    // Fallback to annotation.colors from data. Use modular indexing because
    // colors is capped at palette.length × shapeCount (≤ 126 for Kelly's).
    const colorsArr = annotation.colors;
    if (colorsArr && colorsArr.length > 0) {
      for (let i = 0; i < annotation.values.length; i++) {
        const v = annotation.values[i];
        const k = toInternalValue(v);
        const color = colorsArr[i % colorsArr.length];
        if (color) valueToColor.set(k, color);
      }
    }
  }

  if (shapeMap) {
    // Use legend-provided shape mapping (custom shapes from the legend).
    for (const [key, shape] of Object.entries(shapeMap)) {
      valueToShape.set(key, normalizeShapeName(shape));
    }
  }
  const getPointSize = (_point: PlotDataPoint): number => {
    return styleConfig.sizes.base;
  };

  // What a point's annotation values mean for its shape, colours and z-order.
  // The getters apply these to one point's values, read in place; the staging
  // pass applies them once per category (style-pass.ts), so the two cannot disagree.
  // Shape and z-order read only the value count, the first value and whether any
  // value is in "Other".
  const shapeOf = (count: number, first: string | undefined): string => {
    if (isNumeric) return 'circle';

    // multilabel points only support circle for now
    if (count > 1) return 'circle';

    // Defensive guard — shouldn't happen since DataProcessor normalizes nulls to __NA__
    if (count === 0) return 'circle';

    const annotationValue = first!;
    if (annotationValue && otherValuesSet.has(annotationValue)) return 'circle';

    const k = toInternalValue(annotationValue);
    // Check if we have a custom shape from the legend mapping
    const customShape = valueToShape.get(k);
    if (customShape) return customShape;

    return 'circle';
  };

  const colorsOfValues = (annotationValueArray: readonly string[]): string[] => {
    // Defensive guard
    if (annotationValueArray.length === 0) return [NEUTRAL_VALUE_COLOR];

    if (annotationValueArray.every((v) => otherValuesSet.has(v))) {
      return [NEUTRAL_VALUE_COLOR];
    }

    const colors = annotationValueArray
      .map((v) => {
        if (hiddenKeysSet.has(toInternalValue(v))) return undefined;
        if (otherValuesSet.has(v)) return NEUTRAL_VALUE_COLOR;
        return valueToColor.get(toInternalValue(v)) ?? NEUTRAL_VALUE_COLOR;
      })
      .filter((v) => v !== undefined);

    // Remove multiple neutral colors from multiple other annotations
    return [...new Set(colors)];
  };

  const getPointShape = (point: PlotDataPoint): string => {
    if (!data || !styleConfig.selectedAnnotation) return 'circle';
    if (isNumeric) return 'circle';
    const count = valueCountOf(point.originalIndex);
    return shapeOf(count, count > 0 ? valueOf(point.originalIndex, 0) : undefined);
  };

  const getColors = (point: PlotDataPoint): string[] => {
    if (!data || !styleConfig.selectedAnnotation) return [NEUTRAL_VALUE_COLOR];
    return colorsOfValues(
      getProteinAnnotationValues(data, point.originalIndex, styleConfig.selectedAnnotation),
    );
  };

  /**
   * Compute the "base" opacity for a point, ignoring the hidden-annotation filter.
   * Used by getDepth so that depth (and thus sort order) is stable across
   * visibility toggles — only the alpha channel changes, not the draw order.
   * Thin delegation to the visibility model (the single opacity authority).
   */
  const getBaseOpacity = (point: PlotDataPoint): number => visibility.baseOpacityOf(point);

  const getOpacity = (point: PlotDataPoint): number => visibility.opacityOf(point);

  // Resolve the predicted-cell array once (string-keyed lookup) instead of per point.
  const predictedCells = styleConfig.eatOverlayEnabled
    ? (data?.annotation_predicted?.[styleConfig.selectedAnnotation] ?? null)
    : null;
  const isPredicted = (point: PlotDataPoint): boolean => !!predictedCells?.[point.originalIndex];

  // Precompute normalization for z-order mapping so getDepth is cheap.
  const zMap = styleConfig.zOrderMapping ?? null;
  // reduce (not Math.max(...spread)): a legend with tens of thousands of
  // categories would blow the argument-count limit and throw RangeError.
  // `-Infinity` start matches Math.max over an empty filtered set; downstream
  // `zMax > 0` guards treat that the same as the old code.
  const zMax =
    zMap && Object.keys(zMap).length > 0
      ? Object.values(zMap).reduce(
          (max, v) => (typeof v === 'number' && Number.isFinite(v) && v > max ? v : max),
          -Infinity,
        )
      : 0;
  const Z_EPS = 1e-3; // must be small enough to not override opacity-based depth differences

  /** The z-order offset of a legend rank, or of a value the legend does not rank. */
  const zOffsetOfRank = (order: number | undefined): number => {
    if (typeof order === 'number' && Number.isFinite(order) && zMax > 0) {
      const orderNorm = Math.min(1, Math.max(0, order / zMax));
      return orderNorm * Z_EPS;
    }
    // Unknown values go to the back within an opacity tier.
    return zMax > 0 ? Z_EPS : 0;
  };

  /** The legend z-order offset getDepth adds for a point with these values. */
  const zOffsetOf = (count: number, anyOther: boolean, first: string | undefined): number => {
    if (!zMap) return 0;
    let key: string;

    if (count > 0) {
      // Check if this point belongs to the "Other" category
      key = anyOther ? 'Other' : toInternalValue(first);
    } else {
      // Defensive fallback — shouldn't happen since DataProcessor normalizes nulls
      key = '__NA__';
    }

    return zOffsetOfRank(zMap[key]);
  };

  /** getDepth from a base opacity and the z-order offset of the point's values. */
  const depthOf = (baseOpacity: number, zOffset: number): number => {
    // Base depth in [0,1]: higher opacity -> smaller depth -> wins with LESS
    const depth = 1 - Math.min(1, Math.max(0, baseOpacity)) + zOffset;
    // Clamp to a safe range (shader expects roughly [0,1])
    return Math.min(1, Math.max(0, depth));
  };

  /**
   * Depth used by WebGL depth test:
   * - Primary: base opacity (more opaque wins), ignoring hidden state
   * - Secondary: legend z-order (lower rank wins when opacity ties)
   *
   * Uses getBaseOpacity (not getOpacity) so that hiding/showing annotation
   * values does not change the depth sort order. This allows visibility
   * toggles to use the fast color-only update path instead of a full
   * buffer rebuild + O(N log N) re-sort.
   */
  const getDepth = (point: PlotDataPoint): number => {
    let zOffset = 0;
    if (data && zMap && styleConfig.selectedAnnotation) {
      const oi = point.originalIndex;
      const count = valueCountOf(oi);
      let anyOther = false;
      for (let k = 0; k < count && !anyOther; k++) anyOther = otherValuesSet.has(valueOf(oi, k));
      zOffset = zOffsetOf(count, anyOther, count > 0 ? valueOf(oi, 0) : undefined);
    }
    return depthOf(getBaseOpacity(point), zOffset);
  };

  // Built on the first pass and reused by every later pass over these getters.
  let categoryStyles: CategoryStyles | null = null;
  /**
   * A staging pass over every point (see style-pass.ts). `opacityModel` is what
   * `getOpacity` should read: the scatter plot passes the model it would resolve
   * per point, which can be newer than the one these getters were built with.
   */
  const createStylePass = (opacityModel: VisibilityModel = visibility): PointStylePass => {
    categoryStyles ??= new CategoryStyles({
      data,
      selectedAnnotation: styleConfig.selectedAnnotation,
      pointSize: styleConfig.sizes.base,
      depthModel: visibility,
      predictedCells,
      zOrderActive: !!(data && zMap && styleConfig.selectedAnnotation),
      colorsOfValues,
      shapeOfValues: (values) => shapeOf(values.length, values[0]),
      zOffsetOfValues: (values) =>
        zOffsetOf(
          values.length,
          values.some((v) => otherValuesSet.has(v)),
          values[0],
        ),
      depthOf,
    });
    return createCategoryStylePass(categoryStyles, opacityModel);
  };

  /**
   * Whether a renderer can draw the selection and highlight as marks over points
   * staged with nothing marked (`PointMarks`) and give the frame staging them
   * gives. Staging puts a point at the selected opacity in the selected paint
   * tier and every other one below it, so the selected opacity has to reach that
   * tier and the other two must not, nor be 0, which changes what draws at all.
   * Inside a tier the order is the z-order offset's at one opacity, so at each of
   * the three the float32 depth the sort reads has to keep every offset apart:
   * two categories tied at one opacity interleave by slot, and at another not.
   */
  const canMarkOnGpu = (): boolean => {
    const { base, selected, faded } = styleConfig.opacities;
    const belowTier = (opacity: number) => opacity > 0 && opacity < SELECTED_OPACITY_THRESHOLD;
    if (selected < SELECTED_OPACITY_THRESHOLD || !belowTier(base) || !belowTier(faded)) {
      return false;
    }
    // Every offset zOffsetOf can give.
    const offsets = zMap
      ? [zOffsetOfRank(undefined), ...Object.values(zMap).map(zOffsetOfRank)]
      : [0];
    const ascending = [...new Set(offsets)].sort((a, b) => a - b);
    return [base, selected, faded].every((opacity) =>
      [false, true].every((predicted) => {
        const depths = ascending.map((z) =>
          Math.fround(composePaintDepth(depthOf(opacity, z), opacity, predicted)),
        );
        return depths.every((depth, i) => i === 0 || depth > depths[i - 1]);
      }),
    );
  };
  let marksOnGpu: boolean | null = null;

  return {
    getPointSize,
    getPointShape,
    getColors,
    getOpacity,
    getDepth,
    isPredicted,
    isMultilabel: () => multilabel,
    createStylePass,
    canMarkOnGpu: () => (marksOnGpu ??= canMarkOnGpu()),
  };
}
