import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
  type Placement,
} from '@floating-ui/dom';

export type { Placement };

/**
 * Keeps a top-layer element next to its anchor until the returned function runs. Fixed
 * positioning is what a top-layer element needs; flip and shift keep it on screen, and size
 * publishes the room left as `--available-height` so a tall panel can cap its height and scroll.
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
      middleware: [
        offset(gap),
        flip({ padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply: ({ availableHeight }) =>
            floating.style.setProperty('--available-height', `${Math.max(0, availableHeight)}px`),
        }),
      ],
    }).then(({ x, y }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
    });
  return autoUpdate(anchor, floating, update);
}
