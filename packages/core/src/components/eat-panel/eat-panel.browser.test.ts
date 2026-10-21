import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  annotationLabel,
  DEFAULT_EAT_RELIABILITY,
  NA_VALUE,
  type PredictedCell,
  type VisualizationData,
} from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsSwitch } from '../kit/switch';
import type { EatOverlayChangeDetail } from './eat-reliability-controller';
import { EAT_THRESHOLD_COMMIT_DELAY_MS } from './eat-reliability-controller';
import { getEatIndex, summarizeEat } from './eat-summary';
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
  props: Partial<
    Pick<
      ProtspaceEatPanel,
      'data' | 'annotation' | 'context' | 'active' | 'labelColors' | 'focusProtein'
    >
  > = {},
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
/** Mask of the fixture's proteins without the excluded ids. */
const mask = (excluded: string[]) =>
  Uint8Array.from(EAT_FIXTURE_IDS, (id) => (excluded.includes(id) ? 0 : 1));

const categorical = (values: (string | null)[]) => ({
  kind: 'categorical' as const,
  values,
  colors: values.map(() => '#888'),
  shapes: values.map(() => 'circle'),
});

/**
 * One annotation `cls` whose labels have `curated` curated members and one predicted member per
 * listed reliability.
 */
function labelData(spec: { label: string; curated: number; predicted: number[] }[]) {
  const values = [...spec.map((s) => s.label), NA_VALUE];
  const na = values.length - 1;
  const rows: number[] = [];
  const cells: (PredictedCell | null)[] = [];
  spec.forEach(({ label, curated, predicted }, labelIndex) => {
    for (let i = 0; i < curated; i++) {
      rows.push(labelIndex);
      cells.push(null);
    }
    for (const confidence of predicted) {
      rows.push(na);
      cells.push({ value: label, confidence, source: 'S' });
    }
  });
  const ids = rows.map((_, i) => `Q${i}`);
  const data: VisualizationData = {
    protein_ids: ids,
    projections: [{ name: 'umap', dimension: 2, data: new Float32Array(ids.length * 2) }],
    annotations: { cls: categorical(values) },
    annotation_data: { cls: Int32Array.from(rows) },
    annotation_predicted: { cls: cells },
  };
  return data;
}

/** The fixture plus `kind` (2 curated X, 1 predicted X) and a `toxin__neighbor` column. */
function fixtureWithOthers(): VisualizationData {
  const data = createEatFixture();
  const n = EAT_FIXTURE_IDS.length;
  const kindRows = new Int32Array(n).fill(1);
  kindRows[0] = 0;
  kindRows[1] = 0;
  const kindCells: (PredictedCell | null)[] = new Array(n).fill(null);
  kindCells[2] = { value: 'X', confidence: 0.4, source: 'P0', sourceIndex: 0 };
  data.annotations.kind = categorical(['X', NA_VALUE]);
  data.annotations.toxin__neighbor = categorical(['near', 'distant']);
  data.annotation_data.kind = kindRows;
  data.annotation_data.toxin__neighbor = new Int32Array(n).fill(0);
  data.annotation_predicted = { ...data.annotation_predicted, kind: kindCells };
  return data;
}

const labelNames = (el: ProtspaceEatPanel) =>
  [...root(el).querySelectorAll<HTMLElement>('.eat-label-row')].map((row) => row.dataset.label);

function listenColorBy(el: ProtspaceEatPanel): string[] {
  const picked: string[] = [];
  el.addEventListener('eat-color-by', (event) =>
    picked.push((event as CustomEvent<{ annotation: string }>).detail.annotation),
  );
  return picked;
}

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
    // The host draws the header; an inactive panel renders nothing.
    expect(root(el).querySelector('.eat-show, .eat-overview')).toBeNull();

    el.context = mask(['P0']);
    await el.updateComplete;
    expect(getEatIndex).not.toHaveBeenCalled();

    el.active = true;
    await el.updateComplete;
    expect(getEatIndex).toHaveBeenCalledTimes(1);
  });

  it('does not recompute a hidden panel’s summary when the threshold or context moves', async () => {
    const el = await mount();
    el.active = false;
    await el.updateComplete;
    vi.mocked(summarizeEat).mockClear();

    el.setReliabilityState({ mode: 'atLeast', min: 0.5, max: 1 });
    el.context = mask(['P0']);
    await el.updateComplete;
    expect(summarizeEat).not.toHaveBeenCalled();
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

  it('reset() returns to the defaults and emits them once', async () => {
    const el = await mount();
    expect(el.isAtDefaults).toBe(true);
    el.setReliabilityState({ mode: 'atLeast', min: 0.5, max: 1 });
    await el.updateComplete;
    expect(el.isAtDefaults).toBe(false);
    const details = listen(el);
    el.reset();
    await el.updateComplete;
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ enabled: true, reliability: DEFAULT_EAT_RELIABILITY });
    expect(el.isAtDefaults).toBe(true);
  });

  describe('Drawing', () => {
    function listenDrawing(el: ProtspaceEatPanel) {
      const details: { trace: boolean; linesPerSource: number }[] = [];
      el.addEventListener('eat-drawing-change', (event) =>
        details.push((event as CustomEvent<(typeof details)[number]>).detail),
      );
      return details;
    }

    it('emits trace and lines per source, and a non-default counts against isAtDefaults', async () => {
      const el = await mount();
      const drawing = listenDrawing(el);
      const trace = root(el).querySelector<PsSwitch>('.eat-drawing ps-switch')!;
      const lines = root(el).querySelector<HTMLElement & { value: string }>(
        '.eat-drawing ps-select',
      )!;
      expect(trace.textContent?.trim()).toBe('Trace source on click');
      expect(trace.checked).toBe(true);
      expect(lines.value).toBe('20');

      await trace.updateComplete;
      trace.shadowRoot!.querySelector('button')!.click();
      await el.updateComplete;
      expect(drawing).toEqual([{ trace: false, linesPerSource: 20 }]);
      expect(el.isAtDefaults).toBe(false);

      lines.value = '50';
      lines.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
      expect(drawing.at(-1)).toEqual({ trace: false, linesPerSource: 50 });
    });

    it('reset() puts the Drawing switches back and says so; Reset at defaults does not', async () => {
      const el = await mount();
      const drawing = listenDrawing(el);
      el.reset();
      expect(drawing).toHaveLength(0);

      const lines = root(el).querySelector<HTMLElement & { value: string }>(
        '.eat-drawing ps-select',
      )!;
      lines.value = '10';
      lines.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
      el.reset();
      await el.updateComplete;
      expect(drawing.at(-1)).toEqual({ trace: true, linesPerSource: 20 });
      expect(el.isAtDefaults).toBe(true);
      expect(lines.value).toBe('20');

      // A new dataset keeps how the user likes lines drawn.
      lines.value = '50';
      lines.dispatchEvent(new Event('change', { bubbles: true }));
      el.resetForNewDataset();
      await el.updateComplete;
      expect(drawing).toHaveLength(3);
      expect(lines.value).toBe('50');
    });
  });

  it('Show off disables the threshold controls, greys the rest and says (hidden)', async () => {
    const el = await mount();
    const details = listen(el);
    const toggle = root(el).querySelector<PsSwitch>('ps-switch')!;
    await toggle.updateComplete;
    toggle.shadowRoot!.querySelector('button')!.click();
    await el.updateComplete;
    expect(details.map((d) => d.enabled)).toEqual([false]);
    expect(el.overlayEnabled).toBe(false);
    expect(text(el, '.eat-counts')).toBe('4 curated · 5 predicted (hidden)');
    const section = root(el).querySelector<HTMLElement>('.eat-reliability')!;
    // Greyed, but the bars and their lists still work: only the threshold controls are disabled.
    expect(section.classList.contains('is-off')).toBe(true);
    expect(section.hasAttribute('aria-disabled')).toBe(false);
    // Not inert: a screen reader still finds the controls, and hears that they are off.
    expect(section.inert).toBe(false);
    expect(handle(el).disabled).toBe(true);
    const modes = root(el).querySelector<HTMLElement>('ps-segmented')!;
    await (modes as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const options = [...modes.shadowRoot!.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(options.length).toBe(3);
    for (const option of options) expect(option.getAttribute('aria-disabled')).toBe('true');
    options[1].click();
    await el.updateComplete;
    expect(el.reliability.mode).toBe('atLeast');
    expect(details).toHaveLength(1);
    expect(el.isAtDefaults).toBe(false);
  });

  it('makes the bars one tab stop, with the arrow keys between them', async () => {
    const el = await mount();
    const tabStops = () => bars(el).filter((bar) => bar.tabIndex === 0);
    expect(tabStops()).toEqual([bars(el)[0]]);
    bars(el)[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(tabStops()).toEqual([bars(el)[1]]);
    expect(root(el).activeElement).toBe(bars(el)[1]);
    await userEvent.keyboard('{End}');
    await el.updateComplete;
    expect(root(el).activeElement).toBe(bars(el)[19]);
    // Enter opens the focused bar's list (1 prediction at 100 %).
    await userEvent.keyboard('{Enter}');
    await el.updateComplete;
    expect(text(el, '.eat-drill-heading')).toBe(`Weakest in 95–100${PCT}`);
    await userEvent.keyboard('{Home}');
    await el.updateComplete;
    expect(tabStops()).toEqual([bars(el)[0]]);
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
  describe('By label', () => {
    const SPEC = [
      { label: 'A', curated: 1, predicted: [0.9, 0.9, 0.9] },
      { label: 'B', curated: 0, predicted: [0.2, 0.3, 0.4, 0.5, 0.6] },
      { label: 'C', curated: 5, predicted: [0.1] },
      { label: 'D', curated: 2, predicted: [] },
    ];

    it('sorts by most predicted, least reliable and name', async () => {
      const el = await mount({ data: labelData(SPEC), annotation: 'cls' });
      expect(labelNames(el)).toEqual(['B', 'A', 'C', 'D']);
      const select = root(el).querySelector<HTMLElement & { value: string }>(
        '.eat-breakdown ps-select',
      )!;
      for (const [sort, order] of [
        ['least-reliable', ['C', 'B', 'A', 'D']],
        ['name', ['A', 'B', 'C', 'D']],
      ] as const) {
        select.value = sort;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await el.updateComplete;
        expect(labelNames(el)).toEqual(order);
      }
    });

    it('shows total and predicted share, amber above 80 %, as buttons for the drill-down', async () => {
      const el = await mount({
        data: labelData(SPEC),
        annotation: 'cls',
        labelColors: new Map([
          ['B', 'rgb(255, 0, 0)'],
          ['Other', 'rgb(0, 0, 255)'],
        ]),
      });
      const row = (label: string) =>
        root(el).querySelector<HTMLButtonElement>(`.eat-label-row[data-label="${label}"]`)!;
      expect(row('B').getAttribute('aria-expanded')).toBe('false');
      expect(row('B').querySelector('.eat-label-total')!.textContent).toBe('5');
      expect(row('B').querySelector('.eat-label-share')!.textContent).toBe(`100${PCT}`);
      expect(row('B').querySelector('.eat-label-share')!.classList).toContain(
        'is-mostly-predicted',
      );
      expect(row('A').querySelector('.eat-label-share')!.textContent).toBe(`75${PCT}`);
      expect(row('A').querySelector('.eat-label-share')!.classList).not.toContain(
        'is-mostly-predicted',
      );
      const swatch = row('B').querySelector<HTMLElement>('.eat-swatch')!;
      expect(getComputedStyle(swatch).backgroundColor).toBe('rgb(255, 0, 0)');
      // A label in the legend's Other bucket takes Other's colour.
      const folded = row('A').querySelector<HTMLElement>('.eat-swatch')!;
      expect(getComputedStyle(folded).backgroundColor).toBe('rgb(0, 0, 255)');
      // Bars are relative to the largest label (C, 6 members).
      const width = (label: string) =>
        row(label).querySelector<HTMLElement>('.eat-label-bar')!.style.width;
      expect(width('C')).toBe('100%');
      expect(width('A')).toBe('66.67%');
    });

    it('shows 8 rows, then Show all', async () => {
      const spec = Array.from({ length: 10 }, (_, i) => ({
        label: `L${i}`,
        curated: 1,
        predicted: [0.5],
      }));
      const el = await mount({ data: labelData(spec), annotation: 'cls' });
      expect(labelNames(el)).toHaveLength(8);
      const showAll = root(el).querySelector<HTMLButtonElement>('.eat-show-all')!;
      expect(showAll.textContent!.trim()).toBe('Show all 10 labels');
      showAll.click();
      await el.updateComplete;
      expect(labelNames(el)).toHaveLength(10);
      expect(root(el).querySelector('.eat-show-all')).toBeNull();
    });
  });

  describe('other annotations', () => {
    it('lists other EAT annotations once opened, and each row emits eat-color-by', async () => {
      const el = await mount({ data: fixtureWithOthers() });
      const picked = listenColorBy(el);
      const details = root(el).querySelector<HTMLDetailsElement>('.eat-others')!;
      expect(text(el, '.eat-others summary')).toBe('Other annotations with predictions (1)');
      expect(details.open).toBe(false);
      // Collapsed: the other annotation's index is not built.
      expect(vi.mocked(getEatIndex).mock.calls.map(([, key]) => key)).toEqual(['toxin']);

      root(el).querySelector<HTMLElement>('.eat-others summary')!.click();
      await new Promise((resolve) => details.addEventListener('toggle', resolve, { once: true }));
      await el.updateComplete;
      const row = root(el).querySelector<HTMLButtonElement>('.eat-others .eat-color-by')!;
      expect(row.textContent!.replace(/[ \t\r\n]+/g, ' ').trim()).toBe(
        `${annotationLabel('kind')} · 33${PCT} predicted ›`,
      );
      row.click();
      expect(picked).toEqual(['kind']);
    });

    it('links the EAT neighbourhood column', async () => {
      const el = await mount({ data: fixtureWithOthers() });
      const picked = listenColorBy(el);
      const link = root(el).querySelector<HTMLButtonElement>('.eat-neighbour')!;
      expect(link.getAttribute('aria-label')).toBe(
        `Color by ${annotationLabel('toxin__neighbor')}`,
      );
      expect(link.textContent).toContain('EAT neighbourhood');
      link.click();
      expect(picked).toEqual(['toxin__neighbor']);
    });

    it('draws neither without other EAT annotations or a neighbourhood column', async () => {
      const el = await mount();
      expect(root(el).querySelector('.eat-others, .eat-neighbour')).toBeNull();
    });
  });

  it('lists the annotations with predictions as Color by buttons in the empty state', async () => {
    const el = await mount({ data: fixtureWithOthers(), annotation: 'family' });
    const picked = listenColorBy(el);
    const buttons = [...root(el).querySelectorAll<HTMLButtonElement>('.eat-color-by')];
    expect(buttons.map((b) => b.textContent!.replace(/[ \t\r\n]+/g, ' ').trim())).toEqual([
      `Color by ${annotationLabel('toxin')} 56${PCT} ›`,
      `Color by ${annotationLabel('kind')} 33${PCT} ›`,
    ]);
    buttons[1].click();
    expect(picked).toEqual(['kind']);
  });

  describe('drill-down lists', () => {
    // A: 6 predictions in 50–55 % (Q1–Q6); B: 0.9 (Q7) and 0.2 (Q8).
    const SPEC = [
      { label: 'A', curated: 1, predicted: [0.54, 0.51, 0.53, 0.52, 0.506, 0.545] },
      { label: 'B', curated: 0, predicted: [0.9, 0.2] },
    ];
    const drills = (el: ProtspaceEatPanel) => root(el).querySelectorAll('.eat-drill');
    const drillIds = (el: ProtspaceEatPanel) =>
      [...root(el).querySelectorAll<HTMLElement>('.eat-drill-row')].map(
        (row) => row.dataset.protein,
      );
    const labelRow = (el: ProtspaceEatPanel, label: string) =>
      root(el).querySelector<HTMLButtonElement>(`.eat-label-row[data-label="${label}"]`)!;
    function listenSelect(el: ProtspaceEatPanel) {
      const details: { proteinIds: string[]; zoom: boolean }[] = [];
      el.addEventListener('eat-select-proteins', (event) =>
        details.push((event as CustomEvent<{ proteinIds: string[]; zoom: boolean }>).detail),
      );
      return details;
    }

    it('a bar lists its bin’s weakest 5 in reliability order', async () => {
      const el = await mount({ data: labelData(SPEC), annotation: 'cls' });
      bars(el)[10].click();
      await el.updateComplete;
      expect(bars(el)[10].getAttribute('aria-expanded')).toBe('true');
      expect(text(el, '.eat-drill-heading')).toBe(`Weakest in 50–55${PCT}`);
      expect(drillIds(el)).toEqual(['Q5', 'Q2', 'Q4', 'Q3', 'Q1']);
      expect(text(el, '.eat-drill-row')).toBe(`Q5 51${PCT} A`);
      expect(text(el, '.eat-drill-count')).toBe('5 of 6');
      expect(text(el, '.eat-drill-select')).toBe('Select all 6 kept');
      // An empty bar opens nothing.
      bars(el)[0].click();
      await el.updateComplete;
      expect(text(el, '.eat-drill-heading')).toBe(`Weakest in 50–55${PCT}`);
    });

    it('a label row lists the label’s weakest; Select all emits its kept ids', async () => {
      const el = await mount({ data: labelData(SPEC), annotation: 'cls' });
      const selected = listenSelect(el);
      el.setReliabilityState({ mode: 'atLeast', min: 0.5, max: 1 });
      labelRow(el, 'B').click();
      await el.updateComplete;
      expect(labelRow(el, 'B').getAttribute('aria-expanded')).toBe('true');
      expect(labelRow(el, 'B').parentElement!.querySelector('.eat-drill')).not.toBeNull();
      expect(text(el, '.eat-drill-heading')).toBe('Weakest B');
      expect(drillIds(el)).toEqual(['Q8', 'Q7']);
      // In Hide mode a row below the threshold says so, and stays clickable.
      expect(text(el, '.eat-drill-row')).toBe(`Q8 20${PCT} B Hidden by the threshold`);
      expect(text(el, '.eat-drill-count')).toBe('2 of 2');
      root(el).querySelector<HTMLButtonElement>('.eat-drill-select')!.click();
      expect(selected).toEqual([{ proteinIds: ['Q7'], zoom: false }]);
      root(el).querySelector<HTMLButtonElement>('.eat-drill-row')!.click();
      expect(selected[1]).toEqual({ proteinIds: ['Q8'], zoom: true });
    });

    it('with Show off, By label is greyed but not disabled, and its lists still work', async () => {
      const el = await mount({ data: labelData(SPEC), annotation: 'cls' });
      const selected = listenSelect(el);
      el.setReliabilityState({ mode: 'atLeast', min: 0.5, max: 1 });
      const toggle = root(el).querySelector<PsSwitch>('ps-switch')!;
      await toggle.updateComplete;
      toggle.shadowRoot!.querySelector('button')!.click();
      await el.updateComplete;
      const breakdown = root(el).querySelector<HTMLElement>('.eat-breakdown')!;
      expect(breakdown.classList.contains('is-off')).toBe(true);
      expect(breakdown.hasAttribute('aria-disabled')).toBe(false);
      labelRow(el, 'B').click();
      await el.updateComplete;
      // Nothing is hidden with Show off, so no row says so.
      expect(text(el, '.eat-drill-row')).toBe(`Q8 20${PCT} B`);
      root(el).querySelector<HTMLButtonElement>('.eat-drill-row')!.click();
      expect(selected).toEqual([{ proteinIds: ['Q8'], zoom: true }]);
    });

    const escape = (el: ProtspaceEatPanel) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
      return event;
    };

    it('closes a list whose label leaves the view, and leaves Escape alone', async () => {
      const data = labelData(SPEC);
      const el = await mount({ data, annotation: 'cls' });
      labelRow(el, 'B').click();
      await el.updateComplete;
      expect(drills(el)).toHaveLength(1);
      el.context = Uint8Array.from(data.protein_ids, (id) => (id === 'Q7' || id === 'Q8' ? 0 : 1));
      await el.updateComplete;
      expect(drills(el)).toHaveLength(0);
      expect(escape(el).defaultPrevented).toBe(false);
    });

    it('a label with only curated members in view opens no list, and an open one closes', async () => {
      const data = labelData(SPEC);
      const el = await mount({ data, annotation: 'cls' });
      labelRow(el, 'A').click();
      await el.updateComplete;
      expect(drills(el)).toHaveLength(1);
      // Q0 (curated A) stays; A's predictions Q1–Q6 leave the view.
      el.context = Uint8Array.from(data.protein_ids, (id) =>
        ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'].includes(id) ? 0 : 1,
      );
      await el.updateComplete;
      expect(drills(el)).toHaveLength(0);
      const row = labelRow(el, 'A');
      expect(row.disabled).toBe(true);
      expect(row.title).toBe('No predictions in view');
      expect(row.hasAttribute('aria-expanded')).toBe(false);
      expect(row.getAttribute('aria-label')).toContain('no predictions in view');
      row.click();
      await el.updateComplete;
      expect(drills(el)).toHaveLength(0);
      expect(labelRow(el, 'B').disabled).toBe(false);
    });

    it('closes a bar list whose bin empties', async () => {
      const data = labelData(SPEC);
      const el = await mount({ data, annotation: 'cls' });
      bars(el)[18].click();
      await el.updateComplete;
      expect(text(el, '.eat-drill-heading')).toBe(`Weakest in 90–95${PCT}`);
      el.context = Uint8Array.from(data.protein_ids, (id) => (id === 'Q7' ? 0 : 1));
      await el.updateComplete;
      expect(drills(el)).toHaveLength(0);
    });

    it('does not claim Escape for a list sorted out of the first 8 rows', async () => {
      // Z has the most predictions, so it leads by most predicted and drops past H by name.
      const spec = [...'ABCDEFGH'].map((label) => ({ label, curated: 0, predicted: [0.5] }));
      const el = await mount({
        data: labelData([...spec, { label: 'Z', curated: 0, predicted: [0.6, 0.7] }]),
        annotation: 'cls',
      });
      labelRow(el, 'Z').click();
      await el.updateComplete;
      expect(drills(el)).toHaveLength(1);
      const select = root(el).querySelector<HTMLElement & { value: string }>(
        '.eat-breakdown ps-select',
      )!;
      select.value = 'name';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
      expect(drills(el)).toHaveLength(0);
      expect(escape(el).defaultPrevented).toBe(false);
      // The stale list is gone for good: going back to most predicted does not reopen it.
      select.value = 'most-predicted';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
      expect(drills(el)).toHaveLength(0);
    });

    it('keeps one list open; a second click or Escape closes it', async () => {
      const el = await mount({ data: labelData(SPEC), annotation: 'cls' });
      bars(el)[10].click();
      await el.updateComplete;
      labelRow(el, 'A').click();
      await el.updateComplete;
      expect(drills(el)).toHaveLength(1);
      expect(bars(el)[10].getAttribute('aria-expanded')).toBe('false');
      expect(text(el, '.eat-drill-heading')).toBe('Weakest A');
      labelRow(el, 'A').click();
      await el.updateComplete;
      expect(drills(el)).toHaveLength(0);

      bars(el)[10].click();
      await el.updateComplete;
      root(el).querySelector<HTMLButtonElement>('.eat-drill-row')!.focus();
      await userEvent.keyboard('{Escape}');
      await el.updateComplete;
      expect(drills(el)).toHaveLength(0);
      expect(root(el).activeElement).toBe(bars(el)[10]);
    });
  });

  describe('selected-protein card', () => {
    const card = (el: ProtspaceEatPanel) => root(el).querySelector<HTMLElement>('.eat-card');
    const cardLines = (el: ProtspaceEatPanel) =>
      [...root(el).querySelectorAll('.eat-card-line')].map((line) =>
        line.textContent!.replace(/[ \t\r\n]+/g, ' ').trim(),
      );
    const links = (el: ProtspaceEatPanel) => [
      ...root(el).querySelectorAll<HTMLButtonElement>('.eat-card-link'),
    ];
    const goToSource = (el: ProtspaceEatPanel) =>
      root(el).querySelector<HTMLElement & { disabled: boolean }>('.eat-go-to-source')!;
    const listen = (el: ProtspaceEatPanel, type: string) => {
      const details: unknown[] = [];
      el.addEventListener(type, (event) => details.push((event as CustomEvent).detail));
      return details;
    };
    const at = (id: string) => EAT_FIXTURE_IDS.indexOf(id);

    it('shows a prediction: its label, its source, its rank, Go to source and lent to', async () => {
      const el = await mount({
        focusProtein: at('P8'),
        labelColors: new Map([['C', 'rgb(255, 0, 0)']]),
      });
      expect(text(el, '.eat-card-title')).toBe('C P8');
      expect(root(el).querySelector<HTMLElement>('.eat-card .eat-ring')!.style.borderColor).toBe(
        'rgb(255, 0, 0)',
      );
      // 0.81 is above 3 of the 5 predictions (0.12, 0.55, 0.55).
      expect(cardLines(el)).toEqual([
        'Copied from P0 · curated A',
        `Reliability 0.81 · higher than 60${PCT} of 5`,
      ]);
      expect(goToSource(el).disabled).toBe(false);
      const went = listen(el, 'eat-go-to-source');
      const traced = listen(el, 'eat-trace-source');
      goToSource(el).click();
      expect(went).toEqual([{ targetId: 'P8', targetIndex: at('P8'), sourceId: 'P0' }]);
      expect(links(el).map((link) => link.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        'P0 lent its label to 1 protein ›',
      ]);
      links(el)[0].click();
      expect(traced).toEqual([{ sourceId: 'P0', sourceIndex: 0 }]);
    });

    it('says a source outside the dataset is not in it and disables Go to source', async () => {
      const el = await mount({ focusProtein: at('P9') });
      expect(cardLines(el)).toEqual([
        'Copied from S9 (not in this dataset)',
        `Reliability 1.00 · higher than 80${PCT} of 5`,
        // Still counted from the index, but there is nothing to draw.
        'S9 lent its label to 1 protein',
      ]);
      expect(goToSource(el).disabled).toBe(true);
      expect(root(el).querySelector('.eat-card ps-tooltip')!.getAttribute('text')).toBe(
        'The source is not in this dataset',
      );
      expect(links(el)).toHaveLength(0);
      const went = listen(el, 'eat-go-to-source');
      goToSource(el).click();
      expect(went).toEqual([]);
    });

    it('lists every label of a multi-valued prediction', async () => {
      const el = await mount({ focusProtein: at('P5') });
      expect(text(el, '.eat-card-labels')).toBe('A, B');
      expect(cardLines(el)[0]).toBe('Copied from S1 (not in this dataset)');
      expect(cardLines(el)[1]).toBe(`Reliability 0.55 · higher than 20${PCT} of 5`);
      expect(cardLines(el)[2]).toBe('S1 lent its label to 3 proteins');
    });

    it('shows a source with its value and draws its lines from the lent link', async () => {
      const el = await mount({ focusProtein: at('P0') });
      expect(text(el, '.eat-card-title')).toBe('P0 · curated A');
      expect(goToSource(el)).toBeNull();
      const traced = listen(el, 'eat-trace-source');
      expect(links(el)).toHaveLength(1);
      expect(links(el)[0].textContent!.replace(/\s+/g, ' ').trim()).toBe(
        'lent its label to 1 protein ›',
      );
      links(el)[0].click();
      expect(traced).toEqual([{ sourceId: 'P0', sourceIndex: 0 }]);
    });

    it('floors the rank, so the strongest prediction is never higher than 100 % of them', async () => {
      const predicted = Array.from({ length: 200 }, (_, i) => 0.0025 + i * 0.004);
      const el = await mount({
        data: labelData([{ label: 'A', curated: 0, predicted }]),
        annotation: 'cls',
        focusProtein: 199,
      });
      expect(cardLines(el)[1]).toBe(`Reliability 0.80 · higher than 99${PCT} of 200`);
    });

    it('shows no card for a curated non-source protein or no selection', async () => {
      const el = await mount({ focusProtein: at('P1') });
      expect(card(el)).toBeNull();
      el.focusProtein = null;
      await el.updateComplete;
      expect(card(el)).toBeNull();
      el.focusProtein = at('P8');
      await el.updateComplete;
      expect(card(el)).not.toBeNull();
    });
  });

  describe('Export IDs', () => {
    type ExportDetail = { proteinIds: string[]; fileName: string };
    function listenExport(el: ProtspaceEatPanel): ExportDetail[] {
      const details: ExportDetail[] = [];
      el.addEventListener('eat-export-ids', (event) =>
        details.push((event as CustomEvent<ExportDetail>).detail),
      );
      return details;
    }
    async function openExport(el: ProtspaceEatPanel, trigger: HTMLElement) {
      trigger.click();
      await el.updateComplete;
      const menu = root(el).querySelector<HTMLElement & { open: boolean }>('ps-menu')!;
      expect(menu.open).toBe(true);
      return [...root(el).querySelectorAll<HTMLElement & { disabled: boolean }>('ps-menu-item')];
    }
    const itemText = (item: HTMLElement) => item.textContent!.replace(/\s+/g, ' ').trim();

    it('exports the kept or below-threshold IDs in the view, in reliability order', async () => {
      const el = await mount({ context: mask(['P8']) });
      const exported = listenExport(el);
      el.setReliabilityState({ mode: 'atLeast', min: 0.5, max: 1 });
      await el.updateComplete;
      const trigger = root(el).querySelector<HTMLElement>('.eat-readout-row .eat-export')!;
      let items = await openExport(el, trigger);
      expect(items.map(itemText)).toEqual(['Kept predictions (3)', 'Below threshold (1)']);
      items[0].click();
      await el.updateComplete;
      expect(exported).toEqual([
        { proteinIds: ['P5', 'P7', 'P9'], fileName: 'toxin-eat-kept-ids.txt' },
      ]);
      expect(root(el).querySelector<HTMLElement & { open: boolean }>('ps-menu')!.open).toBe(false);
      items = await openExport(el, trigger);
      items[1].click();
      expect(exported[1]).toEqual({ proteinIds: ['P3'], fileName: 'toxin-eat-below-ids.txt' });
    });

    it('disables an empty choice', async () => {
      const el = await mount();
      const exported = listenExport(el);
      const items = await openExport(
        el,
        root(el).querySelector<HTMLElement>('.eat-readout-row .eat-export')!,
      );
      expect(items.map(itemText)).toEqual(['Kept predictions (5)', 'Below threshold (0)']);
      expect(items.map((item) => item.disabled)).toEqual([false, true]);
      items[1].click();
      expect(exported).toEqual([]);
    });

    it('a drill-down list exports only its bar or label', async () => {
      const el = await mount({
        data: labelData([
          { label: 'A', curated: 1, predicted: [0.54, 0.3] },
          { label: 'B', curated: 0, predicted: [0.9, 0.2] },
        ]),
        annotation: 'cls',
      });
      const exported = listenExport(el);
      el.setReliabilityState({ mode: 'atLeast', min: 0.5, max: 1 });
      await el.updateComplete;
      root(el).querySelector<HTMLButtonElement>('.eat-label-row[data-label="B"]')!.click();
      await el.updateComplete;
      const items = await openExport(
        el,
        root(el).querySelector<HTMLElement>('.eat-drill-foot .eat-export')!,
      );
      expect(items.map(itemText)).toEqual(['Kept predictions (1)', 'Below threshold (1)']);
      items[1].click();
      expect(exported).toEqual([{ proteinIds: ['Q4'], fileName: 'cls-eat-below-ids.txt' }]);
    });
  });
});
