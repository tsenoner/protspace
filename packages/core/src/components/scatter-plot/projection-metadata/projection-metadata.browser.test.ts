import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import type { Projection, ProjectionStatisticRow } from '@protspace/utils';
import { adoptTheme } from '../../kit/adopt-theme';
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

  it('reopened after the bar moved it, the card measures again and stays inside', async () => {
    await page.viewport(390, 420);
    try {
      const el = await mountAt('position: fixed; left: 300px; top: 60px');
      const trigger = el.shadowRoot!.querySelector('.trigger') as HTMLButtonElement;
      const card = el.shadowRoot!.querySelector('.content') as HTMLElement;
      trigger.click();
      await el.updateComplete;
      trigger.click();
      await el.updateComplete;
      // A view-bar re-flow moves the host with no property change on the card.
      el.style.left = '340px';
      trigger.click();
      await el.updateComplete;
      await frame();
      expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(390 - 8 + 0.5);
    } finally {
      await page.viewport(414, 896);
    }
  });

  it('closed, the card does not reach past a 740 px landscape screen', async () => {
    await page.viewport(740, 360);
    try {
      // The details button sits at about x = 507 on a phone on its side; the closed card is laid
      // out (only hidden), so past the right edge it would widen the page.
      const el = await mountAt('position: fixed; left: 507px; top: 8px');
      const card = el.shadowRoot!.querySelector('.content') as HTMLElement;
      expect(getComputedStyle(card).visibility).toBe('hidden');
      expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(740 - 8 + 0.5);
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

type ScoredCard = ProjectionMetadataElement & {
  statisticsRows?: readonly ProjectionStatisticRow[];
  selectedAnnotation: string;
};

describe('protspace-projection-metadata type', () => {
  beforeAll(() => adoptTheme());

  /** A card with parameters and a scored annotation, so every row type renders. */
  async function mountScored(): Promise<ShadowRoot> {
    const el = document.createElement('protspace-projection-metadata') as ScoredCard;
    el.projection = { name: 'ProtT5 — UMAP 2', metadata: { n_components: 2 } } as Projection;
    el.statisticsRows = [
      {
        space_kind: 'projection',
        space_name: 'ProtT5 — UMAP 2',
        annotation: 'major_group',
        stat_family: 'annotation_validity',
        label_kind: 'annotation',
        metric: 'silhouette',
        metric_kind: 'validity',
        value: 0.326,
      } as ProjectionStatisticRow,
    ];
    el.selectedAnnotation = 'major_group';
    document.body.append(el);
    await el.updateComplete;
    return el.shadowRoot!;
  }

  it("the card's header is 13 px and its rows 12 px", async () => {
    const root = await mountScored();
    const fontSize = (selector: string) => getComputedStyle(root.querySelector(selector)!).fontSize;
    expect(fontSize('.header')).toBe('13px');
    expect(fontSize('.item')).toBe('12px');
    expect(fontSize('.annotation-stats')).toBe('12px');
  });

  it('the screen-reader text stays visually hidden', async () => {
    const root = await mountScored();
    const hidden = root.querySelector<HTMLElement>('.annotation-stats .sr-only')!;
    expect(hidden.textContent).toContain('is better');
    const box = hidden.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    const style = getComputedStyle(hidden);
    expect(style.position).toBe('absolute');
    expect(style.overflow).toBe('hidden');
    expect(style.clip).toBe('rect(0px, 0px, 0px, 0px)');
  });
});
