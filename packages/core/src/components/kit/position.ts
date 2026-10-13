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
 * Beside an anchor (left or right), a panel too tall for the room slides along it rather than
 * flipping to grow from its far end, which would lift it over the app bar.
 */
export function anchorTo(
  anchor: Element,
  floating: HTMLElement,
  placement: Placement,
  gap = 6,
): () => void {
  const beside = placement.startsWith('left') || placement.startsWith('right');
  const update = () =>
    computePosition(anchor, floating, {
      placement,
      strategy: 'fixed',
      middleware: [
        offset(gap),
        flip({ padding: 8, flipAlignment: !beside }),
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
