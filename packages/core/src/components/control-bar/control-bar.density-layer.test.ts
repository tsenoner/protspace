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
    // A real element: the control bar adds and removes listeners on whatever
    // `_scatterplotElement` holds, so a bare object blows up on teardown.
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
    // A native select with an aria-label is the accessibility floor: labelled,
    // keyboard operable, announced with its current value.
    expect(el?.getAttribute('aria-label')).toBe('Density layer');

    el!.value = 'auto';
    el!.dispatchEvent(new Event('change'));
    await controlBar.updateComplete;

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ densityLayer: 'auto' });
    expect(controlBar.densityLayer).toBe('auto');
    // The rest of the config has to survive the write: assigning a bare
    // `{ densityLayer }` would drop every other key the host had set.
    expect(plot.config).toEqual({ pointSize: 42, densityLayer: 'auto' });
  });

  it('shows the current mode as the selected option', async () => {
    controlBar.densityLayer = 'on';
    await controlBar.updateComplete;

    expect(select()?.value).toBe('on');
  });
});
