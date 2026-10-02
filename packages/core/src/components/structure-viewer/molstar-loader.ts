// Mol* dynamic loader and viewer factory

import type { TedDomain } from '@protspace/utils';
import { getTedDomainColor, TED_UNASSIGNED_COLOR } from './ted-domain-coloring';

const MOLSTAR_VERSION = '3.44.0';
const MOLSTAR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/molstar@${MOLSTAR_VERSION}/build/viewer/molstar.js`;
const MOLSTAR_CSS_URL = `https://cdn.jsdelivr.net/npm/molstar@${MOLSTAR_VERSION}/build/viewer/molstar.css`;
const TED_COLOR_THEME_NAME = 'protspace-ted-domain';
// Mol*'s click-to-focus behavior draws its own ball-and-stick representations with its own themes
const FOCUS_BEHAVIOR_NAME = 'create-structure-focus-representation';
const FOCUS_PARTS = [
  { tag: 'structure-focus-target-repr', param: 'targetParams' },
  { tag: 'structure-focus-surr-repr', param: 'surroundingsParams' },
] as const;

export type StructureColorMode = 'plddt' | 'ted-domains';

export interface MolstarViewer {
  loadStructureFromUrl: (
    url: string,
    format?: string,
    isBinary?: boolean,
    options?: Record<string, unknown>,
  ) => Promise<void>;
  setColorTheme: (mode: StructureColorMode) => Promise<void>;
  dispose: () => void;
}

interface MolstarUnit {
  kind: number;
  elements: ArrayLike<number>;
  model: {
    atomicHierarchy: {
      residueAtomSegments: { index: ArrayLike<number> };
      residues: { label_seq_id: { value: (index: number) => number } };
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

interface MolstarColorTheme {
  name: string;
  params?: unknown;
}

interface MolstarRepresentationRef {
  cell: {
    transform: { ref: string; tags?: string[]; params?: { colorTheme?: MolstarColorTheme } };
  };
}

interface MolstarFocusBehaviorParams {
  targetParams: { colorTheme: MolstarColorTheme };
  surroundingsParams: { colorTheme: MolstarColorTheme };
}

interface MolstarBehaviorCell {
  transform: {
    ref: string;
    transformer: { definition: { name: string } };
    params?: MolstarFocusBehaviorParams;
  };
}

interface MolstarComponentRef {
  representations: MolstarRepresentationRef[];
}

interface MolstarStructureRef {
  components: MolstarComponentRef[];
}

interface MolstarThemeUpdate {
  color: string;
  colorParams?: unknown;
}

interface MolstarPlugin {
  state: {
    behaviors: {
      cells: Map<string, MolstarBehaviorCell>;
      build: () => {
        to: (ref: string) => {
          update: (edit: (params: MolstarFocusBehaviorParams) => void) => unknown;
        };
        commit: () => Promise<unknown>;
      };
    };
  };
  dataTransaction: (
    edits: () => Promise<void>,
    options?: { rethrowErrors?: boolean },
  ) => Promise<void>;
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
          components: MolstarComponentRef[],
          params: (
            component: MolstarComponentRef,
            representation: MolstarRepresentationRef,
          ) => MolstarThemeUpdate,
        ) => Promise<unknown>;
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

function createTedColorThemeProvider(domains: TedDomain[]) {
  const factory = (_context: unknown, props: Record<string, never>) => ({
    factory,
    granularity: 'group' as const,
    color: (location: MolstarLocation) => {
      const residueSequenceNumber = getResidueSequenceNumber(location);
      return residueSequenceNumber === null
        ? TED_UNASSIGNED_COLOR
        : getTedDomainColor(residueSequenceNumber, domains);
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

export async function createMolstarViewer(
  container: HTMLElement,
  tedDomains: TedDomain[],
): Promise<MolstarViewer> {
  await ensureMolstarResourcesLoaded();

  // Install fetch interceptor to suppress validation server errors
  installValidationInterceptor();

  const viewer = await window.molstar?.Viewer.create(container, {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowRemoteState: false,
    layoutShowSequence: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportShowExpand: false,
    viewportShowSelectionMode: false,
    viewportShowAnimation: false,
  });

  if (!viewer) {
    throw new Error('Failed to initialize Mol* viewer');
  }

  const { plugin } = viewer;
  plugin.representation.structure.themes.colorThemeRegistry.add(
    createTedColorThemeProvider(tedDomains),
  );

  // Preset themes (pLDDT for AlphaFold mmCIF, chain-id for a model without confidence data),
  // captured before the first switch away so pLDDT mode restores exactly them. Keyed by
  // representation ref, or by behavior param for the focus behavior's representations.
  const presetThemes = new Map<string, MolstarColorTheme>();
  const capturePresetTheme = (key: string, theme: MolstarColorTheme | undefined) => {
    if (theme && theme.name !== TED_COLOR_THEME_NAME && !presetThemes.has(key)) {
      presetThemes.set(key, theme);
    }
  };
  const representationKey = ({ cell }: MolstarRepresentationRef) =>
    FOCUS_PARTS.find(({ tag }) => cell.transform.tags?.includes(tag))?.param ?? cell.transform.ref;
  const findFocusBehavior = () =>
    [...plugin.state.behaviors.cells.values()].find(
      (cell) => cell.transform.transformer.definition.name === FOCUS_BEHAVIOR_NAME,
    );

  const applyColorTheme = async (mode: StructureColorMode) => {
    const components = plugin.managers.structure.hierarchy.current.structures.flatMap(
      (structure) => structure.components,
    );
    const representations = components.flatMap((component) => component.representations);
    const focusBehavior = findFocusBehavior();
    for (const repr of representations) {
      capturePresetTheme(representationKey(repr), repr.cell.transform.params?.colorTheme);
    }
    for (const { param } of FOCUS_PARTS) {
      capturePresetTheme(param, focusBehavior?.transform.params?.[param].colorTheme);
    }
    const themeFor = (key: string): MolstarColorTheme | undefined =>
      mode === 'ted-domains' ? { name: TED_COLOR_THEME_NAME, params: {} } : presetThemes.get(key);

    // One transaction for every structure, so a failed representation reverts them all
    await plugin.dataTransaction(
      async () => {
        // Focus representations are created lazily from the behavior's params and drop out of
        // the hierarchy while nothing is focused, so the behavior itself must follow the mode
        if (focusBehavior) {
          const update = plugin.state.behaviors.build();
          update.to(focusBehavior.transform.ref).update((params) => {
            for (const { param } of FOCUS_PARTS) {
              const theme = themeFor(param);
              if (theme) params[param].colorTheme = theme;
            }
          });
          await update.commit();
        }
        await plugin.managers.structure.component.updateRepresentationsTheme(
          components,
          (_component, repr) => {
            const theme = themeFor(representationKey(repr));
            return theme ? { color: theme.name, colorParams: theme.params } : { color: 'default' };
          },
        );
      },
      { rethrowErrors: true },
    );

    // Mol* reverts a failed transform without throwing, so confirm the theme landed
    const applied = representations.every(
      ({ cell }) =>
        (cell.transform.params?.colorTheme?.name === TED_COLOR_THEME_NAME) ===
        (mode === 'ted-domains'),
    );
    if (!applied) throw new Error(`Mol* did not apply the ${mode} color theme`);
  };

  // Theme updates are serialized so the most recently requested mode is applied last
  let colorThemeQueue: Promise<void> = Promise.resolve();

  return {
    loadStructureFromUrl: (...args) => viewer.loadStructureFromUrl(...args),
    setColorTheme: (mode) => {
      const apply = () => applyColorTheme(mode);
      colorThemeQueue = colorThemeQueue.then(apply, apply);
      return colorThemeQueue;
    },
    dispose: () => viewer.dispose(),
  };
}
