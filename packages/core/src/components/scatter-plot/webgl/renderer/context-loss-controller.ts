/**
 * ContextLossController
 *
 * Owns the WebGL2 context-loss lifecycle for {@link WebGLRenderer}: it registers
 * the `webglcontextlost` listener, tracks the idempotent "lost" flag, and fires
 * the renderer-supplied `onLost` callback exactly once.
 *
 * Recovery semantics: the renderer no longer attempts an
 * in-place context *restore*. The `webglcontextrestored` listener and
 * `handleContextRestored` were deleted, so this controller registers ONLY `webglcontextlost`.
 *
 * This is a behavior-preserving extraction of the renderer's
 * `handleContextLost` / `markContextLost` logic — see webgl-renderer.ts.
 */
export class ContextLossController {
  private lost = false;

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.markLost();
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onLost: () => void,
  ) {
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, {
      passive: false,
    });
  }

  /**
   * Mark the context as lost. Idempotent: the first call sets the flag and fires
   * `onLost` once; subsequent calls are no-ops.
   */
  markLost(): void {
    if (this.lost) return;
    this.lost = true;
    this.onLost();
  }

  /** Whether the context has been observed as lost. */
  get isLost(): boolean {
    return this.lost;
  }

  /** Remove the `webglcontextlost` listener. */
  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
  }
}
