/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import './info-popover';

// jsdom has no showPopover, so every case that opens the bubble lives in
// info-popover.browser.test.ts. These cover the closed trigger.

type PopoverEl = HTMLElement & {
  description: string;
  detail: string;
  docsUrl: string;
  label: string;
  updateComplete: Promise<unknown>;
};

async function setup(props: Partial<PopoverEl> = {}): Promise<PopoverEl> {
  const el = document.createElement('protspace-info-popover') as PopoverEl;
  el.description = props.description ?? 'A brief summary.';
  if (props.detail !== undefined) el.detail = props.detail;
  if (props.docsUrl !== undefined) el.docsUrl = props.docsUrl;
  el.label = props.label ?? 'Test annotation';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const button = (el: PopoverEl) =>
  el.shadowRoot!.querySelector('.info-button') as HTMLButtonElement | null;

describe('protspace-info-popover (closed)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing without a description or docs URL', async () => {
    const el = await setup({ description: '', docsUrl: '' });
    expect(button(el)).toBeNull();
    expect(el.shadowRoot!.querySelector('ps-popover')).toBeNull();
  });

  it('has no native title tooltip to collide with its own popover', async () => {
    // A `title` repeating the aria-label rendered a second, browser-styled tooltip on top of
    // the bubble that already explains the icon.
    const el = await setup({ label: 'kNN Overlap' });
    expect(button(el)!.hasAttribute('title')).toBe(false);
    expect(button(el)!.getAttribute('aria-label')).toBe('Information about kNN Overlap');
  });

  it('a closed trigger is collapsed and points at nothing', async () => {
    const el = await setup({ detail: 'A second paragraph.' });
    expect(button(el)!.getAttribute('aria-expanded')).toBe('false');
    expect(button(el)!.hasAttribute('aria-controls')).toBe(false);
    expect(button(el)!.hasAttribute('aria-describedby')).toBe(false);
    // The bubble's contents render only while it is open.
    expect(el.shadowRoot!.querySelector('.popover')).toBeNull();
    const host = el.shadowRoot!.querySelector('ps-popover')!;
    expect(host.getAttribute('panel-role')).toBe('dialog');
    expect(host.getAttribute('panel-label')).toBe('Test annotation information');
  });

  it('renders a trigger for a detail-only popover', async () => {
    const el = await setup({ description: '', detail: 'Only a detail.' });
    expect(button(el)).not.toBeNull();
  });
});
