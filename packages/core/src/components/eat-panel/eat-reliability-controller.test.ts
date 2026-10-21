// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildStorageKey,
  generateDatasetHash,
  setStorageItem,
  type VisualizationData,
} from '@protspace/utils';
import '../legend/legend';
import type { ProtspaceLegend } from '../legend/legend';
import {
  mountLegendWithScatterplot,
  settleLegend,
  stubLocalStorage,
} from '../legend/test-support/legend-scatterplot-harness';
import {
  EAT_THRESHOLD_COMMIT_DELAY_MS,
  EatReliabilityController,
} from './eat-reliability-controller';
import type { PsCheckbox } from '../kit/checkbox';
import type { PsSelect } from '../kit/select';

// The dataset-hash tests seed and read the persisted settings through `localStorage`.
stubLocalStorage();

/** One predicted and one missing protein after `observed` observed ones. */
function makeData(observed = 1): VisualizationData {
  const ids = [
    ...Array.from({ length: observed }, (_, i) => (i ? `observed-${i}` : 'observed')),
    'predicted',
    'missing',
  ];
  return {
    protein_ids: ids,
    projections: [{ name: 'pca', dimension: 2, data: new Float32Array(ids.length * 2) }],
    annotations: {
      ec: {
        kind: 'categorical',
        values: ['observed', 'predicted', '__NA__'],
        colors: ['#111', '#555', '#ccc'],
        shapes: ['circle', 'circle', 'circle'],
      },
      family: {
        kind: 'categorical',
        values: ['family'],
        colors: ['#111'],
        shapes: ['circle'],
      },
    },
    annotation_data: {
      ec: new Int32Array([...Array<number>(observed).fill(0), 2, 2]),
      family: new Int32Array(ids.length),
    },
    annotation_predicted: {
      ec: [
        ...Array<null>(observed).fill(null),
        { value: 'predicted', confidence: 0.8, source: 'observed' },
        null,
      ],
    },
  };
}

async function setup(observed = 1) {
  const data = makeData(observed);
  const { legend, plot } = await mountLegendWithScatterplot(data, 'ec');
  return { data, legend, plot };
}

/** One teardown for every describe in this file — Vitest applies a file-level hook to all of them. */
afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('legend-owned EAT controls', () => {
  it('renders the controls with counts', async () => {
    const { legend } = await setup();
    const root = legend.shadowRoot!;
    const group = root.querySelector<HTMLElement>('.eat-legend')!;

    expect(group.getAttribute('aria-label')).toBe('Embedding Annotation Transfer');
    expect(group.textContent).toContain('Predicted (transferred)');
    expect(group.textContent).toContain('Observed');
    expect(group.textContent).toContain('Predicted by EAT');
    // Default reliability position is 0 (show everything, clean filter box).
    expect(root.querySelector<HTMLInputElement>('.eat-threshold-percent')?.value).toBe('0');
  });

  it('groups the EAT counts in thousands', async () => {
    const { legend } = await setup(1234);
    const counts = legend.shadowRoot!.querySelector('.eat-legend-counts')!.textContent!;
    expect(counts).toMatch(/Observed\s*1,234/);
  });

  it('puts the switch and the mode on the kit, keeping their names', async () => {
    const { legend } = await setup();
    const root = legend.shadowRoot!;

    const toggle = root.querySelector<PsCheckbox>('ps-checkbox.eat-switch')!;
    expect(toggle.label).toBe('Show EAT predictions');
    expect(toggle.checked).toBe(true);
    expect(toggle.textContent!.trim()).toBe('Show');
    // The native checkbox inside carries the name, so the role stays `checkbox`.
    await toggle.updateComplete;
    expect(
      toggle.shadowRoot!.querySelector('input[type="checkbox"]')!.getAttribute('aria-label'),
    ).toBe('Show EAT predictions');

    const mode = root.querySelector<PsSelect>('ps-select.eat-threshold-mode')!;
    expect(mode.label).toBe('EAT reliability filter mode');
    // The small field, so it matches the percent box beside it.
    expect(mode.getAttribute('size')).toBe('sm');
    expect(mode.value).toBe('atLeast');
    expect(mode.disabled).toBe(false);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await legend.updateComplete;
    expect(mode.disabled).toBe(true);
  });

  it('syncs the overlay switch with the scatter plot and emits threshold changes for the filter', async () => {
    const { legend, plot } = await setup();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const toggle = legend.shadowRoot!.querySelector<PsCheckbox>('ps-checkbox.eat-switch')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await legend.updateComplete;

    // The overlay switch still coalesces predictions on the scatter plot.
    expect(plot.eatOverlayEnabled).toBe(false);
    expect(legend.shadowRoot!.querySelector('.eat-legend')).not.toBeNull();
    expect(legend.shadowRoot!.querySelector('.eat-legend-counts')).toBeNull();
    expect(
      legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold input')?.disabled,
    ).toBe(true);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    range.value = '0.73';
    range.dispatchEvent(new Event('input'));
    // Releasing the slider flushes the debounced apply so the emit lands now.
    range.dispatchEvent(new Event('change'));
    await legend.updateComplete;

    expect(plot.eatOverlayEnabled).toBe(true);
    // The threshold is no longer pushed onto the scatter plot as a dimming input;
    // it rides the eat-overlay-change contract and the range/percent stay in sync.
    expect(plot).not.toHaveProperty('eatConfidenceThreshold');
    expect(
      legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')?.value,
    ).toBe('73');
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ enabled: true, confidenceThreshold: 0.73 }),
      }),
    );

    const percent = legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')!;
    percent.value = '34';
    percent.dispatchEvent(new Event('input'));
    percent.dispatchEvent(new Event('change'));
    await legend.updateComplete;
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ enabled: true, confidenceThreshold: 0.34 }),
      }),
    );
    expect(range.value).toBe('0.34');
  });

  it('debounces the threshold apply: display stays live, the emit defers ~150ms', async () => {
    const { legend } = await setup();
    vi.useFakeTimers();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    range.value = '0.62';
    range.dispatchEvent(new Event('input'));

    // The slider thumb value + percent readout update immediately for a smooth drag.
    expect(legend.reliabilityThreshold).toBe(0.62);
    await legend.updateComplete;
    expect(
      legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')?.value,
    ).toBe('62');

    // ...but the expensive downstream apply (the emit that re-runs the query) waits.
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ enabled: true, confidenceThreshold: 0.62 }),
      }),
    );
  });

  it('commits exactly EAT_THRESHOLD_COMMIT_DELAY_MS after the last tick, not before', async () => {
    expect(EAT_THRESHOLD_COMMIT_DELAY_MS).toBe(150);
    const { legend } = await setup();
    vi.useFakeTimers();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    range.value = '0.5';
    range.dispatchEvent(new Event('input'));

    vi.advanceTimersByTime(EAT_THRESHOLD_COMMIT_DELAY_MS - 1);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('collapses a rapid drag into a single deferred emit', async () => {
    const { legend } = await setup();
    vi.useFakeTimers();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    for (const v of ['0.1', '0.2', '0.3', '0.45']) {
      range.value = v;
      range.dispatchEvent(new Event('input'));
    }
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ enabled: true, confidenceThreshold: 0.45 }),
      }),
    );
  });

  it('flushes the pending apply immediately on slider release (@change)', async () => {
    const { legend } = await setup();
    vi.useFakeTimers();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    range.value = '0.4';
    range.dispatchEvent(new Event('input'));
    expect(listener).not.toHaveBeenCalled();

    // Release commits without waiting out the full debounce window.
    range.dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ enabled: true, confidenceThreshold: 0.4 }),
      }),
    );

    // The already-flushed timer must not fire a duplicate emit.
    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('applies the overlay toggle immediately (no debounce)', async () => {
    const { legend } = await setup();
    vi.useFakeTimers();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const toggle = legend.shadowRoot!.querySelector<PsCheckbox>('ps-checkbox.eat-switch')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    // The toggle is a discrete action, not a drag — it emits synchronously.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ enabled: false, confidenceThreshold: 0 }),
      }),
    );
  });

  it('cancels a pending threshold commit when the overlay toggle supersedes it', async () => {
    const { legend } = await setup();
    vi.useFakeTimers();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    // Arm the debounce with a drag tick...
    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    range.value = '0.55';
    range.dispatchEvent(new Event('input'));

    // ...then a discrete toggle applies immediately (one emit) and supersedes it.
    const toggle = legend.shadowRoot!.querySelector<PsCheckbox>('ps-checkbox.eat-switch')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenCalledTimes(1);

    // The superseded debounce timer must not fire a stale second emit.
    vi.advanceTimersByTime(150);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending threshold commit on disconnect (teardown)', async () => {
    const { legend } = await setup();
    vi.useFakeTimers();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    const range = legend.shadowRoot!.querySelector<HTMLInputElement>(
      '.eat-threshold input[type="range"]',
    )!;
    range.value = '0.55';
    range.dispatchEvent(new Event('input'));
    expect(listener).not.toHaveBeenCalled();

    // Tearing the element down clears the pending timer — no emit after teardown.
    legend.remove();
    vi.advanceTimersByTime(150);
    expect(listener).not.toHaveBeenCalled();
  });

  it('setReliabilityState updates the slider without re-emitting (reverse mirror)', async () => {
    const { legend } = await setup();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);

    legend.setReliabilityState({ mode: 'atLeast', min: 0.42, max: 1 });
    await legend.updateComplete;

    expect(legend.reliabilityThreshold).toBe(0.42);
    expect(
      legend.shadowRoot!.querySelector<HTMLInputElement>('.eat-threshold-percent')?.value,
    ).toBe('42');
    // Reverse direction must stay silent so it can't loop back to the filter controller.
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses stable dataset capability and omits controls for a non-EAT selection', async () => {
    const { data, legend, plot } = await setup();
    const filteredView = {
      ...data,
      protein_ids: ['observed'],
      annotation_data: {
        ec: new Int32Array([0]),
        family: new Int32Array([0]),
      },
      annotation_predicted: { ec: [null] },
    };
    plot.getCurrentData = () => filteredView;
    plot.dispatchEvent(new CustomEvent('data-change', { detail: { data: filteredView } }));
    await legend.updateComplete;
    expect(legend.shadowRoot!.querySelector('.eat-legend')).not.toBeNull();

    plot.selectedAnnotation = 'family';
    legend.selectedAnnotation = 'family';
    legend.requestUpdate();
    await legend.updateComplete;
    expect(legend.shadowRoot!.querySelector('.eat-legend')).toBeNull();
  });
});

/**
 * #380 — the legend must be able to express the three filter directions the issue
 * names, not just "hide below". Each mode emits the full state so the filter controller
 * can translate it into one un-negated condition carrying the N/A presence chip,
 * which is what keeps curated points visible.
 */
describe('legend EAT reliability modes (#380)', () => {
  async function selectMode(mode: 'atLeast' | 'atMost' | 'between') {
    const { legend } = await setup();
    const listener = vi.fn();
    legend.addEventListener('eat-overlay-change', listener);
    const select = legend.shadowRoot!.querySelector<PsSelect>('ps-select.eat-threshold-mode')!;
    select.value = mode;
    select.dispatchEvent(new Event('change'));
    await legend.updateComplete;
    return { legend, listener };
  }

  it('offers all three directions', async () => {
    const { legend } = await setup();
    const select = legend.shadowRoot!.querySelector<PsSelect>('ps-select.eat-threshold-mode')!;
    expect(select.options.map((o) => o.value)).toEqual(['atLeast', 'atMost', 'between']);
    expect(select.options.map((o) => o.label)).toEqual([
      'Hide below',
      'Hide above',
      'Keep between',
    ]);
  });

  it('emits the mode immediately, without waiting out the drag debounce', async () => {
    const { listener } = await selectMode('atMost');
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.lastCall?.[0].detail.reliability.mode).toBe('atMost');
  });

  it('reveals a second bound only for a band', async () => {
    const { legend } = await selectMode('between');
    expect(legend.shadowRoot!.querySelector('#eat-reliability-upper')).not.toBeNull();

    const { legend: atLeast } = await selectMode('atLeast');
    expect(atLeast.shadowRoot!.querySelector('#eat-reliability-upper')).toBeNull();
  });

  it('clears the bound a mode no longer uses, so no invisible constraint survives', async () => {
    const { legend } = await setup();
    legend.setReliabilityState({ mode: 'between', min: 0.2, max: 0.6 });
    await legend.updateComplete;

    const select = legend.shadowRoot!.querySelector<PsSelect>('ps-select.eat-threshold-mode')!;
    select.value = 'atLeast';
    select.dispatchEvent(new Event('change'));
    await legend.updateComplete;

    // The upper bound is no longer editable, so it must not still be filtering.
    expect(legend.reliabilityState.max).toBe(1);
  });

  it('round-trips the full state through the reverse mirror', async () => {
    const { legend } = await setup();
    legend.setReliabilityState({ mode: 'between', min: 0.25, max: 0.75 });
    await legend.updateComplete;
    expect(legend.reliabilityState).toEqual({ mode: 'between', min: 0.25, max: 0.75 });
  });

  it('restores a bundle threshold as a lower bound, whatever mode the control was in', async () => {
    // A bundle stores the lower bound only. Writing it into whatever mode the control
    // happens to be in loses it outright in `atMost` (the bound that mode ignores is
    // blanked, so a saved 60% restores as no filter at all).
    const { legend } = await setup();
    legend.setReliabilityState({ mode: 'atMost', min: 0, max: 0.4 });
    await legend.updateComplete;

    legend.applyEatSettings(true, 0.6);
    await legend.updateComplete;

    expect(legend.reliabilityState).toEqual({ mode: 'atLeast', min: 0.6, max: 1 });
  });

  it('keeps the mode and bounds when the overlay switch is toggled', async () => {
    // The switch decides visibility only. Routing it through the bundle-restore path
    // made every toggle a restore too: `atMost`'s lower bound is 0, so flipping the
    // switch off and on rewrote "hide above 40%" as "hide below 0%" — no filter at all.
    const { legend } = await setup();
    legend.setReliabilityState({ mode: 'atMost', min: 0, max: 0.4 });
    await legend.updateComplete;

    const toggle = legend.shadowRoot!.querySelector<PsCheckbox>('ps-checkbox.eat-switch')!;
    for (const checked of [false, true]) {
      toggle.checked = checked;
      toggle.dispatchEvent(new Event('change'));
      await legend.updateComplete;
    }

    expect(legend.reliabilityState).toEqual({ mode: 'atMost', min: 0, max: 0.4 });
  });

  it('resets the whole position for a new dataset, not just the lower bound', async () => {
    // A bundle restores the threshold only. A mode carried over from the previous
    // dataset reinterprets it: a bundle saved as "hide below 60%" would load as
    // "hide above <the previous dataset's upper bound>" — the opposite filter.
    const { legend } = await setup();
    legend.setReliabilityState({ mode: 'atMost', min: 0, max: 0.4 });
    await legend.updateComplete;

    legend.clearForNewDataset('next-dataset-hash');
    await legend.updateComplete;

    expect(legend.reliabilityState).toEqual({ mode: 'atLeast', min: 0, max: 1 });
  });
});

/**
 * A band is one range, not two thresholds. Rendering it as two independent bars drew
 * two fills from 0, so a 25–41% band showed an upper bar filled 0–41% — "keep
 * everything below 41", which is not the filter being applied.
 */
describe('legend EAT reliability band (one track, two thumbs)', () => {
  async function band(min: number, max: number) {
    const { legend } = await setup();
    legend.setReliabilityState({ mode: 'between', min, max });
    await legend.updateComplete;
    const root = legend.shadowRoot!;
    return {
      legend,
      root,
      lower: root.querySelector<HTMLInputElement>('#eat-reliability-threshold')!,
      upper: root.querySelector<HTMLInputElement>('#eat-reliability-upper')!,
    };
  }

  it('puts both bounds on a single shared track', async () => {
    const { root } = await band(0.25, 0.41);
    const track = root.querySelectorAll('.eat-threshold-band');
    expect(track).toHaveLength(1);
    // Both range inputs live inside that one track.
    expect(root.querySelectorAll('.eat-threshold-band input[type="range"]')).toHaveLength(2);
  });

  it('fills only between the thumbs, so what is coloured is what is kept', async () => {
    const { root } = await band(0.25, 0.41);
    const fill = root.querySelector<HTMLElement>('.eat-threshold-fill')!;
    // Inset from BOTH ends — the old two-bar rendering always started at 0.
    expect(fill.style.left).toBe('25%');
    expect(fill.style.right).toBe('59%');
  });

  it('gives every mode the same one-track layout, with a thumb per bound it filters on', async () => {
    // The modes used to look like different controls: `atMost` rendered a dead,
    // disabled lower slider plus a separate "Upper bound" label row — four rows against
    // `atLeast`'s two — so switching modes reshuffled the panel.
    const { legend } = await setup();

    for (const [state, expected] of [
      [{ mode: 'atLeast' as const, min: 0.3, max: 1 }, ['eat-reliability-threshold']],
      [{ mode: 'atMost' as const, min: 0, max: 0.5 }, ['eat-reliability-upper']],
      [
        { mode: 'between' as const, min: 0.3, max: 0.7 },
        ['eat-reliability-threshold', 'eat-reliability-upper'],
      ],
    ] as const) {
      legend.setReliabilityState(state);
      await legend.updateComplete;
      const root = legend.shadowRoot!;

      expect(root.querySelectorAll('.eat-threshold-band')).toHaveLength(1);
      expect(
        Array.from(root.querySelectorAll('.eat-threshold-band input[type="range"]')).map(
          (el) => el.id,
        ),
      ).toEqual(expected);
      // One number box per bound, and never a dead one for a bound the mode ignores.
      expect(root.querySelectorAll('.eat-threshold-percent')).toHaveLength(expected.length);
      expect(root.querySelector('.eat-threshold-band input:disabled')).toBeNull();
    }
  });

  it('fills the kept side in every mode, not whichever side a range input fills', async () => {
    // A plain range input always fills from the left, so `atLeast` — which keeps
    // everything ABOVE its thumb — was colouring exactly the hidden half.
    const { legend } = await setup();
    const fill = () => legend.shadowRoot!.querySelector<HTMLElement>('.eat-threshold-fill')!.style;

    legend.setReliabilityState({ mode: 'atLeast', min: 0.3, max: 1 });
    await legend.updateComplete;
    expect([fill().left, fill().right]).toEqual(['30%', '0%']);

    legend.setReliabilityState({ mode: 'atMost', min: 0, max: 0.5 });
    await legend.updateComplete;
    expect([fill().left, fill().right]).toEqual(['0%', '50%']);

    legend.setReliabilityState({ mode: 'between', min: 0.3, max: 0.7 });
    await legend.updateComplete;
    expect([fill().left, fill().right]).toEqual(['30%', '30%']);
  });

  it('stops the lower thumb at the upper one instead of letting it pass', async () => {
    // Two independent bars could cross, and the crossed pair was only reordered later
    // at commit time — so the bounds swapped under the user's thumb, and the band they
    // got depended on whether they paused for the debounce mid-drag.
    const { legend, lower } = await band(0.2, 0.6);
    lower.value = '0.9';
    lower.dispatchEvent(new Event('input'));
    await legend.updateComplete;

    const { min, max } = legend.reliabilityState;
    expect(max).toBe(0.6);
    expect(min).toBeLessThan(max);
  });

  it('stops the upper thumb at the lower one instead of letting it pass', async () => {
    const { legend, upper } = await band(0.4, 0.8);
    upper.value = '0.1';
    upper.dispatchEvent(new Event('input'));
    await legend.updateComplete;

    const { min, max } = legend.reliabilityState;
    expect(min).toBe(0.4);
    expect(max).toBeGreaterThan(min);
  });

  it('never lets the two thumbs land on the same pixel', async () => {
    // Perfectly overlapped thumbs leave only the top one grabbable.
    const { legend, lower } = await band(0.5, 0.5 + 0.01);
    lower.value = '1';
    lower.dispatchEvent(new Event('input'));
    await legend.updateComplete;

    const { min, max } = legend.reliabilityState;
    expect(max - min).toBeCloseTo(0.01, 10);
  });
});

/**
 * A number input reports an empty field as `''`, and `Number('')` is 0 — not NaN — so
 * the non-finite fallback never sees it. On the UPPER bound that 0 is `confidence <= 0`,
 * which hides every prediction: the exact opposite of clearing the field.
 */
describe('legend EAT reliability percent boxes', () => {
  async function percentBoxes(state: {
    mode: 'atLeast' | 'atMost' | 'between';
    min: number;
    max: number;
  }) {
    const { legend } = await setup();
    legend.setReliabilityState(state);
    await legend.updateComplete;
    return {
      legend,
      boxes: Array.from(
        legend.shadowRoot!.querySelectorAll<HTMLInputElement>('.eat-threshold-percent'),
      ),
    };
  }

  it('reads an emptied upper-bound box as "no upper constraint", not as 0%', async () => {
    const { legend, boxes } = await percentBoxes({ mode: 'atMost', min: 0, max: 0.5 });
    boxes[0]!.value = '';
    boxes[0]!.dispatchEvent(new Event('input'));
    await legend.updateComplete;

    expect(legend.reliabilityState).toEqual({ mode: 'atMost', min: 0, max: 1 });
  });

  it('reads an emptied lower-bound box as "no lower constraint"', async () => {
    const { legend, boxes } = await percentBoxes({ mode: 'atLeast', min: 0.6, max: 1 });
    boxes[0]!.value = '';
    boxes[0]!.dispatchEvent(new Event('input'));
    await legend.updateComplete;

    expect(legend.reliabilityState).toEqual({ mode: 'atLeast', min: 0, max: 1 });
  });

  it('pins a band box back onto the clamped bound so it cannot show an unused value', async () => {
    // The clamp holds the state still, so Lit's `.value` dirty-check has nothing to
    // write and the box would keep displaying a bound the filter is not using.
    const { legend, boxes } = await percentBoxes({ mode: 'between', min: 0.4, max: 0.6 });
    boxes[0]!.value = '95';
    boxes[0]!.dispatchEvent(new Event('input'));
    await legend.updateComplete;

    expect(legend.reliabilityState.min).toBeCloseTo(0.59, 10);
    expect(boxes[0]!.value).toBe('59');
  });
});

describe('EAT reliability help text', () => {
  it('the help text names the annotation by its definition', () => {
    const make = (definition: Record<string, unknown> | undefined) =>
      new EatReliabilityController({ addController: vi.fn(), requestUpdate: vi.fn() } as never, {
        getScatterplot: () => null,
        isHostDriven: () => false,
        getAnnotation: () => 'score__eat_confidence',
        getAnnotationDefinition: () => definition as never,
        emit: vi.fn(),
      });

    // Without a definition the name reads as an EAT confidence column; with one, it is the user's.
    expect(make(undefined).helpText).toContain('“Score — EAT confidence”');
    expect(make({ kind: 'numeric', values: [], colors: [], shapes: [] }).helpText).toContain(
      '“Score eat confidence”',
    );
  });
});

/**
 * The dataset controller keys a load's storage by `generateDatasetHash` of the whole dataset,
 * EAT predictions included: it sweeps that key set for a fresh load and writes a bundle's
 * settings there. The legend has to load and save under the same key set.
 */
describe('legend dataset hash for an EAT dataset', () => {
  it('loads the settings stored under the dataset controller hash', async () => {
    const datasetHash = generateDatasetHash(makeData());
    setStorageItem(buildStorageKey('legend', datasetHash, 'ec'), { shapeSize: 42 });

    const { legend } = await setup();
    await settleLegend(legend);

    expect(legend.shapeSize).toBe(42);
  });

  it('forgets its saved settings when the dataset controller clears the dataset', async () => {
    const { data, legend, plot } = await setup();
    await settleLegend(legend);
    legend.applyShapeSize(42);
    expect(legend.pickedShapeSize).toBe(42);

    legend.clearForNewDataset(generateDatasetHash(data));
    plot.dispatchEvent(new CustomEvent('data-change', { detail: { data } }));
    await settleLegend(legend);

    expect(legend.pickedShapeSize).toBeUndefined();
    expect(legend.shapeSize).toBe(10);
  });
});

describe('legend dataset hash without a scatter plot', () => {
  it('loads the settings stored under the hash of the dataset it is given', async () => {
    const data = makeData();
    setStorageItem(buildStorageKey('legend', generateDatasetHash(data), 'ec'), { shapeSize: 42 });

    const legend = document.createElement('protspace-legend') as ProtspaceLegend;
    legend.autoSync = false;
    legend.data = data;
    legend.proteinIds = data.protein_ids;
    legend.selectedAnnotation = 'ec';
    legend.annotationData = { name: 'ec', values: data.annotations.ec.values, kind: 'categorical' };
    document.body.append(legend);
    await settleLegend(legend);

    expect(legend.shapeSize).toBe(42);
  });
});
