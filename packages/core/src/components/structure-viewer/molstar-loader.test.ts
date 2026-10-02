/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TedDomain } from '@protspace/utils';
import { createMolstarViewer } from './molstar-loader';
import { getTedDomainColor } from './ted-domain-coloring';

const domains: TedDomain[] = [
  {
    domainNumber: 1,
    segments: [
      { start: 33, end: 42 },
      { start: 54, end: 76 },
    ],
  },
  { domainNumber: 2, segments: [{ start: 100, end: 120 }] },
];

describe('TED domain color mapping', () => {
  it('uses one deterministic color across all segments of a domain', () => {
    expect(getTedDomainColor(35, domains)).toBe(getTedDomainColor(60, domains));
    expect(getTedDomainColor(35, domains)).not.toBe(getTedDomainColor(105, domains));
    expect(getTedDomainColor(50, domains)).toBe(0xebebeb);
  });
});

describe('Mol* color theme adapter', () => {
  beforeEach(() => {
    const script = document.createElement('script');
    script.id = 'molstar-script';
    document.head.appendChild(script);
    const style = document.createElement('link');
    style.id = 'molstar-style';
    document.head.appendChild(style);
  });

  afterEach(() => {
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  type ThemeUpdate = { color: string; colorParams?: unknown };
  type FakeRepresentation = {
    cell: {
      transform: { ref: string; params: { colorTheme: { name: string; params?: unknown } } };
    };
  };
  type FakeComponent = { representations: FakeRepresentation[] };

  function representation(ref: string, theme: string, params?: unknown): FakeRepresentation {
    return { cell: { transform: { ref, params: { colorTheme: { name: theme, params } } } } };
  }

  /** Writes the requested theme into each representation, as a committed Mol* update does. */
  async function applyThemeUpdate(
    components: FakeComponent[],
    params: ThemeUpdate | ((c: FakeComponent, r: FakeRepresentation) => ThemeUpdate),
  ) {
    for (const component of components) {
      for (const repr of component.representations) {
        const { color, colorParams } =
          typeof params === 'function' ? params(component, repr) : params;
        repr.cell.transform.params.colorTheme = { name: color, params: colorParams };
      }
    }
  }

  function installRawViewer(
    updateTheme: (...args: never[]) => Promise<unknown>,
    structures: { components: FakeComponent[] }[] = [
      { components: [{ representations: [representation('cartoon', 'plddt-confidence')] }] },
    ],
  ) {
    const addTheme = vi.fn<(provider: unknown) => void>();
    const rawViewer = {
      loadStructureFromUrl: vi.fn(async () => undefined),
      dispose: vi.fn(),
      plugin: {
        dataTransaction: vi.fn(async (edits: () => Promise<void>) => edits()),
        representation: {
          structure: { themes: { colorThemeRegistry: { add: addTheme } } },
        },
        managers: {
          structure: {
            hierarchy: { current: { structures } },
            component: { updateRepresentationsTheme: updateTheme },
          },
        },
      },
    };
    window.molstar = {
      Viewer: { create: vi.fn(async () => rawViewer) },
    } as unknown as typeof window.molstar;
    return { addTheme, rawViewer, components: structures.flatMap((s) => s.components) };
  }

  it('registers TED coloring and switches loaded representations without reloading', async () => {
    const updateTheme = vi.fn(applyThemeUpdate);
    const { addTheme, components, rawViewer } = installRawViewer(updateTheme);
    const viewer = await createMolstarViewer(document.createElement('div'));

    expect(addTheme).toHaveBeenCalledOnce();

    await viewer.setColorTheme('ted-domains', domains);
    expect(updateTheme).toHaveBeenLastCalledWith(components, { color: 'protspace-ted-domain' });
    expect(rawViewer.plugin.dataTransaction).toHaveBeenCalledOnce();
    expect(rawViewer.loadStructureFromUrl).not.toHaveBeenCalled();

    const provider = addTheme.mock.calls[0]?.[0] as
      | {
          factory: (
            context: unknown,
            props: Record<string, never>,
          ) => { color: (location: unknown) => number };
        }
      | undefined;
    expect(provider).toBeDefined();
    const theme = provider!.factory({}, {});
    const atomicUnit = {
      kind: 0,
      elements: [7],
      model: {
        atomicHierarchy: {
          residueAtomSegments: { index: { 7: 3 } },
          residues: { label_seq_id: { value: (index: number) => (index === 3 ? 35 : 200) } },
        },
      },
    };
    expect(theme.color({ kind: 'element-location', unit: atomicUnit, element: 7 })).toBe(0x4e79a7);
    expect(theme.color({ kind: 'bond-location', aUnit: atomicUnit, aIndex: 0 })).toBe(0x4e79a7);
    expect(
      theme.color({ kind: 'element-location', unit: { ...atomicUnit, kind: 1 }, element: 7 }),
    ).toBe(0xebebeb);
  });

  it("restores each representation's preset theme when leaving TED", async () => {
    // An mmCIF model keeps its pLDDT params; a model without confidence data was chain-id colored
    const plddtCartoon = representation('cartoon', 'plddt-confidence', { scale: 'af' });
    const chainIdCartoon = representation('pdb-cartoon', 'chain-id');
    installRawViewer(vi.fn(applyThemeUpdate), [
      { components: [{ representations: [plddtCartoon] }] },
      { components: [{ representations: [chainIdCartoon] }] },
    ]);
    const viewer = await createMolstarViewer(document.createElement('div'));

    await viewer.setColorTheme('ted-domains', domains);
    expect(plddtCartoon.cell.transform.params.colorTheme.name).toBe('protspace-ted-domain');
    expect(chainIdCartoon.cell.transform.params.colorTheme.name).toBe('protspace-ted-domain');

    await viewer.setColorTheme('plddt', domains);
    expect(plddtCartoon.cell.transform.params.colorTheme).toEqual({
      name: 'plddt-confidence',
      params: { scale: 'af' },
    });
    expect(chainIdCartoon.cell.transform.params.colorTheme.name).toBe('chain-id');
  });

  it('updates every structure in one theme update', async () => {
    const updateTheme = vi.fn(applyThemeUpdate);
    const { components } = installRawViewer(updateTheme, [
      { components: [{ representations: [representation('a', 'plddt-confidence')] }] },
      { components: [{ representations: [representation('b', 'plddt-confidence')] }] },
    ]);
    const viewer = await createMolstarViewer(document.createElement('div'));

    await viewer.setColorTheme('ted-domains', domains);

    expect(updateTheme).toHaveBeenCalledOnce();
    expect(updateTheme.mock.calls[0]?.[0]).toEqual(components);
  });

  it('rejects when Mol* reverts the theme update', async () => {
    // A failed transform inside a transaction is reverted silently: the theme stays unchanged
    installRawViewer(vi.fn(async () => undefined));
    const viewer = await createMolstarViewer(document.createElement('div'));

    await expect(viewer.setColorTheme('ted-domains', domains)).rejects.toThrow(
      'did not apply the ted-domains color theme',
    );
  });

  it('applies overlapping theme requests in order', async () => {
    let finishTedUpdate!: () => void;
    const updateTheme = vi.fn(
      (components: FakeComponent[], params: ThemeUpdate | (() => ThemeUpdate)) =>
        new Promise<void>((resolve) => {
          void applyThemeUpdate(components, params);
          if (typeof params === 'function') resolve();
          else finishTedUpdate = resolve;
        }),
    );
    installRawViewer(updateTheme);
    const viewer = await createMolstarViewer(document.createElement('div'));

    const tedChange = viewer.setColorTheme('ted-domains', domains);
    const plddtChange = viewer.setColorTheme('plddt');
    await Promise.resolve();
    await Promise.resolve();
    expect(updateTheme).toHaveBeenCalledOnce();

    finishTedUpdate();
    await Promise.all([tedChange, plddtChange]);
    expect(updateTheme).toHaveBeenCalledTimes(2);
    expect(updateTheme.mock.calls[0]?.[1]).toEqual({ color: 'protspace-ted-domain' });
    expect(updateTheme.mock.calls[1]?.[1]).toBeTypeOf('function');
  });
});
