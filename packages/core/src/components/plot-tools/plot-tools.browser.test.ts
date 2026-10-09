import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { PsIconButton } from '../kit/button';
import { deepActiveElement } from '../kit/focus';
import type { PsTooltip } from '../kit/tooltip';
import type { ProtspacePlotTools } from './plot-tools';
import './plot-tools';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function mount(): Promise<ProtspacePlotTools> {
  const el = document.createElement('protspace-plot-tools');
  el.style.cssText = 'position: fixed; left: 12px; top: 12px';
  document.body.append(el);
  await el.updateComplete;
  return el;
}
/** The kit button whose label starts with `label`. */
const tool = (el: ProtspacePlotTools, label: string) =>
  [...el.shadowRoot!.querySelectorAll<PsIconButton>('ps-icon-button')].find((button) =>
    button.label.startsWith(label),
  )!;
const inner = (button: Element) => button.shadowRoot!.querySelector('button')!;
const textButtons = (el: ProtspacePlotTools) =>
  [...el.shadowRoot!.querySelectorAll('.selection ps-button')].map((b) => b.textContent!.trim());

describe('protspace-plot-tools', () => {
  it('names Move and zoom, Box select, Lasso select and Fit to view, and presses the current tool', async () => {
    const el = await mount();
    await expect.element(page.getByRole('toolbar', { name: 'Plot tools' })).toBeInTheDocument();
    for (const name of ['Move and zoom', 'Box select', 'Lasso select', 'Fit to view']) {
      await expect.element(page.getByRole('button', { name, exact: true })).toBeInTheDocument();
    }
    expect(inner(tool(el, 'Move and zoom')).getAttribute('aria-pressed')).toBe('true');
    expect(inner(tool(el, 'Box select')).getAttribute('aria-pressed')).toBe('false');
    // Fit to view is an action, not a toggle.
    expect(inner(tool(el, 'Fit to view')).hasAttribute('aria-pressed')).toBe(false);

    el.tool = 'lasso';
    await el.updateComplete;
    await tool(el, 'Lasso select').updateComplete;
    expect(inner(tool(el, 'Lasso select')).getAttribute('aria-pressed')).toBe('true');
    expect(inner(tool(el, 'Move and zoom')).getAttribute('aria-pressed')).toBe('false');
  });

  it('choosing a tool dispatches plot-tool-change', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('plot-tool-change', onChange);

    inner(tool(el, 'Box select')).click();

    expect(onChange).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).detail).toEqual({ tool: 'rectangle' });
    expect(el.tool).toBe('rectangle');

    // Re-picking the current tool changes nothing.
    inner(tool(el, 'Box select')).click();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('Fit to view dispatches fit-view', async () => {
    const el = await mount();
    const onFit = vi.fn();
    el.addEventListener('fit-view', onFit);

    inner(tool(el, 'Fit to view')).click();

    expect(onFit).toHaveBeenCalledOnce();
  });

  it('Clear and Isolate show only with a selection, Reset only when isolated', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('[role="group"]')).toBeNull();

    el.selectedCount = 2;
    await el.updateComplete;
    await expect.element(page.getByRole('group', { name: 'Selection' })).toBeInTheDocument();
    expect(textButtons(el)).toEqual(['Clear', 'Isolate']);

    const onClear = vi.fn();
    const onIsolate = vi.fn();
    el.addEventListener('clear-selections', onClear);
    el.addEventListener('isolate-data', onIsolate);
    inner(el.shadowRoot!.querySelectorAll('.selection ps-button')[0]).click();
    inner(el.shadowRoot!.querySelectorAll('.selection ps-button')[1]).click();
    expect(onClear).toHaveBeenCalledOnce();
    expect(onIsolate).toHaveBeenCalledOnce();

    el.selectedCount = 0;
    el.isolated = true;
    await el.updateComplete;
    expect(textButtons(el)).toEqual(['Reset']);
    const onReset = vi.fn();
    el.addEventListener('reset-isolation', onReset);
    inner(el.shadowRoot!.querySelector('.selection ps-button')!).click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('with selection disabled, Box and Lasso are disabled', async () => {
    const el = await mount();
    el.selectionDisabled = true;
    await el.updateComplete;

    expect(tool(el, 'Box select').disabled).toBe(true);
    expect(tool(el, 'Lasso select').disabled).toBe(true);
    expect(tool(el, 'Move and zoom').disabled).toBe(false);
    // The label is the tooltip: it says why.
    expect(tool(el, 'Box select').label).toBe('Box select (needs at least 2 points)');
  });

  it('tooltips open to the right', async () => {
    const el = await mount();
    const move = tool(el, 'Move and zoom');
    const tooltip = move.shadowRoot!.querySelector('ps-tooltip') as PsTooltip;
    await tooltip.updateComplete;

    tooltip.show();
    await frame();
    await frame();

    const tip = tooltip.shadowRoot!.querySelector('.tip')!.getBoundingClientRect();
    expect(tip.left).toBeGreaterThanOrEqual(inner(move).getBoundingClientRect().right);
    tooltip.hide();
  });

  it('arrow keys move between the tools', async () => {
    const el = await mount();
    inner(tool(el, 'Move and zoom')).focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(deepActiveElement()).toBe(inner(tool(el, 'Box select')));
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    expect(deepActiveElement()).toBe(inner(tool(el, 'Fit to view')));
  });
});
