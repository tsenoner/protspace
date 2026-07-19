/**
 * Canvas2D badge engine for the duplicate-stack overlay, extracted byte-faithfully
 * from `scatter-plot.ts` (`_clearDuplicateBadgesCanvas` + `_renderDuplicateBadgesCanvas`,
 * report F-30) plus the viewport cull + top-N cap (`cullAndCapStacks`, report F-52,
 * replacing the inline filter + `_capDuplicateStacksForRendering`).
 *
 * Pure/decoupled: this module does NOT import `scatter-plot.ts`. The host wires its
 * canvas, transform, config size, and expanded-key state through the deps callbacks.
 * All geometry/style literals are preserved verbatim from the original inline code.
 */

import type { RenderDuplicateStack } from './duplicate-stack-types';
import { pointInWindow, type ViewportWindow } from './duplicate-stack-viewport';

/** Badge geometry/style constants — verbatim from the original inline literals. */
export const BADGE_RADIUS = 9;
export const BADGE_OFFSET = { x: 10, y: -10 } as const;
const BADGE_FONT_FAMILY =
  'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
const BADGE_FONT_SIZE = 10;
const BADGE_FONT_WEIGHT = 700;
/** Canvas font string for a badge label at `sizePx` — one source for live + export. */
const badgeFont = (sizePx: number) => `${BADGE_FONT_WEIGHT} ${sizePx}px ${BADGE_FONT_FAMILY}`;
const BADGE_FONT = badgeFont(BADGE_FONT_SIZE);
const BADGE_STROKE = 'rgba(255, 255, 255, 0.9)';
const BADGE_LINE_WIDTH = 1.5;
export const BADGE_EXPANDED_FILL = 'rgba(59, 130, 246, 0.9)';
export const BADGE_DEFAULT_FILL = 'rgba(17, 24, 39, 0.85)';
const BADGE_TEXT_FILL = '#ffffff';

/**
 * Per-badge draw parameters shared by the live overlay (render) and the
 * figure-export capture (renderExport). The two paths differ only in how a
 * stack's px/py maps to a canvas pixel (`mapX`/`mapY`) and in the geometry
 * scale (radius/font/lineWidth); the fill/stroke/label sequence is identical.
 */
interface BadgeDrawSpec {
  mapX: (px: number) => number;
  mapY: (py: number) => number;
  radius: number;
  font: string;
  lineWidth: number;
  expandedKey: string | null;
}

/** Draw every stack's badge into `ctx`. Assumes the caller set the transform. */
function drawBadges(
  ctx: CanvasRenderingContext2D,
  stacks: RenderDuplicateStack[],
  spec: BadgeDrawSpec,
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = spec.font;
  ctx.lineWidth = spec.lineWidth;
  ctx.strokeStyle = BADGE_STROKE;

  for (let i = 0; i < stacks.length; i++) {
    const s = stacks[i];
    const x = spec.mapX(s.px);
    const y = spec.mapY(s.py);
    const isExpanded = s.key === spec.expandedKey;

    ctx.fillStyle = isExpanded ? BADGE_EXPANDED_FILL : BADGE_DEFAULT_FILL;
    ctx.beginPath();
    ctx.arc(x, y, spec.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = BADGE_TEXT_FILL;
    ctx.fillText(String(s.points.length), x, y);
  }
}

/** Cap: max duplicate badges drawn per frame (verbatim from `scatter-plot.ts:52`). */
export const DUPLICATE_BADGES_MAX_VISIBLE = 800;

interface BadgesRendererDeps {
  getCanvas: () => HTMLCanvasElement | undefined;
  getTransform: () => { x: number; y: number; k: number };
  getSize: () => { width: number; height: number };
  getExpandedKey: () => string | null;
}

/**
 * Cull `_duplicateStacks` to the viewport window, then cap to the top-N largest
 * groups — but always keep the currently-expanded stack if it is still on screen
 * (so its spider stays visible when a denser region pushes it out of the top-N).
 * Pure: caller passes the expanded key + byKey map. Preserves the exact predicate
 * (inclusive bounds) and cap behavior previously inline at the two badge-draw sites.
 */
export function cullAndCapStacks(
  stacks: RenderDuplicateStack[],
  win: ViewportWindow,
  expandedKey: string | null,
  byKey: Map<string, RenderDuplicateStack>,
): RenderDuplicateStack[] {
  const visible = stacks.filter((s) => pointInWindow(s, win));
  if (visible.length <= DUPLICATE_BADGES_MAX_VISIBLE) return visible;

  let capped: RenderDuplicateStack[] = [...visible]
    .sort((a, b) => b.points.length - a.points.length)
    .slice(0, DUPLICATE_BADGES_MAX_VISIBLE);

  if (expandedKey && !capped.some((s) => s.key === expandedKey)) {
    const expanded = byKey.get(expandedKey);
    if (expanded && pointInWindow(expanded, win)) {
      capped = [...capped, expanded];
    }
  }
  return capped;
}

export class DuplicateBadgesCanvasRenderer {
  constructor(private readonly deps: BadgesRendererDeps) {}

  /** Clear in device pixels (canvas is sized to DPR). */
  clear(): void {
    const canvas = this.deps.getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  render(stacks: RenderDuplicateStack[]): void {
    const canvas = this.deps.getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.deps.getSize();

    // Work in CSS pixels for drawing; scale to device pixels once.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const t = this.deps.getTransform();
    drawBadges(ctx, stacks, {
      mapX: (px) => t.x + t.k * px + BADGE_OFFSET.x,
      mapY: (py) => t.y + t.k * py + BADGE_OFFSET.y,
      radius: BADGE_RADIUS,
      font: BADGE_FONT,
      lineWidth: BADGE_LINE_WIDTH,
      expandedKey: this.deps.getExpandedKey(),
    });
  }

  /**
   * Draw badges for a figure-export capture (#301/#302). Unlike render():
   * - the canvas is already sized to the OUTPUT physical pixel dims, so we
   *   draw in raw device pixels (identity transform, no devicePixelRatio);
   * - stack px/py are final output-canvas pixels (projected through the
   *   export scales by the caller) — no live zoom-transform math;
   * - all geometry (radius, offset, font, line width) is multiplied by
   *   `badgeScale` (dpr × sizeScaleFactor), the same uniform factor the
   *   exported dots' sizes use, so badge-to-dot proportions match the live
   *   view at any output size — and stay uniform in x/y (circles stay round).
   *
   * Static: the export target canvas, stacks, and expanded key are passed
   * directly, so this needs none of the live-overlay deps (transform, size,
   * live canvas) and the caller renders without constructing an instance.
   */
  static renderExport(
    canvas: HTMLCanvasElement | undefined,
    stacks: RenderDuplicateStack[],
    badgeScale: number,
    expandedKey: string | null,
  ): void {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBadges(ctx, stacks, {
      mapX: (px) => px + BADGE_OFFSET.x * badgeScale,
      mapY: (py) => py + BADGE_OFFSET.y * badgeScale,
      radius: BADGE_RADIUS * badgeScale,
      font: badgeFont(BADGE_FONT_SIZE * badgeScale),
      lineWidth: BADGE_LINE_WIDTH * badgeScale,
      expandedKey,
    });
  }
}
