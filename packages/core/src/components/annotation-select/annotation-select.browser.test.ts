import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { adoptTheme } from '../kit/adopt-theme';
import type { ProtspaceAnnotationSelect } from './annotation-select';
import './annotation-select';

beforeAll(async () => {
  adoptTheme();
  // A desktop width: the ⓘ bubble opens beside the row, and the default frame is phone-narrow.
  await page.viewport(1280, 720);
});
afterEach(() => document.body.replaceChildren());

/** The picker inside a box that clips and transforms, as the view bar's narrow stages can. */
async function openInClippingBox(): Promise<ProtspaceAnnotationSelect> {
  document.body.innerHTML = `
    <div class="clip" style="overflow: hidden; transform: translateX(0); width: 220px; height: 40px">
      <protspace-annotation-select></protspace-annotation-select>
    </div>`;
  const el = document.querySelector('protspace-annotation-select')!;
  el.annotations = ['ec', 'pfam', 'gene_name'];
  el.selectedAnnotation = 'pfam';
  el.eatAnnotations = ['ec'];
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLButtonElement>('.dropdown-trigger')!.click();
  await el.updateComplete;
  const popover = el.shadowRoot!.querySelector('ps-popover')!;
  await vi.waitFor(() =>
    expect(popover.shadowRoot!.querySelector('.panel')!.matches(':popover-open')).toBe(true),
  );
  return el;
}

describe('protspace-annotation-select panel', () => {
  it('opens scrolled to the current annotation at once, not by a smooth scroll', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    try {
      const el = await openInClippingBox();
      await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
      const [row] = scroll.mock.contexts as Element[];
      expect(row.getAttribute('data-annotation')).toBe('pfam');
      expect(scroll.mock.calls[0][0]).not.toMatchObject({ behavior: 'smooth' });
      expect(el.shadowRoot!.contains(row)).toBe(true);
    } finally {
      scroll.mockRestore();
    }
  });

  it('the panel is topmost and an ⓘ bubble inside it is not clipped', async () => {
    const el = await openInClippingBox();
    const row = el.shadowRoot!.querySelector<HTMLElement>('.dropdown-item[data-annotation="ec"]')!;
    const box = row.getBoundingClientRect();
    const clip = document.querySelector('.clip')!.getBoundingClientRect();
    // Below the clipping box, and still the element a press there reaches.
    expect(box.top).toBeGreaterThanOrEqual(clip.bottom);
    const hit = el.shadowRoot!.elementFromPoint(box.left + 12, box.top + box.height / 2);
    expect(hit?.closest('.dropdown-item')).toBe(row);

    const info = row.querySelector('protspace-info-popover')!;
    info.shadowRoot!.querySelector<HTMLElement>('.info-button')!.click();
    const bubble = info.shadowRoot!.querySelector('ps-popover')!;
    const panel = () => bubble.shadowRoot!.querySelector('.panel') as HTMLElement;
    await vi.waitFor(() => expect(panel().matches(':popover-open')).toBe(true));
    const rect = panel().getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    const inside = info.shadowRoot!.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    expect(inside?.closest('ps-popover')).toBe(bubble);
  });

  it('options hold no interactive content; the extras sit beside them', async () => {
    const el = await openInClippingBox();
    const root = el.shadowRoot!;
    const listbox = root.querySelector('[role="listbox"]')!;
    const options = Array.from(listbox.querySelectorAll('[role="option"]'));
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(
        option.querySelector(
          'button, a[href], input, select, textarea, [tabindex], protspace-info-popover',
        ),
      ).toBeNull();
      expect(option.parentElement!.getAttribute('role')).toBe('none');
    }
    for (const toggle of root.querySelectorAll('.tooltip-toggle-btn')) {
      expect(toggle.getAttribute('tabindex')).toBe('-1');
      expect(toggle.closest('[role="option"]')).toBeNull();
    }
    expect(listbox.querySelectorAll('[role="group"]').length).toBeGreaterThan(0);
    // The EAT badge's meaning is the option's description, not a native tooltip.
    const ec = root.querySelector('.dropdown-item[data-annotation="ec"] [role="option"]')!;
    expect(root.getElementById(ec.getAttribute('aria-describedby')!)!.textContent).toContain(
      'EAT predictions available',
    );
    expect(root.querySelector('.eat-badge')!.hasAttribute('title')).toBe(false);
  });

  it('Tab from the search closes the list onto the trigger, opening no ⓘ bubble', async () => {
    const el = await openInClippingBox();
    const root = el.shadowRoot!;
    await vi.waitFor(() => expect(root.activeElement?.id).toBe('annotation-search-input'));

    await userEvent.keyboard('{Tab}');
    await el.updateComplete;

    const trigger = root.querySelector('.dropdown-trigger')!;
    await vi.waitFor(() => expect(root.activeElement).toBe(trigger));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('protspace-info-popover')).toBeNull();
  });

  it('under a coarse pointer the hover-tooltip eye is a 40 px target', async () => {
    const el = await openInClippingBox();
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      const toggles = el.shadowRoot!.querySelectorAll('.tooltip-toggle-btn');
      expect(toggles.length).toBeGreaterThan(0);
      for (const toggle of toggles) {
        const box = toggle.getBoundingClientRect();
        expect(box.width).toBeGreaterThanOrEqual(40 - 0.5);
        expect(box.height).toBeGreaterThanOrEqual(40 - 0.5);
      }
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
