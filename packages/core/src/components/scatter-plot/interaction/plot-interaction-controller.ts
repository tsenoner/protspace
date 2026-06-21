import * as d3 from 'd3';
import type { PlotDataPoint } from '@protspace/utils';
import type { RenderWebGLTrigger } from '../webgl-render-perf';

export interface PlotInteractionHost {
  getSvg(): SVGSVGElement | undefined;
  getCanvas(): HTMLCanvasElement | undefined;
  getMergedConfig(): {
    width: number;
    height: number;
    zoomExtent: [number, number];
    margin: { top: number; right: number; bottom: number; left: number };
  };
  getSelectionMode(): boolean;
  getSelectionTool(): 'rectangle' | 'lasso';
  // Readiness: whether the host's scales (and thus data) exist yet. Mirrors main's
  // `!this._scales` guard so updateSelectionMode is a no-op before data arrives.
  hasScales(): boolean;
  // host owns _transform (F-48): the controller reads it back through this getter
  // rather than keeping a parallel copy. applyZoom funnels new transforms through
  // onTransform first, so reads here always see the latest value.
  getTransform(): d3.ZoomTransform;
  // host-owned spatial + picking (reuses _quadtreeIndex / _slotsToInteractiveIds / pickInteractivePointAt)
  queryByPolygon(vertices: ReadonlyArray<[number, number]>): number[];
  queryByPixels(x0: number, y0: number, x1: number, y1: number): number[];
  resolveSlotsToIds(slots: number[]): string[];
  pickInteractivePointAt(mouseX: number, mouseY: number): PlotDataPoint | null;
  // callbacks — dispatch stays on the host (INV-03/INV-05)
  onTransform(t: d3.ZoomTransform): void;
  onSelect(ids: string[], clearVisual: () => void): void;
  onHover(event: MouseEvent, point: PlotDataPoint | null): void;
  onHoverEnd(): void;
  onClick(event: MouseEvent): void;
  renderWebGL(trigger: RenderWebGLTrigger): void;
  updateSelectionOverlays(opts?: { duplicateImmediate?: boolean }): void;
}

/**
 * Owns the d3 zoom/brush/lasso interaction layer, the three SVG groups, and the
 * zoom/lasso RAF loops, lifted out of the scatter-plot god component (F-07). It
 * signals the host via callbacks; the host keeps event dispatch and owns the
 * transform value (written back via onTransform — F-48). Hover throttling and
 * picking stay on the host (host-only quadtree/visibility access).
 */
export class PlotInteractionController {
  private _zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
  private _svgSelection: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private _mainGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  private _brushGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  private _overlayGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  private _brush: d3.BrushBehavior<unknown> | null = null;
  private _isBrushing = false;
  private _lassoVertices: Array<[number, number]> = [];
  private _lassoPath: SVGPathElement | null = null;
  private _isLassoing = false;

  private _zoomRafId: number | null = null;
  private _lassoRafId: number | null = null;

  constructor(private readonly host: PlotInteractionHost) {}

  get mainGroup() {
    return this._mainGroup;
  }
  get overlayGroup() {
    return this._overlayGroup;
  }
  get isBrushing() {
    return this._isBrushing;
  }

  initialize(): void {
    const svg = this.host.getSvg();
    if (!svg) return;

    this._svgSelection = d3.select(svg);

    // Clear existing content
    this._svgSelection.selectAll('*').remove();

    // Create main container group
    this._mainGroup = this._svgSelection.append('g').attr('class', 'scatter-plot-container');

    // Create brush group
    this._brushGroup = this._svgSelection.append('g').attr('class', 'brush-container');

    // Create overlay group (above brush) for transient drawings like selections
    this._overlayGroup = this._svgSelection.append('g').attr('class', 'overlay-container');

    this._zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(this.host.getMergedConfig().zoomExtent)
      .on('zoom', (event) => this.applyZoom(event.transform));
    this._svgSelection.call(this._zoom);
    this._setupDblClickHandlers();
  }

  /** Apply a transform (from the d3 zoom handler or programmatic reset). */
  applyZoom(t: d3.ZoomTransform): void {
    // Host owns the transform (F-48): write it back first so the brush-extent sync
    // below (and any other host.getTransform() read) sees the new value.
    this.host.onTransform(t);
    if (this._mainGroup) {
      this._mainGroup.attr('transform', t.toString());
    }
    if (this._brushGroup) {
      this._brushGroup.attr('transform', t.toString());
    }
    if (this._overlayGroup) {
      this._overlayGroup.attr('transform', t.toString());
    }
    // Smooth WebGL rendering during zoom using requestAnimationFrame
    if (this.host.getCanvas()) {
      if (this._zoomRafId !== null) {
        cancelAnimationFrame(this._zoomRafId);
      }
      this._zoomRafId = requestAnimationFrame(() => {
        this._zoomRafId = null;
        this.host.renderWebGL('zoom');
        // During active zoom/pan, defer duplicate badge DOM updates to keep interactions smooth.
        this.host.updateSelectionOverlays({ duplicateImmediate: false });
      });
    }
    // Keep brush extent in sync with the viewport when scroll-zooming in selection mode.
    // Skip if a brush gesture is in progress — re-applying the brush resets D3's drag state.
    if (
      this.host.getSelectionMode() &&
      this.host.getSelectionTool() === 'rectangle' &&
      this._brush &&
      !this._isBrushing
    ) {
      this.updateBrushExtent();
    }
  }

  resetZoom(): void {
    if (this._zoom && this._svgSelection) {
      this._svgSelection.transition().duration(750).call(this._zoom.transform, d3.zoomIdentity);
    }
  }

  /** Disable D3's built-in double-click zoom and attach our own reset handler. */
  private _setupDblClickHandlers(): void {
    if (!this._svgSelection) return;
    this._svgSelection.on('dblclick.zoom', null);
    this._svgSelection.on('dblclick.reset', (event: MouseEvent) => {
      event.preventDefault();
      this.resetZoom();
    });
  }

  setupCanvasEventHandling(): void {
    if (!this._svgSelection) return;

    // Use event delegation on the SVG overlay for canvas interactions
    this._svgSelection
      .on('mousemove.canvas', (event) => this.host.onHover(event, null))
      .on('click.canvas', (event) => this.host.onClick(event))
      .on('mouseout.canvas', () => this.host.onHoverEnd());
  }

  updateSelectionMode(): void {
    if (!this._svgSelection || !this._brushGroup || !this.host.hasScales()) return;

    // Clean up both selection tools
    this._brushGroup.selectAll('*').remove();
    this._cleanupLasso();
    this._brush = null;
    this._isBrushing = false;

    if (this.host.getSelectionMode()) {
      // Keep scroll-wheel zoom active but disable drag-to-pan (drag = selection)
      if (this._zoom && this._svgSelection) {
        this._svgSelection
          .on('mousedown.zoom', null)
          .on('touchstart.zoom', null)
          .on('touchmove.zoom', null)
          .on('touchend.zoom', null);
      }

      if (this.host.getSelectionTool() === 'lasso') {
        this._setupLasso();
      } else {
        this._setupBrush();
      }
    } else {
      // Re-enable zoom
      if (this._zoom) {
        this._svgSelection.call(this._zoom);
        this._setupDblClickHandlers();
      }
    }
  }

  private _setupBrush(): void {
    if (!this._svgSelection || !this._brushGroup) return;

    this._brush = d3
      .brush()
      .handleSize(0)
      .on('start', () => {
        this._isBrushing = true;
      })
      .on('end', (event) => {
        this._isBrushing = false;
        this._handleBrushEnd(event);
      });

    this.updateBrushExtent();
  }

  /** Recompute the brush extent from the current zoom transform and re-apply. */
  updateBrushExtent(): void {
    if (!this._brush || !this._brushGroup) return;

    const config = this.host.getMergedConfig();
    const t = this.host.getTransform();
    const vx0 = t.invertX(0);
    const vy0 = t.invertY(0);
    const vx1 = t.invertX(config.width);
    const vy1 = t.invertY(config.height);

    this._brush.extent([
      [Math.min(vx0, vx1), Math.min(vy0, vy1)],
      [Math.max(vx0, vx1), Math.max(vy0, vy1)],
    ]);

    this._brushGroup.call(this._brush);
  }

  // ── Lasso selection ──────────────────────────────────────────────

  private _setupLasso(): void {
    if (!this._svgSelection) return;

    this._svgSelection
      .on('pointerdown.lasso', (event: PointerEvent) => {
        if (event.button !== 0) return; // left click only
        event.preventDefault();
        this.beginLasso(this._pointerToLocal(event));
        // Capture pointer for reliable tracking even if cursor leaves the SVG
        (event.target as Element)?.setPointerCapture?.(event.pointerId);
      })
      .on('pointermove.lasso', (event: PointerEvent) => {
        if (!this._isLassoing || !this._lassoPath) return;
        event.preventDefault();
        this.extendLasso(this._pointerToLocal(event));
      })
      .on('pointerup.lasso', (event: PointerEvent) => {
        if (!this._isLassoing) return;
        event.preventDefault();
        (event.target as Element)?.releasePointerCapture?.(event.pointerId);
        this.endLasso();
      });
  }

  /** Convert a pointer event to local (untransformed) SVG coordinates. */
  private _pointerToLocal(event: PointerEvent): [number, number] {
    const [svgX, svgY] = d3.pointer(event);
    const t = this.host.getTransform();
    const localX = (svgX - t.x) / t.k;
    const localY = (svgY - t.y) / t.k;
    return [localX, localY];
  }

  beginLasso(start: [number, number]): void {
    this._isLassoing = true;
    this._lassoVertices = [start];

    // Create the SVG path in the brush group (same coordinate space as the brush)
    if (this._brushGroup) {
      this._lassoPath = this._brushGroup.append('path').attr('class', 'lasso-path').node();
    }
  }

  extendLasso(pt: [number, number]): void {
    this._lassoVertices.push(pt);

    // Throttle SVG path updates to animation frames
    if (this._lassoRafId === null) {
      this._lassoRafId = requestAnimationFrame(() => {
        this._lassoRafId = null;
        if (!this._lassoPath || this._lassoVertices.length < 2) return;

        const d = this._lassoVertices
          .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`)
          .join(' ');
        this._lassoPath.setAttribute('d', d);
      });
    }
  }

  endLasso(): void {
    this._isLassoing = false;

    // Need at least 3 vertices to form a polygon
    if (this._lassoVertices.length < 3) {
      this._clearLassoVisual();
      return;
    }

    // Close the path visually
    if (this._lassoPath) {
      const d = this._lassoPath.getAttribute('d') ?? '';
      this._lassoPath.setAttribute('d', d + ' Z');
    }

    const slots = this.host.queryByPolygon(this._lassoVertices);
    const selectedIds = this.host.resolveSlotsToIds(slots);
    this.host.onSelect(selectedIds, () => this._clearLassoVisual());
  }

  private _handleBrushEnd(event: d3.D3BrushEvent<unknown>): void {
    if (!event.selection) return;

    const [[x0, y0], [x1, y1]] = event.selection as [[number, number], [number, number]];
    const slots = this.host.queryByPixels(x0, y0, x1, y1);
    const selectedIds = this.host.resolveSlotsToIds(slots);
    this.host.onSelect(selectedIds, () => {
      if (this._brush && this._brushGroup) {
        this._brushGroup.call(this._brush.move, null);
      }
    });
  }

  private _clearLassoVisual(): void {
    if (this._lassoPath) {
      this._lassoPath.remove();
      this._lassoPath = null;
    }
    this._lassoVertices = [];
  }

  private _cleanupLasso(): void {
    if (this._svgSelection) {
      this._svgSelection.on('pointerdown.lasso', null);
      this._svgSelection.on('pointermove.lasso', null);
      this._svgSelection.on('pointerup.lasso', null);
    }
    if (this._lassoRafId !== null) {
      cancelAnimationFrame(this._lassoRafId);
      this._lassoRafId = null;
    }
    this._lassoPath?.remove();
    this._lassoPath = null;
    this._lassoVertices = [];
    this._isLassoing = false;
  }

  /** Cancel the zoom/lasso RAFs, interrupt the reset transition, tear down brush + lasso. */
  teardown(): void {
    if (this._zoomRafId !== null) {
      cancelAnimationFrame(this._zoomRafId);
      this._zoomRafId = null;
    }
    this._svgSelection?.interrupt();
    if (this._brush) {
      this._brush.on('start', null).on('end', null);
      this._brush = null;
      this._isBrushing = false;
    }
    this._cleanupLasso();
  }
}
