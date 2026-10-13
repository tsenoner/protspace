/**
 * Lightweight Canvas 2D scatter plot for the landing page.
 *
 * It reproduces the explorer's point vocabulary without importing the explorer: filled discs
 * with a darkened rim, grey "Other" and N/A drawn underneath, 0.9 base opacity. Category changes
 * crossfade in place so the geometry visibly stays fixed while only the annotation changes; new
 * coordinates for the same points (another projection) move each point to its new place.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Category } from './landing-data';
import { prefersReducedMotion } from './motion';

export interface ScatterCanvasProps {
  /** Normalized coordinates in [0, 1]; y grows upward like the explorer. */
  x: Float32Array;
  y: Float32Array;
  /** Per-point index into `categories`. */
  index: ArrayLike<number>;
  /** Legend categories; those with a `kind` (Other, N/A) are drawn underneath the rest. */
  categories: readonly Pick<Category, 'color' | 'kind'>[];
  /** Point radius in CSS px on a 600px-wide canvas; scales with the rendered width. */
  pointRadius?: number;
  /** Draw every point in neutral grey (the pre-annotation entry state). */
  neutral?: boolean;
  /** Crossfade length when colors change. */
  transitionMs?: number;
  onHover?: (index: number | null) => void;
  renderTooltip?: (index: number) => ReactNode;
  'aria-label'?: string;
}

/** The grey of points and legend swatches before a section reveals its colors. */
export const NEUTRAL_COLOR = '#c4cad3';
const BASE_OPACITY = 0.9;
const FADED_OPACITY = 0.18;
const HIT_RADIUS_PX = 9;
/** Fraction of each axis kept clear around the data, mirrored by `toPercent` for overlays. */
const PAD_FRACTION = 0.04;
const MORPH_MS = 800;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Points in flight between two projections: where they started and where they are now. */
interface Morph {
  fromX: Float32Array;
  fromY: Float32Array;
  x: Float32Array;
  y: Float32Array;
  start: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A soft rim: the fill color darkened to 80%, lighter than the explorer's 50%. */
function rimColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * 0.8));
  return `rgb(${r} ${g} ${b})`;
}

interface Layout {
  width: number;
  height: number;
  dpr: number;
  radius: number;
}

const SPAN = 1 - 2 * PAD_FRACTION;
/** Normalized x → fraction of the width, and normalized y (upward) → fraction of the height. */
const toFractionX = (nx: number) => PAD_FRACTION + nx * SPAN;
const toFractionY = (ny: number) => PAD_FRACTION + (1 - ny) * SPAN;

/** CSS `left`/`top` percentages of the point at normalized (nx, ny), for HTML overlays. */
export function toPercent(nx: number, ny: number): { left: string; top: string } {
  return { left: `${toFractionX(nx) * 100}%`, top: `${toFractionY(ny) * 100}%` };
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  props: ScatterCanvasProps,
  layout: Layout,
  neutral: boolean,
  only?: number,
) {
  const { x, y, index, categories } = props;
  const { radius, width, height } = layout;
  // Other and N/A first, so the named categories draw on top of them.
  const order = categories
    .map((category, i) => ({ i, base: category.kind !== undefined }))
    .sort((a, b) => Number(b.base) - Number(a.base))
    .map(({ i }) => i);
  // Rim: the outer ~10% of the radius (at least one device pixel, at most a quarter), inside
  // the disc so the point does not grow.
  const rim = Math.min(Math.max(radius * 0.1, 1 / layout.dpr), radius * 0.25);
  ctx.lineJoin = 'round';
  for (const category of order) {
    if (only !== undefined && category !== only) continue;
    const color = neutral ? NEUTRAL_COLOR : categories[category]?.color;
    if (!color) continue;

    ctx.beginPath();
    let count = 0;
    for (let i = 0; i < x.length; i++) {
      if (index[i] !== category) continue;
      const sx = toFractionX(x[i]) * width;
      const sy = toFractionY(y[i]) * height;
      ctx.moveTo(sx + radius, sy);
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      count++;
    }
    if (!count) continue;
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    const r = radius - rim / 2;
    for (let i = 0; i < x.length; i++) {
      if (index[i] !== category) continue;
      const sx = toFractionX(x[i]) * width;
      const sy = toFractionY(y[i]) * height;
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
    }
    ctx.lineWidth = rim;
    ctx.strokeStyle = rimColor(color);
    ctx.stroke();
  }
}

function renderLayer(props: ScatterCanvasProps, layout: Layout, neutral: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width * layout.dpr));
  canvas.height = Math.max(1, Math.round(layout.height * layout.dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(layout.dpr, layout.dpr);
  ctx.globalAlpha = BASE_OPACITY;
  drawPoints(ctx, props, layout, neutral);
  return canvas;
}

export function ScatterCanvas(props: ScatterCanvasProps) {
  const {
    x,
    y,
    index,
    categories,
    pointRadius = 2.6,
    neutral = false,
    transitionMs = 550,
    onHover,
    renderTooltip,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0, dpr: 1 });
  const [hover, setHover] = useState<{ index: number; px: number; py: number } | null>(null);

  const propsRef = useRef(props);
  propsRef.current = props;
  // Read by `composite` through a ref so a hover change only recomposites, never re-rasterizes.
  const hoveredRef = useRef<number | undefined>(undefined);
  hoveredRef.current = hover?.index;
  const layers = useRef<{
    current: HTMLCanvasElement | null;
    previous: HTMLCanvasElement | null;
    start: number;
    frame: number;
    morph: Morph | null;
    /** The coordinates last rendered, to tell a new projection from a recolor. */
    drawn: { x: Float32Array; y: Float32Array } | null;
  }>({ current: null, previous: null, start: 0, frame: 0, morph: null, drawn: null });

  const layout: Layout = {
    width: box.width,
    height: box.height,
    dpr: box.dpr,
    radius: pointRadius * Math.min(1.5, Math.max(0.55, box.width / 600)),
  };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      setBox((prev) =>
        prev.width === width && prev.height === height && prev.dpr === dpr
          ? prev
          : { width, height, dpr },
      );
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const composite = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const state = layers.current;
    if (!canvas || !ctx || !state.current) return;
    const { dpr } = layoutRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;

    if (state.morph) {
      const morph = state.morph;
      const current = propsRef.current;
      const t = Math.min(1, (performance.now() - morph.start) / MORPH_MS);
      const e = easeInOut(t);
      for (let i = 0; i < current.x.length; i++) {
        morph.x[i] = morph.fromX[i] + (current.x[i] - morph.fromX[i]) * e;
        morph.y[i] = morph.fromY[i] + (current.y[i] - morph.fromY[i]) * e;
      }
      ctx.globalAlpha = BASE_OPACITY;
      ctx.scale(dpr, dpr);
      drawPoints(
        ctx,
        { ...current, x: morph.x, y: morph.y },
        layoutRef.current,
        current.neutral ?? false,
      );
      if (t < 1) {
        state.frame = requestAnimationFrame(composite);
      } else {
        state.morph = null;
        // The morph loop draws no hover emphasis; restore it once the points have landed.
        if (hoveredRef.current !== undefined) state.frame = requestAnimationFrame(composite);
      }
      return;
    }

    const elapsed = performance.now() - state.start;
    const t = state.previous ? Math.min(1, elapsed / transitionMs) : 1;
    const hovered = hoveredRef.current;

    if (hovered !== undefined) {
      ctx.globalAlpha = FADED_OPACITY / BASE_OPACITY;
      ctx.drawImage(state.current, 0, 0);
      ctx.globalAlpha = BASE_OPACITY;
      ctx.scale(dpr, dpr);
      const current = propsRef.current;
      drawPoints(ctx, current, layoutRef.current, current.neutral ?? false, current.index[hovered]);
      ctx.globalAlpha = 1;
      const { width, height, radius } = layoutRef.current;
      ctx.beginPath();
      ctx.arc(
        toFractionX(current.x[hovered]) * width,
        toFractionY(current.y[hovered]) * height,
        radius + 3,
        0,
        Math.PI * 2,
      );
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
      return;
    }

    ctx.drawImage(state.current, 0, 0);
    if (state.previous && t < 1) {
      // Fade the previous annotation out on top: geometry is identical, so only colors change.
      ctx.globalAlpha = 1 - t;
      ctx.drawImage(state.previous, 0, 0);
      ctx.globalAlpha = 1;
      state.frame = requestAnimationFrame(composite);
    } else {
      state.previous = null;
    }
  }, [transitionMs]);

  // Re-render the state bitmap when data, colors or size change, then crossfade to it.
  useEffect(() => {
    if (!box.width || !box.height) return;
    const state = layers.current;
    const next = renderLayer(propsRef.current, layoutRef.current, neutral);
    const canSlide =
      state.current &&
      state.current.width === next.width &&
      state.current.height === next.height &&
      !prefersReducedMotion();
    state.previous = canSlide ? state.current : null;
    const { drawn } = state;
    if (canSlide && drawn && (drawn.x !== x || drawn.y !== y) && drawn.x.length === x.length) {
      // A new projection of the same points: move them rather than crossfade. Mid-flight, start
      // from where the points are now.
      const from = state.morph ?? drawn;
      state.morph = {
        fromX: from.x.slice(),
        fromY: from.y.slice(),
        x: new Float32Array(x.length),
        y: new Float32Array(x.length),
        start: performance.now(),
      };
      state.previous = null;
    }
    state.drawn = { x, y };
    state.start = performance.now();
    state.current = next;
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(composite);
    return () => cancelAnimationFrame(state.frame);
  }, [x, y, index, categories, pointRadius, neutral, box, composite]);

  // Hover emphasis is drawn from the cached layer: recomposite only.
  useEffect(() => {
    const state = layers.current;
    if (!state.current) return;
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(composite);
  }, [hover?.index, composite]);

  useEffect(() => {
    onHover?.(hover?.index ?? null);
  }, [hover?.index, onHover]);

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const { width, height } = layoutRef.current;
    let best = -1;
    let bestDistance = HIT_RADIUS_PX * HIT_RADIUS_PX;
    for (let i = 0; i < x.length; i++) {
      const d = (toFractionX(x[i]) * width - px) ** 2 + (toFractionY(y[i]) * height - py) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    setHover((prev) => {
      if (best < 0) return prev ? null : prev;
      if (prev && prev.index === best) return prev;
      return { index: best, px, py };
    });
  };

  const tooltip = hover && renderTooltip ? renderTooltip(hover.index) : null;
  const flipX = hover ? hover.px > box.width * 0.6 : false;
  const flipY = hover ? hover.py > box.height * 0.7 : false;

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full cursor-crosshair"
      onPointerMove={handleMove}
      onPointerLeave={() => setHover(null)}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={props['aria-label']}
        width={Math.max(1, Math.round(box.width * box.dpr))}
        height={Math.max(1, Math.round(box.height * box.dpr))}
        className="absolute inset-0 h-full w-full"
      />
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-border bg-white/95 px-3 py-2 text-xs text-foreground shadow-md"
          style={{
            ...(flipY ? { bottom: box.height - hover!.py + 12 } : { top: hover!.py + 12 }),
            ...(flipX ? { right: box.width - hover!.px + 12 } : { left: hover!.px + 12 }),
          }}
        >
          {tooltip}
        </div>
      ) : null}
    </div>
  );
}
