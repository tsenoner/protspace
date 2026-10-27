// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EatReliabilityInput } from '@protspace/utils';
import type { PsSwitch } from '../kit/switch';
import './eat-panel';
import type { ProtspaceEatPanel } from './eat-panel';
import { EAT_THRESHOLD_COMMIT_DELAY_MS } from './eat-reliability-controller';
import { createEatFixture } from './test-support/eat-fixture';

/** The controller through the EAT panel, its one host: the switch, the handles and boxes. */
async function setup(): Promise<ProtspaceEatPanel> {
  const panel = document.createElement('protspace-eat-panel');
  Object.assign(panel, { data: createEatFixture(), annotation: 'toxin', active: true });
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

async function setupAt(state: EatReliabilityInput): Promise<ProtspaceEatPanel> {
  const panel = await setup();
  panel.setReliabilityState(state);
  await panel.updateComplete;
  return panel;
}

const $ = <T extends Element>(panel: ProtspaceEatPanel, selector: string) =>
  panel.shadowRoot!.querySelector<T>(selector)!;
const lower = (panel: ProtspaceEatPanel) =>
  $<HTMLInputElement>(panel, '#eat-reliability-threshold');
const upper = (panel: ProtspaceEatPanel) => $<HTMLInputElement>(panel, '#eat-reliability-upper');
const percents = (panel: ProtspaceEatPanel) => [
  ...panel.shadowRoot!.querySelectorAll<HTMLInputElement>('.eat-threshold-percent'),
];
const listen = (panel: ProtspaceEatPanel) => {
  const listener = vi.fn();
  panel.addEventListener('eat-overlay-change', listener);
  return listener;
};
const detail = (listener: ReturnType<typeof vi.fn>) => listener.mock.lastCall?.[0].detail;

function drag(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

async function toggle(panel: ProtspaceEatPanel, checked: boolean): Promise<void> {
  const show = $<PsSwitch>(panel, 'ps-switch.eat-show');
  show.checked = checked;
  show.dispatchEvent(new Event('change'));
  await panel.updateComplete;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('EAT reliability controller: switch, handles and boxes', () => {
  it('emits the switch and the threshold, keeping the handle and the box in step', async () => {
    const panel = await setup();
    const listener = listen(panel);

    await toggle(panel, false);
    expect(detail(listener)).toMatchObject({
      enabled: false,
      reliability: expect.objectContaining({ min: 0 }),
    });
    expect(lower(panel).disabled).toBe(true);

    await toggle(panel, true);
    drag(lower(panel), '0.73');
    // Releasing the handle flushes the debounced apply so the emit lands now.
    lower(panel).dispatchEvent(new Event('change'));
    await panel.updateComplete;
    expect(percents(panel)[0]!.value).toBe('73');
    // A screen reader hears the percentage the box shows, not the 0–1 fraction.
    expect(lower(panel).getAttribute('aria-valuetext')).toBe('73\u202f%');
    expect(detail(listener)).toMatchObject({
      enabled: true,
      reliability: expect.objectContaining({ min: 0.73 }),
    });

    const box = percents(panel)[0]!;
    box.value = '34';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new Event('change'));
    await panel.updateComplete;
    expect(detail(listener)).toMatchObject({
      enabled: true,
      reliability: expect.objectContaining({ min: 0.34 }),
    });
    expect(lower(panel).value).toBe('0.34');
  });

  it('debounces the threshold apply: display stays live, the emit defers ~150ms', async () => {
    const panel = await setup();
    vi.useFakeTimers();
    const listener = listen(panel);

    drag(lower(panel), '0.62');
    expect(panel.reliabilityThreshold).toBe(0.62);
    await panel.updateComplete;
    expect(percents(panel)[0]!.value).toBe('62');
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledOnce();
    expect(detail(listener)).toMatchObject({
      enabled: true,
      reliability: expect.objectContaining({ min: 0.62 }),
    });
  });

  it('commits exactly EAT_THRESHOLD_COMMIT_DELAY_MS after the last tick, not before', async () => {
    expect(EAT_THRESHOLD_COMMIT_DELAY_MS).toBe(150);
    const panel = await setup();
    vi.useFakeTimers();
    const listener = listen(panel);

    drag(lower(panel), '0.5');
    vi.advanceTimersByTime(EAT_THRESHOLD_COMMIT_DELAY_MS - 1);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('collapses a rapid drag into a single deferred emit', async () => {
    const panel = await setup();
    vi.useFakeTimers();
    const listener = listen(panel);

    for (const value of ['0.1', '0.2', '0.3', '0.45']) drag(lower(panel), value);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledOnce();
    expect(detail(listener)).toMatchObject({ reliability: expect.objectContaining({ min: 0.45 }) });
  });

  it('flushes the pending apply immediately on release (@change), once', async () => {
    const panel = await setup();
    vi.useFakeTimers();
    const listener = listen(panel);

    drag(lower(panel), '0.4');
    expect(listener).not.toHaveBeenCalled();
    lower(panel).dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenCalledOnce();
    expect(detail(listener)).toMatchObject({ reliability: expect.objectContaining({ min: 0.4 }) });

    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('applies the switch immediately and drops a pending threshold commit', async () => {
    const panel = await setup();
    vi.useFakeTimers();
    const listener = listen(panel);

    drag(lower(panel), '0.55');
    await toggle(panel, false);
    expect(listener).toHaveBeenCalledOnce();
    expect(detail(listener)).toMatchObject({ enabled: false });

    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('cancels a pending threshold commit on disconnect (teardown)', async () => {
    const panel = await setup();
    vi.useFakeTimers();
    const listener = listen(panel);

    drag(lower(panel), '0.55');
    panel.remove();
    vi.advanceTimersByTime(150);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setReliabilityState moves the controls without emitting (reverse mirror)', async () => {
    const panel = await setup();
    const listener = listen(panel);

    panel.setReliabilityState({ min: 0.42, max: 1 });
    await panel.updateComplete;

    expect(panel.reliabilityThreshold).toBe(0.42);
    expect(percents(panel)[0]!.value).toBe('42');
    expect(listener).not.toHaveBeenCalled();
  });
});

/**
 * #380: one range, both ends included, emitted as the full state so the filter controller can
 * write one un-negated condition carrying the N/A presence chip, which keeps curated points visible.
 */
describe('EAT reliability controller: the range (#380)', () => {
  it('always shows a low and a high handle and box, starting at the full range', async () => {
    const panel = await setup();
    const handles = [...panel.shadowRoot!.querySelectorAll('input[type="range"]')];
    expect(handles.map((el) => el.id)).toEqual([
      'eat-reliability-threshold',
      'eat-reliability-upper',
    ]);
    expect(percents(panel).map((box) => box.value)).toEqual(['0', '100']);
    expect(panel.reliability).toEqual({ min: 0, max: 1 });
    expect(panel.isAtDefaults).toBe(true);
    expect(panel.shadowRoot!.querySelector('.eat-range-row ps-segmented')).toBeNull();
  });

  it('moves the high end alone and emits the range', async () => {
    const panel = await setup();
    const listener = listen(panel);
    drag(upper(panel), '0.8');
    upper(panel).dispatchEvent(new Event('change'));
    expect(detail(listener).reliability).toEqual({ min: 0, max: 0.8 });
    expect(panel.isAtDefaults).toBe(false);
  });

  it('round-trips the full state through the reverse mirror', async () => {
    const panel = await setupAt({ min: 0.25, max: 0.75 });
    expect(panel.reliability).toEqual({ min: 0.25, max: 0.75 });
  });

  it('loads a legacy mode as its range, ignoring the bound the mode never used', async () => {
    expect((await setupAt({ mode: 'atLeast', min: 0.3, max: 0.5 })).reliability).toEqual({
      min: 0.3,
      max: 1,
    });
    expect((await setupAt({ mode: 'atMost', min: 0.3, max: 0.5 })).reliability).toEqual({
      min: 0,
      max: 0.5,
    });
    expect((await setupAt({ mode: 'between', min: 0.3, max: 0.5 })).reliability).toEqual({
      min: 0.3,
      max: 0.5,
    });
  });

  it('restores a bundle threshold as the range threshold..100 %', async () => {
    // A bundle stores the lower bound only; a high end left over would be a band it never saved.
    const panel = await setupAt({ min: 0, max: 0.4 });
    panel.applyEatSettings(true, 0.6);
    expect(panel.reliability).toEqual({ min: 0.6, max: 1 });
  });

  it('restores a bundle saved in Fade as Fade, and one without an outcome as Hide', async () => {
    const panel = await setupAt({ min: 0, max: 1 });
    panel.applyEatSettings(true, 0.5, 'dim');
    expect(panel.outcome).toBe('dim');
    expect(panel.reliability).toEqual({ min: 0.5, max: 1 });
    panel.applyEatSettings(true, 0.6);
    expect(panel.outcome).toBe('hide');
  });

  it('keeps both bounds when the switch is toggled', async () => {
    const panel = await setupAt({ min: 0, max: 0.4 });
    await toggle(panel, false);
    await toggle(panel, true);
    expect(panel.reliability).toEqual({ min: 0, max: 0.4 });
  });

  it('resets the whole range for a new dataset, not just the lower bound', async () => {
    const panel = await setupAt({ min: 0.2, max: 0.4 });
    panel.resetForNewDataset();
    expect(panel.reliability).toEqual({ min: 0, max: 1 });
  });
});

describe('EAT reliability controller: a band’s two handles', () => {
  it('stops the lower handle at the upper one instead of letting it pass', async () => {
    const panel = await setupAt({ min: 0.2, max: 0.6 });
    drag(lower(panel), '0.9');
    const { min, max } = panel.reliability;
    expect(max).toBe(0.6);
    expect(min).toBeLessThan(max);
  });

  it('stops the upper handle at the lower one instead of letting it pass', async () => {
    const panel = await setupAt({ min: 0.4, max: 0.8 });
    drag(upper(panel), '0.1');
    const { min, max } = panel.reliability;
    expect(min).toBe(0.4);
    expect(max).toBeGreaterThan(min);
  });

  it('never lets the two handles land on the same pixel', async () => {
    const panel = await setupAt({ min: 0.5, max: 0.51 });
    drag(lower(panel), '1');
    const { min, max } = panel.reliability;
    expect(max - min).toBeCloseTo(0.01, 10);
  });
});

/**
 * A number input reports an empty field as `''`, and `Number('')` is 0, not NaN. On the upper
 * bound that 0 is `confidence <= 0`, which hides every prediction: the opposite of clearing it.
 */
describe('EAT reliability controller: percent boxes', () => {
  it('reads an emptied upper-bound box as "no upper constraint", not as 0 %', async () => {
    const panel = await setupAt({ min: 0, max: 0.5 });
    drag(percents(panel)[1]!, '');
    expect(panel.reliability).toEqual({ min: 0, max: 1 });
  });

  it('reads an emptied lower-bound box as "no lower constraint"', async () => {
    const panel = await setupAt({ min: 0.6, max: 1 });
    drag(percents(panel)[0]!, '');
    expect(panel.reliability).toEqual({ min: 0, max: 1 });
  });

  it('pins a band box back onto the clamped bound so it cannot show an unused value', async () => {
    const panel = await setupAt({ min: 0.4, max: 0.6 });
    const box = percents(panel)[0]!;
    drag(box, '95');
    await panel.updateComplete;
    expect(panel.reliability.min).toBeCloseTo(0.59, 10);
    expect(box.value).toBe('59');
  });
});
