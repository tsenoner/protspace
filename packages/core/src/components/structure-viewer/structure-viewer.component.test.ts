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
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
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

    const tedLink = Array.from(
      viewer.shadowRoot!.querySelectorAll<HTMLAnchorElement>('.header-link'),
    ).find((link) => link.textContent?.trim() === 'TED');

    expect({
      href: tedLink?.getAttribute('href'),
      rel: tedLink?.getAttribute('rel'),
      target: tedLink?.getAttribute('target'),
    }).toEqual({
      href: 'https://ted.cathdb.info/uniprot/W6JQJ9',
      rel: 'noopener noreferrer',
      target: '_blank',
    });
  });
});
