import { afterEach, describe, expect, it } from 'vitest';
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
