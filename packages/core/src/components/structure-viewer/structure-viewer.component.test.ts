/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESOURCE_LINKS } from '../common/resource-links';
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
    // in resource-links.test.ts.
    expect(
      links.map((link) => [
        link.querySelector('.header-link-label')?.textContent?.trim(),
        link.getAttribute('href'),
      ]),
    ).toEqual(RESOURCE_LINKS.map((resource) => [resource.label, resource.build(PROTEIN_ID)]));

    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      // The new tab is announced by a hidden hint, not a native title tooltip.
      expect(link.hasAttribute('title')).toBe(false);
      expect(link.querySelector('.resource-links-hint')?.textContent).toBe(' (opens in a new tab)');
      // The links have their own row below the header, so a narrow panel wraps them.
      expect(link.parentElement?.matches('ul[part="links"] > li.resource-links-item')).toBe(true);
      expect(link.closest('.header')).toBeNull();
    }
  });

  it('renders the title as plain text, not a hidden AlphaFold link', async () => {
    const root = await mount();
    expect(root.querySelector('.title')?.tagName).toBe('SPAN');
  });

  it('the close button is named Close structure', async () => {
    const root = await mount();
    const button = root.querySelector<HTMLButtonElement>('button.close-button')!;
    expect(button.getAttribute('aria-label')).toBe('Close structure');
    expect(button.getAttribute('type')).toBe('button');
    // A Lucide icon, not the old text glyph.
    expect(button.querySelector('svg.ps-icon')).not.toBeNull();
    expect(button.textContent?.trim()).toBe('');
  });

  it('the body part wraps the viewer and the colour toolbar, and nothing of the header', async () => {
    const root = await mount();
    const body = root.querySelector<HTMLElement>('[part="body"]')!;
    expect(body).not.toBeNull();
    expect(body.querySelector('.viewer-container .viewer-content')).not.toBeNull();
    expect(body.querySelector('.color-toolbar')).not.toBeNull();
    // mount() keeps showTips at its default, true.
    expect(body.querySelector('.tips')).not.toBeNull();
    expect(body.contains(root.querySelector('[part="header"]'))).toBe(false);
    expect(body.contains(root.querySelector('[part="links"]'))).toBe(false);
  });

  it('with one choice the protein id is plain text', async () => {
    const root = await mount();
    const viewer = root.host as HTMLElement & {
      proteinChoices: readonly string[];
      updateComplete: Promise<unknown>;
    };
    viewer.proteinChoices = [PROTEIN_ID];
    await viewer.updateComplete;
    const id = root.querySelector('.protein-id')!;
    expect(id.tagName).toBe('SPAN');
    expect(id.textContent).toBe(PROTEIN_ID);
    expect(root.querySelector('ps-menu')).toBeNull();
  });
});

describe('protspace-structure-viewer protein-click', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('opens on a click whose detail has no modifierKeys, as on an unmodified click', async () => {
    const viewer = document.createElement('protspace-structure-viewer') as HTMLElement & {
      autoSync: boolean;
      proteinId: string | null;
      updateComplete: Promise<unknown>;
      _handleProteinClick(event: Event): void;
    };
    viewer.autoSync = false;
    document.body.appendChild(viewer);
    await viewer.updateComplete;

    viewer._handleProteinClick(
      new CustomEvent('protein-click', { detail: { proteinId: PROTEIN_ID } }),
    );

    expect(viewer.proteinId).toBe(PROTEIN_ID);
    expect(viewer.style.display).toBe('flex');
  });
});
