/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './structure-viewer';

type StructureViewerElement = HTMLElement & {
  autoSync: boolean;
  proteinId: string | null;
  updateComplete: Promise<unknown>;
};

describe('protspace-structure-viewer resource links', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // The component defers _loadStructure() (a network fetch) to a rAF
    // callback; swallowing the callback keeps the render assertion offline.
    vi.stubGlobal('requestAnimationFrame', () => 1);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('renders TED beside the existing protein resources', async () => {
    const viewer = document.createElement('protspace-structure-viewer') as StructureViewerElement;
    viewer.autoSync = false;
    viewer.proteinId = 'W6JQJ9.2';
    document.body.appendChild(viewer);
    await viewer.updateComplete;

    const links = Array.from(
      viewer.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.header-link'),
    );

    // Assert the whole row, in order: a `.find()` on the TED label alone would
    // still pass if its peers had disappeared.
    expect(
      links.map((link) => ({
        label: link.querySelector('.header-link-label')?.textContent?.trim(),
        href: link.getAttribute('href'),
        rel: link.getAttribute('rel'),
        target: link.getAttribute('target'),
      })),
    ).toEqual([
      {
        label: 'AlphaFold',
        href: 'https://alphafold.ebi.ac.uk/entry/W6JQJ9',
        rel: 'noopener noreferrer',
        target: '_blank',
      },
      {
        label: 'UniProt',
        href: 'https://www.uniprot.org/uniprotkb/W6JQJ9/entry',
        rel: 'noopener noreferrer',
        target: '_blank',
      },
      {
        label: 'InterPro',
        href: 'https://www.ebi.ac.uk/interpro/protein/UniProt/W6JQJ9/',
        rel: 'noopener noreferrer',
        target: '_blank',
      },
      {
        label: 'TED',
        href: 'https://ted.cathdb.info/uniprot/W6JQJ9',
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    ]);
  });

  it('renders the title as plain text, not a hidden AlphaFold link', async () => {
    const viewer = document.createElement('protspace-structure-viewer') as StructureViewerElement;
    viewer.autoSync = false;
    viewer.proteinId = 'W6JQJ9.2';
    document.body.appendChild(viewer);
    await viewer.updateComplete;

    const title = viewer.shadowRoot!.querySelector('.title');
    expect(title?.tagName).toBe('SPAN');
    expect(viewer.shadowRoot!.querySelector('a.title')).toBeNull();
  });
});
