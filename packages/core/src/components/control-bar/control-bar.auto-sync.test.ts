/**
 * @vitest-environment jsdom
 *
 * Lifetime contract for the control bar's auto-sync timers.
 *
 * With `autoSync` on, connecting the control bar polls the document for the
 * scatter plot (up to 10 `setTimeout` retries) and, once found, schedules an
 * initial sync 50 ms later. Those timers used to outlive the element: a control
 * bar removed while a retry was pending kept polling, latched onto a scatter plot
 * it no longer belonged to, and — once jsdom had been torn down at the end of a
 * test file — threw `ReferenceError: document is not defined`, which made
 * `vitest --run` exit 1 even though every assertion passed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './control-bar';

interface ControlBarInternals extends HTMLElement {
  autoSync: boolean;
  updateComplete: Promise<unknown>;
  _scatterplotElement: unknown;
  _syncWithScatterplot(): void;
}

/** Long enough to drain every retry (10 attempts, ≤ 550 ms apart) plus the sync. */
const DRAIN_MS = 10_000;

function mountControlBar(): ControlBarInternals {
  const controlBar = document.createElement('protspace-control-bar') as ControlBarInternals;
  controlBar.autoSync = true;
  document.body.appendChild(controlBar);
  return controlBar;
}

function addScatterplot(): HTMLElement {
  const plot = document.createElement('protspace-scatterplot');
  document.body.appendChild(plot);
  return plot;
}

describe('control-bar auto-sync timers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops retrying the scatter plot lookup once the control bar is removed', async () => {
    const controlBar = mountControlBar();
    await controlBar.updateComplete;

    // First lookup ran synchronously on connect and found nothing; a retry is pending.
    expect(vi.getTimerCount()).toBe(1);
    controlBar.remove();
    expect(vi.getTimerCount()).toBe(0);
    const querySpy = vi.spyOn(document, 'querySelector');
    const plot = addScatterplot();
    const addListenerSpy = vi.spyOn(plot, 'addEventListener');

    await vi.advanceTimersByTimeAsync(DRAIN_MS);

    expect(querySpy).not.toHaveBeenCalledWith('protspace-scatterplot');
    expect(addListenerSpy).not.toHaveBeenCalled();
    expect(controlBar._scatterplotElement).toBeNull();
  });

  it('cancels the pending initial sync once the control bar is removed', async () => {
    addScatterplot();
    const controlBar = mountControlBar();
    await controlBar.updateComplete;
    expect(controlBar._scatterplotElement).not.toBeNull();

    const syncSpy = vi.spyOn(controlBar, '_syncWithScatterplot');
    expect(vi.getTimerCount()).toBe(1);
    controlBar.remove();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(DRAIN_MS);

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('still finds a late scatter plot and syncs while connected', async () => {
    const controlBar = mountControlBar();
    await controlBar.updateComplete;
    const syncSpy = vi.spyOn(controlBar, '_syncWithScatterplot');

    const plot = addScatterplot();
    await vi.advanceTimersByTimeAsync(DRAIN_MS);

    expect(controlBar._scatterplotElement).toBe(plot);
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it('resumes auto-sync when re-attached after a removal', async () => {
    const controlBar = mountControlBar();
    await controlBar.updateComplete;
    controlBar.remove();

    const plot = addScatterplot();
    document.body.appendChild(controlBar);
    const syncSpy = vi.spyOn(controlBar, '_syncWithScatterplot');

    await vi.advanceTimersByTimeAsync(DRAIN_MS);

    expect(controlBar._scatterplotElement).toBe(plot);
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});
