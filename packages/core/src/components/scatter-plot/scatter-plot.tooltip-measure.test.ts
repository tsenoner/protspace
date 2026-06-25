// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
import './scatter-plot';

type Internals = HTMLElement & {
  _tooltipData: unknown;
  _tooltipHeight: number | null;
  _tooltipMeasureToken: number;
  renderRoot: { querySelector(s: string): unknown };
  _measureTooltipHeight(): void;
};

// A controllable deferred standing in for the child tooltip's updateComplete.
function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function withStubChild(sp: Internals, height: number, ready: Promise<unknown>) {
  const child = { offsetHeight: height, updateComplete: ready } as unknown;
  (sp as unknown as { renderRoot: { querySelector: () => unknown } }).renderRoot = {
    querySelector: (s: string) => (s.includes('protein-tooltip') ? child : null),
  };
}

describe('tooltip-height async measurement race (F-25 characterization lock)', () => {
  it('a newer hover (token bump) suppresses the stale measure write', async () => {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp._tooltipData = { id: 'p0' };
    sp._tooltipHeight = null;
    const d = makeDeferred<void>();
    withStubChild(sp, 42, d.promise);
    sp._measureTooltipHeight(); // captures token T, awaits d.promise
    sp._tooltipMeasureToken++; // a newer hover bumps the token while we wait
    d.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sp._tooltipHeight).toBeNull(); // stale measure must NOT write 42
  });

  it('clearing _tooltipData before resolve suppresses the write', async () => {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp._tooltipData = { id: 'p0' };
    sp._tooltipHeight = null;
    const d = makeDeferred<void>();
    withStubChild(sp, 42, d.promise);
    sp._measureTooltipHeight();
    sp._tooltipData = null; // tooltip cleared mid-flight
    d.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sp._tooltipHeight).toBeNull();
  });

  it('a single in-flight measure with a matching token writes the height', async () => {
    const sp = document.createElement('protspace-scatterplot') as Internals;
    sp._tooltipData = { id: 'p0' };
    sp._tooltipHeight = null;
    const d = makeDeferred<void>();
    withStubChild(sp, 42, d.promise);
    sp._measureTooltipHeight();
    d.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sp._tooltipHeight).toBe(42);
  });
});
