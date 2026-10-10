import { vi } from 'vitest';
import type { VisualizationData } from '@protspace/utils';
import '../legend';
import type { ProtspaceLegend } from '../legend';

/**
 * Test harness for the legend's half of the scatterplot sync.
 *
 * `ScatterplotSyncController` has no injectable entry point: `onDataChange` is a closure field on
 * the options object passed to its constructor (`legend.ts`), never assigned onto the element, so
 * a test cannot call it directly. The only way in is a mock `<protspace-scatterplot>` the
 * controller discovers by tag name — which makes this mock the controller's discovery contract
 * written down. It lives here rather than in each spec so that contract has one copy to update.
 */
export type MockScatterplot = HTMLElement & {
  data: VisualizationData;
  selectedAnnotation: string;
  selectedProjectionIndex: number;
  eatOverlayEnabled: boolean;
  hiddenAnnotationValues: string[];
  otherAnnotationValues: string[];
  config: Record<string, never>;
  filtersActive: boolean;
  filteredProteinIds: string[];
  getCurrentData(): VisualizationData;
  isIsolationMode(): boolean;
  getIsolationHistory(): string[][];
};

/**
 * Mount a legend beside a mock scatterplot showing `data` coloured by `selectedAnnotation`, and
 * wait for its first render.
 *
 * `plot` overrides individual scatterplot properties (`filtersActive`, `isIsolationMode`,
 * `selectedProjectionIndex`, …) after the defaults, which describe an unfiltered, un-isolated
 * view of the first projection.
 *
 * Callers are responsible for clearing `document.body` between tests.
 */
export async function mountLegendWithScatterplot(
  data: VisualizationData,
  selectedAnnotation: string,
  plot: Partial<MockScatterplot> = {},
): Promise<{
  legend: ProtspaceLegend;
  plot: MockScatterplot;
  controlBar: HTMLElement;
}> {
  // Through `unknown`: the tag resolves to the real `ProtspaceScatterplot` in the global element
  // map, and the point of this mock is to implement only the slice the controller reads.
  const scatterplot = document.createElement('protspace-scatterplot') as unknown as MockScatterplot;
  Object.assign(scatterplot, {
    data,
    selectedAnnotation,
    selectedProjectionIndex: 0,
    eatOverlayEnabled: true,
    hiddenAnnotationValues: [],
    otherAnnotationValues: [],
    config: {},
    filtersActive: false,
    filteredProteinIds: [],
    getCurrentData: () => data,
    isIsolationMode: () => false,
    getIsolationHistory: () => [],
    ...plot,
  });
  document.body.append(scatterplot);

  // A bare, unregistered element is enough: the sync controller matches control bars by tag
  // name (see `scatterplot-sync-controller.ts` `_onScatterplotDiscovered`).
  const controlBar = document.createElement('protspace-control-bar');
  document.body.append(controlBar);

  const legend = document.createElement('protspace-legend') as ProtspaceLegend;
  document.body.append(legend);
  await legend.updateComplete;

  return { legend, plot: scatterplot, controlBar };
}

/** Wait until the legend stops re-rendering: `updated()` sets state that schedules another pass. */
export async function settle(legend: ProtspaceLegend): Promise<void> {
  for (let i = 0; i < 10; i++) if (await legend.updateComplete) return;
  throw new Error('legend did not settle within 10 update cycles');
}

/**
 * Replace `localStorage` with an in-memory store for the calling spec file.
 *
 * The persistence controller keys `localStorage` by a hash of the dataset, so mounted legends
 * whose fixtures hash the same leak saved settings into each other; specs clear the store in a
 * `beforeEach`. Node does not hand jsdom a usable `localStorage` without `--localstorage-file`,
 * so without this stub persistence silently no-ops locally but runs in CI, and `clear()` throws.
 * Same shape as the mock in `packages/utils/src/storage/storage-service.test.ts`.
 */
export function stubLocalStorage(): void {
  let store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  });
}
