/**
 * Moves the overlays and insets of a figure saved under the plot's earlier framing onto the
 * current one, so they mark the same proteins.
 *
 * Positions are normalised 0–1 over the figure's plot area, and the plot area shows the padded data
 * extent inside margins. Before the explore workbench the export padded the extent by 5 %, kept a
 * 40 px margin on an 800 × 600 reference, and stretched each axis to fill what was left. Now it
 * pads by 2 %, keeps 12 px, and fits the extent with one pixels-per-unit for both axes, centred
 * (design decision 3), so the same normalised point now sits over different data. Each saved
 * position is read back to data coordinates under the old framing and placed again under the new.
 */
import { PUBLISH_FRAMING, type NormRect, type Overlay, type PublishState } from './publish-state';

/** A data-coordinate rectangle. */
interface Domain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Where a plot area shows its padded data extent: the extent (`domain`) and the rectangle it fills,
 * as fractions of the plot area's width (`left`, `width`) and height (`top`, `height`).
 */
export interface Framing {
  domain: Domain;
  left: number;
  top: number;
  width: number;
  height: number;
}

const LEGACY_PADDING = 0.05;
const LEGACY_MARGIN_X = 40 / 800;
const LEGACY_MARGIN_Y = 40 / 600;

/**
 * The framing every figure was saved in before the workbench, over the unpadded data extent
 * `extent`. It does not depend on the figure's size: the margins scaled with it.
 */
export function legacyFraming(extent: Domain): Framing {
  const xPad = Math.abs(extent.xMax - extent.xMin) * LEGACY_PADDING;
  const yPad = Math.abs(extent.yMax - extent.yMin) * LEGACY_PADDING;
  return {
    domain: {
      xMin: extent.xMin - xPad,
      xMax: extent.xMax + xPad,
      yMin: extent.yMin - yPad,
      yMax: extent.yMax + yPad,
    },
    left: LEGACY_MARGIN_X,
    top: LEGACY_MARGIN_Y,
    width: 1 - 2 * LEGACY_MARGIN_X,
    height: 1 - 2 * LEGACY_MARGIN_Y,
  };
}

/**
 * The current framing of a `width` × `height` plot area, from the plot's padded extent and the
 * margins `getRenderInfo` gives for that size (the fitted rectangle's edges).
 */
export function currentFraming(
  padded: Domain,
  info: { marginLeft: number; marginRight: number; marginTop: number; marginBottom: number },
  width: number,
  height: number,
): Framing {
  return {
    domain: padded,
    left: info.marginLeft / width,
    top: info.marginTop / height,
    width: (width - info.marginLeft - info.marginRight) / width,
    height: (height - info.marginTop - info.marginBottom) / height,
  };
}

/** Per axis: normalised position = offset + data value × scale. Null when the axis cannot map. */
interface AxisMap {
  offset: number;
  scale: number;
}

function axisMap(
  start: number,
  size: number,
  dMin: number,
  dMax: number,
  flip: boolean,
): AxisMap | null {
  const span = dMax - dMin;
  if (!(Number.isFinite(span) && span > 0 && Number.isFinite(size) && size > 0)) return null;
  // y runs top-down on screen and bottom-up in data.
  return flip
    ? { offset: start + (dMax / span) * size, scale: -size / span }
    : { offset: start - (dMin / span) * size, scale: size / span };
}

/** old normalised → new normalised, per axis: u' = a + b·u. Identity where an axis cannot map. */
function reframeAxis(from: AxisMap | null, to: AxisMap | null): { a: number; b: number } {
  if (!from || !to) return { a: 0, b: 1 };
  const b = to.scale / from.scale;
  return { a: to.offset - from.offset * b, b };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * `state` with every overlay and inset source moved from the framing `from` onto `to`, and marked
 * {@link PUBLISH_FRAMING}. Lengths (a circle's radii) scale with their axis. Inset targets and a
 * free legend are placed on the figure, not on data, and keep their place.
 */
export function reframePublishState(state: PublishState, from: Framing, to: Framing): PublishState {
  const x = reframeAxis(
    axisMap(from.left, from.width, from.domain.xMin, from.domain.xMax, false),
    axisMap(to.left, to.width, to.domain.xMin, to.domain.xMax, false),
  );
  const y = reframeAxis(
    axisMap(from.top, from.height, from.domain.yMin, from.domain.yMax, true),
    axisMap(to.top, to.height, to.domain.yMin, to.domain.yMax, true),
  );
  const mx = (u: number) => x.a + x.b * u;
  const my = (v: number) => y.a + y.b * v;

  const overlays = state.overlays.map((overlay): Overlay => {
    switch (overlay.type) {
      case 'circle':
        return {
          ...overlay,
          cx: mx(overlay.cx),
          cy: my(overlay.cy),
          rx: overlay.rx * Math.abs(x.b),
          ry: overlay.ry * Math.abs(y.b),
        };
      case 'arrow':
        return {
          ...overlay,
          x1: mx(overlay.x1),
          y1: my(overlay.y1),
          x2: mx(overlay.x2),
          y2: my(overlay.y2),
        };
      case 'label':
        return { ...overlay, x: mx(overlay.x), y: my(overlay.y) };
    }
  });

  const reframeRect = (rect: NormRect): NormRect => {
    // Both corners move, so the rect keeps covering the same data; held inside the plot area.
    const x0 = clamp01(mx(rect.x));
    const x1 = clamp01(mx(rect.x + rect.w));
    const y0 = clamp01(my(rect.y));
    const y1 = clamp01(my(rect.y + rect.h));
    return {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0),
      h: Math.abs(y1 - y0),
    };
  };
  const insets = state.insets.map((inset) => ({
    ...inset,
    sourceRect: reframeRect(inset.sourceRect),
  }));

  return { ...state, overlays, insets, framing: PUBLISH_FRAMING };
}
