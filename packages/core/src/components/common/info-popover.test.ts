/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './info-popover';

type PopoverEl = HTMLElement & {
  description: string;
  docsUrl: string;
  label: string;
  align: 'left' | 'right';
  placement: 'bottom' | 'side';
  updateComplete: Promise<unknown>;
};

async function setup(props: Partial<PopoverEl> = {}): Promise<PopoverEl> {
  const el = document.createElement('protspace-info-popover') as PopoverEl;
  el.description = props.description ?? 'A brief summary.';
  if (props.docsUrl !== undefined) el.docsUrl = props.docsUrl;
  el.label = props.label ?? 'Test annotation';
  if (props.align) el.align = props.align;
  if (props.placement) el.placement = props.placement;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const button = (el: PopoverEl) =>
  el.shadowRoot!.querySelector('.info-button') as HTMLButtonElement | null;
const popover = (el: PopoverEl) => el.shadowRoot!.querySelector('.popover');

describe('protspace-info-popover', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('renders nothing without a description or docs URL', async () => {
    const el = await setup({ description: '', docsUrl: '' });
    expect(button(el)).toBeNull();
    expect(popover(el)).toBeNull();
  });

  it('opens on hover and closes after the pointer leaves (with grace)', async () => {
    vi.useFakeTimers();
    const el = await setup();
    expect(popover(el)).toBeNull();

    el.dispatchEvent(new Event('pointerenter'));
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    el.dispatchEvent(new Event('pointerleave'));
    await el.updateComplete;
    // still open during the grace window
    expect(popover(el)).not.toBeNull();

    vi.advanceTimersByTime(200);
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it('stays open when the pointer crosses from the icon into the popover', async () => {
    vi.useFakeTimers();
    const el = await setup();
    el.dispatchEvent(new Event('pointerenter'));
    await el.updateComplete;

    // leaving the icon starts the close timer, but re-entering (now over the popover) cancels it
    el.dispatchEvent(new Event('pointerleave'));
    el.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(200);
    await el.updateComplete;

    expect(popover(el)).not.toBeNull();
  });

  it('opens on keyboard focus and closes when focus leaves the component', async () => {
    const el = await setup();
    button(el)!.dispatchEvent(new FocusEvent('focus'));
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    el.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body, bubbles: true }));
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it('click pins it open so it survives the pointer leaving, and toggles closed', async () => {
    vi.useFakeTimers();
    const el = await setup();

    el.dispatchEvent(new Event('pointerenter'));
    button(el)!.click(); // pin
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(200);
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    button(el)!.click(); // unpin
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it('closes on Escape', async () => {
    const el = await setup();
    button(el)!.dispatchEvent(new FocusEvent('focus'));
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    popover(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it('side placement floats the popover beside the icon with an arrow', async () => {
    const el = await setup({ placement: 'side' });
    el.dispatchEvent(new Event('pointerenter'));
    await el.updateComplete;
    const pop = popover(el);
    expect(pop).not.toBeNull();
    expect(pop?.classList.contains('placement-side')).toBe(true);
    expect(el.shadowRoot!.querySelector('.popover-arrow')).not.toBeNull();
  });

  it('side placement stays open until the pointer leaves the whole row', async () => {
    vi.useFakeTimers();
    const row = document.createElement('div');
    document.body.appendChild(row);
    const el = document.createElement('protspace-info-popover') as PopoverEl;
    el.description = 'Brief summary.';
    el.placement = 'side';
    row.appendChild(el);
    await el.updateComplete; // firstUpdated attaches the row keep-open listener

    el.dispatchEvent(new Event('pointerenter')); // open via the icon
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    // Leaving just the icon must NOT close it — the keep-open region is the whole row.
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(300);
    await el.updateComplete;
    expect(popover(el)).not.toBeNull();

    // Leaving the row closes it after the grace period.
    row.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(300);
    await el.updateComplete;
    expect(popover(el)).toBeNull();
  });

  it('bottom placement (default) has no arrow', async () => {
    const el = await setup();
    el.dispatchEvent(new Event('pointerenter'));
    await el.updateComplete;
    expect(popover(el)?.classList.contains('placement-side')).toBe(false);
    expect(el.shadowRoot!.querySelector('.popover-arrow')).toBeNull();
  });

  it('renders the docs link with the provided URL', async () => {
    const el = await setup({ docsUrl: '/docs/guide/annotations#ec' });
    el.dispatchEvent(new Event('pointerenter'));
    await el.updateComplete;
    const link = el.shadowRoot!.querySelector('.popover-link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/docs/guide/annotations#ec');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
