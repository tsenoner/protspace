/**
 * F-04: NumericRecomputeRunner
 *
 * Owns the numeric-annotation recompute lifecycle extracted verbatim from
 * `ProtspaceScatterplot._scheduleNumericAnnotationRefresh` (scatter-plot.ts
 * L839-915): the per-schedule job id, the deferred (requestAnimationFrame)
 * heavy-recompute tail, the stale-job drop (B7/F-23 last-write-wins), the
 * running-state mirror, and cancel-on-teardown (F-05).
 *
 * (F-46) The previously-dispatched `numeric-recompute-start` / `-end`
 * CustomEvents were unconsumed public surface and have been removed; the busy
 * state is now observable solely via the `setRunning` host mirror and the
 * runner's own `runningAnnotation()`.
 *
 * The component supplies the data-refresh routing + lifecycle-bound render tail
 * + the `data-change` re-emit via `runRecompute()`; that body stays in the
 * component because the three render sequences differ and must not be unified.
 *
 * Behavior preserved exactly from the original inline implementation:
 *   - schedule() bails (no state change) when the host has no data.
 *   - The job id is bumped + captured per schedule(); the RAF body bails when
 *     the captured id was superseded — a superseded (older) job runs no body and
 *     leaves the busy state untouched.
 *   - The body runs inside the deferred RAF for the current job; running state
 *     resets after the body, followed by a requestUpdate().
 */
interface NumericRecomputeHost {
  /** Whether the host currently holds data (gates schedule). */
  hasData(): boolean;
  /** The active annotation, re-read at start and at end (matches production). */
  getSelectedAnnotation(): string;
  /** Mirror the running flag onto the host's reactive `@state` (also schedules Lit update). */
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
  private _annotation: string | null = null;

  constructor(private readonly _host: NumericRecomputeHost) {}

  runningAnnotation(): string | null {
    return this._annotation;
  }

  schedule(): void {
    if (!this._host.hasData()) return;

    const annotation = this._host.getSelectedAnnotation();
    const jobId = ++this._jobId;
    this._annotation = annotation;
    // F-57: setRunning writes the `_numericRecomputeRunning` @state mirror, whose
    // reactive setter already schedules a Lit update — an explicit requestUpdate()
    // here was redundant and has been dropped.
    this._host.setRunning(true);

    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (jobId !== this._jobId) return; // superseded — last-write-wins

      this._host.runRecompute();

      this._annotation = null;
      // F-57: the setRunning @state-mirror write schedules the Lit update; the
      // explicit requestUpdate() that used to follow was redundant.
      this._host.setRunning(false);
    });
  }

  cancel(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._jobId++; // invalidate any in-flight job
    this._annotation = null;
    this._host.setRunning(false);
  }
}
