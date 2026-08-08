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
    expect(getTedDomainColor(50, domains)).toBe(0x9ca3af);
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

  it('registers TED coloring and switches loaded representations without reloading', async () => {
    const addTheme = vi.fn<(provider: unknown) => void>();
    const updateTheme = vi.fn(async () => undefined);
    const components = [{ id: 'polymer' }];
    const rawViewer = {
      loadStructureFromUrl: vi.fn(async () => undefined),
      dispose: vi.fn(),
      plugin: {
        representation: {
          structure: { themes: { colorThemeRegistry: { add: addTheme } } },
        },
        managers: {
          structure: {
            hierarchy: { current: { structures: [{ components }] } },
            component: { updateRepresentationsTheme: updateTheme },
          },
        },
      },
    };
    window.molstar = {
      Viewer: { create: vi.fn(async () => rawViewer) },
    } as unknown as typeof window.molstar;

    const viewer = await createMolstarViewer(document.createElement('div'));

    expect(addTheme).toHaveBeenCalledOnce();
    expect(viewer.setColorTheme).toBeTypeOf('function');

    await viewer.setColorTheme('ted-domains', domains);
    expect(updateTheme).toHaveBeenLastCalledWith(components, { color: 'protspace-ted-domain' });
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
    expect(theme.color({ kind: 'element-location', unit: atomicUnit, element: 7 })).toBe(0x0072b2);
    expect(theme.color({ kind: 'bond-location', aUnit: atomicUnit, aIndex: 0 })).toBe(0x0072b2);
    expect(
      theme.color({ kind: 'element-location', unit: { ...atomicUnit, kind: 1 }, element: 7 }),
    ).toBe(0x9ca3af);

    await viewer.setColorTheme('plddt');
    expect(updateTheme).toHaveBeenLastCalledWith(components, { color: 'plddt-confidence' });
  });
});
