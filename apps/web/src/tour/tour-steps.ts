/**
 * The product tour's steps as data: the full tour and the short "What's new" tour, for each layout
 * mode, pointer type and keyboard (design decisions 1, 16 and 17; the Migration Plan). No driver.js
 * here: `product-tour.ts` maps these specs to driver.js steps when a tour starts, so every list is
 * unit-tested in node. Targets are `data-driver-id` hosts in the light DOM; the Other row is the
 * one target inside a shadow root.
 */
import type { LayoutMode } from '../explore/layout-defaults';
import { hasStructureSheet } from '../explore/layout-mode';
import type { TourKind } from './storage-key';

/** What the steps depend on, read when a tour starts. */
export interface TourContext {
  mode: LayoutMode;
  /** `(pointer: coarse)`: touch words, no keyboard shortcuts. */
  coarse: boolean;
  /** ⌘ on Mac and iOS, Ctrl elsewhere. */
  mac: boolean;
}

type TourStepId =
  | 'welcome'
  | 'whats-new'
  | 'data'
  | 'dataset'
  | 'view-bar'
  | 'more'
  | 'search'
  | 'plot'
  | 'selection'
  | 'legend'
  | 'other'
  | 'sidebar'
  | 'theme'
  | 'finish'
  | 'end';

export interface TourStepSpec {
  id: TourStepId;
  title: string;
  /** HTML, set as the popover's description. */
  description: string;
  /** A light-DOM selector, an element inside a host's shadow root, or null for a centred step. */
  target: string | { host: string; inner: string } | null;
  /** On a centred step: the control lifted above the overlay, where the tour can be found again. */
  spotlight?: string;
}

const driverId = (name: string): string => `[data-driver-id="${name}"]`;

const EXTERNAL_ICON =
  '<svg class="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

const link = (href: string, text: string): string =>
  `<a href="${href}" target="_blank" rel="noopener">${text}${EXTERNAL_ICON}</a>`;

/** ⌘K on a Mac, Ctrl+K elsewhere, as a key cap. */
const chord = (ctx: TourContext, key: string): string =>
  ctx.mac ? `<kbd><span class="mod-key">⌘</span>${key}</kbd>` : `<kbd>Ctrl+${key}</kbd>`;

/** The modifier alone, for "hold it and click". */
const modifier = (ctx: TourContext): string =>
  ctx.mac ? '<kbd><span class="mod-key">⌘</span></kbd>' : '<kbd>Ctrl</kbd>';

/** ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere: redo, as one key cap. */
const redoChord = (ctx: TourContext): string =>
  ctx.mac ? '<kbd><span class="mod-key">⇧⌘</span>Z</kbd>' : '<kbd>Ctrl+Shift+Z</kbd>';

/** "Click" on a mouse, "Tap" on a touch screen. */
const press = (ctx: TourContext): string => (ctx.coarse ? 'Tap' : 'Click');

/** Where Take the tour lives: Help, or More → Help & shortcuts on a phone. */
const tourHome = (ctx: TourContext): string =>
  hasStructureSheet(ctx.mode)
    ? '<strong>More</strong> → <strong>Help &amp; shortcuts</strong> → <strong>Take the tour</strong>'
    : '<strong>Help</strong> → <strong>Take the tour</strong>';

const homeSpotlight = (ctx: TourContext): string =>
  driverId(hasStructureSheet(ctx.mode) ? 'more' : 'help');

type StepBuilder = (ctx: TourContext, kind: TourKind) => TourStepSpec;

const STEPS: Record<TourStepId, StepBuilder> = {
  welcome: (ctx) => ({
    id: 'welcome',
    title: 'Welcome to ProtSpace',
    description: `This short tour shows the main parts of the workbench. Skip it if you like: ${tourHome(ctx)} plays it again any time.`,
    target: null,
    spotlight: homeSpotlight(ctx),
  }),

  'whats-new': (ctx) => ({
    id: 'whats-new',
    title: "What's new in ProtSpace",
    description: `ProtSpace has a new layout. This tour shows what moved and what is new in a few steps; <strong>Full tour</strong> shows everything instead, and ${tourHome(ctx)} plays it later.`,
    target: null,
    spotlight: homeSpotlight(ctx),
  }),

  data: (ctx) => ({
    id: 'data',
    title: 'Import & Export',
    description: `${press(ctx)} the <strong>dataset name</strong> or <strong>Import</strong> to load one of the <strong>examples</strong>, reopen your <strong>last file</strong>, or choose <strong>Open a file…</strong>. You can also drop a file anywhere on the page. A <code>.parquetbundle</code> loads entirely in your browser; a <code>.fasta</code> is sent to our server to be embedded first. <strong>Export</strong> holds the <strong>Figure editor</strong>, a quick PNG or PDF, the protein IDs and the <code>.parquetbundle</code>. ${link('/docs/guide/data-preparation', 'Learn how to prepare your data')}.`,
    target: driverId('data-actions'),
  }),

  dataset: (ctx) => ({
    id: 'dataset',
    title: 'Your Data',
    description: `${press(ctx)} the <strong>dataset name</strong> to load one of the <strong>examples</strong>, reopen your <strong>last file</strong>, or choose <strong>Open a file…</strong>. A <code>.parquetbundle</code> loads entirely on your device; a <code>.fasta</code> is sent to our server to be embedded first.`,
    target: driverId('dataset'),
  }),

  'view-bar': (ctx, kind) => ({
    id: 'view-bar',
    title: 'The View Bar',
    description: hasStructureSheet(ctx.mode)
      ? kind === 'whats-new'
        ? 'The view bar replaces the control bar. <strong>Projection</strong> picks the 2D map and <strong>Color by</strong> the annotation that colours the points; everything else is in <strong>More</strong>.'
        : '<strong>Projection</strong> picks the 2D map (UMAP, PCA and others) and <strong>Color by</strong> the annotation that colours the points. Everything else is in <strong>More</strong>.'
      : kind === 'whats-new'
        ? ctx.mode === 'desktop'
          ? "The view bar replaces the control bar: <strong>Projection</strong> (with its details beside it), <strong>Color by</strong> and <strong>Contours</strong> sit here; <strong>Filter</strong> is on the rail at the sidebar's edge. In a narrow window, what does not fit moves into <strong>More</strong>."
          : 'The view bar replaces the control bar: <strong>Projection</strong> (with its details beside it), <strong>Color by</strong>, <strong>Contours</strong> and <strong>Filter</strong> sit here. In a narrow window, what does not fit moves into <strong>More</strong>.'
        : ctx.mode === 'desktop'
          ? '<strong>Projection</strong> picks the 2D map (UMAP, PCA and others); the button beside it shows how the map was made and how well it keeps neighbours. <strong>Color by</strong> picks the annotation that colours the points, and <strong>Contours</strong> draws density rings for each colour. In a narrow window, what does not fit moves into <strong>More</strong>.'
          : '<strong>Projection</strong> picks the 2D map (UMAP, PCA and others); the button beside it shows how the map was made and how well it keeps neighbours. <strong>Color by</strong> picks the annotation that colours the points, <strong>Contours</strong> draws density rings for each colour, and <strong>Filter</strong> opens the Filter panel in the sidebar. In a narrow window, what does not fit moves into <strong>More</strong>.',
    target: driverId('view-bar'),
  }),

  more: () => ({
    id: 'more',
    title: 'More Options',
    description:
      '<strong>More</strong> holds <strong>Contours</strong>, <strong>Filter</strong>, <strong>Import</strong>, <strong>Export</strong>, the <strong>Theme</strong> (System, Light or Dark), <strong>Help &amp; shortcuts</strong> and <strong>Feedback</strong>. A dot on the button means contours or a filter are on.',
    target: driverId('more'),
  }),

  search: (ctx) => ({
    id: 'search',
    title: 'Search Proteins',
    description: hasStructureSheet(ctx.mode)
      ? `${press(ctx)} the search button to search over the app bar. Type a protein ID to find it, or <strong>paste</strong> a list of IDs to select them all at once; a message says how many were found and which were not.`
      : `${ctx.coarse ? 'Tap here' : `Press ${chord(ctx, 'K')} or click here`} to search. Type a protein ID to find it, or <strong>paste</strong> a list of IDs to select them all at once; a message says how many were found and which were not.`,
    target: driverId(hasStructureSheet(ctx.mode) ? 'search-toggle' : 'search'),
  }),

  plot: (ctx) => ({
    id: 'plot',
    title: 'Interactive Scatterplot',
    description: ctx.coarse
      ? 'Each point is a protein. <strong>Tap</strong> a point to select it and see its details and its 3D structure (when there is one). <strong>Drag</strong> to pan and <strong>pinch</strong> to zoom. Both axes share one scale, so distances read the same in every direction.'
      : `Each point is a protein. <strong>Hover</strong> a point for its details, <strong>drag</strong> to pan and zoom with the mouse wheel. <strong>Click</strong> a point to select it and see its 3D structure (when there is one); hold ${modifier(ctx)} and click to add a point to the selection or take it out. Both axes share one scale, so distances read the same in every direction.`,
    target: driverId('scatterplot'),
  }),

  selection: (ctx, kind) => {
    // Its own line, with both shortcuts in full: undo is new, and "add Shift" was easy to miss.
    const undo = ctx.coarse
      ? ''
      : `<br><br><strong>Undo</strong> ${chord(ctx, 'Z')} and <strong>redo</strong> ${redoChord(ctx)} a selection, <strong>Show only these</strong> or a filter change.`;
    return {
      id: 'selection',
      title: 'Selection Tools',
      description:
        kind === 'whats-new'
          ? `The selection tools now sit on the plot. A selection opens a bar with <strong>Show only these</strong>, <strong>Zoom to them</strong>, <strong>Copy IDs</strong> and <strong>Clear</strong>; chips in the corner say what is hidden, and their ✕ shows it again.${undo}`
          : `<strong>Box select</strong> and <strong>Lasso select</strong> select the points you drag around; <strong>Move and zoom</strong> pans again and <strong>Fit to view</strong> shows every point. With a selection, the bar at the bottom of the plot offers <strong>Show only these</strong>, <strong>Zoom to them</strong>, <strong>Copy IDs</strong> and <strong>Clear</strong>. Chips in the corner say what is hidden; their ✕ shows it again.${undo}`,
      target: driverId('selection'),
    };
  },

  legend: (ctx) => ({
    id: 'legend',
    title: 'Legend Panel',
    description: ctx.coarse
      ? `<strong>Tap</strong> a row to hide or show its category, <strong>double-tap</strong> to show only that one. A row's <strong>⋯</strong> offers <em>Show only this</em> and <em>Colour and shape</em>; hold its handle and drag to reorder (higher rows are drawn on top).${hasStructureSheet(ctx.mode) ? ' The panel folds down to its header to give the plot more room.' : ''}`
      : '<strong>Click</strong> a row to hide or show its category, <strong>double-click</strong> to show only that one. Hover a row for its eye, its drag handle (higher rows are drawn on top) and <strong>⋯</strong> (<em>Show only this</em>, <em>Colour and shape</em>). Drag a category onto <strong>Other</strong> to merge it. The sort button in the header orders the rows; the sliders button opens <strong>Legend settings</strong>.',
    target: driverId('legend'),
  }),

  other: (ctx) => ({
    id: 'other',
    title: 'Expand Hidden Categories',
    description: `When an annotation has many values, the least frequent are grouped into <strong>Other</strong>. ${press(ctx)} <strong>View</strong> to list them, search them and add any back to the legend.`,
    target: { host: driverId('legend'), inner: driverId('other-row') },
  }),

  sidebar: (_ctx, kind) => ({
    id: 'sidebar',
    title: 'The Sidebar',
    description:
      kind === 'whats-new'
        ? '<strong>Legend</strong>, <strong>Structure</strong>, <strong>Filter</strong> and <strong>EAT</strong> (when the annotation has transferred labels) are now panels of the sidebar. Collapse it from this rail, drag its left edge to resize it, and pop the structure out to float it over the plot.'
        : "The rail switches the sidebar between <strong>Legend</strong>, <strong>Structure</strong> (a dot shows when a protein is loaded), <strong>Filter</strong> and <strong>EAT</strong> (when the annotation has transferred labels), and collapses the sidebar to give the plot the whole width. Drag the sidebar's left edge to resize it, and pop the structure out to float it over the plot.",
    target: driverId('rail'),
  }),

  theme: (_ctx, kind) => ({
    id: 'theme',
    title: 'Light or Dark',
    description:
      kind === 'whats-new'
        ? 'ProtSpace now has a dark theme. <strong>System</strong> follows your device; <strong>Light</strong> and <strong>Dark</strong> stay as you set them. Exports and figures stay light.'
        : '<strong>System</strong> follows your device; <strong>Light</strong> and <strong>Dark</strong> stay as you set them. The plot and the structure follow the theme; exports and figures are always light.',
    target: driverId('theme'),
  }),

  finish: (ctx) => ({
    id: 'finish',
    title: "You're All Set!",
    description: `You know the essentials. ${hasStructureSheet(ctx.mode) ? '<strong>More</strong> → <strong>Help &amp; shortcuts</strong>' : '<strong>Help</strong>'} has the keyboard shortcuts and plays this tour again. For more, read the ${link('/docs/', 'documentation')}. Happy exploring!`,
    target: null,
  }),

  end: (ctx) => ({
    id: 'end',
    title: "That's it",
    description: `That is what changed. For the whole tour, open ${tourHome(ctx)}.`,
    target: null,
  }),
};

/** Steps shown only at desktop widths, where the rail is. */
const desktopOnly = (mode: LayoutMode, ids: TourStepId[]): TourStepId[] =>
  mode === 'desktop' ? ids : [];

function stepIds(kind: TourKind, mode: LayoutMode): TourStepId[] {
  if (hasStructureSheet(mode)) {
    return kind === 'full'
      ? [
          'welcome',
          'dataset',
          'view-bar',
          'more',
          'search',
          'plot',
          'selection',
          'legend',
          'other',
          'finish',
        ]
      : ['whats-new', 'view-bar', 'more', 'legend', 'selection', 'end'];
  }
  return kind === 'full'
    ? [
        'welcome',
        'data',
        'view-bar',
        'search',
        'plot',
        'selection',
        'legend',
        'other',
        ...desktopOnly(mode, ['sidebar']),
        'theme',
        'finish',
      ]
    : ['whats-new', 'view-bar', ...desktopOnly(mode, ['sidebar']), 'selection', 'theme', 'end'];
}

/** The steps of `kind` for the window `ctx` describes, in order. */
export function tourSteps(kind: TourKind, ctx: TourContext): TourStepSpec[] {
  return stepIds(kind, ctx.mode).map((id) => STEPS[id](ctx, kind));
}
