/**
 * The files that stand in for entries not yet recaptured since every docs image became a light and
 * dark pair and every animation a looping video: a light-only screenshot (`name.png`), or the old
 * light GIF (`name.gif`). Until `pnpm docs:images` recaptures an entry, the lint accepts its
 * stand-in in place of the entry's outputs, shown alone, and nothing else. Remove a file from the
 * list when its entry is recaptured and its page shows the new pair or video; delete this module
 * and its uses once the list is empty.
 *
 * Pure data, so the hook's lint and the app's Vitest both read it.
 */
export const AWAITING_RECAPTURE: readonly string[] = [
  // Screenshots, light only.
  'color-by-menu.png',
  'contours-menu.png',
  'export-menu.png',
  'search-messages.png',
  'scatterplot-contours.png',
  'eat-annotation-badge.png',
  'eat-filter-row.png',
  'eat-phone.png',
  'figure-editor-presets.png',
  'figure-editor-overlays.png',
  'figure-editor-zoom-inset.png',
  'scatterplot-example.png',
  'tablet-layout.png',
  'examples/demo.png',
  'examples/three-finger-toxins.png',
  'examples/human-fly.png',
  'examples/beta-lactamase.png',
  'examples/swissprot.png',
  // Animations, still GIFs.
  'select-single.gif',
  'select-box.gif',
  'duplicate-badges.gif',
  'legend-toggle.gif',
  'legend-reorder.gif',
  'legend-others.gif',
  'sidebar-fold-resize.gif',
  'eat-range-hide.gif',
  'eat-range-fade.gif',
  'eat-check.gif',
  'eat-connectors.gif',
];
