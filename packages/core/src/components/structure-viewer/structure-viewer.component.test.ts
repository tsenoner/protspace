/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESOURCE_LINKS } from './header-links';
import './structure-viewer';

const PROTEIN_ID = 'W6JQJ9.2';

async function mount(): Promise<ShadowRoot> {
  // Typed as ProtspaceStructureViewer through its HTMLElementTagNameMap entry.
  const viewer = document.createElement('protspace-structure-viewer');
  viewer.autoSync = false;
  viewer.proteinId = PROTEIN_ID;
  document.body.appendChild(viewer);
  await viewer.updateComplete;
  return viewer.shadowRoot!;
}

describe('protspace-structure-viewer resource links', () => {
  beforeEach(() => {
    // The component defers _loadStructure() (a network fetch) to a rAF
    // callback; swallowing the callback keeps the render assertion offline.
    vi.stubGlobal('requestAnimationFrame', () => 1);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('renders every resource link, in order, as a safe new-tab link', async () => {
    const root = await mount();
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.header-link'));

    // Assert the whole row, in order: a `.find()` on one label alone would
    // still pass if its peers had disappeared. The URLs themselves are pinned
    // in header-links.test.ts.
    expect(
      links.map((link) => [
        link.querySelector('.header-link-label')?.textContent?.trim(),
        link.getAttribute('href'),
      ]),
    ).toEqual(RESOURCE_LINKS.map((resource) => [resource.label, resource.build(PROTEIN_ID)]));

    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      // The separator is drawn on the list item; a link must not contain it.
      expect(link.parentElement?.matches('ul[role="list"] > li.header-links-item')).toBe(true);
    }
  });

  it('renders the title as plain text, not a hidden AlphaFold link', async () => {
    const root = await mount();
    expect(root.querySelector('.title')?.tagName).toBe('SPAN');
  });
});
