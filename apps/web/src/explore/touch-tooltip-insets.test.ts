import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TouchTooltipInsets } from '@protspace/core';
import { bindTouchTooltipInsets, measureTouchTooltipInsets } from './touch-tooltip-insets';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

const element = (box: DOMRect) => ({ getBoundingClientRect: () => box }) as unknown as Element;

describe('measureTouchTooltipInsets', () => {
  it("keeps the tool strip's width on the left and the lifted status corner at the bottom", () => {
    // A phone plot at (0, 100); the tool strip at 12 px, 44 px wide; a 20 px status line, lifted
    // 12 + 50 + 8 px above the plot's bottom while a tap's selection shows.
    const insets = measureTouchTooltipInsets(
      element(rect(0, 100, 412, 510)),
      element(rect(12, 112, 44, 180)),
      element(rect(12, 570, 200, 20)),
      70,
    );
    expect(insets).toEqual({ top: 0, right: 0, bottom: 70 + 20, left: 56 });
  });

  it('a hidden tool strip covers nothing', () => {
    const insets = measureTouchTooltipInsets(
      element(rect(300, 100, 412, 510)),
      element(rect(0, 0, 0, 0)),
      element(rect(312, 570, 200, 20)),
      70,
    );
    expect(insets.left).toBe(0);
  });
});

describe('bindTouchTooltipInsets', () => {
  const observers: Array<{ callback: () => void; targets: Element[]; disconnect: () => void }> = [];

  afterEach(() => {
    observers.length = 0;
    vi.unstubAllGlobals();
  });

  it('sets the insets on the plot, again when the chrome resizes, and stops on dispose', () => {
    // The lift comes from workbench.css's --wb-status-lift, the one place it is set.
    let lift = '70px';
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => (name === '--wb-status-lift' ? lift : ''),
    }));
    const pointer = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => pointer);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        targets: Element[] = [];
        disconnect = vi.fn();
        constructor(public callback: () => void) {
          observers.push(this);
        }
        observe(target: Element) {
          this.targets.push(target);
        }
      },
    );
    let status = rect(12, 570, 200, 20);
    const plot = {
      touchTooltipInsets: { top: 0, right: 0, bottom: 0, left: 0 } as TouchTooltipInsets,
      getBoundingClientRect: () => rect(0, 100, 412, 510),
    };
    const tools = element(rect(12, 112, 44, 180));
    const statusEl = { getBoundingClientRect: () => status } as unknown as Element;

    const dispose = bindTouchTooltipInsets(plot as never, tools, statusEl);
    expect(plot.touchTooltipInsets).toEqual({ top: 0, right: 0, bottom: 90, left: 56 });
    expect(observers[0].targets).toEqual([tools, statusEl]);

    // The status line wraps to two rows.
    status = rect(12, 550, 200, 40);
    observers[0].callback();
    expect(plot.touchTooltipInsets.bottom).toBe(110);

    // Unchanged boxes write nothing, so the plot does not re-render.
    const before = plot.touchTooltipInsets;
    observers[0].callback();
    expect(plot.touchTooltipInsets).toBe(before);

    // The pointer turns fine: the mouse-sized bar lifts the status corner 12 + 38 + 8 px.
    lift = '58px';
    const [, onPointerChange] = pointer.addEventListener.mock.calls[0];
    onPointerChange();
    expect(plot.touchTooltipInsets.bottom).toBe(98);

    dispose();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(pointer.removeEventListener).toHaveBeenCalledWith('change', onPointerChange);
  });
});
