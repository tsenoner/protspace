// Mol* dynamic loader and viewer factory

import type { TedDomain } from '@protspace/utils';
import { getTedDomainColor, TED_UNASSIGNED_COLOR } from './ted-domain-coloring';

const MOLSTAR_VERSION = '3.44.0';
const MOLSTAR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/molstar@${MOLSTAR_VERSION}/build/viewer/molstar.js`;
const MOLSTAR_CSS_URL = `https://cdn.jsdelivr.net/npm/molstar@${MOLSTAR_VERSION}/build/viewer/molstar.css`;
const TED_COLOR_THEME_NAME = 'protspace-ted-domain';

export type StructureColorMode = 'plddt' | 'ted-domains';

export interface MolstarViewer {
  loadStructureFromUrl: (
    url: string,
    format?: string,
    isBinary?: boolean,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  setColorTheme: (mode: StructureColorMode, tedDomains?: TedDomain[]) => Promise<void>;
  dispose: () => void;
}

interface MolstarColumn {
  value: (index: number) => number;
}

interface MolstarUnit {
  kind: number;
  elements: ArrayLike<number>;
  model: {
    atomicHierarchy: {
      residueAtomSegments: { index: ArrayLike<number> };
      residues: { label_seq_id: MolstarColumn };
    };
  };
}

interface MolstarLocation {
  kind?: string;
  unit?: MolstarUnit;
  element?: number;
  aUnit?: MolstarUnit;
  aIndex?: number;
}

interface MolstarStructureRef {
  components: unknown[];
}

interface MolstarPlugin {
  representation: {
    structure: {
      themes: {
        colorThemeRegistry: { add: (provider: unknown) => void };
      };
    };
  };
  managers: {
    structure: {
      hierarchy: { current: { structures: MolstarStructureRef[] } };
      component: {
        updateRepresentationsTheme: (
          components: unknown[],
          params: { color: string },
        ) => Promise<unknown> | undefined;
      };
    };
  };
}

interface RawMolstarViewer {
  loadStructureFromUrl: MolstarViewer['loadStructureFromUrl'];
  dispose: () => void;
  plugin: MolstarPlugin;
}

declare global {
  interface Window {
    molstar: {
      Viewer: {
        create: (
          target: string | HTMLElement,
          options?: {
            layoutIsExpanded?: boolean;
            layoutShowControls?: boolean;
            layoutShowRemoteState?: boolean;
            layoutShowSequence?: boolean;
            layoutShowLog?: boolean;
            layoutShowLeftPanel?: boolean;
            viewportShowExpand?: boolean;
            viewportShowSelectionMode?: boolean;
            viewportShowAnimation?: boolean;
            pdbProvider?: string;
            emdbProvider?: string;
            validationProvider?: string;
            extensions?: unknown[];
          },
        ) => Promise<RawMolstarViewer>;
      };
    };
  }
}

function getResidueSequenceNumber(location: MolstarLocation): number | null {
  const unit = location.kind === 'bond-location' ? location.aUnit : location.unit;
  const element =
    location.kind === 'bond-location' && unit && location.aIndex !== undefined
      ? unit.elements[location.aIndex]
      : location.element;

  // Mol* Unit.Kind.Atomic is 0. Coarse units do not expose atomic residue numbering.
  if (!unit || unit.kind !== 0 || element === undefined) return null;

  const residueIndex = unit.model.atomicHierarchy.residueAtomSegments.index[element];
  if (residueIndex === undefined) return null;

  const sequenceNumber = unit.model.atomicHierarchy.residues.label_seq_id.value(residueIndex);
  return Number.isFinite(sequenceNumber) ? sequenceNumber : null;
}

function createTedColorThemeProvider(getDomains: () => TedDomain[]) {
  const factory = (_context: unknown, props: Record<string, never>) => ({
    factory,
    granularity: 'group' as const,
    color: (location: MolstarLocation) => {
      const residueSequenceNumber = getResidueSequenceNumber(location);
      return residueSequenceNumber === null
        ? TED_UNASSIGNED_COLOR
        : getTedDomainColor(residueSequenceNumber, getDomains());
    },
    props,
    description: 'Assigns categorical colors to TED domains.',
  });

  return {
    name: TED_COLOR_THEME_NAME,
    label: 'TED Domains',
    category: 'Custom',
    factory,
    getParams: () => ({}),
    defaultValues: {},
    isApplicable: () => true,
  };
}

async function ensureMolstarResourcesLoaded(): Promise<void> {
  if (!document.getElementById('molstar-script')) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.id = 'molstar-script';
      script.src = MOLSTAR_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  if (!document.getElementById('molstar-style')) {
    await new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.id = 'molstar-style';
      link.rel = 'stylesheet';
      link.href = MOLSTAR_CSS_URL;
      link.onload = () => resolve();
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }
}

// Install a global fetch interceptor once to silently block Molstar validation server requests.
// Molstar tries to fetch validation data from localhost:9000 by default, which doesn't exist
// in our setup. This interceptor prevents console errors without affecting functionality.
let validationInterceptorInstalled = false;

function installValidationInterceptor(): void {
  if (validationInterceptorInstalled) return;

  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Extract URL from various input types
    let url: string | undefined;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
    } else if (input instanceof URL) {
      url = input.href;
    }

    // Block Molstar validation server requests (they're optional and fail silently in Molstar anyway)
    if (url && (url.includes('localhost:9000') || url.includes('/v2/list_entries/'))) {
      return Promise.resolve(
        new Response('[]', {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    return originalFetch.call(this, input, init);
  };

  validationInterceptorInstalled = true;
}

export async function createMolstarViewer(container: HTMLElement): Promise<MolstarViewer> {
  await ensureMolstarResourcesLoaded();

  // Install fetch interceptor to suppress validation server errors
  installValidationInterceptor();

  const viewer = (await window.molstar?.Viewer.create(container, {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowRemoteState: false,
    layoutShowSequence: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportShowExpand: false,
    viewportShowSelectionMode: false,
    viewportShowAnimation: false,
  })) as unknown as RawMolstarViewer | undefined;

  if (!viewer) {
    throw new Error('Failed to initialize Mol* viewer');
  }

  let tedDomains: TedDomain[] = [];
  viewer.plugin.representation.structure.themes.colorThemeRegistry.add(
    createTedColorThemeProvider(() => tedDomains),
  );

  return {
    loadStructureFromUrl: (...args) => viewer.loadStructureFromUrl(...args),
    setColorTheme: async (mode, domains = []) => {
      tedDomains = domains;
      const color = mode === 'ted-domains' ? TED_COLOR_THEME_NAME : 'plddt-confidence';
      const structures = viewer.plugin.managers.structure.hierarchy.current.structures;

      for (const structure of structures) {
        await viewer.plugin.managers.structure.component.updateRepresentationsTheme(
          structure.components,
          { color },
        );
      }
    },
    dispose: () => viewer.dispose(),
  };
}
