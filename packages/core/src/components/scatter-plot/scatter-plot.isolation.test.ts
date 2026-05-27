/**
 * @vitest-environment jsdom
 *
 * Unit tests for the isolation-state event contract on protspace-scatterplot.
 *
 * These tests construct the element via document.createElement without appending
 * it to the DOM, so Lit's connectedCallback/firstUpdated never fire and we avoid
 * the WebGL/canvas init that would otherwise blow up under jsdom. The constructor
 * does new ResizeObserver(...), which jsdom doesn't provide, so we stub that one
 * global before the element module is imported.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

import './scatter-plot';

type ScatterplotInternals = HTMLElement & {
  _isolationMode: boolean;
  _isolationHistory: string[][];
  clearIsolationState(options?: { silent?: boolean }): void;
  isIsolationMode(): boolean;
};

describe('scatter-plot clearIsolationState', () => {
  let sp: ScatterplotInternals;
  let events: CustomEvent[];

  beforeEach(() => {
    sp = document.createElement('protspace-scatterplot') as ScatterplotInternals;
    events = [];
    sp.addEventListener('data-isolation-reset', (event) => {
      events.push(event as CustomEvent);
    });
  });

  it('dispatches data-isolation-reset when previously isolated', () => {
    sp._isolationMode = true;
    sp._isolationHistory = [['p1', 'p2', 'p3']];

    sp.clearIsolationState();

    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ isolationHistory: [], isolationMode: false });
    expect(events[0].bubbles).toBe(true);
    expect(events[0].composed).toBe(true);
    expect(sp.isIsolationMode()).toBe(false);
    expect(sp._isolationHistory).toEqual([]);
  });

  it('does not dispatch when never isolated (fresh load)', () => {
    sp.clearIsolationState();

    expect(events).toHaveLength(0);
    expect(sp.isIsolationMode()).toBe(false);
  });

  it('does not dispatch when called with { silent: true } from resetIsolation', () => {
    sp._isolationMode = true;
    sp._isolationHistory = [['p1', 'p2']];

    sp.clearIsolationState({ silent: true });

    expect(events).toHaveLength(0);
    expect(sp.isIsolationMode()).toBe(false);
    expect(sp._isolationHistory).toEqual([]);
  });
});
