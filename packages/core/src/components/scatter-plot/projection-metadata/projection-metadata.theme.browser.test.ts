import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Projection } from '@protspace/utils';
import { adoptTheme } from '../../kit/adopt-theme';
import './projection-metadata';

type ProjectionMetadataElement = HTMLElement & {
  projection: Projection | null;
  updateComplete: Promise<unknown>;
};

beforeAll(() => adoptTheme());
afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
});

/**
 * The card as the view bar holds it: in the page's light DOM, so its text inherits the page's
 * theme and its own background must follow too.
 */
async function mount(): Promise<ShadowRoot> {
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
  return el.shadowRoot!;
}

const styleOf = (root: ShadowRoot, selector: string) =>
  getComputedStyle(root.querySelector(selector)!);

describe('protspace-projection-metadata theme', () => {
  it('in dark the card is the raised surface and its text the dark text tokens', async () => {
    document.documentElement.dataset.theme = 'dark';
    const root = await mount();
    // #162036 --ps-surface-raised, #1e293b --ps-border, #131d33 --ps-surface-muted.
    expect(styleOf(root, '.content').backgroundColor).toBe('rgb(22, 32, 54)');
    expect(styleOf(root, '.content').borderTopColor).toBe('rgb(30, 41, 59)');
    expect(styleOf(root, '.header').backgroundColor).toBe('rgb(19, 29, 51)');
    // #f1f5f9 --ps-text, #94a3b8 --ps-text-muted.
    expect(styleOf(root, '.header').color).toBe('rgb(241, 245, 249)');
    expect(styleOf(root, 'dt').color).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, 'dd').color).toBe('rgb(148, 163, 184)');
    expect(styleOf(root, '.section-heading').color).toBe('rgb(148, 163, 184)');
    // The caption tier is the 11 px token, which also resolves in the light DOM.
    expect(styleOf(root, '.section-heading').fontSize).toBe('11px');
  });

  it('in light it keeps the light card', async () => {
    const root = await mount();
    expect(styleOf(root, '.content').backgroundColor).toBe('rgb(255, 255, 255)');
    expect(styleOf(root, '.header').backgroundColor).toBe('rgb(248, 250, 252)');
    expect(styleOf(root, '.header').color).toBe('rgb(15, 23, 42)');
    expect(styleOf(root, 'dt').color).toBe('rgb(71, 85, 105)');
  });
});
