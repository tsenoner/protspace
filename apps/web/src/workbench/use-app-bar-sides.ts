import { useEffect, type RefObject } from 'react';

/**
 * Keeps search centred in the app bar (workbench.css): sets `--wb-app-bar-side` on the bar to the
 * wider side's content width, so search narrows until both side columns can share that width.
 * Both sides are sized to their content, so writing the property never resizes what is observed.
 */
export function useAppBarSides(barRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const sides = Array.from(
      bar.querySelectorAll<HTMLElement>(
        ":scope > [data-workbench='app-bar-start'], :scope > [data-workbench='app-bar-actions']",
      ),
    );
    const observer = new ResizeObserver(() => {
      const widest = Math.max(...sides.map((side) => side.getBoundingClientRect().width));
      bar.style.setProperty('--wb-app-bar-side', `${Math.ceil(widest)}px`);
    });
    for (const side of sides) observer.observe(side);
    return () => observer.disconnect();
  }, [barRef]);
}
