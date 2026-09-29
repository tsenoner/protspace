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

describe('control-bar density layer select', () => {
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

  const select = () =>
    controlBar.shadowRoot?.querySelector('#density-layer-select') as HTMLSelectElement | null;

  it('dispatches density-layer-change and mirrors the mode onto the plot config', async () => {
    const handler = vi.fn();
    controlBar.addEventListener('density-layer-change', handler);

    const el = select();
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toBe('Density layer');

    el!.value = 'auto';
    el!.dispatchEvent(new Event('change'));
    await controlBar.updateComplete;

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({
      densityLayer: 'auto',
    });
    expect(controlBar.densityLayer).toBe('auto');
    expect(plot.config).toEqual({
      pointSize: 42,
      densityLayer: 'auto',
    });
  });

  it('shows the current mode as the selected option', async () => {
    controlBar.densityLayer = 'on';
    await controlBar.updateComplete;

    expect(select()?.value).toBe('on');
  });

  it.each(['off', 'auto', 'on'] as const)('option %s writes mode %s', async (value) => {
    const handler = vi.fn();
    controlBar.addEventListener('density-layer-change', handler);

    const el = select();
    expect([...el!.options].map((o) => o.value)).toEqual(['off', 'auto', 'on']);
    expect([...el!.options].map((o) => o.textContent?.trim())).toEqual([
      'Contour: off',
      'Contour: auto',
      'Contour: on',
    ]);

    el!.value = value;
    el!.dispatchEvent(new Event('change'));
    await controlBar.updateComplete;

    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ densityLayer: value });
    expect(controlBar.densityLayer).toBe(value);
    expect(plot.config).toMatchObject({ densityLayer: value });
    expect(select()?.value).toBe(value);
  });
});
