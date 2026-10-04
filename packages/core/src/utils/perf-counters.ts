/**
 * Work counters for the Playwright perf checks (`apps/web/tests/perf-*.spec.ts`).
 *
 * `null` unless the page URL carries `?perfCounters`, so a call site costs one null
 * check in production: `if (perfCounters) perfCounters.render++`. With the flag the
 * object is also exposed as `window.__protspacePerfCounters`, which the specs diff
 * before and after each interaction.
 */
interface PerfCounters {
  /** Full GPU re-stages (`populateBuffers` calls), and which parts they rewrote. */
  restage: number;
  restagePos: number;
  restageStyle: number;
  /** Wall time spent in `populateBuffers`, in ms. */
  restageMs: number;
  render: number;
  /** Points drawn by the most recent render (a value, not a count). */
  drawn: number;
  processData: number;
  gridRebuild: number;
  legendUpdate: number;
  legendRebuild: number;
}

function createPerfCounters(): PerfCounters | null {
  if (typeof window === 'undefined' || typeof location === 'undefined') return null;
  if (!new URLSearchParams(location.search).has('perfCounters')) return null;
  const counters: PerfCounters = {
    restage: 0,
    restagePos: 0,
    restageStyle: 0,
    restageMs: 0,
    render: 0,
    drawn: 0,
    processData: 0,
    gridRebuild: 0,
    legendUpdate: 0,
    legendRebuild: 0,
  };
  (window as unknown as { __protspacePerfCounters?: PerfCounters }).__protspacePerfCounters =
    counters;
  return counters;
}

export const perfCounters: PerfCounters | null = createPerfCounters();
