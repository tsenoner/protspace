// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotationLabel } from '@protspace/utils';
import type { PsIconButton } from '../kit/button';
import type { ProtspaceLegend } from './legend';
import { sortIcon, sortLabel } from './legend-header';
import type { LegendSortMode } from './types';
import { categoricalData, numericData, TWELVE } from './test-support/legend-fixtures';
import {
  mountLegendWithScatterplot,
  settleLegend,
} from './test-support/legend-scatterplot-harness';
import { createLocalStorageMock } from './test-support/local-storage-mock';
import { stubPopoverApi } from './test-support/popover-stub';

// Settings persist per dataset: an in-memory store keeps one test's sort out of the next.
vi.stubGlobal('localStorage', createLocalStorageMock());
stubPopoverApi();

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

async function mount(
  ...args: Parameters<typeof mountLegendWithScatterplot>
): Promise<ProtspaceLegend> {
  const { legend } = await mountLegendWithScatterplot(...args);
  await settleLegend(legend);
  return legend;
}

async function headerButton(
  legend: ProtspaceLegend,
  name: 'sort-button' | 'settings-button',
): Promise<PsIconButton> {
  const button = legend.shadowRoot!.querySelector<PsIconButton>(
    `.legend-header ps-icon-button.${name}`,
  )!;
  await button.updateComplete;
  return button;
}

const inner = (button: PsIconButton) => button.shadowRoot!.querySelector('button')!;

const CATEGORICAL_LABELS: Array<[LegendSortMode, string]> = [
  ['size-desc', 'By count, largest first'],
  ['size-asc', 'By count, smallest first'],
  ['alpha-asc', 'By name, A to Z'],
  ['alpha-desc', 'By name, Z to A'],
  ['manual', 'Your order'],
  ['manual-reverse', 'Your order, reversed'],
  ['silhouette-desc', 'By separation, best first'],
  ['silhouette-asc', 'By separation, worst first'],
];

const NUMERIC_LABELS: Array<[LegendSortMode, string]> = [
  ['alpha-asc', 'By value, low to high'],
  ['alpha-desc', 'By value, high to low'],
  ['manual', 'Your order'],
  ['manual-reverse', 'Your order, reversed'],
];

describe('legend header', () => {
  it('the title is the display name, never the key', async () => {
    const legend = await mount(categoricalData(TWELVE, 'order'), 'order');
    const title = legend.shadowRoot!.querySelector('.legend-header .legend-title')!;
    expect(title.textContent!.trim()).toBe(annotationLabel('order'));
    expect(title.textContent!.trim()).not.toBe('order');
  });

  it('a predicted annotation shows the sparkles icon named Predicted annotation, and no ⚡ or note', async () => {
    const legend = await mount(categoricalData(TWELVE, 'predicted_membrane'), 'predicted_membrane');
    const root = legend.shadowRoot!;
    const mark = root.querySelector('.legend-header .legend-predicted')!;
    expect(mark.getAttribute('role')).toBe('img');
    expect(mark.getAttribute('aria-label')).toBe('Predicted annotation');
    expect(mark.querySelector('svg')).not.toBeNull();
    const tooltip = mark.nextElementSibling!;
    expect(tooltip.tagName).toBe('PS-TOOLTIP');
    expect(tooltip.getAttribute('text')).toBe(
      'Predicted: computational, not experimentally curated',
    );
    expect(root.textContent).not.toContain('⚡');
    expect(root.querySelector('[part="predicted-note"]')).toBeNull();
    expect(root.querySelector('.legend-header [title]')).toBeNull();

    document.body.innerHTML = '';
    const plain = await mount(categoricalData(TWELVE), 'family');
    expect(plain.shadowRoot!.querySelector('.legend-predicted')).toBeNull();
  });

  it('sortLabel names all eight modes, and the numeric ones by value', () => {
    for (const [mode, label] of CATEGORICAL_LABELS) expect(sortLabel(mode, false)).toBe(label);
    for (const [mode, label] of NUMERIC_LABELS) expect(sortLabel(mode, true)).toBe(label);
  });

  it('sortIcon maps every mode', () => {
    const categorical: Array<[LegendSortMode, string]> = [
      ['size-desc', 'arrow-down-wide-narrow'],
      ['size-asc', 'arrow-down-narrow-wide'],
      ['alpha-asc', 'arrow-down-a-z'],
      ['alpha-desc', 'arrow-down-z-a'],
      ['manual', 'arrow-up-down'],
      ['manual-reverse', 'arrow-up-down'],
      ['silhouette-desc', 'arrow-down-wide-narrow'],
      ['silhouette-asc', 'arrow-down-narrow-wide'],
    ];
    for (const [mode, name] of categorical) expect(sortIcon(mode, false)).toBe(name);
    expect(sortIcon('alpha-asc', true)).toBe('arrow-down-0-1');
    expect(sortIcon('alpha-desc', true)).toBe('arrow-down-1-0');
    expect(sortIcon('manual', true)).toBe('arrow-up-down');
    expect(sortIcon('manual-reverse', true)).toBe('arrow-up-down');
  });

  it('the sort button is named Sort: {label}', async () => {
    const legend = await mount(categoricalData(TWELVE), 'family');
    const sort = await headerButton(legend, 'sort-button');
    expect(sort.label).toBe('Sort: By count, largest first');
    expect(sort.icon).toBe('arrow-down-wide-narrow');
    expect(inner(sort).getAttribute('aria-label')).toBe('Sort: By count, largest first');
    expect(sort.hasAttribute('hidden')).toBe(false);

    document.body.innerHTML = '';
    const numeric = await mount(numericData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 'length');
    const numericSort = await headerButton(numeric, 'sort-button');
    expect(numericSort.label).toBe('Sort: By value, low to high');
    expect(numericSort.icon).toBe('arrow-down-0-1');
  });

  it('the settings button is named Legend settings and dispatches legend-customize', async () => {
    const { legend } = await mountLegendWithScatterplot(categoricalData(TWELVE), 'family');
    await legend.updateComplete;
    const customize = vi.fn();
    legend.addEventListener('legend-customize', customize);
    const button = legend.shadowRoot!.querySelector<HTMLElement & { label: string }>(
      '.settings-button',
    )!;
    expect(button.label).toBe('Legend settings');
    const popover = () => legend.shadowRoot!.querySelector('protspace-legend-settings-popover')!;

    button.click();
    for (let i = 0; i < 10 && !(await legend.updateComplete); i++);
    expect(customize).toHaveBeenCalledOnce();
    expect(popover().open).toBe(true);

    button.click();
    await legend.updateComplete;
    expect(popover().open).toBe(false);
    expect(customize).toHaveBeenCalledOnce();
  });

  it('with one row the sort button is hidden', async () => {
    const legend = await mount(categoricalData({ A: 3 }), 'family');
    const sort = await headerButton(legend, 'sort-button');
    expect(sort.hasAttribute('hidden')).toBe(true);
  });
});
