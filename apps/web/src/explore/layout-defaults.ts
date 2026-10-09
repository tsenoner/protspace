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

/** The narrowest window that gets the desktop workbench; below it, a stacked fallback. */
export const DESKTOP_MIN_WIDTH = 951;

export type StructurePlacement = 'docked' | 'floating';

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
}

export const DEFAULT_LAYOUT: LayoutState = {
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_WIDTH.default,
  legendFraction: LEGEND_FRACTION.default,
  structurePlacement: 'docked',
  floatingRect: null,
};
