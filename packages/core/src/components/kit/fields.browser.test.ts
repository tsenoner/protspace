import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsCheckbox } from './checkbox';
import './checkbox';
import type { PsInput } from './input';
import './input';
import type { PsSegmented } from './segmented';
import './segmented';
import type { PsSelect } from './select';
import './select';
import type { PsSwitch } from './switch';
import './switch';

beforeAll(() => adoptTheme());
afterEach(() => document.body.replaceChildren());

async function mount<T extends HTMLElement & { updateComplete: Promise<unknown> }>(
  markup: string,
): Promise<T> {
  document.body.innerHTML = markup;
  const el = document.body.firstElementChild as T;
  await el.updateComplete;
  return el;
}

describe('ps-input', () => {
  it('keeps value in sync with typing and re-dispatches change from the host', async () => {
    const el = await mount<PsInput>('<ps-input label="Max legend items" value="13"></ps-input>');
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    const input = el.shadowRoot!.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('Max legend items');
    await userEvent.fill(input, '20');
    expect(el.value).toBe('20');
    input.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('draws one focus ring, on the field, not a second one on the inner input', async () => {
    const el = await mount<PsInput>('<ps-input label="Size"></ps-input>');
    const input = el.shadowRoot!.querySelector('input')!;
    const field = el.shadowRoot!.querySelector('.field')!;
    expect(getComputedStyle(field).boxShadow).toBe('none');
    await userEvent.click(input);
    expect(input.matches(':focus-visible')).toBe(true);
    expect(getComputedStyle(input).outlineStyle).toBe('none');
    expect(getComputedStyle(field).boxShadow).not.toBe('none');
  });

  it('ends text too long for the field in an ellipsis', async () => {
    const el = await mount<PsInput>('<ps-input label="Search"></ps-input>');
    expect(getComputedStyle(el.shadowRoot!.querySelector('input')!).textOverflow).toBe('ellipsis');
  });

  it('marks itself invalid for assistive technology', async () => {
    const el = await mount<PsInput>('<ps-input label="Size" invalid></ps-input>');
    expect(el.shadowRoot!.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('ps-input describedBy', () => {
  it('forwards describedBy to the native input', async () => {
    document.body.innerHTML =
      '<p id="hint">Clear the field to use the default.</p><ps-input label="Point size"></ps-input>';
    const el = document.querySelector('ps-input')!;
    const hint = document.getElementById('hint')!;
    el.describedBy = [hint];
    await el.updateComplete;
    const native = el.shadowRoot!.querySelector('input')!;
    expect(native.ariaDescribedByElements?.[0]).toBe(hint);
    el.describedBy = [];
    await el.updateComplete;
    expect(native.ariaDescribedByElements ?? []).toHaveLength(0);
  });
});

describe('ps-select', () => {
  it('renders a native select from options and reports the new value', async () => {
    const el = await mount<PsSelect>('<ps-select label="Palette"></ps-select>');
    el.options = [
      { value: 'kelly', label: 'Kelly' },
      { value: 'okabe', label: 'Okabe-Ito' },
    ];
    el.value = 'kelly';
    await el.updateComplete;
    const select = el.shadowRoot!.querySelector('select')!;
    expect(select.options.length).toBe(2);
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    await userEvent.selectOptions(select, 'okabe');
    expect(el.value).toBe('okabe');
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('shows the option that value names after the user picked another', async () => {
    const el = await mount<PsSelect>('<ps-select label="Palette"></ps-select>');
    el.options = [
      { value: 'kelly', label: 'Kelly' },
      { value: 'okabe', label: 'Okabe-Ito' },
    ];
    el.value = 'kelly';
    await el.updateComplete;
    const select = el.shadowRoot!.querySelector('select')!;
    await userEvent.selectOptions(select, 'okabe');
    el.value = 'kelly';
    await el.updateComplete;
    expect(select.value).toBe('kelly');
    el.value = 'okabe';
    await el.updateComplete;
    el.value = 'kelly';
    await el.updateComplete;
    el.value = 'okabe';
    await el.updateComplete;
    expect(select.value).toBe('okabe');
  });

  it('shows the old option when the owner rejects a pick', async () => {
    const el = await mount<PsSelect>('<ps-select label="Palette"></ps-select>');
    el.options = [
      { value: 'kelly', label: 'Kelly' },
      { value: 'okabe', label: 'Okabe-Ito' },
    ];
    el.value = 'kelly';
    await el.updateComplete;
    el.addEventListener('change', () => (el.value = 'kelly'));
    const select = el.shadowRoot!.querySelector('select')!;
    await userEvent.selectOptions(select, 'okabe');
    await el.updateComplete;
    expect(el.value).toBe('kelly');
    expect(select.value).toBe('kelly');
  });

  it('forwards describedBy to the native select', async () => {
    document.body.innerHTML =
      '<p id="note">Only positive values.</p><ps-select label="Bin distribution"></ps-select>';
    const el = document.querySelector('ps-select')!;
    const note = document.getElementById('note')!;
    el.describedBy = [note];
    await el.updateComplete;
    const native = el.shadowRoot!.querySelector('select')!;
    expect(native.ariaDescribedByElements?.[0]).toBe(note);
    el.describedBy = [];
    await el.updateComplete;
    expect(native.ariaDescribedByElements ?? []).toHaveLength(0);
  });
});

describe('ps-checkbox', () => {
  it('toggles on click and clears indeterminate', async () => {
    const el = await mount<PsCheckbox>('<ps-checkbox indeterminate>Show duplicates</ps-checkbox>');
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    await userEvent.click(el.shadowRoot!.querySelector('label')!);
    expect(el.checked).toBe(true);
    expect(el.indeterminate).toBe(false);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('stays mixed when the owner sets indeterminate again on change', async () => {
    const el = await mount<PsCheckbox>('<ps-checkbox indeterminate>Select all</ps-checkbox>');
    el.addEventListener('change', () => (el.indeterminate = true));
    await userEvent.click(el.shadowRoot!.querySelector('label')!);
    await el.updateComplete;
    expect(el.indeterminate).toBe(true);
    expect(el.shadowRoot!.querySelector('input')!.indeterminate).toBe(true);
  });

  it('takes an accessible name from label when it has no text', async () => {
    await mount<PsCheckbox>('<ps-checkbox label="Select all"></ps-checkbox>');
    await expect.element(page.getByRole('checkbox', { name: 'Select all' })).toBeInTheDocument();
  });

  it('draws the unchecked box with the control border colour', async () => {
    const el = await mount<PsCheckbox>('<ps-checkbox label="Select all"></ps-checkbox>');
    const box = el.shadowRoot!.querySelector('.box')!;
    // --ps-border-control, slate-500 in the light theme
    expect(getComputedStyle(box).borderTopColor).toBe('rgb(100, 116, 139)');
  });
});

describe('ps-switch', () => {
  it('is a switch that toggles with Space', async () => {
    const el = await mount<PsSwitch>('<ps-switch label="Contours"></ps-switch>');
    const button = el.shadowRoot!.querySelector('button')!;
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-checked')).toBe('false');
    button.focus();
    await userEvent.keyboard(' ');
    expect(el.checked).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('outlines the off track with the control border colour', async () => {
    const el = await mount<PsSwitch>('<ps-switch label="Contours"></ps-switch>');
    const button = el.shadowRoot!.querySelector('button')!;
    expect(getComputedStyle(button).boxShadow).toContain('rgb(100, 116, 139)');
  });

  it('takes its name from the slotted text, and a click on the text toggles it', async () => {
    const el = await mount<PsSwitch>('<ps-switch>Contours</ps-switch>');
    await expect
      .element(page.getByRole('switch', { name: 'Contours', checked: false }))
      .toBeInTheDocument();
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    await userEvent.click(page.getByText('Contours'));
    expect(el.checked).toBe(true);
    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe('ps-segmented', () => {
  it('is a radio group that moves with the arrow keys', async () => {
    const el = await mount<PsSegmented>('<ps-segmented label="Color by"></ps-segmented>');
    el.options = [
      { value: 'plddt', label: 'pLDDT' },
      { value: 'ted', label: 'TED domains' },
    ];
    el.value = 'plddt';
    await el.updateComplete;
    const radios = [...el.shadowRoot!.querySelectorAll('[role="radio"]')] as HTMLElement[];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    // The selected chip gets an accent ring (3:1 against the track; colour alone is not enough).
    expect(getComputedStyle(radios[0]).boxShadow).toContain('rgb(0, 122, 181)');
    expect(getComputedStyle(radios[1]).boxShadow).toBe('none');
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    radios[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(el.value).toBe('ted');
    expect(onChange.mock.calls[0][0].detail).toEqual({ value: 'ted' });
    expect(el.shadowRoot!.activeElement).toBe(radios[1]);
  });

  it('keeps one option reachable by Tab when no value is set', async () => {
    const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
    el.options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    await el.updateComplete;
    const tabbable = [...el.shadowRoot!.querySelectorAll('[role="radio"]')].filter(
      (r) => r.getAttribute('tabindex') === '0',
    );
    expect(tabbable.length).toBe(1);
  });

  /** Options a, b and c with b disabled and explained; a is checked. */
  async function withDisabled(): Promise<{ el: PsSegmented; radios: HTMLElement[] }> {
    const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
    el.options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true, tooltip: 'Available once B has loaded' },
      { value: 'c', label: 'C' },
    ];
    el.value = 'a';
    await el.updateComplete;
    const radios = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="radio"]')];
    return { el, radios };
  }

  it('a disabled option is aria-disabled, not natively disabled', async () => {
    const { radios } = await withDisabled();
    expect(radios.map((r) => r.getAttribute('aria-disabled'))).toEqual([null, 'true', null]);
    // Not native disabled: that would drop hover and clicks, and with them the tooltip.
    expect(radios[1].hasAttribute('disabled')).toBe(false);
    const style = getComputedStyle(radios[1]);
    // #94a3b8, the light --ps-text-faint (disabled text).
    expect(style.color).toBe('rgb(148, 163, 184)');
    expect(style.cursor).toBe('not-allowed');
  });

  it('clicking a disabled option changes nothing and dispatches no change', async () => {
    const { el, radios } = await withDisabled();
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    // A DOM click: Playwright's own click waits for an aria-disabled element to become enabled.
    radios[1].click();
    radios[1].focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await el.updateComplete;
    expect(el.value).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('clicking a disabled option shows its reason and still selects nothing', async () => {
    const { el, radios } = await withDisabled();
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    const tip = radios[1].nextElementSibling as HTMLElement;
    // A real click (forced: Playwright waits for an aria-disabled element to become enabled).
    await userEvent.click(radios[1], { force: true });
    await expect
      .poll(() => tip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
      .toBe(true);
    expect(el.value).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
    // A press elsewhere takes focus away, which hides it.
    radios[0].focus();
    await expect
      .poll(() => tip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
      .toBe(false);
  });

  it('a disabled option is faint in dark too, apart from the enabled ones', async () => {
    document.documentElement.dataset.theme = 'dark';
    try {
      const { radios } = await withDisabled();
      // #64748b, the dark --ps-text-faint; enabled options keep --ps-text-muted (#94a3b8).
      expect(getComputedStyle(radios[1]).color).toBe('rgb(100, 116, 139)');
      expect(getComputedStyle(radios[2]).color).toBe('rgb(148, 163, 184)');
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it('under forced colours a disabled option is GrayText, unlike an enabled one', async () => {
    const session = cdp();
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    try {
      expect(matchMedia('(forced-colors: active)').matches).toBe(true);
      const { radios } = await withDisabled();
      const probe = document.createElement('span');
      probe.style.color = 'GrayText';
      document.body.append(probe);
      expect(getComputedStyle(radios[1]).color).toBe(getComputedStyle(probe).color);
      expect(getComputedStyle(radios[1]).color).not.toBe(getComputedStyle(radios[2]).color);
    } finally {
      await session.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('arrow keys skip a disabled option', async () => {
    const { el, radios } = await withDisabled();
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    radios[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    await el.updateComplete;
    expect(el.value).toBe('c');
    expect(onChange.mock.calls.map(([event]) => event.detail)).toEqual([{ value: 'c' }]);
    expect(el.shadowRoot!.activeElement).toBe(radios[2]);
    await userEvent.keyboard('{ArrowLeft}');
    await el.updateComplete;
    expect(el.value).toBe('a');
    expect(el.shadowRoot!.activeElement).toBe(radios[0]);
  });

  it('with only the checked option enabled, an arrow changes nothing', async () => {
    const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
    el.options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
      { value: 'c', label: 'C', disabled: true },
    ];
    el.value = 'a';
    await el.updateComplete;
    const onChange = vi.fn();
    el.addEventListener('change', onChange);
    const first = el.shadowRoot!.querySelector<HTMLElement>('[role="radio"]')!;
    first.focus();
    const key = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    first.dispatchEvent(key);
    await el.updateComplete;
    // The key is still the group's: the page does not scroll.
    expect(key.defaultPrevented).toBe(true);
    expect(el.value).toBe('a');
    expect(onChange).not.toHaveBeenCalled();
    expect(el.shadowRoot!.activeElement).toBe(first);
  });

  it("an option's tooltip describes its button", async () => {
    const { radios } = await withDisabled();
    const tooltip = radios[1].nextElementSibling as HTMLElement & { text: string };
    expect(tooltip.localName).toBe('ps-tooltip');
    expect(tooltip.text).toBe('Available once B has loaded');
    // The tooltip binds to its anchor a microtask after it connects.
    await expect.poll(() => radios[1].ariaDescribedByElements?.includes(tooltip)).toBe(true);
    await userEvent.hover(radios[1]);
    await expect
      .poll(() => tooltip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
      .toBe(true);
    // Options without a reason get no tooltip.
    expect(radios[0].nextElementSibling).toBe(radios[1]);
  });

  it('a checked option that is disabled is the tab stop', async () => {
    const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
    const stops = () =>
      [...el.shadowRoot!.querySelectorAll('[role="radio"]')].map((r) => r.getAttribute('tabindex'));
    el.options = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B' },
    ];
    el.value = 'a';
    await el.updateComplete;
    expect(stops()).toEqual(['0', '-1']);
    // No value: the first enabled option.
    el.value = '';
    await el.updateComplete;
    expect(stops()).toEqual(['-1', '0']);
    // Nothing enabled: the first option, so the group stays reachable.
    el.options = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B', disabled: true },
    ];
    await el.updateComplete;
    expect(stops()).toEqual(['0', '-1']);
  });
});

describe('choice controls under a coarse pointer', () => {
  /** Runs `body` with touch emulation on, which switches `(pointer: coarse)`. */
  async function coarse(body: () => Promise<void>): Promise<void> {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      // Fail loudly if this Chromium does not flip the media feature.
      expect(matchMedia('(pointer: coarse)').matches).toBe(true);
      await body();
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  }

  it('segmented options are 34 px tall inside a 40 px group and at least 34 px wide', async () => {
    await coarse(async () => {
      const el = await mount<PsSegmented>('<ps-segmented label="Contours"></ps-segmented>');
      el.options = [
        { value: 'off', label: 'Off' },
        { value: 'auto', label: 'Auto' },
        // A disabled option with a reason keeps the same box; its tooltip adds none.
        { value: 'on', label: 'Always', disabled: true, tooltip: 'Needs a density layer' },
      ];
      el.value = 'off';
      await el.updateComplete;
      const group = el.shadowRoot!.querySelector('[role="radiogroup"]')!;
      expect(group.getBoundingClientRect().height).toBeCloseTo(40, 0);
      for (const radio of el.shadowRoot!.querySelectorAll('[role="radio"]')) {
        const box = radio.getBoundingClientRect();
        expect(box.height).toBeCloseTo(34, 0);
        expect(box.width).toBeGreaterThanOrEqual(34 - 0.5);
      }
    });
  });

  it('tapping a disabled option shows its reason and selects nothing', async () => {
    await coarse(async () => {
      const el = await mount<PsSegmented>('<ps-segmented label="Mode"></ps-segmented>');
      el.options = [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true, tooltip: 'Available once B has loaded' },
      ];
      el.value = 'a';
      await el.updateComplete;
      const radio = el.shadowRoot!.querySelectorAll<HTMLElement>('[role="radio"]')[1];
      const tip = radio.nextElementSibling as HTMLElement;
      await expect.poll(() => radio.ariaDescribedByElements?.includes(tip)).toBe(true);
      // A real touch tap: pointer events with pointerType "touch", then the click.
      const box = radio.getBoundingClientRect();
      const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const session = cdp();
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect
        .poll(() => tip.shadowRoot?.querySelector('.tip')?.matches(':popover-open'))
        .toBe(true);
      expect(el.value).toBe('a');
    });
  });

  it('a checkbox and a switch take a 40 px hit row', async () => {
    await coarse(async () => {
      for (const markup of [
        '<ps-checkbox label="Select all"></ps-checkbox>',
        '<ps-switch label="Contours"></ps-switch>',
      ]) {
        const el = await mount<PsCheckbox | PsSwitch>(markup);
        const label = el.shadowRoot!.querySelector('label')!;
        const box = label.getBoundingClientRect();
        expect(box.height).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.width).toBeGreaterThanOrEqual(40 - 0.5);
        // A press near the row's corner lands inside the label, which toggles the control.
        const hit = el.shadowRoot!.elementFromPoint(box.left + 2, box.bottom - 2);
        expect(hit !== null && label.contains(hit)).toBe(true);
      }
    });
  });
});
