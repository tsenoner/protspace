/**
 * Runs one deferred state change after the browser has painted the next frame.
 *
 * An input handler that applies an expensive change (re-colouring or moving
 * every point) holds back the frame that shows the input's own feedback: work
 * done in the handler, in the microtasks after it, or in a requestAnimationFrame
 * callback all runs before the next paint, so the menu stays open and the old
 * label stays on screen until the work is done. A task posted from a
 * requestAnimationFrame callback runs only after that frame's rendering step,
 * so the handler shows its feedback, and the change follows one frame later.
 *
 * Why not `scheduler.yield()`: it resumes as a high-priority continuation and
 * does not wait for a paint. `setTimeout(0)` posted from a rAF callback is at
 * timer nesting level 1, so no engine clamps it.
 *
 * One instance per control: scheduling again replaces a change still waiting,
 * so the last pick wins and a stale one is never applied after a newer one.
 */
export class AfterPaintCommit {
  private _commit: (() => void) | null = null;
  private _rafId: number | null = null;
  private _timeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Run `commit` after the next paint, in place of any change still waiting. */
  schedule(commit: () => void): void {
    this.cancel();
    this._commit = commit;
    // A hidden page paints no frame, and some test DOMs have no rAF: post the task directly.
    if (typeof requestAnimationFrame !== 'function' || document.hidden) {
      this._timeoutId = setTimeout(() => this.flush(), 0);
      return;
    }
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._timeoutId = setTimeout(() => this.flush(), 0);
    });
  }

  /** Apply the waiting change now, if there is one. */
  flush(): void {
    const commit = this._commit;
    this.cancel();
    commit?.();
  }

  /** Drop the waiting change. */
  cancel(): void {
    this._commit = null;
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    if (this._timeoutId !== null) clearTimeout(this._timeoutId);
    this._rafId = null;
    this._timeoutId = null;
  }
}
