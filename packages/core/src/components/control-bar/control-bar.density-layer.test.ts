/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './control-bar';
import type { DensityLayerMode, ScatterplotConfig } from '@protspace/utils';

type Bar = HTMLElement & {
  autoSync?: boolean;
  densityLayer?: DensityLayerMode;
  updateComplete?: Promise<unknown>;
  _scatterplotElement?: unknown;
};

/** Resolves in the task after the next frame, once a menu pick has been committed. */
const afterNextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

describe('control-bar contours menu', () => {
  let controlBar: Bar;
  let plot: HTMLElement & { config: Partial<ScatterplotConfig> };

  beforeEach(async () => {
    document.body.innerHTML = '';
    controlBar = document.createElement('protspace-control-bar') as Bar;
    controlBar.autoSync = true;
    document.body.appendChild(controlBar);
    await controlBar.updateComplete;
    plot = document.createElement('div') as HTMLElement & { config: Partial<ScatterplotConfig> };
    plot.config = { pointSize: 42 };
    controlBar._scatterplotElement = plot;
  });

  const trigger = () =>
    controlBar.shadowRoot?.querySelector('#density-layer-trigger') as HTMLButtonElement | null;
  const items = () =>
    [...(controlBar.shadowRoot?.querySelectorAll('.density-item') ?? [])] as HTMLElement[];

  const openMenu = async () => {
    trigger()!.click();
    await controlBar.updateComplete;
  };

  it('lists off, auto and on with the current mode checked', async () => {
    controlBar.densityLayer = 'auto';
    await controlBar.updateComplete;
    expect(items()).toHaveLength(0);

    await openMenu();

    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    expect(items().map((i) => i.dataset.mode)).toEqual(['off', 'auto', 'on']);
    expect(items().map((i) => i.querySelector('.density-item-label')?.textContent)).toEqual([
      'Off',
      'Auto',
      'Always',
    ]);
    expect(items().map((i) => i.querySelector('.density-item-hint')?.textContent)).toEqual([
      'No contours',
      'Fades out as you zoom in; faint or hidden when few points are shown',
      'Full strength at every zoom level',
    ]);
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  });

  it.each(['off', 'auto', 'on'] as const)(
    'picking %s closes the menu, then dispatches it and mirrors it onto the plot after the paint',
    async (mode) => {
      const handler = vi.fn();
      controlBar.addEventListener('density-layer-change', handler);

      await openMenu();
      items()
        .find((i) => i.dataset.mode === mode)!
        .click();
      await controlBar.updateComplete;

      expect(items()).toHaveLength(0);
      expect(controlBar.densityLayer).toBe(mode);
      expect(handler).not.toHaveBeenCalled();
      expect(plot.config).toEqual({ pointSize: 42 });

      await afterNextPaint();

      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ densityLayer: mode });
      expect(plot.config).toEqual({ pointSize: 42, densityLayer: mode });
    },
  );

  it('marks the trigger active only while contours can show', async () => {
    expect(trigger()?.classList.contains('filter-active')).toBe(false);
    controlBar.densityLayer = 'on';
    await controlBar.updateComplete;
    expect(trigger()?.classList.contains('filter-active')).toBe(true);
  });

  it.each([
    ['off', 'Contours', 'Off'],
    ['auto', 'Contours: Auto', 'Auto'],
    ['on', 'Contours: Always', 'Always'],
  ] as const)('names %s on the trigger text, title and aria-label', async (mode, text, label) => {
    controlBar.densityLayer = mode;
    await controlBar.updateComplete;

    expect(trigger()?.querySelector('.dropdown-trigger-text')?.textContent).toBe(text);
    expect(trigger()?.getAttribute('aria-label')).toBe(`Contours: ${label}`);
    expect(trigger()?.getAttribute('title')).toBe(
      `Contours: ${label}. One ring set per legend colour; not included in exports.`,
    );
  });

  it('supports arrow keys and Enter', async () => {
    const handler = vi.fn();
    controlBar.addEventListener('density-layer-change', handler);

    trigger()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await controlBar.updateComplete;
    trigger()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await controlBar.updateComplete;
    trigger()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await controlBar.updateComplete;
    await afterNextPaint();

    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ densityLayer: 'auto' });
    expect(items()).toHaveLength(0);
  });
});
