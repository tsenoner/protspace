/**
 * Lightweight Canvas 2D scatter plot for the landing page.
 *
 * It reproduces the explorer's point vocabulary without importing the explorer: filled discs
 * with a darkened rim, grey "Other" and N/A drawn underneath, 0.9 base opacity. Category changes
 * crossfade in place so the geometry visibly stays fixed while only the annotation changes.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from './motion';

interface ScatterCanvasProps {
  /** Normalized coordinates in [0, 1]; y grows upward like the explorer. */
  x: Float32Array;
  y: Float32Array;
  /** Per-point category index into `palette`. */
  categories: ArrayLike<number>;
  /** Category index → CSS color. */
  palette: readonly string[];
  /** Categories drawn underneath everything else (Other, N/A). */
  baseCategories?: readonly number[];
  /** Point radius in CSS px on a 600px-wide canvas; scales with the rendered width. */
  pointRadius?: number;
  /** Draw every point in neutral grey (the pre-annotation entry state). */
  neutral?: boolean;
  /** Crossfade length when colors change. */
  transitionMs?: number;
  /** Enable hover emphasis and tooltips. */
  interactive?: boolean;
  onHover?: (index: number | null) => void;
  renderTooltip?: (index: number) => ReactNode;
  className?: string;
  'aria-label'?: string;
}

const NEUTRAL_COLOR = '#c4cad3';
const BASE_OPACITY = 0.9;
const FADED_OPACITY = 0.18;
const HIT_RADIUS_PX = 9;
/** Fraction of each axis kept clear around the data, mirrored by `toPercent` for overlays. */
const PAD_FRACTION = 0.04;

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The explorer darkens the rim to 50% of the fill color. */
function rimColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * 0.5));
  return `rgb(${r} ${g} ${b})`;
}

interface Layout {
  width: number;
  height: number;
  dpr: number;
  radius: number;
}

function toScreen(layout: Layout, nx: number, ny: number): [number, number] {
  const { width, height } = layout;
  const span = 1 - 2 * PAD_FRACTION;
  return [(PAD_FRACTION + nx * span) * width, (PAD_FRACTION + (1 - ny) * span) * height];
}

/** CSS `left`/`top` percentages of the point at normalized (nx, ny), for HTML overlays. */
export function toPercent(nx: number, ny: number): { left: string; top: string } {
  const span = 1 - 2 * PAD_FRACTION;
  return {
    left: `${(PAD_FRACTION + nx * span) * 100}%`,
    top: `${(PAD_FRACTION + (1 - ny) * span) * 100}%`,
  };
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  props: ScatterCanvasProps,
  layout: Layout,
  neutral: boolean,
  only?: number,
) {
  const { x, y, categories, palette, baseCategories = [] } = props;
  const { radius } = layout;
  const order = [
    ...baseCategories,
    ...palette.map((_, i) => i).filter((i) => !baseCategories.includes(i)),
  ];
  // Rim: the explorer darkens the outer ~15% of the radius (at least one device pixel, at most
  // about a third), inside the disc so the point does not grow.
  const rim = Math.min(Math.max(radius * 0.15, 1 / layout.dpr), radius * 0.3);
  ctx.lineJoin = 'round';
  for (const category of order) {
    if (only !== undefined && category !== only) continue;
    const color = neutral ? NEUTRAL_COLOR : palette[category];
    if (!color) continue;

    ctx.beginPath();
    let count = 0;
    for (let i = 0; i < x.length; i++) {
      if (categories[i] !== category) continue;
      const [sx, sy] = toScreen(layout, x[i], y[i]);
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
      if (categories[i] !== category) continue;
      const [sx, sy] = toScreen(layout, x[i], y[i]);
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
    categories,
    palette,
    baseCategories,
    pointRadius = 2.6,
    neutral = false,
    transitionMs = 550,
    interactive = false,
    onHover,
    renderTooltip,
    className,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0, dpr: 1 });
  const [hover, setHover] = useState<{ index: number; px: number; py: number } | null>(null);

  const propsRef = useRef(props);
  propsRef.current = props;
  const layers = useRef<{
    current: HTMLCanvasElement | null;
    previous: HTMLCanvasElement | null;
    start: number;
    frame: number;
  }>({ current: null, previous: null, start: 0, frame: 0 });

  const layout: Layout = {
    width: box.width,
    height: box.height,
    dpr: box.dpr,
    radius: pointRadius * Math.min(1.5, Math.max(0.55, box.width / 600)),
  };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Callers rebuild these arrays per render; compare by content so a parent re-render does not
  // re-rasterize 7,831 points or restart an in-flight crossfade.
  const paletteKey = palette.join('|');
  const baseKey = (baseCategories ?? []).join(',');

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

    const elapsed = performance.now() - state.start;
    const t = state.previous ? Math.min(1, elapsed / transitionMs) : 1;
    const hovered = hover?.index;

    if (hovered !== undefined) {
      ctx.globalAlpha = FADED_OPACITY / BASE_OPACITY;
      ctx.drawImage(state.current, 0, 0);
      ctx.globalAlpha = BASE_OPACITY;
      ctx.scale(dpr, dpr);
      const current = propsRef.current;
      drawPoints(
        ctx,
        current,
        layoutRef.current,
        current.neutral ?? false,
        current.categories[hovered],
      );
      ctx.globalAlpha = 1;
      const [sx, sy] = toScreen(layoutRef.current, current.x[hovered], current.y[hovered]);
      ctx.beginPath();
      ctx.arc(sx, sy, layoutRef.current.radius + 3, 0, Math.PI * 2);
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
  }, [hover, transitionMs]);

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
    state.start = performance.now();
    state.current = next;
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(composite);
    return () => cancelAnimationFrame(state.frame);
  }, [x, y, categories, paletteKey, baseKey, pointRadius, neutral, box, composite]);

  useEffect(() => {
    onHover?.(hover?.index ?? null);
  }, [hover?.index, onHover]);

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.pointerType === 'touch') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best = -1;
    let bestDistance = HIT_RADIUS_PX * HIT_RADIUS_PX;
    for (let i = 0; i < x.length; i++) {
      const [sx, sy] = toScreen(layoutRef.current, x[i], y[i]);
      const d = (sx - px) ** 2 + (sy - py) ** 2;
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
      className={`relative h-full w-full ${interactive ? 'cursor-crosshair' : ''} ${className ?? ''}`}
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
