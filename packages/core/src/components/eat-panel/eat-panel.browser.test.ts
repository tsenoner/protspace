import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { annotationLabel, DEFAULT_EAT_RELIABILITY } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsButton } from '../kit/button';
import type { PsSwitch } from '../kit/switch';
import type { EatOverlayChangeDetail } from './eat-reliability-controller';
import { EAT_THRESHOLD_COMMIT_DELAY_MS } from './eat-reliability-controller';
import { getEatIndex } from './eat-summary';
import type { ProtspaceEatPanel } from './eat-panel';
import { createEatFixture, EAT_FIXTURE_IDS } from './test-support/eat-fixture';
import './eat-panel';

vi.mock('./eat-summary', { spy: true });

const PCT = ' %';

beforeAll(() => adoptTheme());
// Braces: a function returned from beforeEach is run as its cleanup.
beforeEach(() => {
  vi.mocked(getEatIndex).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function mount(
  props: Partial<Pick<ProtspaceEatPanel, 'data' | 'annotation' | 'context' | 'active'>> = {},
): Promise<ProtspaceEatPanel> {
  const el = document.createElement('protspace-eat-panel');
  Object.assign(el, { data: createEatFixture(), annotation: 'toxin', active: true, ...props });
  document.body.append(el);
  await el.updateComplete;
  return el;
}

const root = (el: ProtspaceEatPanel) => el.shadowRoot!;
const text = (el: ProtspaceEatPanel, selector: string) =>
  root(el)
    .querySelector(selector)
    ?.textContent?.replace(/[ \t\r\n]+/g, ' ')
    .trim() ?? null;
const bars = (el: ProtspaceEatPanel) => [
  ...root(el).querySelectorAll<HTMLButtonElement>('.eat-bar'),
];
const handle = (el: ProtspaceEatPanel) =>
  root(el).querySelector<HTMLInputElement>('#eat-reliability-threshold')!;
const resetButton = (el: ProtspaceEatPanel) => root(el).querySelector<PsButton>('.eat-reset')!;
/** Mask of the fixture's proteins without the excluded ids. */
const mask = (excluded: string[]) =>
  Uint8Array.from(EAT_FIXTURE_IDS, (id) => (excluded.includes(id) ? 0 : 1));

function listen(el: ProtspaceEatPanel): EatOverlayChangeDetail[] {
  const details: EatOverlayChangeDetail[] = [];
  el.addEventListener('eat-overlay-change', (event) =>
    details.push((event as CustomEvent<EatOverlayChangeDetail>).detail),
  );
  return details;
}

describe('protspace-eat-panel', () => {
  it('builds nothing while inactive', async () => {
    const el = await mount({ active: false });
    expect(getEatIndex).not.toHaveBeenCalled();
    expect(text(el, '.eat-title')).toBe('EAT · Toxin');
    expect(root(el).querySelector('.eat-overview')).toBeNull();

    el.context = mask(['P0']);
    await el.updateComplete;
    expect(getEatIndex).not.toHaveBeenCalled();

    el.active = true;
    await el.updateComplete;
    expect(getEatIndex).toHaveBeenCalledTimes(1);
  });

  it('shows the overview numbers', async () => {
    const el = await mount();
    expect(text(el, '.eat-counts')).toBe('4 curated · 5 predicted (5 kept) · 1 none');
    expect(text(el, '.eat-readout')).toBe(`Keeps 5 of 5 predictions (100${PCT})`);
  });

  it('draws 20 bars and shades the kept range', async () => {
    const el = await mount();
    el.setReliabilityState({ mode: 'atLeast', min: 0.5, max: 1 });
    await el.updateComplete;
    const all = bars(el);
    expect(all).toHaveLength(20);
    expect(all.slice(0, 10).every((bar) => bar.dataset.kept === 'false')).toBe(true);
    expect(all.slice(10).every((bar) => bar.dataset.kept === 'true')).toBe(true);
    expect(all[11].getAttribute('aria-label')).toBe(`55–60${PCT}: 2 predictions`);
    expect(all[2].getAttribute('aria-label')).toBe(`10–15${PCT}: 1 prediction`);
  });

  it('emits eat-overlay-change once 150 ms after a handle drag', async () => {
    vi.useFakeTimers();
    const el = await mount();
    const details = listen(el);
    const input = handle(el);
    input.value = '0.6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    // The shading and readout follow the drag at once; the emit waits out the debounce.
    expect(bars(el)[11].dataset.kept).toBe('false');
    expect(text(el, '.eat-readout')).toBe(`Keeps 2 of 5 predictions (40${PCT})`);
    vi.advanceTimersByTime(EAT_THRESHOLD_COMMIT_DELAY_MS - 1);
    expect(details).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(details).toHaveLength(1);
    expect(details[0].reliability.min).toBe(0.6);
  });

  it('Shift+ArrowRight moves the focused handle by 10 %', async () => {
    const el = await mount();
    const details = listen(el);
    handle(el).focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await el.updateComplete;
    expect(el.reliability.min).toBe(0.1);
    expect(handle(el).value).toBe('0.1');
    expect(details.map((d) => d.reliability.min)).toEqual([0.1]);
    await userEvent.keyboard('{ArrowRight}');
    expect(el.reliability.min).toBe(0.11);
  });

  it('setReliabilityState never emits', async () => {
    vi.useFakeTimers();
    const el = await mount();
    const details = listen(el);
    el.setReliabilityState({ mode: 'between', min: 0.2, max: 0.7 });
    await el.updateComplete;
    vi.advanceTimersByTime(EAT_THRESHOLD_COMMIT_DELAY_MS * 2);
    expect(details).toHaveLength(0);
    expect(el.reliability).toEqual({ mode: 'between', min: 0.2, max: 0.7 });
    expect(el.reliabilityThreshold).toBe(0.2);
  });

  it('Reset is disabled at defaults and emits the default once', async () => {
    const el = await mount();
    expect(el.isAtDefaults).toBe(true);
    expect(resetButton(el).disabled).toBe(true);
    el.setReliabilityState({ mode: 'atLeast', min: 0.5, max: 1 });
    await el.updateComplete;
    expect(resetButton(el).disabled).toBe(false);
    const details = listen(el);
    resetButton(el).click();
    await el.updateComplete;
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ enabled: true, reliability: DEFAULT_EAT_RELIABILITY });
    expect(resetButton(el).disabled).toBe(true);
  });

  it('Show off disables the controls and says (hidden)', async () => {
    const el = await mount();
    const details = listen(el);
    const toggle = root(el).querySelector<PsSwitch>('ps-switch')!;
    await toggle.updateComplete;
    toggle.shadowRoot!.querySelector('button')!.click();
    await el.updateComplete;
    expect(details.map((d) => d.enabled)).toEqual([false]);
    expect(el.overlayEnabled).toBe(false);
    expect(text(el, '.eat-counts')).toBe('4 curated · 5 predicted (hidden)');
    expect(root(el).querySelector('.eat-reliability')!.getAttribute('aria-disabled')).toBe('true');
    expect(handle(el).disabled).toBe(true);
    expect(el.isAtDefaults).toBe(false);
  });

  it('says the annotation has no predicted values', async () => {
    const el = await mount({ annotation: 'family' });
    expect(text(el, '.eat-empty')).toBe(`${annotationLabel('family')} has no predicted values.`);
    expect(bars(el)).toHaveLength(0);
  });

  it('shows In view only with a context', async () => {
    const el = await mount();
    expect(root(el).querySelector('.eat-in-view')).toBeNull();
    el.context = mask(['P0', 'P9']);
    await el.updateComplete;
    expect(text(el, '.eat-in-view')).toBe('In view: 8 of 10');
    expect(text(el, '.eat-counts')).toBe('3 curated · 4 predicted (4 kept) · 1 none');
  });

  it('renders the empty-view message when the context holds no prediction', async () => {
    const el = await mount({ context: mask(['P3', 'P5', 'P7', 'P8', 'P9']) });
    expect(text(el, '.eat-empty-view')).toBe('No predictions in the current view');
    expect(bars(el)).toHaveLength(0);
    expect(handle(el).disabled).toBe(false);
  });

  it('renders a skeleton with disabled controls before data arrives', async () => {
    const el = await mount({ data: null });
    expect(bars(el)).toHaveLength(20);
    expect(bars(el).every((bar) => bar.disabled)).toBe(true);
    expect(handle(el).disabled).toBe(true);
    expect(getEatIndex).not.toHaveBeenCalled();
  });
});
