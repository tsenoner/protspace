import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adoptStyles, render } from 'lit';
import { adoptTheme } from '../kit/adopt-theme';
import type { ProtspaceLegend } from './legend';
import { LEGEND_VALUES, NA_VALUE } from './config';
import { legendStyles } from './legend.styles';
import { renderLegendRow, type LegendRowHandlers, type LegendRowView } from './legend-row';
import './category-score-strip';
import type { LegendItem } from './types';
import { categoricalData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Ten rows, Other (J, K and L) and an N/A row large enough to stay in the list. */
async function mountLegend(): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(
    categoricalData({ [NA_VALUE]: 20, ...TWELVE }),
    'family',
  );
  await settleLegend(legend);
  await frame();
  return legend;
}

const swatch = (legend: ProtspaceLegend, value: string) =>
  legend.shadowRoot!.querySelector<SVGPathElement>(
    `.legend-item[data-value="${value}"] .legend-symbol path`,
  )!;

const noop = () => {};
const HANDLERS: LegendRowHandlers = {
  onClick: noop,
  onDoubleClick: noop,
  onKeyDown: noop,
  onHandleKeyDown: noop,
  onHover: noop,
  onFocus: noop,
  onToggle: noop,
  onMenu: noop,
  onViewOther: noop,
  onNamePointerEnter: noop,
  onPointerDown: noop,
};
const VIEW: LegendRowView = {
  classes: 'legend-item',
  symbolSize: 10,
  tabbable: true,
  draggable: false,
  picked: false,
  hasMenu: true,
};

/** One row as the legend draws it, under the legend's own stylesheet. */
function drawRow(item: LegendItem): SVGPathElement {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  adoptStyles(root, legendStyles);
  document.body.append(host);
  render(renderLegendRow(item, VIEW, HANDLERS), root);
  return root.querySelector<SVGPathElement>('.legend-symbol path')!;
}

const item = (value: string, color: string): LegendItem => ({
  value,
  color,
  shape: 'circle',
  count: 1,
  isVisible: true,
  zOrder: 0,
});

describe('legend swatches in dark', () => {
  it('the Other swatch fills with the dark Other grey', async () => {
    document.documentElement.dataset.theme = 'dark';
    const legend = await mountLegend();
    // #64748b, the dark --ps-plot-other: the colour the plot draws Other points in.
    expect(getComputedStyle(swatch(legend, LEGEND_VALUES.OTHER)).fill).toBe('rgb(100, 116, 139)');
  });

  it('a default-coloured N/A swatch fills with the dark N/A grey', async () => {
    document.documentElement.dataset.theme = 'dark';
    const legend = await mountLegend();
    const path = swatch(legend, NA_VALUE);
    // The data colour stays light (exports draw it); only the screen follows the theme.
    expect(path.getAttribute('fill')?.toLowerCase()).toBe('#dddddd');
    // #2a3547, the dark --ps-plot-na.
    expect(getComputedStyle(path).fill).toBe('rgb(42, 53, 71)');
  });

  it('an N/A coloured by the user keeps its colour', () => {
    document.documentElement.dataset.theme = 'dark';
    expect(getComputedStyle(drawRow(item(NA_VALUE, '#ff00aa'))).fill).toBe('rgb(255, 0, 170)');
    // A regular category that happens to be the N/A grey is not N/A.
    expect(getComputedStyle(drawRow(item('A', '#DDDDDD'))).fill).toBe('rgb(221, 221, 221)');
  });

  it("a swatch outline reads --ps-swatch-stroke and a selected row's outline is still the accent", async () => {
    document.documentElement.dataset.theme = 'dark';
    const legend = await mountLegend();
    // #94a3b8, the dark --ps-swatch-stroke: a dark fill (Kelly's #222222) keeps its edge.
    expect(getComputedStyle(swatch(legend, 'A')).stroke).toBe('rgb(148, 163, 184)');
    legend.shadowRoot!.querySelector('.legend-item[data-value="B"]')!.classList.add('selected');
    // #38bdf8, the dark --ps-accent, 2 px.
    expect(getComputedStyle(swatch(legend, 'B')).stroke).toBe('rgb(56, 189, 248)');
    expect(getComputedStyle(swatch(legend, 'B')).strokeWidth).toBe('2px');
  });

  it("the score strip's Other dot is the dark Other grey", async () => {
    document.documentElement.dataset.theme = 'dark';
    const strip = document.createElement('protspace-score-strip');
    strip.points = [
      { category: 'A', value: 0.5, color: '#ff0000' },
      { category: 'Z', value: -0.2, color: '#888', other: true },
    ];
    strip.label = 'Silhouette';
    document.body.append(strip);
    await strip.updateComplete;
    const [rowDot, otherDot] = strip.shadowRoot!.querySelectorAll('circle');
    expect(getComputedStyle(rowDot).fill).toBe('rgb(255, 0, 0)');
    expect(getComputedStyle(otherDot).fill).toBe('rgb(100, 116, 139)');
  });
});

describe('legend swatches in light', () => {
  it('in light the swatches keep their data colours', async () => {
    const legend = await mountLegend();
    expect(getComputedStyle(swatch(legend, LEGEND_VALUES.OTHER)).fill).toBe('rgb(136, 136, 136)');
    expect(getComputedStyle(swatch(legend, NA_VALUE)).fill).toBe('rgb(221, 221, 221)');
    // #394150, LEGEND_STYLES.colors.defaultStroke, the light --ps-swatch-stroke.
    expect(getComputedStyle(swatch(legend, 'A')).stroke).toBe('rgb(57, 65, 80)');
  });
});
