/**
 * F-04: NumericRecomputeRunner
 *
 * Owns the numeric-annotation recompute lifecycle extracted verbatim from
 * `ProtspaceScatterplot._scheduleNumericAnnotationRefresh` (scatter-plot.ts
 * L839-915): the per-schedule job id, the synchronous `numeric-recompute-start`
 * dispatch, the deferred (requestAnimationFrame) heavy-recompute tail, the
 * stale-job drop (B7/F-23 last-write-wins), the `numeric-recompute-end` dispatch
 * with a durationMs measured from the captured start time, the running-state
 * mirror, and cancel-on-teardown (F-05).
 *
 * The component supplies the data-refresh routing + lifecycle-bound render tail
 * + the `data-change` re-emit via `runRecompute()`; that body stays in the
 * component because the three render sequences differ and must not be unified.
 *
 * Behavior preserved exactly from the original inline implementation:
 *   - schedule() bails (no events, no state change) when the host has no data.
 *   - The job id is bumped + captured per schedule(); the RAF body bails when
 *     the captured id was superseded — a superseded (older) job runs no body and
 *     dispatches no `numeric-recompute-end`.
 *   - The `numeric-recompute-end` `annotation` detail is re-read from the host
 *     at end time (the original RAF body reads `this.selectedAnnotation`), not
 *     the value captured at schedule() time.
 *   - durationMs is `performance.now() - startedAt`, where startedAt is captured
 *     synchronously in schedule() (0 if unavailable — preserved from the
 *     original's `startedAt == null ? 0 : ...`).
 *   - The body runs before the end event; running state resets after the end
 *     event, followed by a requestUpdate().
 */
interface NumericRecomputeHost {
  /** Whether the host currently holds data (gates schedule). */
  hasData(): boolean;
  /** The active annotation, re-read at start and at end (matches production). */
  getSelectedAnnotation(): string;
  /** Dispatch a CustomEvent-equivalent (type + detail) from the host. */
  dispatch(type: string, detail: unknown): void;
  /** Trigger a host re-render (Lit requestUpdate). */
  requestUpdate(): void;
  /** Mirror the running flag onto the host's reactive `@state`. */
  setRunning(running: boolean): void;
  /**
   * Component-owned data-refresh routing + lifecycle-bound render tail + the
   * `data-change` re-emit. Runs inside the deferred RAF for the current job.
   */
  runRecompute(): void;
}

export class NumericRecomputeRunner {
  private _jobId = 0;
  private _rafId: number | null = null;
  private _running = false;
  private _annotation: string | null = null;
  private _startedAt: number | null = null;

  constructor(private readonly _host: NumericRecomputeHost) {}

  isRunning(): boolean {
    return this._running;
  }

  runningAnnotation(): string | null {
    return this._annotation;
  }

  schedule(): void {
    if (!this._host.hasData()) return;

    const annotation = this._host.getSelectedAnnotation();
    const jobId = ++this._jobId;
    this._running = true;
    this._annotation = annotation;
    this._startedAt = performance.now();
    this._host.setRunning(true);
    this._host.dispatch('numeric-recompute-start', { annotation });
    this._host.requestUpdate();

    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (jobId !== this._jobId) return; // superseded — last-write-wins

      this._host.runRecompute();

      this._host.dispatch('numeric-recompute-end', {
        annotation: this._host.getSelectedAnnotation(),
        durationMs: this._startedAt == null ? 0 : performance.now() - this._startedAt,
      });

      this._running = false;
      this._annotation = null;
      this._startedAt = null;
      this._host.setRunning(false);
      this._host.requestUpdate();
    });
  }

  cancel(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._jobId++; // invalidate any in-flight job
    this._running = false;
    this._annotation = null;
    this._startedAt = null;
    this._host.setRunning(false);
  }
}
