import { describe, it, expect, vi } from 'vitest';
import { ContextLossController } from './context-loss-controller';

function makeCanvas() {
  const listeners: Record<string, EventListener[]> = {};
  return {
    addEventListener: vi.fn((t: string, cb: EventListener) => {
      (listeners[t] ??= []).push(cb);
    }),
    removeEventListener: vi.fn((t: string, cb: EventListener) => {
      listeners[t] = (listeners[t] ?? []).filter((c) => c !== cb);
    }),
    _fire: (t: string, ev: Event) => (listeners[t] ?? []).forEach((c) => c(ev)),
    _count: (t: string) => (listeners[t] ?? []).length,
  };
}

describe('ContextLossController', () => {
  // POST-B1 reality (R2 / F-39): the restore path was deleted, so the controller
  // registers ONLY `webglcontextlost` — never `webglcontextrestored`.
  it('registers webglcontextlost (and NOT webglcontextrestored) on construction', () => {
    const canvas = makeCanvas();
    new ContextLossController(canvas as unknown as HTMLCanvasElement, vi.fn(), vi.fn());
    expect(canvas._count('webglcontextlost')).toBe(1);
    expect(canvas._count('webglcontextrestored')).toBe(0);
  });

  it('on lost: preventDefault + sets flag + invokes onLost', () => {
    const canvas = makeCanvas();
    const onLost = vi.fn();
    const ctrl = new ContextLossController(canvas as unknown as HTMLCanvasElement, onLost, vi.fn());
    const ev = { preventDefault: vi.fn() } as unknown as Event;
    canvas._fire('webglcontextlost', ev);
    expect(
      (ev as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault,
    ).toHaveBeenCalled();
    expect(ctrl.isLost).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('markLost is idempotent (onLost fired once)', () => {
    const canvas = makeCanvas();
    const onLost = vi.fn();
    const ctrl = new ContextLossController(canvas as unknown as HTMLCanvasElement, onLost, vi.fn());
    ctrl.markLost();
    ctrl.markLost();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(ctrl.isLost).toBe(true);
  });

  it('destroy removes the webglcontextlost listener', () => {
    const canvas = makeCanvas();
    const ctrl = new ContextLossController(
      canvas as unknown as HTMLCanvasElement,
      vi.fn(),
      vi.fn(),
    );
    ctrl.destroy();
    expect(canvas._count('webglcontextlost')).toBe(0);
  });
});
