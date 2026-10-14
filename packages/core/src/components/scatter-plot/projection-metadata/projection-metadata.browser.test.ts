import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import type { Projection } from '@protspace/utils';
import { topLayer } from '../../kit/layers';
import './projection-metadata';

type ProjectionMetadataElement = HTMLElement & {
  projection: Projection | null;
  updateComplete: Promise<unknown>;
};

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function escape(): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('protspace-projection-metadata with an open info popover', () => {
  it('Escape closes the ⓘ bubble first, then the pinned card', async () => {
    const el = document.createElement('protspace-projection-metadata') as ProjectionMetadataElement;
    el.projection = {
      name: 'ProtT5 — UMAP 2',
      metadata: {
        n_components: 2,
        quality: {
          knn_overlap: { value: 0.57, scope: 'local', k: 15, seed: 42, sampled: false },
        },
      },
    } as Projection;
    document.body.append(el);
    await el.updateComplete;

    const card = () => el.shadowRoot!.querySelector('.content')!;
    (el.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(card().classList.contains('is-pinned')).toBe(true);

    const info = card().querySelector('protspace-info-popover') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    (info.shadowRoot!.querySelector('.info-button') as HTMLButtonElement).click();
    await info.updateComplete;
    await frame();
    const panel = info
      .shadowRoot!.querySelector('ps-popover')!
      .shadowRoot!.querySelector('.panel')!;
    expect(panel.matches(':popover-open')).toBe(true);

    escape();
    await info.updateComplete;
    await el.updateComplete;
    expect(panel.matches(':popover-open'), 'the first Escape closes the bubble').toBe(false);
    expect(card().classList.contains('is-pinned'), 'and leaves the card pinned').toBe(true);

    escape();
    await el.updateComplete;
    expect(card().classList.contains('is-pinned'), 'the second Escape closes the card').toBe(false);
    expect(topLayer()).toBeUndefined();
  });
});

/** A projection with enough parameters for a card taller than a phone's plot. */
function tallProjection(): Projection {
  const metadata: Record<string, unknown> = { n_components: 2 };
  for (let i = 0; i < 40; i++) metadata[`parameter_${i}`] = i;
  return { name: 'ProtT5 — UMAP 2', metadata } as Projection;
}

async function mountAt(style: string): Promise<ProjectionMetadataElement> {
  const el = document.createElement('protspace-projection-metadata') as ProjectionMetadataElement;
  el.projection = tallProjection();
  el.style.cssText = style;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('protspace-projection-metadata on a phone', () => {
  it('the card stays inside a 390 × 420 screen beside the right edge and scrolls', async () => {
    await page.viewport(390, 420);
    try {
      // The details button sits far right on a phone's view bar.
      const el = await mountAt('position: fixed; left: 300px; top: 60px');
      (el.shadowRoot!.querySelector('.trigger') as HTMLButtonElement).click();
      await el.updateComplete;
      await frame();
      const card = el.shadowRoot!.querySelector('.content') as HTMLElement;
      const box = card.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.right).toBeLessThanOrEqual(390 - 8 + 0.5);
      expect(box.bottom).toBeLessThanOrEqual(420 - 8 + 0.5);
      expect(card.scrollHeight).toBeGreaterThan(card.clientHeight);
    } finally {
      await page.viewport(414, 896);
    }
  });

  it('under touch a hover reveals nothing and a second tap closes the card', async () => {
    const session = cdp();
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      expect(matchMedia('(hover: none)').matches).toBe(true);
      const el = await mountAt('position: fixed; left: 40px; top: 40px');
      const trigger = el.shadowRoot!.querySelector('.trigger') as HTMLButtonElement;
      const card = el.shadowRoot!.querySelector('.content') as HTMLElement;
      // A tap leaves the pointer "over" the button: :hover must not hold the card open.
      await userEvent.hover(trigger);
      // Past the card's 0.2 s fade: a transition starting now would still read hidden.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(getComputedStyle(card).visibility).toBe('hidden');
      trigger.click();
      await el.updateComplete;
      await expect.poll(() => getComputedStyle(card).visibility).toBe('visible');
      trigger.click();
      await el.updateComplete;
      await expect.poll(() => getComputedStyle(card).visibility).toBe('hidden');
    } finally {
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
