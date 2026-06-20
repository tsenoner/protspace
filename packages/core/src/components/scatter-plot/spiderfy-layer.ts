import type { Selection } from 'd3';
import type { PlotDataPoint } from '@protspace/utils';
import type { ViewportDuplicateStack } from './duplicate-stack-types';

const SPIDERFY_NODE_RADIUS = 5;
export const SPIDERFY_CLICK_DIST2_MAX = 16; // (4px)² movement budget for a tap
export const SPIDERFY_CLICK_MS_MAX = 700;

interface SpiderNode {
  point: PlotDataPoint;
  idx: number;
  x: number;
  y: number;
  /** ring radius (shared by all nodes of the stack). */
  r: number;
}

/** Ring geometry: radius = min(70, max(22, 12 + n*2)); node i at angle i/n*2π − π/2. */
export function computeSpiderNodes(points: PlotDataPoint[]): SpiderNode[] {
  const n = points.length;
  const r = Math.min(70, Math.max(22, 12 + n * 2));
  return points.map((point, idx) => {
    const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
    return { point, idx, x: r * Math.cos(angle), y: r * Math.sin(angle), r };
  });
}

/** A press/release counts as a click iff it was short and barely moved. */
export function isClickGesture(
  press: { x: number; y: number; t: number },
  release: { clientX: number; clientY: number; now: number },
): boolean {
  const dx = release.clientX - press.x;
  const dy = release.clientY - press.y;
  return (
    dx * dx + dy * dy <= SPIDERFY_CLICK_DIST2_MAX && release.now - press.t <= SPIDERFY_CLICK_MS_MAX
  );
}

interface SpiderfyLayerDeps {
  getColor: (p: PlotDataPoint) => string;
  onActivate: (event: MouseEvent, p: PlotDataPoint) => void; // → host _handleClick (INV-05)
  onHover: (event: MouseEvent, p: PlotDataPoint) => void; // → host _handleMouseOver
  onHoverEnd: () => void; // → host _clearHoverState
}

type SvgG = Selection<SVGGElement, unknown, null, undefined>;

/**
 * Owns the SVG spiderfy ring + the pointer-capture click-synthesis state machine.
 * Native 'click' can be eaten by d3.zoom, so taps are reconstructed from
 * pointerdown/up via {@link isClickGesture}. Caller positions the layer; this
 * builds the ring (constant screen-size via scale(1/k)) and wires interaction.
 */
export class SpiderfyLayer {
  private readonly pressByPointerId = new Map<number, { x: number; y: number; t: number }>();

  constructor(private readonly deps: SpiderfyLayerDeps) {}

  /** Clear any tracked presses (called on collapse / data swap). */
  reset(): void {
    this.pressByPointerId.clear();
  }

  /** Render the ring for `stack` into `layer`, scaled to `k` so it stays screen-constant. */
  render(layer: SvgG, stack: ViewportDuplicateStack, k: number): void {
    layer.selectAll('*').remove();
    const nodes = computeSpiderNodes(stack.points);
    const spiderGroup = layer
      .append('g')
      .attr('class', 'dup-spiderfy')
      // Keep spiderfy UI constant-size in screen pixels via scale(1/k)
      .attr('transform', `translate(${stack.px},${stack.py}) scale(${1 / k})`);

    // Leader lines
    spiderGroup
      .selectAll('line.dup-spiderfy-line')
      .data(nodes)
      .enter()
      .append('line')
      .attr('class', 'dup-spiderfy-line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', (d) => d.x)
      .attr('y2', (d) => d.y);

    // Clickable nodes
    const gNodes = spiderGroup
      .selectAll('g.dup-spiderfy-node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'dup-spiderfy-node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    // Create circles with explicit pointer-events and handle selection via pointer press/release.
    // We avoid relying on the native 'click' event because it can be suppressed by d3.zoom gesture handling.
    gNodes
      .append('circle')
      .attr('class', 'dup-spiderfy-node-circle')
      .attr('r', SPIDERFY_NODE_RADIUS)
      .attr('fill', (d) => this.deps.getColor(d.point))
      .style('pointer-events', 'all')
      .style('cursor', 'pointer')
      .on('pointerdown', (event: PointerEvent) => {
        event.stopPropagation();
        if (typeof event.pointerId === 'number') {
          this.pressByPointerId.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            t: Date.now(),
          });
        }
        // Keep pointer events routed to this element even if the pointer moves slightly.
        const el = event.currentTarget as HTMLElement | null;
        if (
          el &&
          typeof el.setPointerCapture === 'function' &&
          typeof event.pointerId === 'number'
        ) {
          try {
            el.setPointerCapture(event.pointerId);
          } catch {
            // ignore
          }
        }
      })
      .on('pointerup', (event: PointerEvent, d: SpiderNode) => {
        event.stopPropagation();
        const rec =
          typeof event.pointerId === 'number'
            ? this.pressByPointerId.get(event.pointerId)
            : undefined;
        if (typeof event.pointerId === 'number') this.pressByPointerId.delete(event.pointerId);
        if (!rec) return;
        // Treat a short, low-movement press/release as a click.
        if (
          isClickGesture(rec, { clientX: event.clientX, clientY: event.clientY, now: Date.now() })
        ) {
          this.deps.onActivate(event as unknown as MouseEvent, d.point);
        }
      })
      .on('lostpointercapture', (event: PointerEvent) => {
        if (typeof event.pointerId === 'number') this.pressByPointerId.delete(event.pointerId);
      })
      .on('pointercancel', (event: PointerEvent) => {
        if (typeof event.pointerId === 'number') this.pressByPointerId.delete(event.pointerId);
      })
      // Show the real tooltip for the hovered protein (not the stack centroid)
      .on('mouseenter', (event: MouseEvent, d: SpiderNode) => this.deps.onHover(event, d.point))
      .on('mouseleave', () => this.deps.onHoverEnd());
  }
}
