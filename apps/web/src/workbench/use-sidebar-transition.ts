import { useLayoutEffect, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { SidebarPhase } from './layout-geometry';

interface SlideTargets {
  aside: RefObject<HTMLElement | null>;
  /** The structure section while it sits in the sidebar column (not floating). */
  structure: RefObject<HTMLElement | null>;
}

/** The theme's panel duration and easing (design decision 8), read where theme.ts sets them. */
function slideTiming(): KeyframeAnimationOptions {
  const style = getComputedStyle(document.documentElement);
  // No fallback: a missing --ps-duration makes animate() throw, which the e2e suite catches.
  return {
    duration: Number.parseFloat(style.getPropertyValue('--ps-duration')),
    easing: style.getPropertyValue('--ps-ease').trim(),
  };
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The sidebar's slide (design decision 4). Opening reports 'opening' (the sidebar shows over the
 * plot and slides in) and then 'open', which narrows the plot; closing reports 'closing' at once,
 * which widens the plot under the still-shown sidebar, then slides it out before 'collapsed'.
 * Either way the plot's box changes once (see plotRightInset).
 *
 * Off desktop (`animate` false) the sidebar is the panel under the plot: it never slides, and the
 * phase follows `open` at once.
 *
 * The slide is a Web Animation without fill, so no transform stays on the sidebar at rest: the
 * legend's fixed-position dialogs need an ancestor without one. The phase follows
 * `Animation.finished`, never `transitionend`, which a 0 ms transition does not fire; under
 * reduced motion there is no slide and the phase settles at once, in the same order.
 */
export function useSidebarTransition(
  open: boolean,
  targets: SlideTargets,
  animate: boolean,
): SidebarPhase {
  const [phase, setPhase] = useState<SidebarPhase>(open ? 'open' : 'collapsed');
  const [shownOpen, setShownOpen] = useState(open);
  const settled: SidebarPhase = open ? 'open' : 'collapsed';
  if (open !== shownOpen) {
    // React's "adjust state while rendering": the phase moves in the same render as `open`.
    setShownOpen(open);
    if (!animate || prefersReducedMotion()) setPhase(settled);
    else setPhase(open ? 'opening' : 'closing');
  } else if (!animate && phase !== settled) {
    // The window left desktop in mid-slide: settle at once, with no slide off desktop.
    setPhase(settled);
  }

  const { aside, structure } = targets;
  useLayoutEffect(() => {
    if (!animate || (phase !== 'opening' && phase !== 'closing')) return;
    const done: SidebarPhase = phase === 'opening' ? 'open' : 'collapsed';
    // Off to the right by its own width, under the rail.
    const away: Keyframe = { transform: 'translateX(100%)' };
    const rest: Keyframe = { transform: 'none' };
    const timing = slideTiming();
    const animations = [aside.current, structure.current]
      .filter((element): element is HTMLElement => element !== null)
      .map((element) => element.animate(phase === 'opening' ? [away, rest] : [rest, away], timing));
    let cancelled = false;
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        // Commit before the frame paints the sidebar back at rest (the animation has no fill).
        if (!cancelled) flushSync(() => setPhase(done));
      },
      () => {
        // Cancelled: a toggle in mid-slide or an unmount; the next phase owns the sidebar now.
      },
    );
    return () => {
      cancelled = true;
      for (const animation of animations) animation.cancel();
    };
  }, [phase, aside, structure, animate]);

  return phase;
}
