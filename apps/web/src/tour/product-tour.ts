/**
 * ProtSpace Product Tour
 *
 * Self-contained module that defines and drives an overview tour of the
 * Explore page using driver.js.  All step definitions live here so that
 * the rest of the codebase only needs to:
 *   1. add `data-driver-id="…"` attributes to the elements it wants to
 *      highlight, and
 *   2. call `startProductTour()`.
 *
 * For elements inside Shadow DOM (the legend's "Other" row) we use the
 * `() => Element` function form supported by driver.js, which resolves the
 * element lazily at step-activation time.
 */

import { type Config, driver, type DriveStep, type PopoverDOM, type State } from 'driver.js';
import { isMacOrIos } from '@protspace/utils';
import { getLayout, updateLayout } from '../explore/layout-state';
import './product-tour.css';
import { waitForElement } from './wait-for-element';
import { TOUR_STORAGE_KEY } from './storage-key';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Host selector for the legend custom element. */
const LEGEND = '[data-driver-id="legend"]';

// ---------------------------------------------------------------------------
// Driver instance (singleton)
// ---------------------------------------------------------------------------

const driverObj = driver();

// ---------------------------------------------------------------------------
// Shadow DOM helpers
// ---------------------------------------------------------------------------

/**
 * Resolve an element inside a host's Shadow DOM.
 * Returns `undefined` when the element cannot be found (driver.js treats
 * that as a centred popover with no highlight).
 */
function shadowEl(hostSelector: string, shadowSelector: string): Element | undefined {
  const host = document.querySelector(hostSelector);
  return host?.shadowRoot?.querySelector(shadowSelector) ?? undefined;
}

/**
 * Clean up driver.js classes/attributes that `document.querySelectorAll`
 * cannot reach inside Shadow DOM after a step is deselected.
 */
function cleanupShadowElement(element: Element | undefined) {
  if (!element) return;
  element.classList.remove('driver-active-element', 'driver-no-interaction');
  element.removeAttribute('aria-haspopup');
  element.removeAttribute('aria-expanded');
  element.removeAttribute('aria-controls');
}

// ---------------------------------------------------------------------------
// Help spotlight (step 1)
// ---------------------------------------------------------------------------

/** The app bar's Help button, where the tour and the shortcuts live. */
const HELP = '[data-driver-id="help"]';

/**
 * Add or remove a visual spotlight on the Help button. Used during the centred welcome step so
 * the user can see where to find the tour later, even though the popover is not attached to it.
 *
 * The glow goes on the `<button>` inside `<ps-icon-button>`'s shadow DOM (not the host), so it
 * follows the button's rounded shape. Lifting the host above the overlay works because the app
 * bar creates no stacking context.
 */
function spotlightHelp(on: boolean) {
  const host = document.querySelector(HELP);
  if (!(host instanceof HTMLElement)) return;
  const button = host.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLElement)) return;

  if (on) {
    // Lift the host above the driver.js overlay (z-index ~100000)
    host.style.zIndex = '100001';
    // Glow on the rounded button so there are no corner artifacts
    button.style.boxShadow = '0 0 0 3px #00a3e0, 0 0 12px rgba(0, 163, 224, 0.5)';
    button.style.transition = 'box-shadow 0.3s ease';
  } else {
    host.style.removeProperty('z-index');
    button.style.removeProperty('box-shadow');
    button.style.removeProperty('transition');
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

const moveNext = async (driverOpts: { config: Config; state: State }) => {
  if (driverObj.hasNextStep() && driverOpts.config.steps) {
    const stepIndex = driverObj.getActiveIndex() ?? 0;
    const nextStep = driverOpts.config.steps[stepIndex + 1];

    if (nextStep && typeof nextStep.element === 'string') {
      await waitForElement(nextStep.element).catch(() => {
        /* element may already be visible – continue anyway */
      });
    }

    driverObj.moveNext();
  }
};

const movePrevious = async (driverOpts: { config: Config; state: State }) => {
  if (driverObj.hasPreviousStep() && driverOpts.config.steps) {
    const stepIndex = driverObj.getActiveIndex() ?? 0;
    const previousStep = driverOpts.config.steps[stepIndex - 1];

    if (previousStep && typeof previousStep.element === 'string') {
      await waitForElement(previousStep.element).catch(() => {
        /* continue anyway */
      });
    }
  }

  driverObj.movePrevious();
};

// ---------------------------------------------------------------------------
// Popover render hook (shared)
// ---------------------------------------------------------------------------

const onPopoverRenderBase = (popover: PopoverDOM) => {
  setTimeout(() => {
    popover.wrapper.addEventListener('click', (e) => e.stopPropagation());
    // Prevent the close button from being automatically focused
    popover.closeButton?.blur();
  }, 5);
};

// ---------------------------------------------------------------------------
// Shadow-DOM step helper
// ---------------------------------------------------------------------------

/** Build a Shadow DOM step targeting a `data-driver-id` attribute. */
function shadowStep(host: string, driverId: string, popover: DriveStep['popover']): DriveStep {
  const selector = `[data-driver-id="${driverId}"]`;
  return {
    element: () => shadowEl(host, selector) as Element,
    popover: {
      ...popover,
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
    onDeselected: () => cleanupShadowElement(shadowEl(host, selector)),
  };
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const steps: DriveStep[] = [
  // ── Step 1 – Welcome (centred, ? icon spotlighted) ──────────
  {
    popover: {
      title: 'Welcome to ProtSpace',
      description:
        'This short tour will walk you through the main features. You can skip it anytime\u2009—\u2009look for the highlighted <strong>?</strong> icon to replay it later or see shortcuts.',
      nextBtnText: 'Start Tour',
      showButtons: ['close', 'next'],
      onPopoverRender: (popover) => {
        onPopoverRenderBase(popover);

        // Add a "Skip" button before "Start Tour"
        const skipButton = document.createElement('button');
        skipButton.innerText = 'Skip';
        skipButton.className = 'driver-tour-skip-btn';
        skipButton.addEventListener('click', () => {
          spotlightHelp(false);
          driverObj.destroy();
        });
        popover.nextButton.insertAdjacentElement('beforebegin', skipButton);

        // Spotlight Help so the user knows where to find the tour again
        spotlightHelp(true);
      },
      // driver.js skips `onDeselected` when the step is left during its 400 ms highlight
      // transition, so Next and Skip clear the spotlight themselves; `onDestroyStarted` covers
      // every other way out.
      onNextClick: async (_el, _step, opts) => {
        spotlightHelp(false);
        await moveNext(opts);
      },
    },
  },

  // ── Step 2 – Import menu (app bar) ──────────────────────────
  {
    element: '[data-driver-id="import"]',
    popover: {
      title: 'Import Your Data',
      description:
        'Click <strong>Import</strong> or drag-and-drop a file onto the canvas. A <code>.parquetbundle</code> loads entirely in your browser; a <code>.fasta</code> is uploaded to our server to be prepared first. No data yet? Pick one of the <strong>Examples</strong> in the Import menu. <a href="/docs/guide/data-preparation" target="_blank" rel="noopener">Learn how to prepare your data<svg class="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>.',
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },

  // ── Step 3 – Projections & Annotations (view bar) ────────────
  {
    element: '[data-driver-id="projections"]',
    popover: {
      title: 'Projections & Annotations',
      description:
        'Switch between <strong>projections</strong> (UMAP, PCA, etc.) and choose which <strong>annotation</strong> to color the points by. <strong>Filter</strong> (in the same bar) opens a query builder for combining annotation conditions with AND/OR logic.',
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },

  // ── Step 4 – Search (app bar) ───────────────────────────────
  {
    element: '[data-driver-id="search"]',
    popover: {
      title: 'Search Proteins',
      description: `Press <kbd><span class="mod-key">${isMacOrIos() ? '⌘' : 'Ctrl+'}</span>K</kbd> or click here to search. Type a protein ID to find it instantly, or <strong>paste</strong> multiple IDs to select them all at once.`,
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },

  // ── Step 5 – Selection Tools (plot tool strip) ─────────────
  {
    element: '[data-driver-id="selection"]',
    popover: {
      title: 'Selection Tools',
      description:
        '<strong>Box select</strong> and <strong>Lasso select</strong> select the points you drag around; <strong>Move and zoom</strong> pans again, and <strong>Fit to view</strong> shows every point. Press <kbd>Esc</kbd> to clear the current selection; press it again to return to Move and zoom.<br><br>With a selection, <strong>Clear</strong> deselects all and <strong>Isolate</strong> focuses on the selected proteins; <strong>Reset</strong> restores the full dataset.',
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },

  // ── Step 6 – Export & Import (app bar) ──────────────────────
  {
    element: '[data-driver-id="data-actions"]',
    popover: {
      title: 'Export & Import',
      description:
        '<strong>Export</strong> opens the <strong>Figure Editor</strong> for publication-ready figures with journal presets, overlays, zoom insets, and legend customization — or use <strong>Quick Export</strong> for a fast PNG, PDF, protein IDs, or <code>.parquetbundle</code> dump. <strong>Import</strong> uploads a new dataset or loads one of the built-in examples.',
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },

  // ── Step 7 – Scatterplot ────────────────────────────────────
  {
    element: '[data-driver-id="scatterplot"]',
    popover: {
      title: 'Interactive Scatterplot',
      description: `Each point represents a protein. <strong>Hover</strong> over a point to see its details. <strong>Pan</strong> by dragging, <strong>zoom</strong> with the mouse wheel, and <strong>click</strong> a point to view its 3D structure (when available). Hold <kbd><span class="mod-key">${isMacOrIos() ? '⌘' : 'Ctrl'}</span>+Click</kbd> to toggle a point in or out of the current selection.`,
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },

  // ── Step 8 – Legend ─────────────────────────────────────────
  {
    element: '[data-driver-id="legend"]',
    popover: {
      title: 'Legend Panel',
      description:
        '<strong>Click</strong> to hide/show, <strong>double-click</strong> to isolate a category. Drag <kbd><svg style="vertical-align:middle;display:inline" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 8h16M4 16h16"/></svg></kbd> to reorder\u2009—\u2009higher items are drawn on top.<br><br>Click a color swatch to change colors or shapes. Drag a category onto <strong>Other</strong> to merge it. Use <kbd><svg style="vertical-align:middle;display:inline" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4m6-2v12m0 0l4-4m-4 4l-4-4"/></svg></kbd> to reverse sort order or <kbd><svg style="vertical-align:middle;display:inline" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/></svg></kbd> for advanced settings.',
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: async (_el, _step, opts) => moveNext(opts),
    },
  },

  // ── Step 9 – Expand hidden categories (Shadow DOM in legend)
  shadowStep(LEGEND, 'other-row', {
    title: 'Expand Hidden Categories',
    description:
      'When there are many annotation values, the least frequent are grouped into <strong>Other</strong>. Click <strong>(view)</strong> to see them and <strong>extract</strong> individual items back into the legend.',
  }),

  // ── Step 10 – Finish (centred, no element) ──────────────────
  {
    popover: {
      title: "You're All Set!",
      description:
        'You now know the essentials. Remember, the <strong>?</strong> icon has shortcuts and a link to replay this tour. For more details, visit the <a href="/docs/" target="_blank" rel="noopener">documentation<svg class="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>. Happy exploring!',
      showButtons: ['close', 'previous', 'next'],
      nextBtnText: 'Finish',
      onPrevClick: async (_el, _step, opts) => movePrevious(opts),
      onNextClick: () => driverObj.destroy(),
    },
  },
];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

driverObj.setConfig({
  showProgress: true,
  disableActiveInteraction: true,
  overlayColor: '#334155',
  overlayOpacity: 0.5,
  stagePadding: 8,
  stageRadius: 8,

  doneBtnText: 'Finish',
  nextBtnText: 'Next',
  prevBtnText: 'Back',

  onPopoverRender: onPopoverRenderBase,

  // Every user close (the close button, Escape, an overlay click) comes through here, even during
  // a step's highlight transition, when driver.js skips `onDeselected` and `onDestroyed`.
  onDestroyStarted: () => {
    spotlightHelp(false);
    driverObj.destroy();
  },

  steps,
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface ProductTourOptions {
  /** When `true` the tour starts regardless of localStorage state. */
  force?: boolean;
}

/**
 * Start the ProtSpace overview tour.
 *
 * By default the tour only runs once (tracked via `localStorage`).
 * Pass `{ force: true }` to bypass the localStorage guard (e.g. when the
 * user explicitly clicks "Take a Tour").
 */
export function startProductTour(options: ProductTourOptions = {}) {
  const hasCompleted = localStorage.getItem(TOUR_STORAGE_KEY) === 'true';

  if (!options.force && hasCompleted) {
    return;
  }

  // Mark as completed immediately so it won't auto-start again even if the
  // user closes the tour early.
  localStorage.setItem(TOUR_STORAGE_KEY, 'true');

  // The legend steps need the sidebar open; its slide ends long before they come.
  if (!getLayout().sidebarOpen) updateLayout({ sidebarOpen: true });
  driverObj.drive();
}
