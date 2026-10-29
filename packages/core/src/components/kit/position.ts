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

const OPPOSITE_SIDE = { left: 'right', right: 'left' } as const;

/**
 * Beside an anchor: the other side, then below, then above, each with the same alignment. A
 * full-width row on a phone leaves no room on either side, so the panel goes under it.
 */
function besideFallbacks(placement: Placement): Placement[] {
  const [side, align] = placement.split('-') as ['left' | 'right', string | undefined];
  const suffix = align ? `-${align}` : '';
  return [`${OPPOSITE_SIDE[side]}${suffix}`, `bottom${suffix}`, `top${suffix}`] as Placement[];
}

/**
 * Keeps a top-layer element next to its anchor until the returned function runs. Fixed
 * positioning is what a top-layer element needs; flip and shift keep it on screen, and size
 * publishes the room left as `--available-height` and `--available-width` so a large panel can
 * cap itself and scroll.
 * Beside an anchor (left or right), a panel too tall for the room slides along it rather than
 * flipping to grow from its far end, which would lift it over the app bar. Only when neither side
 * has room does it fall below or above the anchor; as a last resort it shifts across the anchor
 * rather than leave the screen.
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
        beside
          ? // Only the side's own axis decides: a tall panel overflowing below still fits beside.
            flip({ padding: 8, crossAxis: false, fallbackPlacements: besideFallbacks(placement) })
          : flip({ padding: 8 }),
        shift({ padding: 8, crossAxis: beside }),
        size({
          padding: 8,
          apply: ({ availableHeight, availableWidth }) => {
            floating.style.setProperty('--available-height', `${Math.max(0, availableHeight)}px`);
            floating.style.setProperty('--available-width', `${Math.max(0, availableWidth)}px`);
          },
        }),
      ],
    }).then(({ x, y }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
    });
  return autoUpdate(anchor, floating, update);
}
