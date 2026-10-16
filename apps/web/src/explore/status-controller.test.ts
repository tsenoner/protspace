import type { ProtspacePlotStatus, ProtspaceScatterplot } from '@protspace/core';
import { describe, expect, it, vi } from 'vitest';
import { createStatusController } from './status-controller';
import type { WorkbenchStatus } from './workbench-status';

const fire = (target: EventTarget, type: string, detail?: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail }));

function setup() {
  const plot = new EventTarget();
  const status = Object.assign(new EventTarget(), {
    count: null as number | null,
    zoomedIn: false,
    filterConditions: 0,
    isolation: null as { steps: number; size: number } | null,
    hiddenCategories: 0,
  });
  let current = { appliedFilterConditions: 0 } as WorkbenchStatus;
  const listeners = new Set<() => void>();
  const callbacks = {
    openFilter: vi.fn(),
    clearFilter: vi.fn(),
    openLegend: vi.fn(),
    showAllCategories: vi.fn(),
    resetIsolation: vi.fn(),
  };
  const controller = createStatusController({
    plotElement: plot as unknown as ProtspaceScatterplot,
    plotStatus: status as unknown as ProtspacePlotStatus,
    getStatus: () => current,
    subscribeStatus: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ...callbacks,
  });
  const publish = (patch: Partial<WorkbenchStatus>) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  };
  return { controller, plot, status, publish, listeners, ...callbacks };
}

describe('status controller', () => {
  it('view-status-change feeds the count and the zoomed-in flag', () => {
    const m = setup();
    fire(m.plot, 'view-status-change', { count: 7831, zoomedIn: true });
    expect(m.status.count).toBe(7831);
    expect(m.status.zoomedIn).toBe(true);
  });

  it('hidden-values-change feeds the hidden categories', () => {
    const m = setup();
    fire(m.plot, 'hidden-values-change', { count: 4 });
    expect(m.status.hiddenCategories).toBe(4);
  });

  it('data-isolation feeds the steps and the size; data-isolation-reset clears it', () => {
    const m = setup();
    fire(m.plot, 'data-isolation', {
      isolationHistory: [['P1', 'P2', 'P3'], ['P1']],
      isolationMode: true,
      dataSize: 1,
    });
    expect(m.status.isolation).toEqual({ steps: 2, size: 1 });
    fire(m.plot, 'data-isolation-reset', { isolationHistory: [], isolationMode: false });
    expect(m.status.isolation).toBeNull();
  });

  it('a status store change updates filterConditions', () => {
    const m = setup();
    expect(m.status.filterConditions).toBe(0);
    m.publish({ appliedFilterConditions: 2 });
    expect(m.status.filterConditions).toBe(2);
  });

  it('each chip event calls its callback', () => {
    const m = setup();
    fire(m.status, 'status-open', { kind: 'filter' });
    fire(m.status, 'status-open', { kind: 'hidden' });
    fire(m.status, 'status-open', { kind: 'isolation' });
    expect(m.openFilter).toHaveBeenCalledOnce();
    expect(m.openLegend).toHaveBeenCalledOnce();

    fire(m.status, 'status-clear', { kind: 'filter' });
    fire(m.status, 'status-clear', { kind: 'isolation' });
    fire(m.status, 'status-clear', { kind: 'hidden' });
    expect(m.clearFilter).toHaveBeenCalledOnce();
    expect(m.resetIsolation).toHaveBeenCalledOnce();
    expect(m.showAllCategories).toHaveBeenCalledOnce();
  });

  it('dispose removes every listener', () => {
    const m = setup();
    m.controller.dispose();
    fire(m.plot, 'view-status-change', { count: 5, zoomedIn: false });
    fire(m.plot, 'hidden-values-change', { count: 1 });
    fire(m.status, 'status-clear', { kind: 'filter' });
    expect(m.status.count).toBeNull();
    expect(m.status.hiddenCategories).toBe(0);
    expect(m.clearFilter).not.toHaveBeenCalled();
    expect(m.listeners.size).toBe(0);
  });
});
