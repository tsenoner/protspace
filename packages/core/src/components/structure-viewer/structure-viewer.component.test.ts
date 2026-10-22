/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructureService, type StructureData } from '@protspace/utils';
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

const STRUCTURE: StructureData = {
  proteinId: PROTEIN_ID,
  source: 'alphafold',
  url: 'blob:structure',
  format: 'mmcif',
  isBinary: false,
  tedDomains: [],
  metadata: { confidence: 'high', method: 'predicted', version: 'v6' },
};

describe('protspace-structure-viewer Mol* background', () => {
  // What --ps-surface resolves to on the viewer: jsdom resolves no token, so the test chooses it.
  let surface = '#ffffff';
  const setProps = vi.fn();
  const requestCameraReset = vi.fn();
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    surface = '#ffffff';
    setProps.mockReset();
    requestCameraReset.mockReset();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    vi.stubGlobal('getComputedStyle', (element: Element, pseudo?: string | null) => {
      const style = realGetComputedStyle(element, pseudo);
      const read = style.getPropertyValue.bind(style);
      style.getPropertyValue = (name: string) => (name === '--ps-surface' ? surface : read(name));
      return style;
    });
    // Mol*'s script and stylesheet count as loaded; window.molstar is a viewer with a canvas.
    for (const [tag, id] of [
      ['script', 'molstar-script'],
      ['link', 'molstar-style'],
    ] as const) {
      const element = document.createElement(tag);
      element.id = id;
      document.head.append(element);
    }
    window.molstar = {
      Viewer: {
        create: vi.fn(async () => ({
          loadStructureFromUrl: vi.fn(async () => undefined),
          dispose: vi.fn(),
          plugin: {
            representation: { structure: { themes: { colorThemeRegistry: { add: vi.fn() } } } },
            canvas3d: { setProps, requestCameraReset },
          },
        })),
      },
    } as unknown as typeof window.molstar;
    vi.spyOn(StructureService, 'loadStructure').mockResolvedValue({ ...STRUCTURE });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    delete (window as unknown as { molstar?: unknown }).molstar;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A viewer that has loaded a structure, its first background applied. */
  async function mountLoaded() {
    const viewer = document.createElement('protspace-structure-viewer');
    viewer.autoSync = false;
    viewer.proteinId = PROTEIN_ID;
    document.body.appendChild(viewer);
    await vi.waitFor(() => expect(setProps).toHaveBeenCalledOnce());
    return viewer;
  }

  it('the background is applied once the viewer is created', async () => {
    await mountLoaded();
    expect(setProps).toHaveBeenCalledWith({ renderer: { backgroundColor: 0xffffff } });
  });

  it('a double-click on the model resets the camera', async () => {
    const viewer = await mountLoaded();
    const mount = viewer.shadowRoot!.querySelector<HTMLElement>('.molstar-mount')!;
    // A press inside Mol*'s canvas bubbles up to its mount.
    const canvas = mount.appendChild(document.createElement('canvas'));
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(requestCameraReset).toHaveBeenCalledOnce();
  });

  it('the canvas stays hidden until its background is set', async () => {
    const mountOf = () =>
      document
        .querySelector('protspace-structure-viewer')!
        .shadowRoot!.querySelector<HTMLElement>('.molstar-mount')!;
    const seen: string[] = [];
    setProps.mockImplementation(() => seen.push(mountOf().style.visibility));
    await mountLoaded();
    // Mol* paints its own near-white background first; the mount hides that frame.
    expect(seen).toEqual(['hidden']);
    expect(mountOf().style.visibility).toBe('');
  });

  it('a theme notification with a new surface applies it once', async () => {
    await mountLoaded();
    surface = '#0f172a';
    document.documentElement.dataset.theme = 'dark';
    await vi.waitFor(() => expect(setProps).toHaveBeenCalledTimes(2));
    expect(setProps).toHaveBeenLastCalledWith({ renderer: { backgroundColor: 0x0f172a } });
    await tick();
    expect(setProps).toHaveBeenCalledTimes(2);
  });

  it('a notification with the same surface applies nothing', async () => {
    await mountLoaded();
    // An attribute change that leaves --ps-surface as it was (System on a light OS, say).
    document.documentElement.dataset.theme = 'system';
    await tick();
    expect(setProps).toHaveBeenCalledOnce();
  });

  it('disconnect stops listening', async () => {
    const viewer = await mountLoaded();
    viewer.remove();
    const apply = vi.spyOn(
      viewer as unknown as { _applyViewerBackground(): void },
      '_applyViewerBackground',
    );
    surface = '#0f172a';
    document.documentElement.dataset.theme = 'dark';
    await tick();
    expect(apply).not.toHaveBeenCalled();
  });
});
