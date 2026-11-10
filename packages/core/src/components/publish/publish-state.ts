/**
 * State types for the Publish (figure editor) modal.
 *
 * All overlay/inset coordinates are normalised to 0–1 over the
 * scatterplot area so they survive resolution and preset changes.
 */

import type { PresetId } from './journal-presets';
import type { SizeMode } from './dimension-utils';

// ── Overlay primitives ──────────────────────────────────

export interface CircleOverlay {
  type: 'circle';
  /** Centre X, normalised 0–1 */
  cx: number;
  /** Centre Y, normalised 0–1 */
  cy: number;
  /** Horizontal radius, normalised 0–1 */
  rx: number;
  /** Vertical radius, normalised 0–1 */
  ry: number;
  /** Rotation in radians */
  rotation: number;
  color: string;
  strokeWidth: number;
}

export interface ArrowOverlay {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface LabelOverlay {
  type: 'label';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  /** Rotation in radians */
  rotation: number;
  color: string;
}

export type Overlay = CircleOverlay | ArrowOverlay | LabelOverlay;

// ── Zoom inset ───────────────────────────────────────────

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Inset {
  sourceRect: NormRect;
  targetRect: NormRect;
  border: number;
  connector: 'lines' | 'none';
  /** Multiplier applied to the rendered dot size inside the zoomed inset.
   *  1 (default) matches the main plot's dot size; >1 makes points more
   *  visible after zooming, <1 makes them less prominent. */
  pointSizeScale?: number;
}

// ── Legend layout ────────────────────────────────────────

export type LegendPosition =
  | 'right'
  | 'left'
  | 'top'
  | 'bottom'
  | 'tr'
  | 'tl'
  | 'br'
  | 'bl'
  | 'free'
  | 'none';

export type LegendOverflow = 'scale' | 'truncate' | 'multi-column';

/** Normalised position for free-floating legend. */
export interface LegendFreePosition {
  /** X position, normalised 0–1 over entire canvas */
  nx: number;
  /** Y position, normalised 0–1 over entire canvas */
  ny: number;
}

export interface LegendLayout {
  visible: boolean;
  position: LegendPosition;
  widthPercent: number;
  /** Internal source of truth for legend label size. */
  fontSizePx: number;
  /** Display-only: which unit the user is editing in.
   *  pt is derived from fontSizePx + dpi (pt = px × 72 / dpi). */
  fontSizeUnit: 'pt' | 'px';
  columns: number;
  overflow: LegendOverflow;
  /** Position when legend.position === 'free'. */
  freePos?: LegendFreePosition;
}

// ── Top-level publish state ─────────────────────────────

/**
 * The plot framing overlay and inset positions are placed in (see `framing-migration.ts`): a state
 * without it was saved before the workbench changed the framing, and is moved onto this one.
 */
export const PUBLISH_FRAMING = 2;

export interface PublishState {
  preset: PresetId | 'custom';
  sizeMode: SizeMode;
  widthPx: number;
  heightPx: number;
  dpi: number;
  format: 'png' | 'pdf';
  legend: LegendLayout;
  background: 'white' | 'transparent';
  overlays: Overlay[];
  insets: Inset[];
  /** Width in px when overlays were authored. Used to scale pixel properties proportionally. */
  referenceWidth: number;
  /** When true, changing dpi/mm recomputes pixels. When false, only metadata changes. */
  resample: boolean;
  /** Chain-link aspect ratio: when true, editing width also rescales height (and vice versa). */
  aspectLocked: boolean;
  /** Display unit for Width/Height inputs. Display-only; pixels are the internal source of truth. */
  unit: 'px' | 'mm' | 'in' | 'cm';
  /** Visualization context when overlays/insets were authored. Used to detect stale positions. */
  viewFingerprint?: {
    projection: string;
    dimensionality: number;
  };
  /** {@link PUBLISH_FRAMING} once the positions are in the current framing; absent before. */
  framing?: typeof PUBLISH_FRAMING;
}

/** Tool currently active on the overlay */
export type OverlayTool = 'select' | 'circle' | 'arrow' | 'label' | 'inset-source' | 'inset-target';

export function createDefaultPublishState(base?: {
  imageWidth?: number;
  imageHeight?: number;
  legendWidthPercent?: number;
  legendFontSizePx?: number;
}): PublishState {
  return {
    preset: 'flexible',
    sizeMode: 'flexible',
    widthPx: base?.imageWidth ?? 2048,
    heightPx: base?.imageHeight ?? 1024,
    dpi: 300,
    resample: true,
    aspectLocked: true,
    unit: 'mm',
    format: 'png',
    legend: {
      visible: true,
      position: 'right',
      widthPercent: base?.legendWidthPercent ?? 20,
      fontSizePx: base?.legendFontSizePx ?? 15,
      fontSizeUnit: 'pt',
      columns: 1,
      overflow: 'multi-column',
    },
    background: 'white',
    overlays: [],
    insets: [],
    referenceWidth: base?.imageWidth ?? 2048,
    framing: PUBLISH_FRAMING,
  };
}
