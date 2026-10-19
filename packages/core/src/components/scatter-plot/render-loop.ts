import type { WebGLRenderer } from './webgl';

interface RenderLoopHost {
  /** The full render. It calls `noteDrawn()` when it draws a frame. */
  render(): void;
  /** The live renderer: null until the first resize builds it, and after a disconnect. */
  renderer(): Pick<WebGLRenderer, 'isMorphing' | 'morphNextPositionChange' | 'cancelMorph'> | null;
  /** Set or drop `data-morphing`, which hides badges and overlays while the points glide. */
  setMorphing(on: boolean): void;
  /** End hover: it hit-tests the positions the points glide to. */
  endHover(): void;
}

/**
 * When the plot draws, and its projection glide.
 *
 * One interaction used to re-stage the buffers once per state change it
 * touched: each plot.updated() and each legend mapping event rendered on the
 * spot. They now call request(), which draws once on the next frame. The
 * renderer ORs every invalidate*() into its own dirty flags, so that one render
 * stages the union of what the requests needed.
 *
 * Two draws bypass the coalescing:
 * - A resize renders with now(): resize() just cleared the canvas, and a
 *   ResizeObserver callback runs after this frame's rAF callbacks, so a
 *   deferred render would paint one blank frame. now() takes the place of a
 *   waiting request, and one observer callback per frame keeps this at one
 *   redraw per frame.
 * - A zoom or pan draws on PlotInteractionController's own animation frame,
 *   through the host's `_renderWebGL`, without the rest of the full render.
 *   A full render requested for the same frame draws it again. The camera
 *   frame counts as drawn (noteDrawn), but only the full render carries a
 *   glide on to its next frame.
 */
export class RenderLoop {
  private _frameId: number | null = null;
  // Whether every point is still in the slot it was last drawn in, which a
  // projection switch needs to glide (see noteGeometry).
  private _slotsKept = true;
  // Whether the full render in progress drew a frame.
  private _drawn = false;

  constructor(private readonly host: RenderLoopHost) {}

  /**
   * Ask for a full render on the next frame. Every request made before that
   * frame shares the one render. Without requestAnimationFrame (some test DOMs)
   * it renders immediately, as every call site did before coalescing.
   */
  request() {
    if (this._frameId !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this._render();
      return;
    }
    this._frameId = requestAnimationFrame(() => this.flush());
  }

  /**
   * Run a requested render now, if one is waiting. Anything that reads what the
   * renderer last drew (export, data extent) calls this first.
   */
  flush() {
    if (this._frameId !== null) this.now();
  }

  /** Render now and drop any render requested for the next frame. */
  now() {
    this.cancel();
    this._render();
  }

  /** Drop the render requested for the next frame, if any. */
  cancel() {
    if (this._frameId === null) return;
    cancelAnimationFrame(this._frameId);
    this._frameId = null;
  }

  /**
   * After a geometry rebuild. A change that kept every point in the slot it was
   * last drawn in (a projection or plane switch) glides; any other change ends a
   * glide at once.
   */
  noteGeometry(slotsKept: boolean) {
    this._slotsKept &&= slotsKept;
    if (this._slotsKept) this._startGlide();
    else this.cancelGlide();
  }

  /** A frame was drawn, so every point now sits in the slot it is drawn in. */
  noteDrawn() {
    this._slotsKept = true;
    this._drawn = true;
  }

  /** End any glide at once: the next frame draws the staged positions. */
  cancelGlide() {
    this.host.renderer()?.cancelMorph();
    this.host.setMorphing(false);
  }

  private _render() {
    this._drawn = false;
    this.host.render();
    if (!this._drawn) return;
    // A glide draws a frame per animation frame, in the render that every
    // other request for that frame shares.
    if (this.host.renderer()?.isMorphing) this.request();
    else this.host.setMorphing(false);
  }

  /**
   * Glide the points to the positions the next render stages instead of jumping
   * there (see WebGLRenderer.morphNextPositionChange); the full render draws one
   * frame per animation frame until they arrive. Badges, overlays and hover
   * already follow the new positions, so they stay hidden until then.
   */
  private _startGlide() {
    // Without animation frames request() renders on the spot, so the glide
    // would recurse through every one of its frames.
    if (
      typeof requestAnimationFrame !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      this.cancelGlide();
      return;
    }
    const renderer = this.host.renderer();
    if (!renderer) return;
    renderer.morphNextPositionChange();
    this.host.endHover();
    this.host.setMorphing(true);
  }
}
