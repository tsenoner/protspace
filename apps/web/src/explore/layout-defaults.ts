/**
 * The workbench's layout constants, types and defaults (design decision 10). A leaf module with no
 * imports, so the Playwright helpers can import it as well. Sizes the shell clamps against live
 * here, never as --ps-* tokens.
 */

/** The one localStorage key the layout is kept under. Layout never goes into the URL. */
export const LAYOUT_STORAGE_KEY = 'protspace:layout:v1';

/** The sidebar's width in px, stored within min and max and clamped again to the window at render. */
export const SIDEBAR_WIDTH = { min: 240, max: 480, default: 300 } as const;

/** The legend's share of the sidebar's height above the divider. */
export const LEGEND_FRACTION = { min: 0.2, max: 0.8, default: 0.5 } as const;

/** The floating structure card in px; its default spot is `inset` from the plot's bottom-right. */
export const FLOATING_CARD = {
  minWidth: 280,
  minHeight: 240,
  defaultWidth: 340,
  defaultHeight: 360,
  inset: 14,
} as const;

/** The narrowest window that gets the desktop workbench (design decision 17). */
export const DESKTOP_MIN_WIDTH = 951;

/** The widest window that gets the phone layout; from here to 950 px, the tablet layout. */
export const PHONE_MAX_WIDTH = 640;

/** A landscape window at most this tall (and at most 950 px wide) is a phone on its side. */
export const LANDSCAPE_PHONE_MAX_HEIGHT = 500;

/** The workbench's four layouts; layout-mode.ts resolves which one the window gets. */
export type LayoutMode = 'desktop' | 'tablet' | 'phone' | 'landscape';

/**
 * The media queries the layout mode is resolved from, in the order they win: a phone on its side
 * first (capped below desktop width, so a short desktop window stays desktop), then desktop, then
 * phone; anything else is a tablet. Core's breakpoints.ts keeps the same numbers (Task 5.6).
 */
export const LAYOUT_QUERIES = {
  landscape: `(orientation: landscape) and (max-height: ${LANDSCAPE_PHONE_MAX_HEIGHT}px) and (max-width: ${DESKTOP_MIN_WIDTH - 1}px)`,
  desktop: `(min-width: ${DESKTOP_MIN_WIDTH}px)`,
  phone: `(max-width: ${PHONE_MAX_WIDTH}px)`,
} as const;

export type StructurePlacement = 'docked' | 'floating';

/** What the sidebar shows above the structure: the legend or the Filter panel (decision 14). */
export type SidebarPanel = 'legend' | 'filter';

/** The floating card in px, relative to the plot area's top-left corner. */
export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  legendFraction: number;
  structurePlacement: StructurePlacement;
  /** null: the default spot at the plot area's bottom-right corner. */
  floatingRect: FloatingRect | null;
  /** The sidebar's panel; the filter itself is never stored. */
  panel: SidebarPanel;
  /**
   * The phone's bottom panel shows only its header (design decision 17). Phones only, and
   * independent of sidebarOpen: collapsing the desktop sidebar never folds the phone panel.
   */
  panelFolded: boolean;
}

export const DEFAULT_LAYOUT: LayoutState = {
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_WIDTH.default,
  legendFraction: LEGEND_FRACTION.default,
  structurePlacement: 'docked',
  floatingRect: null,
  panel: 'legend',
  panelFolded: false,
};

/** The icon rail at the sidebar's right edge, shown at desktop widths. */
export const RAIL_WIDTH = 44;
/** The plot keeps at least this width beside a sidebar at desktop widths (rendering clamps the sidebar). */
export const MIN_PLOT_WIDTH = 480;
