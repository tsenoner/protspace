import { describe, expect, it } from 'vitest';
import type { LayoutMode } from './layout-defaults';
import { bindPhoneDim } from './phone-dim';

function fakeMode(initial: LayoutMode) {
  let mode = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => mode,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: LayoutMode) {
      mode = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('bindPhoneDim', () => {
  it("fades unselected points less on a phone, and gives the plot's own fade back elsewhere", () => {
    const plot: { config?: Record<string, unknown> } = { config: { densityLayer: 'x' } };
    const source = fakeMode('desktop');
    const writes: unknown[] = [];
    const watched = {
      get config() {
        return plot.config;
      },
      set config(next) {
        writes.push(next);
        plot.config = next;
      },
    };
    const stop = bindPhoneDim(watched as never, source);
    // Desktop: the plot's default stays, and nothing is written.
    expect(writes).toEqual([]);

    source.set('phone');
    expect(plot.config).toEqual({ densityLayer: 'x', fadedOpacity: 0.25 });
    source.set('landscape');
    expect(writes).toHaveLength(1);
    source.set('tablet');
    expect(plot.config).toEqual({ densityLayer: 'x', fadedOpacity: 0.15 });

    stop();
    source.set('phone');
    expect(plot.config!.fadedOpacity).toBe(0.15);
  });
});
