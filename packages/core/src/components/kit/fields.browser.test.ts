import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
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
});
