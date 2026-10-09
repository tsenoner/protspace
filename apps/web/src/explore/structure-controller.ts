import type {
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  TooltipAction,
  TooltipActionDetail,
} from '@protspace/core';
import type { LayoutState } from './layout-defaults';
import { getLayout, subscribeLayout, updateLayout } from './layout-state';
import { setWorkbenchStatus } from './workbench-status';

/** "View structure" in a pinned protein tooltip. */
const VIEW_STRUCTURE: TooltipAction = { id: 'view-structure', label: 'View structure' };

/**
 * Whether the structure can be seen with this layout. Below 951 px the stacked sidebar never
 * collapses, so it always can; on desktop a floating card always can, and a docked one only while
 * the sidebar is open.
 */
export function isStructureVisible(layout: LayoutState, desktop: boolean): boolean {
  if (!desktop) return true;
  return layout.structurePlacement === 'floating' || layout.sidebarOpen;
}

export interface StructureController {
  /** Shows `proteinId` now if the structure can be seen, or keeps it until it can. */
  request(proteinId: string): void;
  /** Forgets the protein (a new dataset). Closes the viewer only if it holds one. */
  clear(): void;
  dispose(): void;
}

interface StructureControllerOptions {
  viewer: ProtspaceStructureViewer;
  /** The plot whose pinned tooltip offers "View structure". */
  plotElement: Pick<
    ProtspaceScatterplot,
    'tooltipActions' | 'addEventListener' | 'removeEventListener'
  >;
  /** `matchMedia('(min-width: 951px)')` in the app; a fake in tests. */
  desktopQuery: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
}

/**
 * What the structure viewer shows, and when (design decision 2). A protein requested while the
 * structure is hidden (docked in a collapsed sidebar) only waits behind the rail's dot: no
 * AlphaFold request and no Mol* start in a hidden box. It loads once a layout or breakpoint change
 * makes the structure visible. The viewer no longer shows or hides itself: the shell places it
 * from `structureProteinId` in the workbench status.
 */
export function createStructureController({
  viewer,
  plotElement,
  desktopQuery,
}: StructureControllerOptions): StructureController {
  // Properties, not attributes: Lit reads auto-show="false" as true.
  viewer.autoShow = false;
  viewer.showTips = false;
  viewer.title = 'Structure';
  viewer.style.removeProperty('display');

  // The protein waiting for the structure to be seen; null once it loads or is forgotten.
  let waiting: string | null = null;

  const visible = () => isStructureVisible(getLayout(), desktopQuery.matches);
  const publish = (proteinId: string | null) =>
    setWorkbenchStatus({ structureProteinId: proteinId });
  const load = (proteinId: string) => {
    waiting = null;
    viewer.loadProtein(proteinId);
  };
  const loadWaiting = () => {
    if (waiting !== null && visible()) load(waiting);
  };
  const forget = () => {
    waiting = null;
    publish(null);
  };

  const request = (proteinId: string) => {
    publish(proteinId);
    if (visible()) load(proteinId);
    else waiting = proteinId;
  };

  // "View structure" is offered only where a click cannot show the structure: docked in a
  // collapsed sidebar, on desktop (design decision 2). A visible or floating one loads on click.
  const offerViewStructure = () => {
    const layout = getLayout();
    const offer =
      desktopQuery.matches && layout.structurePlacement === 'docked' && !layout.sidebarOpen;
    if (offer !== plotElement.tooltipActions.length > 0) {
      plotElement.tooltipActions = offer ? [VIEW_STRUCTURE] : [];
    }
  };
  const onLayoutChange = () => {
    offerViewStructure();
    loadWaiting();
  };
  const onTooltipAction = (event: Event) => {
    const { id, proteinId } = (event as CustomEvent<TooltipActionDetail>).detail;
    if (id !== VIEW_STRUCTURE.id) return;
    // Wait for the tooltip's protein, then open the sidebar, which loads it.
    request(proteinId);
    updateLayout({ sidebarOpen: true });
  };

  const unsubscribe = subscribeLayout(onLayoutChange);
  desktopQuery.addEventListener('change', onLayoutChange);
  viewer.addEventListener('structure-close', forget);
  plotElement.addEventListener('tooltip-action', onTooltipAction);
  offerViewStructure();

  return {
    request,
    clear() {
      // close() dispatches structure-close, which forgets the protein.
      if (viewer.proteinId) viewer.close();
      else forget();
    },
    dispose() {
      unsubscribe();
      desktopQuery.removeEventListener('change', onLayoutChange);
      viewer.removeEventListener('structure-close', forget);
      plotElement.removeEventListener('tooltip-action', onTooltipAction);
    },
  };
}
