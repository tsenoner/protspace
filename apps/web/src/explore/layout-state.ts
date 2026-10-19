import { getStorageItem, setStorageItem } from '@protspace/utils';
import {
  DEFAULT_LAYOUT,
  FLOATING_CARD,
  LAYOUT_STORAGE_KEY,
  LEGEND_FRACTION,
  SIDEBAR_WIDTH,
  type FloatingRect,
  type LayoutState,
  type SidebarPanel,
  type StructurePlacement,
} from './layout-defaults';
import { getLayoutMode } from './layout-mode';

/**
 * The persisted workbench layout (design decision 10): the React shell subscribes with
 * useSyncExternalStore and the runtime reads and writes it through the same functions. It is read
 * once, parsed field by field, and written once per committed change, never during a drag. Clamps
 * that depend on the window happen at render and never rewrite it.
 */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPlacement = (value: unknown): value is StructurePlacement =>
  value === 'docked' || value === 'floating';

const isPanel = (value: unknown): value is SidebarPanel => value === 'legend' || value === 'filter';

function parseRect(raw: unknown): FloatingRect | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, width, height } = raw as Partial<Record<keyof FloatingRect, unknown>>;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(FLOATING_CARD.minWidth, Math.round(width)),
    height: Math.max(FLOATING_CARD.minHeight, Math.round(height)),
  };
}

/** A layout from anything stored: each field that is missing or invalid takes its default. */
export function parseLayout(raw: unknown): LayoutState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_LAYOUT };
  const value = raw as Partial<Record<keyof LayoutState, unknown>>;
  return {
    sidebarOpen:
      typeof value.sidebarOpen === 'boolean' ? value.sidebarOpen : DEFAULT_LAYOUT.sidebarOpen,
    sidebarWidth: isFiniteNumber(value.sidebarWidth)
      ? clamp(Math.round(value.sidebarWidth), SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max)
      : DEFAULT_LAYOUT.sidebarWidth,
    legendFraction: isFiniteNumber(value.legendFraction)
      ? clamp(value.legendFraction, LEGEND_FRACTION.min, LEGEND_FRACTION.max)
      : DEFAULT_LAYOUT.legendFraction,
    structurePlacement: isPlacement(value.structurePlacement)
      ? value.structurePlacement
      : DEFAULT_LAYOUT.structurePlacement,
    floatingRect: parseRect(value.floatingRect),
    panel: isPanel(value.panel) ? value.panel : DEFAULT_LAYOUT.panel,
    panelFolded:
      typeof value.panelFolded === 'boolean' ? value.panelFolded : DEFAULT_LAYOUT.panelFolded,
    structureHidden:
      typeof value.structureHidden === 'boolean'
        ? value.structureHidden
        : DEFAULT_LAYOUT.structureHidden,
    plotFill: typeof value.plotFill === 'boolean' ? value.plotFill : DEFAULT_LAYOUT.plotFill,
  };
}

function sameRect(a: FloatingRect | null, b: FloatingRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameLayout(a: LayoutState, b: LayoutState): boolean {
  return (
    a.sidebarOpen === b.sidebarOpen &&
    a.sidebarWidth === b.sidebarWidth &&
    a.legendFraction === b.legendFraction &&
    a.structurePlacement === b.structurePlacement &&
    sameRect(a.floatingRect, b.floatingRect) &&
    a.panel === b.panel &&
    a.panelFolded === b.panelFolded &&
    a.structureHidden === b.structureHidden &&
    a.plotFill === b.plotFill
  );
}

let layout: LayoutState | null = null;
const listeners = new Set<() => void>();

/** The layout: read from storage on the first call, then the same object until a change. */
export function getLayout(): LayoutState {
  layout ??= parseLayout(getStorageItem<unknown>(LAYOUT_STORAGE_KEY, null));
  return layout;
}

export function subscribeLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Commits a change: parsed, written once and announced; an equal layout does nothing. */
export function updateLayout(patch: Partial<LayoutState>): void {
  const current = getLayout();
  const next = parseLayout({ ...current, ...patch });
  if (sameLayout(current, next)) return;
  layout = next;
  setStorageItem(LAYOUT_STORAGE_KEY, next);
  for (const listener of [...listeners]) listener();
}

/**
 * Opens the sidebar on `panel`: the rail's items, the view bar's Filter, the More sheet's Filter
 * and the status chips. On a phone it also unfolds the bottom panel, so what opened is on screen.
 */
export function openPanel(panel: SidebarPanel): void {
  updateLayout({ sidebarOpen: true, panel, panelFolded: false });
}

const focusTitle = (): boolean => {
  const title = document.getElementById('wb-filter-title');
  // Only a phone on its side scrolls the page; focus must never scroll the fixed screens.
  title?.focus({ preventScroll: getLayoutMode() !== 'landscape' });
  return title !== null && document.activeElement === title;
};

/**
 * Moves focus to the Filter panel's heading, after the panel opened from the view bar's Filter or
 * the status corner's filter chip. A sidebar still sliding in shows it a frame later.
 */
export function focusFilterTitle(): void {
  if (!focusTitle()) requestAnimationFrame(focusTitle);
}

export function resetLayoutForTests(): void {
  layout = null;
  listeners.clear();
}
