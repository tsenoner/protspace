import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import { deepActiveElement } from '../kit/focus';
import type { PsInput } from '../kit/input';
import type { PsSelect } from '../kit/select';
import {
  SETTINGS_INPUT_DEBOUNCE_MS,
  type ProtspaceLegendSettingsPopover,
} from './legend-settings-popover';
import { CATEGORICAL_PALETTE_IDS, GRADIENT_PALETTE_IDS } from './palette-swatches';
import type { LegendDisplaySettings } from './types';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Past the number fields' debounce, with room for a slow frame. */
const afterDebounce = () => wait(SETTINGS_INPUT_DEBOUNCE_MS + 150);

async function settle(el: ProtspaceLegendSettingsPopover): Promise<void> {
  await el.updateComplete;
  await frame();
  await frame();
}

const CATEGORICAL: LegendDisplaySettings = {
  maxVisibleValues: 10,
  shapeSize: 12,
  enableDuplicateStackUI: false,
  paletteId: 'kellys',
  numericStrategy: 'quantile',
  reverseGradient: false,
};

interface MountOptions {
  numeric?: boolean;
  logBinningAvailable?: boolean;
  canReset?: boolean;
  settings?: Partial<LegendDisplaySettings>;
}

/**
 * The popover open under an anchor, as the legend renders it. A listener stands in for the legend:
 * it records each settings-change and applies it, so the popover shows the new value.
 */
async function mount(options: MountOptions = {}) {
  document.body.innerHTML =
    '<button id="anchor">Legend settings</button><button id="outside">Outside</button>';
  const anchor = document.getElementById('anchor') as HTMLButtonElement;
  const el = document.createElement('protspace-legend-settings-popover');
  el.anchor = anchor;
  el.annotationLabel = options.numeric ? 'Sequence length' : 'Family';
  el.numeric = options.numeric ?? false;
  el.defaultShapeSize = 4;
  el.logBinningAvailable = options.logBinningAvailable ?? true;
  el.canReset = options.canReset ?? true;
  el.settings = {
    ...CATEGORICAL,
    ...(options.numeric ? { paletteId: 'batlow' } : {}),
    ...options.settings,
  };
  const changes: Partial<LegendDisplaySettings>[] = [];
  el.addEventListener('settings-change', (event) => {
    const detail = (event as CustomEvent<Partial<LegendDisplaySettings>>).detail;
    changes.push(detail);
    el.settings = { ...el.settings, ...detail };
  });
  document.body.append(el);
  anchor.focus();
  el.open = true;
  await settle(el);
  return { el, anchor, changes };
}

const root = (el: ProtspaceLegendSettingsPopover) => el.shadowRoot!;
const field = (el: ProtspaceLegendSettingsPopover, id: 'max-visible-input' | 'shape-size-input') =>
  root(el).querySelector<PsInput>(`#${id}`)!;
const inner = (host: PsInput) => host.shadowRoot!.querySelector('input')!;
const radios = (el: ProtspaceLegendSettingsPopover) => [
  ...root(el).querySelectorAll<HTMLElement>('[role="radio"]'),
];
const radioNames = (el: ProtspaceLegendSettingsPopover) =>
  radios(el).map((radio) => radio.textContent!.trim());

describe('protspace-legend-settings-popover', () => {
  it('the panel is a dialog named Legend settings: {label}, headed by the display name', async () => {
    const { el } = await mount();
    await expect
      .element(page.getByRole('dialog', { name: 'Legend settings: Family' }))
      .toBeVisible();
    expect(root(el).querySelector('.title')!.textContent!.trim()).toBe('Family');
    // Non-modal: the plot stays usable beside it.
    const panel = root(el).querySelector('ps-popover')!.shadowRoot!.querySelector('.panel')!;
    expect(panel.hasAttribute('aria-modal')).toBe(false);
  });

  it('the swatches are a radio group named Palette with 6 categorical and 5 gradient palettes', async () => {
    expect(CATEGORICAL_PALETTE_IDS).toEqual([
      'dark2',
      'kellys',
      'okabeIto',
      'set2',
      'tableau10',
      'tolBright',
    ]);
    expect(GRADIENT_PALETTE_IDS).toEqual(['batlow', 'cividis', 'inferno', 'plasma', 'viridis']);

    const { el } = await mount();
    await expect.element(page.getByRole('radiogroup', { name: 'Palette' })).toBeVisible();
    expect(radioNames(el)).toEqual([
      'Dark2',
      "Kelly's Colors",
      'Okabe-Ito',
      'Set2',
      'Tableau 10',
      'Tol Bright',
    ]);
    expect(radios(el).map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(radios(el).map((radio) => radio.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]);
    expect(radios(el)[1].querySelectorAll('.chip')).toHaveLength(8);
    el.focusFirst();
    expect(deepActiveElement()).toBe(radios(el)[1]);

    document.body.replaceChildren();
    const numeric = await mount({ numeric: true });
    expect(radioNames(numeric.el)).toEqual(['Batlow', 'Cividis', 'Inferno', 'Plasma', 'Viridis']);
    const strip = radios(numeric.el)[0].querySelector<HTMLElement>('.swatch-gradient')!;
    expect(strip.style.backgroundImage).toContain('linear-gradient(90deg');
  });

  it('picking a palette fires settings-change {paletteId}; the checked one fires nothing and nothing bubbles', async () => {
    const { el, changes } = await mount();
    const onDocument = vi.fn();
    document.addEventListener('settings-change', onDocument);
    try {
      await userEvent.click(page.getByRole('radio', { name: 'Okabe-Ito' }));
      await settle(el);
      await userEvent.click(page.getByRole('radio', { name: 'Okabe-Ito' }));
    } finally {
      document.removeEventListener('settings-change', onDocument);
    }
    expect(changes).toEqual([{ paletteId: 'okabeIto' }]);
    await settle(el);
    expect(radios(el)[2].getAttribute('aria-checked')).toBe('true');
    expect(onDocument).not.toHaveBeenCalled();
    expect(el.open).toBe(true);
  });

  it('arrow keys move the checked swatch and fire one settings-change each', async () => {
    const { el, changes } = await mount();
    radios(el)[1].focus();
    for (const key of ['{ArrowRight}', '{ArrowDown}', '{ArrowLeft}', '{End}', '{Home}']) {
      await userEvent.keyboard(key);
      await settle(el);
    }
    expect(changes.map((change) => change.paletteId)).toEqual([
      'okabeIto',
      'set2',
      'okabeIto',
      'tolBright',
      'dark2',
    ]);
    expect(deepActiveElement()).toBe(radios(el)[0]);
    expect(radios(el).map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
  });

  it('typing 2 then 5 fires one settings-change {maxVisibleValues: 25} after 300 ms', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'max-visible-input'));
    await userEvent.fill(input, '');
    await userEvent.keyboard('25');
    expect(input.value).toBe('25');
    expect(changes).toEqual([]);
    await expect.poll(() => changes).toEqual([{ maxVisibleValues: 25 }]);
    await frame();
    expect(changes).toHaveLength(1);
  });

  it('commits exactly SETTINGS_INPUT_DEBOUNCE_MS after the last input', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'max-visible-input'));
    // Synthetic input under fake timers: userEvent talks to the runner over real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      for (const value of ['2', '25']) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        vi.advanceTimersByTime(SETTINGS_INPUT_DEBOUNCE_MS - 1);
      }
      expect(changes).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(changes).toEqual([{ maxVisibleValues: 25 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holding ArrowUp on the field fires one settings-change after the burst', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'max-visible-input'));
    input.focus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(input.value).toBe('13');
    expect(changes).toEqual([]);
    await expect.poll(() => changes).toEqual([{ maxVisibleValues: 13 }]);
    await frame();
    expect(changes).toHaveLength(1);
  });

  it('Enter or leaving the field fires at once', async () => {
    const { el, changes } = await mount();
    await userEvent.fill(inner(field(el, 'max-visible-input')), '30');
    await userEvent.keyboard('{Enter}');
    expect(changes).toEqual([{ maxVisibleValues: 30 }]);
    await userEvent.fill(inner(field(el, 'shape-size-input')), '20');
    await userEvent.keyboard('{Tab}');
    expect(changes).toEqual([{ maxVisibleValues: 30 }, { shapeSize: 20 }]);
    await afterDebounce();
    expect(changes).toHaveLength(2);
    expect(el.open).toBe(true);
  });

  it('an emptied size fires shapeSize: null and shows the default as placeholder', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'shape-size-input'));
    expect(input.value).toBe('12');
    expect(input.placeholder).toBe('4');
    expect(root(el).textContent).toContain('Default for this dataset: 4');
    await userEvent.fill(input, '');
    await expect.poll(() => changes).toEqual([{ shapeSize: null }]);
    await settle(el);
    expect(input.value).toBe('');
  });

  it('640 becomes 64 in the field and in the event', async () => {
    const { el, changes } = await mount();
    const input = inner(field(el, 'shape-size-input'));
    await userEvent.fill(input, '640');
    expect(input.value).toBe('64');
    await expect.poll(() => changes).toEqual([{ shapeSize: 64 }]);
  });

  it('0, -5, an empty field and a bad entry fire nothing and mark the field invalid', async () => {
    const { el, changes } = await mount();
    const host = field(el, 'max-visible-input');
    const input = inner(host);
    for (const value of ['0', '-5', '']) {
      await userEvent.fill(input, value);
      await settle(el);
      expect(host.invalid, value).toBe(true);
      expect(input.getAttribute('aria-invalid'), value).toBe('true');
    }
    // 'e' is the one letter a number field takes; alone it parses as nothing.
    await userEvent.keyboard('e');
    await settle(el);
    expect(host.invalid).toBe(true);
    await afterDebounce();
    expect(changes).toEqual([]);

    await userEvent.fill(input, '12');
    await settle(el);
    expect(host.invalid).toBe(false);
    await expect.poll(() => changes).toEqual([{ maxVisibleValues: 12 }]);

    const size = field(el, 'shape-size-input');
    await userEvent.fill(inner(size), '0');
    await settle(el);
    expect(size.invalid).toBe(true);
    await afterDebounce();
    expect(changes).toHaveLength(1);

    // 1 is the smallest size the field takes.
    await userEvent.fill(inner(size), '1');
    await settle(el);
    expect(size.invalid).toBe(false);
    await expect.poll(() => changes.at(-1)).toEqual({ shapeSize: 1 });
  });

  it('each number field and Reset are described by the hint under them', async () => {
    const { el } = await mount();
    expect(inner(field(el, 'shape-size-input')).ariaDescribedByElements?.[0]?.textContent).toMatch(
      /^Default for this dataset: 4; clear the field to use it\.$/,
    );
    expect(
      inner(field(el, 'max-visible-input')).ariaDescribedByElements?.[0]?.textContent?.trim(),
    ).toBeTruthy();
    const reset = root(el).querySelector('ps-button')!.shadowRoot!.querySelector('button')!;
    expect(reset.ariaDescribedByElements?.[0]?.textContent).toMatch(/^\s*Resets this annotation/);
  });

  it('the numeric panel shows its whole foot, Reset included, without scrolling', async () => {
    const { el } = await mount({ numeric: true });
    const panel = root(el)
      .querySelector('ps-popover')!
      .shadowRoot!.querySelector<HTMLElement>('.panel')!;
    expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight);
    const reset = page.getByRole('button', { name: 'Reset', exact: true }).element();
    expect(reset.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      panel.getBoundingClientRect().bottom,
    );
  });

  it('logarithmic is disabled with its note when unavailable', async () => {
    const { el } = await mount({ numeric: true, logBinningAvailable: false });
    const select = root(el).querySelector<PsSelect>('#numeric-distribution-select')!;
    const native = select.shadowRoot!.querySelector('select')!;
    expect(
      [...native.options].map((option) => [option.value, option.text.trim(), option.disabled]),
    ).toEqual([
      ['linear', 'Linear', false],
      ['quantile', 'Quantile', false],
      ['logarithmic', 'Logarithmic', true],
    ]);
    const note = root(el).querySelector<HTMLElement>('#numeric-log-disabled-note')!;
    expect(note.textContent!.trim()).toBe(
      'Logarithmic distribution is only available for positive values.',
    );
    expect(note.dataset.driverId).toBe('numeric-log-disabled-note');
    expect(native.ariaDescribedByElements?.[0]).toBe(note);

    el.logBinningAvailable = true;
    await settle(el);
    expect(root(el).querySelector('#numeric-log-disabled-note')).toBeNull();
    expect(native.options[2].disabled).toBe(false);
    expect(native.ariaDescribedByElements ?? []).toHaveLength(0);
  });

  it('numeric shows Bins, Point size, Reverse gradient and Bin distribution; categorical shows neither switch nor select', async () => {
    const { el, changes } = await mount({ numeric: true });
    await expect.element(page.getByRole('spinbutton', { name: 'Bins' })).toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: 'Point size' })).toBeVisible();
    await userEvent.click(page.getByRole('switch', { name: 'Reverse gradient' }));
    await userEvent.selectOptions(
      page.getByRole('combobox', { name: 'Bin distribution' }),
      'linear',
    );
    await userEvent.click(
      page.getByRole('switch', { name: 'Show duplicate counts and spread overlaps' }),
    );
    expect(changes).toEqual([
      { reverseGradient: true },
      { numericStrategy: 'linear' },
      { enableDuplicateStackUI: true },
    ]);
    await settle(el);
    const strip = radios(el)[0].querySelector<HTMLElement>('.swatch-gradient')!;
    expect(strip.style.backgroundImage).toContain('270deg');

    document.body.replaceChildren();
    const categorical = await mount();
    await expect.element(page.getByRole('spinbutton', { name: 'Max legend items' })).toBeVisible();
    await expect.element(page.getByRole('spinbutton', { name: 'Shape size' })).toBeVisible();
    expect(root(categorical.el).querySelector('#reverse-gradient-toggle')).toBeNull();
    expect(root(categorical.el).querySelector('#numeric-distribution-select')).toBeNull();
  });

  it('Reset fires settings-reset, keeps the panel open, and is disabled when canReset is false', async () => {
    const { el } = await mount();
    const onReset = vi.fn();
    el.addEventListener('settings-reset', onReset);
    const reset = page.getByRole('button', { name: 'Reset', exact: true });
    await userEvent.click(reset);
    expect(onReset).toHaveBeenCalledOnce();
    expect(el.open).toBe(true);
    await expect
      .element(
        page.getByText(
          "Resets this annotation's colours, order, hidden categories, palette and item count, and the dataset's point size",
        ),
      )
      .toBeVisible();

    el.canReset = false;
    await settle(el);
    await expect.element(reset).toBeDisabled();
  });

  it('there is no Save or Cancel and no title attribute', async () => {
    const { el } = await mount({ numeric: true });
    expect(page.getByRole('button', { name: /^(Save|Cancel)$/ }).elements()).toHaveLength(0);
    expect(root(el).querySelectorAll('[title]')).toHaveLength(0);
  });

  it('closing with a pending edit fires it before ps-close reaches the owner; so does removal', async () => {
    const { el, anchor } = await mount();
    const log: string[] = [];
    el.addEventListener('settings-change', (event) =>
      log.push(`change ${JSON.stringify((event as CustomEvent).detail)}`),
    );
    el.addEventListener('ps-close', () => {
      log.push('close');
      // The owner's part: it closes the popover it opened.
      el.open = false;
    });
    await userEvent.fill(inner(field(el, 'max-visible-input')), '25');
    await userEvent.keyboard('{Escape}');
    await settle(el);
    expect(log).toEqual(['change {"maxVisibleValues":25}', 'close']);
    expect(document.activeElement).toBe(anchor);

    el.open = true;
    await settle(el);
    await userEvent.fill(inner(field(el, 'max-visible-input')), '7');
    el.remove();
    expect(log.at(-1)).toBe('change {"maxVisibleValues":7}');
  });
});
