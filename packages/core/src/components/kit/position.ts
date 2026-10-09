import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';

export type { Placement };

/**
 * Keeps a top-layer element next to its anchor until the returned function runs. Fixed
 * positioning is what a top-layer element needs; flip and shift keep it on screen.
 */
export function anchorTo(
  anchor: Element,
  floating: HTMLElement,
  placement: Placement,
  gap = 6,
): () => void {
  const update = () =>
    computePosition(anchor, floating, {
      placement,
      strategy: 'fixed',
      middleware: [offset(gap), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
    });
  return autoUpdate(anchor, floating, update);
}
