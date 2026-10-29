import { LAYOUT_QUERIES, type LayoutMode } from './layout-defaults';

/**
 * The workbench's layout mode (design decision 17), from the three LAYOUT_QUERIES: the one source
 * the React shell (useLayoutMode, which writes data-layout) and the runtime's controllers share,
 * so CSS and JS never disagree about the layout. Not React: the runtime reads it too.
 */

type QueryName = keyof typeof LAYOUT_QUERIES;

/** The layout mode for what the three queries answer: landscape, desktop, phone, else tablet. */
export function resolveLayoutMode(matches: Record<QueryName, boolean>): LayoutMode {
  if (matches.landscape) return 'landscape';
  if (matches.desktop) return 'desktop';
  if (matches.phone) return 'phone';
  return 'tablet';
}

/** Where the structure is a bottom sheet and More opens a sheet: a phone, upright or on its side. */
export function hasStructureSheet(mode: LayoutMode): boolean {
  return mode === 'phone' || mode === 'landscape';
}

/** The mode and its changes, as the structure controller takes them (a fake in its tests). */
export type LayoutModeSource = {
  get(): LayoutMode;
  subscribe(listener: () => void): () => void;
};

let lists: Record<QueryName, MediaQueryList> | null = null;
let mode: LayoutMode = 'desktop';
const listeners = new Set<() => void>();

const read = (from: Record<QueryName, MediaQueryList>): LayoutMode =>
  resolveLayoutMode({
    landscape: from.landscape.matches,
    desktop: from.desktop.matches,
    phone: from.phone.matches,
  });

/**
 * A window crossing two breakpoints at once fires change on two lists in the same task. matches
 * is live, so the first event resolves the final mode and the second finds nothing new.
 */
const onChange = () => {
  if (!lists) return;
  const next = read(lists);
  if (next === mode) return;
  mode = next;
  for (const listener of [...listeners]) listener();
};

// Made on first use, not at import (the node tests and the shell's first render import this
// module), and kept: React reads the snapshot on every render.
function ensureLists(): void {
  if (lists) return;
  lists = {
    landscape: window.matchMedia(LAYOUT_QUERIES.landscape),
    desktop: window.matchMedia(LAYOUT_QUERIES.desktop),
    phone: window.matchMedia(LAYOUT_QUERIES.phone),
  };
  for (const list of Object.values(lists)) list.addEventListener('change', onChange);
  mode = read(lists);
}

/** The window's layout mode now; the same string until one of the queries changes it. */
export function getLayoutMode(): LayoutMode {
  ensureLists();
  return mode;
}

/** Calls `listener` after each change of the resolved mode, not for a change that keeps it. */
export function subscribeLayoutMode(listener: () => void): () => void {
  ensureLists();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetLayoutModeForTests(): void {
  if (lists) {
    for (const list of Object.values(lists)) list.removeEventListener('change', onChange);
  }
  lists = null;
  mode = 'desktop';
  listeners.clear();
}
