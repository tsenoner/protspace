import type {
  ProtspaceScatterplot,
  ProtspaceStructureViewer,
  StructureProteinChangeDetail,
  TooltipAction,
  TooltipActionDetail,
} from '@protspace/core';
import type { LayoutMode, LayoutState } from './layout-defaults';
import { hasStructureSheet, type LayoutModeSource } from './layout-mode';
import { getLayout, subscribeLayout, updateLayout } from './layout-state';
import {
  getWorkbenchStatus,
  setStructureSheet,
  setWorkbenchStatus,
  subscribeWorkbenchStatus,
} from './workbench-status';

/** "View structure" in a pinned protein tooltip. */
const VIEW_STRUCTURE: TooltipAction = { id: 'view-structure', label: 'View structure' };

/**
 * Whether the structure can be seen with this layout. Off desktop the panel under the plot never
 * collapses, so it always can; on desktop a floating card always can, and a docked one only while
 * the sidebar is open.
 */
export function isStructureVisible(layout: LayoutState, mode: LayoutMode): boolean {
  if (mode !== 'desktop') return true;
  return layout.structurePlacement === 'floating' || layout.sidebarOpen;
}

export interface StructureController {
  /** Shows `proteinId` now if the structure can be seen, or keeps it until it can. */
  request(proteinId: string): void;
  /**
   * The selection changed: offer its proteins in the header and choose which one shows. A single
   * protein added to the selection shows; else the shown (or waiting) one stays while it is still
   * selected; else the selection's last. An empty selection only clears the offer.
   */
  select(proteinIds: readonly string[]): void;
  /** Forgets the protein and the choices (a new dataset). Closes the viewer only if it holds one. */
  clear(): void;
  dispose(): void;
}

interface StructureControllerOptions {
  viewer: ProtspaceStructureViewer;
  /** The plot whose pinned tooltip offers "View structure", and whose taps pin a tooltip. */
  plotElement: Pick<
    ProtspaceScatterplot,
    'tooltipActions' | 'tapTooltips' | 'addEventListener' | 'removeEventListener'
  >;
  /** The workbench's layout mode (layout-mode.ts in the app; a fake in tests). */
  layoutMode: LayoutModeSource;
}

/**
 * The one protein `next` adds to `previous`, or null when it adds none or several, or drops one.
 * Lengths are compared first, and an appended protein (a ⌘-click) needs no set, so a large
 * selection change costs a length check.
 */
function singleAddition(previous: readonly string[], next: readonly string[]): string | null {
  if (next.length !== previous.length + 1) return null;
  if (previous.every((id, index) => next[index] === id)) return next[next.length - 1];
  const known = new Set(previous);
  let added: string | null = null;
  for (const id of next) {
    if (known.has(id)) continue;
    if (added !== null) return null;
    added = id;
  }
  return added;
}

/**
 * What the structure viewer shows, and when (design decision 2). A protein requested while the
 * structure is hidden (docked in a collapsed sidebar) only waits behind the rail's dot: no
 * AlphaFold request and no Mol* start in a hidden box. It loads once a layout or breakpoint change
 * makes the structure visible. The viewer no longer shows or hides itself: the shell places it
 * from `structureProteinId` in the workbench status. On phones the structure is a sheet: it opens
 * folded and "View structure" expands it (decision 17).
 */
export function createStructureController({
  viewer,
  plotElement,
  layoutMode,
}: StructureControllerOptions): StructureController {
  // Properties, not attributes: Lit reads auto-show="false" as true.
  viewer.autoShow = false;
  viewer.showTips = false;
  viewer.title = 'Structure';
  viewer.style.removeProperty('display');

  // The protein waiting for the structure to be seen; null once it loads or is forgotten.
  let waiting: string | null = null;
  // The selection the header offers, as select() last received it.
  let choices: readonly string[] = [];

  const visible = () => isStructureVisible(getLayout(), layoutMode.get());
  // A structure that appears from none opens folded on phones (decision 17), so the plot and the
  // tooltip stay in view; closing starts over, so the next one opens folded too.
  const publish = (proteinId: string | null) => {
    const appears = proteinId !== null && getWorkbenchStatus().structureProteinId === null;
    setWorkbenchStatus(
      proteinId === null || appears
        ? { structureProteinId: proteinId, structureSheet: 'folded' }
        : { structureProteinId: proteinId },
    );
  };
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

  const select = (proteinIds: readonly string[]) => {
    const previous = choices;
    choices = proteinIds;
    viewer.proteinChoices = proteinIds;
    if (proteinIds.length === 0) return;
    const added = singleAddition(previous, proteinIds);
    if (added !== null) {
      request(added);
      return;
    }
    const shown = waiting ?? viewer.proteinId;
    if (shown !== null && proteinIds.includes(shown)) return;
    request(proteinIds[proteinIds.length - 1]);
  };
  // The user picked another selected protein in the header; the viewer is loading it.
  const onProteinChange = (event: Event) => {
    waiting = null;
    publish((event as CustomEvent<StructureProteinChangeDetail>).detail.proteinId);
  };

  // What a pinned tooltip offers and whether a tap pins one (design decisions 2 and 17). Desktop:
  // "View structure" only where a click cannot show the structure, docked in a collapsed sidebar.
  // Tablet: nothing, its structure is always in view; a tap still pins, to read a protein. Phone
  // and landscape: "View structure" expands the folded sheet; while the sheet is up a tap pins
  // nothing, so no tooltip opens under it (expanding also ends a pin: tapTooltips turns false).
  const offerViewStructure = () => {
    const mode = layoutMode.get();
    const layout = getLayout();
    const { structureSheet, structureProteinId } = getWorkbenchStatus();
    const sheet = hasStructureSheet(mode);
    const sheetUp = sheet && structureSheet === 'expanded' && structureProteinId !== null;
    const offer =
      mode === 'desktop'
        ? layout.structurePlacement === 'docked' && !layout.sidebarOpen
        : sheet && !sheetUp;
    if (offer !== plotElement.tooltipActions.length > 0) {
      plotElement.tooltipActions = offer ? [VIEW_STRUCTURE] : [];
    }
    if (plotElement.tapTooltips === sheetUp) plotElement.tapTooltips = !sheetUp;
  };
  const onLayoutChange = () => {
    offerViewStructure();
    loadWaiting();
  };
  const onTooltipAction = (event: Event) => {
    const { id, proteinId } = (event as CustomEvent<TooltipActionDetail>).detail;
    if (id !== VIEW_STRUCTURE.id) return;
    // The focused button goes with its tooltip; focus what it opened instead of leaving <body>.
    const focused =
      typeof document !== 'undefined' && document.activeElement === event.currentTarget;
    request(proteinId);
    // A phone expands its sheet; elsewhere the sidebar opens, which loads a waiting protein.
    if (hasStructureSheet(layoutMode.get())) setStructureSheet('expanded');
    else updateLayout({ sidebarOpen: true });
    // A frame on, the sheet or the sidebar has rendered and the section is no longer inert.
    if (focused) {
      requestAnimationFrame(() =>
        viewer.closest<HTMLElement>('[data-workbench="structure"]')?.focus(),
      );
    }
  };

  const unsubscribe = subscribeLayout(onLayoutChange);
  const unsubscribeMode = layoutMode.subscribe(onLayoutChange);
  // The sheet's state, which the shell writes, and the shown protein change the offer.
  const unsubscribeStatus = subscribeWorkbenchStatus(offerViewStructure);
  viewer.addEventListener('structure-close', forget);
  viewer.addEventListener('structure-protein-change', onProteinChange);
  plotElement.addEventListener('tooltip-action', onTooltipAction);
  offerViewStructure();

  return {
    request,
    select,
    clear() {
      choices = [];
      viewer.proteinChoices = [];
      // close() dispatches structure-close, which forgets the protein.
      if (viewer.proteinId) viewer.close();
      else forget();
    },
    dispose() {
      unsubscribe();
      unsubscribeMode();
      unsubscribeStatus();
      viewer.removeEventListener('structure-close', forget);
      viewer.removeEventListener('structure-protein-change', onProteinChange);
      plotElement.removeEventListener('tooltip-action', onTooltipAction);
    },
  };
}
