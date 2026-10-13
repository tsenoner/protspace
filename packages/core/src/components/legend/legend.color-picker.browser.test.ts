import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { LegendPersistedSettings, VisualizationData } from '@protspace/utils';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsMenu } from '../kit/menu';
import type { PsPopover } from '../kit/popover';
import type { ProtspaceLegend } from './legend';
import { LEGEND_EVENTS, LEGEND_STYLES, SHAPE_PATH_GENERATORS } from './config';
import { COLOR_COMMIT_DELAY_MS } from './legend-color-picker';
import { TWELVE, categoricalData, numericData } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  type MockScatterplot,
} from './test-support/legend-scatterplot-harness';

beforeAll(async () => {
  adoptTheme();
  await page.viewport(1280, 800);
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function settle(legend: ProtspaceLegend): Promise<void> {
  await legend.updateComplete;
  await frame();
  await frame();
}

/** Two categories, one protein carrying both: a multilabel annotation. */
function multilabelData(): VisualizationData {
  return {
    protein_ids: ['p1', 'p2', 'p3'],
    projections: [{ name: 'UMAP 2', dimension: 2, data: new Float32Array(6) }],
    annotations: {
      family: {
        kind: 'categorical',
        values: ['A', 'B'],
        colors: ['#e41a1c', '#377eb8'],
        shapes: ['circle', 'circle'],
      },
    },
    annotation_data: { family: [[0], [0, 1], [1]] },
  };
}

/** The legend as a 240 px sidebar at the window's right edge, which clips what overflows it. */
async function mount(data: VisualizationData = categoricalData(TWELVE)) {
  const mounted = await mountLegendWithScatterplot(data, 'family');
  mounted.legend.style.cssText =
    'position: fixed; top: 0; right: 0; width: 240px; height: 480px; overflow: hidden;';
  await settle(mounted.legend);
  return mounted;
}

const row = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<HTMLElement>(`.legend-item[data-value="${value}"]`)!;
const more = (legend: ProtspaceLegend, value: string) =>
  row(legend, value).querySelector<HTMLButtonElement>('.legend-more')!;
const picker = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<PsPopover>('ps-popover.color-picker')!;
const panel = (legend: ProtspaceLegend) =>
  picker(legend).shadowRoot!.querySelector<HTMLElement>('.panel')!;
const swatch = (legend: ProtspaceLegend) =>
  legend.shadowRoot!.querySelector<HTMLInputElement>('.color-picker-swatch')!;
const shape = (legend: ProtspaceLegend, name: string) =>
  legend.shadowRoot!.querySelector<HTMLButtonElement>(
    `.shape-picker-item[aria-label^="Use ${name} shape"]`,
  )!;

/** "⋯", then "Colour and shape", with the pointer, as a user opens it. */
async function openPicker(legend: ProtspaceLegend, value: string): Promise<void> {
  await userEvent.hover(row(legend, value).querySelector<HTMLElement>('.legend-item-main')!);
  await userEvent.click(more(legend, value));
  await settle(legend);
  const menu = legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
  const item = [...menu.querySelectorAll('ps-menu-item')].find(
    (each) => each.textContent!.trim() === 'Colour and shape',
  )!;
  await userEvent.click(item);
  await settle(legend);
}

/** Counts the colour-only mapping changes the legend sends the plot (a colour edit's commit). */
function colourCommits(plot: MockScatterplot): () => number {
  let count = 0;
  plot.addEventListener(LEGEND_EVENTS.COLORMAPPING_CHANGE, (event) => {
    if ((event as CustomEvent<{ colorOnly: boolean }>).detail.colorOnly) count += 1;
  });
  return () => count;
}

function inputColour(legend: ProtspaceLegend, color: string): void {
  const input = swatch(legend);
  input.value = color;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

function press(down: Element, up: Element = down): void {
  down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
}

function storedFamilyRecord(): LegendPersistedSettings {
  const key = Object.keys(localStorage).find(
    (each) => each.startsWith('protspace:legend:') && each.endsWith(':family'),
  );
  return JSON.parse(localStorage.getItem(key!)!) as LegendPersistedSettings;
}

/** The stored record for `annotation`, whatever the dataset hash. */
function storedRecord(annotation: string): LegendPersistedSettings | null {
  const key = Object.keys(localStorage).find(
    (each) => each.startsWith('protspace:legend:') && each.endsWith(`:${annotation}`),
  );
  return key ? (JSON.parse(localStorage.getItem(key)!) as LegendPersistedSettings) : null;
}

/** Two annotations with the same twelve categories. */
function twoAnnotations(): VisualizationData {
  const data = categoricalData(TWELVE);
  const kind = categoricalData(TWELVE, 'kind');
  data.annotations.kind = kind.annotations.kind;
  data.annotation_data.kind = kind.annotation_data.kind;
  return data;
}

describe('legend colour and shape picker', () => {
  it('Colour and shape opens the picker in the top layer beside its row, unclipped by a 240 px sidebar', async () => {
    const { legend } = await mount();
    await openPicker(legend, 'A');

    expect(picker(legend).open).toBe(true);
    expect(panel(legend).matches(':popover-open')).toBe(true);
    expect(panel(legend).getAttribute('role')).toBe('dialog');
    expect(panel(legend).getAttribute('aria-label')).toBe('Colour and shape: A');
    expect(legend.shadowRoot!.querySelector('.color-picker-header')!.textContent!.trim()).toBe('A');
    expect(swatch(legend).getAttribute('aria-label')).toBe('Set color for A');

    const rowBox = row(legend, 'A').getBoundingClientRect();
    const box = panel(legend).getBoundingClientRect();
    // left-start: beside the row, over the plot, its top level with the row's.
    expect(box.right).toBeLessThanOrEqual(rowBox.left + 1);
    expect(Math.abs(box.top - rowBox.top)).toBeLessThanOrEqual(3);
    // Outside the legend's clipping box, and still what a press there reaches.
    expect(box.left).toBeLessThan(legend.getBoundingClientRect().left);
    const hit = legend.shadowRoot!.elementFromPoint(box.left + 12, box.top + 12);
    expect(hit?.closest('ps-popover.color-picker')).toBe(picker(legend));
  });

  it('three colour inputs within 150 ms dispatch one legend-colormapping-change', async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    const commits = colourCommits(plot);

    for (const color of ['#112233', '#223344', '#334455']) inputColour(legend, color);
    await legend.updateComplete;

    // The row repaints at once; the plot waits until the drag pauses.
    expect(row(legend, 'A').querySelector('.legend-symbol path')!.getAttribute('fill')).toBe(
      '#334455',
    );
    expect(commits()).toBe(0);
    await expect.poll(commits, { timeout: COLOR_COMMIT_DELAY_MS + 1000 }).toBe(1);
    // and no second commit trails it
    await pause(COLOR_COMMIT_DELAY_MS);
    expect(commits()).toBe(1);
    expect(storedFamilyRecord().categories.A.color).toBe('#334455');
  });

  it("lands a pending colour on its own row when another row's picker opens", async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    const commits = colourCommits(plot);
    inputColour(legend, '#ff0000');

    await openPicker(legend, 'B');

    expect(commits()).toBe(1);
    expect(panel(legend).getAttribute('aria-label')).toBe('Colour and shape: B');
    expect(storedFamilyRecord().categories.A.color).toBe('#ff0000');
    expect(storedFamilyRecord().categories.B.color).not.toBe('#ff0000');
    await pause(COLOR_COMMIT_DELAY_MS + 50);
    expect(commits()).toBe(1);
  });

  it("opening another row's picker without a press lands the pending colour first", async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    const commits = colourCommits(plot);
    inputColour(legend, '#00ff00');

    // A synthetic click fires no pointerdown, so A's picker is not closed by an outside press:
    // the keyboard path, where only open() can land the pending colour.
    more(legend, 'B').click();
    await settle(legend);
    expect(picker(legend).open).toBe(true);
    expect(commits()).toBe(0);
    legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!.dispatchEvent(
      new CustomEvent('ps-select', {
        bubbles: true,
        composed: true,
        detail: { value: 'customize', checked: false },
      }),
    );
    // Synchronously, before the commit delay could have run out.
    expect(commits()).toBe(1);
    await settle(legend);

    expect(panel(legend).getAttribute('aria-label')).toBe('Colour and shape: B');
    expect(storedFamilyRecord().categories.A.color).toBe('#00ff00');
    await pause(COLOR_COMMIT_DELAY_MS + 50);
    expect(commits()).toBe(1);
  });

  it('lands a colour still waiting for its delay on the dataset it was picked on', async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    const commits = colourCommits(plot);
    inputColour(legend, '#ff0000');

    legend.clearForNewDataset('next-dataset');

    expect(commits()).toBe(1);
    expect(storedFamilyRecord().categories.A.color).toBe('#ff0000');
    await pause(COLOR_COMMIT_DELAY_MS + 50);
    expect(commits()).toBe(1);
  });

  it('an annotation change closes it and lands a pending colour on the annotation it was picked on', async () => {
    const { legend, plot, picker: annotationPicker } = await mount(twoAnnotations());
    await openPicker(legend, 'A');
    inputColour(legend, '#ff0000');

    plot.selectedAnnotation = 'kind';
    annotationPicker.dispatchEvent(
      new CustomEvent(LEGEND_EVENTS.ANNOTATION_CHANGE, {
        detail: { annotation: 'kind' },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(legend);

    expect(legend.selectedAnnotation).toBe('kind');
    expect(picker(legend).open).toBe(false);
    expect(storedRecord('family')?.categories.A.color).toBe('#ff0000');
    expect(storedRecord('kind')?.categories?.A?.color).not.toBe('#ff0000');
    await pause(COLOR_COMMIT_DELAY_MS + 50);
    expect(storedRecord('kind')?.categories?.A?.color).not.toBe('#ff0000');
  });

  it('the annotation set from outside closes it and drops a pending colour', async () => {
    const { legend } = await mount(twoAnnotations());
    await openPicker(legend, 'A');
    inputColour(legend, '#ff0000');

    legend.selectedAnnotation = 'kind';
    await settle(legend);

    expect(picker(legend).open).toBe(false);
    await pause(COLOR_COMMIT_DELAY_MS + 50);
    expect(storedRecord('kind')?.categories?.A?.color).not.toBe('#ff0000');
  });

  it('a shape pick persists and checks its radio', async () => {
    const { legend } = await mount();
    await openPicker(legend, 'A');
    expect(
      legend.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute('aria-label'),
    ).toBe('Shape');
    expect(shape(legend, 'circle').getAttribute('aria-checked')).toBe('true');

    await userEvent.click(shape(legend, 'square'));
    await settle(legend);

    expect(shape(legend, 'square').getAttribute('aria-checked')).toBe('true');
    expect(shape(legend, 'circle').getAttribute('aria-checked')).toBe('false');
    expect(storedFamilyRecord().categories.A.shape).toBe('square');
    expect(row(legend, 'A').querySelector('.legend-symbol path')!.getAttribute('d')).toBe(
      SHAPE_PATH_GENERATORS.square(LEGEND_STYLES.legendDisplaySize),
    );

    // The arrow keys move the pick, and focus goes with the checked radio.
    shape(legend, 'square').focus();
    await userEvent.keyboard('{ArrowRight}');
    await settle(legend);
    expect(shape(legend, 'diamond').getAttribute('aria-checked')).toBe('true');
    expect(deepActiveElement()).toBe(shape(legend, 'diamond'));
    expect(storedFamilyRecord().categories.A.shape).toBe('diamond');
  });

  it('Colour and shape on the row whose picker is open keeps it open', async () => {
    const { legend } = await mount();
    await openPicker(legend, 'A');
    expect(picker(legend).open).toBe(true);

    await openPicker(legend, 'A');

    expect(picker(legend).open).toBe(true);
    expect(panel(legend).getAttribute('aria-label')).toBe('Colour and shape: A');
  });

  it('an outside press closes it and flushes the pending colour; a drag that ends outside does not', async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    const commits = colourCommits(plot);

    press(swatch(legend), document.body);
    await settle(legend);
    expect(picker(legend).open).toBe(true);

    inputColour(legend, '#123456');
    press(document.body);
    await settle(legend);

    expect(picker(legend).open).toBe(false);
    // At once, well inside the commit delay.
    expect(commits()).toBe(1);
  });

  it("Escape closes it, flushes, and returns focus to the row's ⋯ button", async () => {
    const { legend, plot } = await mount();
    await openPicker(legend, 'A');
    expect(deepActiveElement()).toBe(swatch(legend));
    const commits = colourCommits(plot);
    inputColour(legend, '#654321');

    await userEvent.keyboard('{Escape}');
    await settle(legend);

    expect(picker(legend).open).toBe(false);
    expect(commits()).toBe(1);
    expect(deepActiveElement()).toBe(more(legend, 'A'));
  });

  it('still closes on Escape and on a press outside after the legend is moved', async () => {
    const { legend } = await mount();
    const parent = legend.parentElement!;

    // The panel leaves the top layer with the move and comes back on the popover's next update.
    await openPicker(legend, 'A');
    legend.remove();
    parent.append(legend);
    await settle(legend);
    expect(panel(legend).matches(':popover-open')).toBe(true);
    await userEvent.keyboard('{Escape}');
    await settle(legend);
    expect(picker(legend).open).toBe(false);

    await openPicker(legend, 'B');
    legend.remove();
    parent.append(legend);
    await settle(legend);
    press(document.body);
    await settle(legend);
    expect(picker(legend).open).toBe(false);
  });

  it('offers no Colour and shape on numeric rows', async () => {
    const { legend } = await mountLegendWithScatterplot(
      numericData(Array.from({ length: 20 }, (_, i) => i + 1)),
      'length',
    );
    await settle(legend);
    const first = legend.shadowRoot!.querySelector<HTMLElement>(
      '.legend-item:not(.legend-item-other)',
    )!;

    first.querySelector<HTMLButtonElement>('.legend-more')!.click();
    await settle(legend);

    const menu = legend.shadowRoot!.querySelector<PsMenu>('ps-menu.row-menu')!;
    expect(menu.open).toBe(true);
    expect(menu.querySelector('ps-menu-item[value="isolate"]')).not.toBeNull();
    expect(menu.querySelector('ps-menu-item[value="customize"]')).toBeNull();
  });

  it('multilabel annotations show the shapes disabled with the note', async () => {
    const { legend } = await mount(multilabelData());
    await openPicker(legend, 'A');

    const shapes = [
      ...legend.shadowRoot!.querySelectorAll<HTMLButtonElement>('.shape-picker-item'),
    ];
    expect(shapes).toHaveLength(6);
    expect(shapes.every((button) => button.disabled)).toBe(true);
    expect(legend.shadowRoot!.querySelector('.symbol-picker-note')!.textContent!.trim()).toBe(
      'Shapes unavailable for multilabel annotations',
    );
    expect(
      legend.shadowRoot!.querySelector('.shape-picker')!.getAttribute('aria-describedby'),
    ).toBe('shape-note');
  });
});
