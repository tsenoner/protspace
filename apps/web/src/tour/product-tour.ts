/**
 * The ProtSpace product tour (design decisions 1, 11, 16 and 17; the Migration Plan). The steps are
 * data (`tour-steps.ts`); this module builds the list for the window when a tour starts, drops a
 * step whose target is not on screen, and drives the rest with driver.js. The runtime and the Help
 * menu import it lazily, so driver.js and its CSS stay out of the explore chunk.
 *
 * The Other row lives in the legend's shadow root: its step uses driver.js's `() => Element` form,
 * resolved when the step activates, and cleans up what `document.querySelectorAll` cannot reach.
 */

import { type Config, driver, type DriveStep, type PopoverDOM, type State } from 'driver.js';
// The kit entry, not '@protspace/core': Help imports this module from the shell, and a value
// import of core there would load all of core early (eslint.config.mjs:81-84). kit.mjs and
// core.mjs share one kit chunk, so there is one layer stack.
import { pushLayer } from '@protspace/core/kit';
import { isMacOrIos } from '@protspace/utils';
import { getLayoutMode, subscribeLayoutMode } from '../explore/layout-mode';
import { openPanel } from '../explore/layout-state';
import './product-tour.css';
import { TOUR_STORAGE_KEY, type TourKind } from './storage-key';
import { tourSteps, type TourStepSpec } from './tour-steps';
import { waitForElement } from './wait-for-element';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const COARSE_POINTER = '(pointer: coarse)';
/** The attributes driver.js sets on a highlighted element and removes when it moves on. */
const ARIA_STATE = ['aria-haspopup', 'aria-expanded', 'aria-controls'] as const;

const driverObj = driver();

/** What a running tour holds: its Escape layer and its layout-mode listener. */
let running: { release: () => void; unsubscribe: () => void } | null = null;
/** The control the first step lifted above the overlay, until that step is left. */
let spotlit: string | null = null;
/** Each light-DOM target's own aria state, put back when driver.js leaves it. */
let savedAria: Array<{ element: Element; values: Array<string | null> }> = [];
/** The running tour's targets inside a shadow root, which driver.js cannot unlight. */
let shadowTargets: Array<{ host: string; inner: string }> = [];
/** Bumped by every start: a start superseded while its layout settles never drives. */
let startCount = 0;

// ---------------------------------------------------------------------------
// Shadow DOM
// ---------------------------------------------------------------------------

/** An element inside a host's shadow root, or undefined (a dropped or centred step). */
function shadowEl(hostSelector: string, innerSelector: string): Element | undefined {
  const host = document.querySelector(hostSelector);
  return host?.shadowRoot?.querySelector(innerSelector) ?? undefined;
}

/** What driver.js cannot remove inside a shadow root after a step is deselected. */
function cleanupShadowElement(element: Element | undefined): void {
  if (!element) return;
  element.classList.remove('driver-active-element', 'driver-no-interaction');
  for (const name of ARIA_STATE) element.removeAttribute(name);
}

// ---------------------------------------------------------------------------
// Spotlight (the first step)
// ---------------------------------------------------------------------------

/**
 * Lifts the control where the tour lives (Help, or More on a phone) above the overlay and outlines
 * it, while the centred first step shows. A kit button glows on its inner `<button>`, so the ring
 * follows its rounded shape; a plain element glows itself. Lifting the host works because the bars
 * create no stacking context.
 */
function setSpotlight(selector: string, on: boolean): void {
  const host = document.querySelector<HTMLElement>(selector);
  if (!host) return;
  const glow = host.shadowRoot?.querySelector<HTMLElement>('button') ?? host;
  if (on) {
    // Above the driver.js overlay (z-index ~100000); the focus token follows the theme.
    host.style.zIndex = '100001';
    glow.style.boxShadow = '0 0 0 3px var(--ps-focus)';
    glow.style.transition = 'box-shadow 0.3s ease';
  } else {
    host.style.removeProperty('z-index');
    glow.style.removeProperty('box-shadow');
    glow.style.removeProperty('transition');
  }
}

function clearSpotlight(): void {
  if (spotlit !== null) setSpotlight(spotlit, false);
  spotlit = null;
}

// ---------------------------------------------------------------------------
// Aria state
// ---------------------------------------------------------------------------

function saveAria(steps: readonly TourStepSpec[]): void {
  savedAria = steps.flatMap((step) => {
    if (typeof step.target !== 'string') return [];
    const element = document.querySelector(step.target);
    return element
      ? [{ element, values: ARIA_STATE.map((name) => element.getAttribute(name)) }]
      : [];
  });
}

/**
 * driver.js unlights only the element it recorded when the last highlight finished, so a step left
 * during its highlight transition (a quick Next) stays lit. Once a highlight finishes, every other
 * target is unlit, the Other row inside the legend's shadow root too.
 */
function unlightOthers(active: Element | undefined): void {
  document.querySelectorAll('.driver-active-element').forEach((element) => {
    if (element !== active && element.id !== 'driver-dummy-element') {
      element.classList.remove('driver-active-element', 'driver-no-interaction');
    }
  });
  for (const { host, inner } of shadowTargets) {
    const element = shadowEl(host, inner);
    if (element !== active) cleanupShadowElement(element);
  }
}

/** Puts back every saved target's own attributes, except on the element highlighted now. */
function restoreAria(active?: Element): void {
  for (const { element, values } of savedAria) {
    if (element === active) continue;
    ARIA_STATE.forEach((name, index) => {
      const value = values[index];
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    });
  }
}

/**
 * driver.js anchors a centred step to its own invisible 0×0 `#driver-dummy-element` and marks it as
 * a popup button, which a plain `<div>` may not be (axe aria-allowed-attr).
 */
function stripDummyAria(): void {
  const dummy = document.getElementById('driver-dummy-element');
  for (const name of ARIA_STATE) dummy?.removeAttribute(name);
}

// ---------------------------------------------------------------------------
// Ending
// ---------------------------------------------------------------------------

/** Every way out: Skip, Finish, the close button, the overlay, Escape and a layout change. */
function endTour(): void {
  clearSpotlight();
  running?.release();
  running?.unsubscribe();
  running = null;
  driverObj.destroy();
  restoreAria();
  savedAria = [];
  shadowTargets = [];
}

// ---------------------------------------------------------------------------
// Navigation
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
// Steps
// ---------------------------------------------------------------------------

const onPopoverRender = (popover: PopoverDOM): void => {
  // driver.js marks the dummy anchor right after this hook returns, on the first step.
  queueMicrotask(stripDummyAria);
  setTimeout(() => {
    popover.wrapper.addEventListener('click', (event) => event.stopPropagation());
    // Keep the close button from being focused automatically.
    popover.closeButton?.blur();
  }, 5);
};

function footerButton(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

/** A step when it is on screen now: centred, or a target with a box. */
function isShown(target: TourStepSpec['target']): boolean {
  if (target === null) return true;
  const element =
    typeof target === 'string'
      ? document.querySelector(target)
      : shadowEl(target.host, target.inner);
  if (!element) return false;
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

function toDriveStep(spec: TourStepSpec, index: number, count: number, kind: TourKind): DriveStep {
  const last = index === count - 1;
  const popover: NonNullable<DriveStep['popover']> = {
    title: spec.title,
    description: spec.description,
    onPrevClick: async (_element, _step, options) => movePrevious(options),
    onNextClick: last
      ? () => endTour()
      : async (_element, _step, options) => {
          // driver.js skips onDeselected when a step is left during its highlight transition, so
          // Next clears the first step's spotlight itself; endTour covers every other way out.
          clearSpotlight();
          await moveNext(options);
        },
  };

  if (index === 0) {
    popover.showButtons = ['close', 'next'];
    popover.nextBtnText = 'Start Tour';
    popover.onPopoverRender = (dom) => {
      onPopoverRender(dom);
      dom.nextButton.insertAdjacentElement(
        'beforebegin',
        footerButton('Skip', 'driver-tour-skip-btn', endTour),
      );
      if (kind === 'whats-new') {
        dom.nextButton.insertAdjacentElement(
          'beforebegin',
          footerButton('Full tour', 'driver-tour-full-btn', () => {
            endTour();
            startTour('full', { force: true });
          }),
        );
      }
      if (spec.spotlight) {
        setSpotlight(spec.spotlight, true);
        spotlit = spec.spotlight;
      }
    };
  }
  if (last) {
    popover.showButtons = ['close', 'previous', 'next'];
    popover.nextBtnText = 'Finish';
  }

  const step: DriveStep = { popover };
  const { target } = spec;
  if (typeof target === 'string') {
    step.element = target;
  } else if (target) {
    step.element = () => shadowEl(target.host, target.inner) as Element;
    step.onDeselected = () => cleanupShadowElement(shadowEl(target.host, target.inner));
  }
  return step;
}

const BASE_CONFIG: Config = {
  showProgress: true,
  disableActiveInteraction: true,
  // driver.js sets the overlay path's `style.fill` to this string, so a token works; the scrim
  // carries its own alpha (light 0.45, dark 0.65), hence opacity 1.
  overlayColor: 'var(--ps-scrim)',
  overlayOpacity: 1,
  stagePadding: 8,
  stageRadius: 8,

  doneBtnText: 'Finish',
  nextBtnText: 'Next',
  prevBtnText: 'Back',

  onPopoverRender,
  onHighlighted: (element) => {
    stripDummyAria();
    unlightOthers(element);
    restoreAria(element);
  },
  // Every user close (the close button, an overlay click) comes through here, even during a
  // step's highlight transition, when driver.js skips `onDeselected` and `onDestroyed`.
  onDestroyStarted: () => endTour(),
};

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

/** The recorded kind; undefined when storage cannot be read (blocked site data). */
function readSeen(): string | null | undefined {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY);
  } catch {
    return undefined;
  }
}

function writeSeen(kind: TourKind): boolean {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, kind);
    return true;
  } catch {
    return false;
  }
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

function drive(kind: TourKind): void {
  const steps = tourSteps(kind, {
    mode: getLayoutMode(),
    coarse: matchMedia(COARSE_POINTER).matches,
    mac: isMacOrIos(),
  }).filter((step) => isShown(step.target));
  if (steps.length === 0) return;

  saveAria(steps);
  shadowTargets = steps.flatMap((step) =>
    step.target !== null && typeof step.target !== 'string' ? [step.target] : [],
  );
  driverObj.setConfig({
    ...BASE_CONFIG,
    animate: !matchMedia(REDUCED_MOTION).matches,
    steps: steps.map((step, index) => toDriveStep(step, index, steps.length, kind)),
  });
  running = {
    // Escape closes the tour and nothing else (decision 11). driver.js closes on keyup, after the
    // page's keydown handlers would already have cleared a selection.
    release: pushLayer({
      close: endTour,
      get elements() {
        const popover = document.querySelector('.driver-popover');
        return popover ? [popover] : [];
      },
      dismissOnOutsidePress: false,
    }),
    // A step list fits one layout: rotating a phone or resizing across a breakpoint ends the tour.
    unsubscribe: subscribeLayoutMode(endTour),
  };
  driverObj.drive();
}

/**
 * Starts the `kind` tour at its first step. Unforced (the first-visit start), it runs only when no
 * tour was recorded and the record can be written, so blocked storage never replays it; forced
 * (Help → Take the tour, the Full tour button) it always runs. The key is written as the kind when
 * the tour starts, so closing it early counts as seen.
 */
export function startTour(kind: TourKind, options: { force?: boolean } = {}): void {
  if (!options.force && readSeen() !== null) return;
  if (!writeSeen(kind) && !options.force) return;
  if (running) endTour();

  // The legend steps need the legend on screen: the sidebar open on the Legend panel, a phone's
  // panel unfolded. openPanel writes nothing when they already are.
  openPanel('legend');
  const start = ++startCount;
  // React commits that layout on its next render: measure the targets two frames later.
  void nextFrame()
    .then(() => nextFrame())
    .then(() => {
      if (start === startCount) drive(kind);
    });
}
