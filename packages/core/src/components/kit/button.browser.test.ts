import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { adoptTheme } from './adopt-theme';
import type { PsButton, PsIconButton } from './button';
import './button';

beforeAll(() => adoptTheme());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function mount<T extends HTMLElement & { updateComplete: Promise<unknown> }>(
  markup: string,
): Promise<T> {
  document.body.innerHTML = markup;
  const el = document.body.firstElementChild as T;
  await el.updateComplete;
  return el;
}
const inner = (host: Element) => host.shadowRoot!.querySelector('button')!;
const tip = (host: Element) =>
  host.shadowRoot!.querySelector('ps-tooltip')!.shadowRoot!.querySelector('.tip')!;

describe('ps-button', () => {
  it('renders a native button that reports clicks', async () => {
    const el = await mount<PsButton>('<ps-button variant="primary">Export</ps-button>');
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    inner(el).click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(inner(el).type).toBe('button');
  });

  it('reports no clicks while disabled', async () => {
    const el = await mount<PsButton>('<ps-button disabled>Export</ps-button>');
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    inner(el).click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('takes the primary fill from the tokens', async () => {
    const el = await mount<PsButton>('<ps-button variant="primary">Export</ps-button>');
    expect(getComputedStyle(inner(el)).backgroundColor).toBe('rgb(0, 122, 181)');
  });
});

describe('ps-icon-button', () => {
  it('uses its label as the accessible name', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    expect(inner(el).getAttribute('aria-label')).toBe('Close');
    expect(inner(el).querySelector('svg')).not.toBeNull();
  });

  it('reports a toggle state through aria-pressed only when pressed is set', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="search" label="Search"></ps-icon-button>',
    );
    expect(inner(el).hasAttribute('aria-pressed')).toBe(false);
    el.pressed = true;
    await el.updateComplete;
    expect(inner(el).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows its label as a tooltip on keyboard focus and hides it on Escape', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    await userEvent.tab();
    expect(tip(el).matches(':popover-open')).toBe(true);
    expect(tip(el).textContent).toBe('Close');
    await userEvent.keyboard('{Escape}');
    expect(tip(el).matches(':popover-open')).toBe(false);
  });

  it('shows the tooltip after 500ms of hover and hides it when the pointer leaves', async () => {
    const el = await mount<PsIconButton>(
      '<ps-icon-button icon="x" label="Close"></ps-icon-button>',
    );
    vi.useFakeTimers();
    inner(el).dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(499);
    expect(tip(el).matches(':popover-open')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tip(el).matches(':popover-open')).toBe(true);
    inner(el).dispatchEvent(new PointerEvent('pointerleave'));
    expect(tip(el).matches(':popover-open')).toBe(false);
  });
});
