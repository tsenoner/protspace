import { useLayoutEffect, type RefObject } from 'react';
import type { FloatingRect } from '../explore/layout-defaults';
import { updateLayout } from '../explore/layout-state';
import { clampFloatRect, floatStep } from './layout-geometry';
import { useLayout } from './use-layout';
import { useLayoutMode } from './use-layout-mode';

/** Whether a press starts on the viewer's header, away from its buttons and links. */
function pressesHeader(event: PointerEvent): boolean {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    if (target.matches('a, button, input, select, textarea, [role="button"]')) return false;
    if (target.part.contains('header')) return true;
  }
  return false;
}

interface Gesture {
  kind: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  start: FloatingRect;
}

const FLOAT_PROPERTIES = ['--wb-float-x', '--wb-float-y', '--wb-float-w', '--wb-float-h'];

/**
 * Moves the floating structure card by the viewer's header and resizes it from its corner grip;
 * the arrow keys do the same on the focused card and grip (design decision 2). The card stays
 * inside the plot area, also when the plot area shrinks, without rewriting the stored rect; the
 * layout is written once per gesture, on release or keyup. Only the section's --wb-float-*
 * properties change: the plot's box never does, and the viewer is never re-parented.
 */
export function useFloatingCard(
  sectionRef: RefObject<HTMLElement | null>,
  plotRef: RefObject<HTMLElement | null>,
): void {
  const layout = useLayout();
  const floating = useLayoutMode() === 'desktop' && layout.structurePlacement === 'floating';
  const stored = layout.floatingRect;

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const plot = plotRef.current;
    if (!floating || !section || !plot) return;

    const bounds = () => ({ width: plot.clientWidth, height: plot.clientHeight });
    const grip = () => section.querySelector<HTMLElement>('[data-workbench="float-grip"]');
    let rect = clampFloatRect(stored, bounds());
    let gesture: Gesture | null = null;
    let keyed = false;

    const paint = (next: FloatingRect) => {
      rect = next;
      section.style.setProperty('--wb-float-x', `${next.x}px`);
      section.style.setProperty('--wb-float-y', `${next.y}px`);
      section.style.setProperty('--wb-float-w', `${next.width}px`);
      section.style.setProperty('--wb-float-h', `${next.height}px`);
    };
    const commit = () =>
      updateLayout({
        structurePlacement: 'floating',
        floatingRect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    // Resizing keeps the top-left corner where it is.
    const resized = (from: FloatingRect, width: number, height: number) => {
      const area = bounds();
      return clampFloatRect(
        {
          ...from,
          width: Math.min(width, area.width - from.x),
          height: Math.min(height, area.height - from.y),
        },
        area,
      );
    };
    const moved = (from: FloatingRect, dx: number, dy: number) =>
      clampFloatRect({ ...from, x: from.x + dx, y: from.y + dy }, bounds());

    paint(rect);
    // The window and the sidebar resize the plot area: keep the stored card inside it.
    const observer = new ResizeObserver(() => {
      if (!gesture) paint(clampFloatRect(stored, bounds()));
    });
    observer.observe(plot);

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const handle = grip();
      const kind =
        handle && event.composedPath().includes(handle)
          ? 'resize'
          : pressesHeader(event)
            ? 'move'
            : null;
      if (!kind) return;
      event.preventDefault();
      section.setPointerCapture(event.pointerId);
      gesture = {
        kind,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        start: rect,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      const { start } = gesture;
      paint(
        gesture.kind === 'move'
          ? moved(start, dx, dy)
          : resized(start, start.width + dx, start.height + dy),
      );
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture = null;
      commit();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const { dx, dy } = floatStep(event.key, event.shiftKey);
      if (dx === 0 && dy === 0) return;
      const handle = grip();
      const resizing = handle !== null && event.target === handle;
      // Only the card itself or its grip: keys inside the viewer belong to the viewer.
      if (!resizing && event.target !== section) return;
      event.preventDefault();
      keyed = true;
      paint(resizing ? resized(rect, rect.width + dx, rect.height + dy) : moved(rect, dx, dy));
    };
    const onKeyUp = () => {
      if (!keyed) return;
      keyed = false;
      commit();
    };

    section.addEventListener('pointerdown', onPointerDown);
    section.addEventListener('pointermove', onPointerMove);
    section.addEventListener('pointerup', onPointerEnd);
    section.addEventListener('pointercancel', onPointerEnd);
    section.addEventListener('lostpointercapture', onPointerEnd);
    section.addEventListener('keydown', onKeyDown);
    section.addEventListener('keyup', onKeyUp);
    return () => {
      observer.disconnect();
      section.removeEventListener('pointerdown', onPointerDown);
      section.removeEventListener('pointermove', onPointerMove);
      section.removeEventListener('pointerup', onPointerEnd);
      section.removeEventListener('pointercancel', onPointerEnd);
      section.removeEventListener('lostpointercapture', onPointerEnd);
      section.removeEventListener('keydown', onKeyDown);
      section.removeEventListener('keyup', onKeyUp);
      for (const name of FLOAT_PROPERTIES) section.style.removeProperty(name);
    };
  }, [floating, stored, sectionRef, plotRef]);
}
