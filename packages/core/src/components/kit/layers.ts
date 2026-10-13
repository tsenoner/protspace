/**
 * One stack of open layers (popovers, menus, dialogs, sheets, the figure editor, pinned panels) for
 * the whole page (design decision 11). Escape closes only the top layer, in the window's capture
 * phase, before any component sees the key. With no layer open, Escape first reaches the page's own
 * handlers; a handler that acts on it calls `preventDefault()` (or stops it). Then, in the window's
 * bubble phase, the registered fallbacks run in ascending `ESCAPE_ORDER` (EAT connectors, the
 * selection, the selection tool), and the first that handles it wins. So each press takes exactly
 * one step. A press that starts and ends outside the top layer closes it, so a drag that ends
 * outside closes nothing.
 */
export interface Layer {
  /** Closes the layer. The owner then calls the release function pushLayer returned. */
  close(): void;
  /** Elements that belong to the layer, including its anchor; a press on them is not outside. */
  readonly elements: readonly Element[];
  /** Close on a press that starts and ends outside the layer. Defaults to true. */
  readonly dismissOnOutsidePress?: boolean;
}

/** Order of the Escape fallbacks when no layer is open; lower runs first. */
export const ESCAPE_ORDER = { connectors: 10, selection: 20, tool: 30 } as const;

interface Fallback {
  readonly order: number;
  readonly handle: (event: KeyboardEvent) => boolean;
}

const stack: Layer[] = [];
const fallbacks: Fallback[] = [];
let pressStartedOutside = false;
let installed = false;

/** Opens a layer on top of the stack. Returns its release function, safe to call more than once. */
export function pushLayer(layer: Layer): () => void {
  install();
  stack.push(layer);
  return () => {
    const index = stack.indexOf(layer);
    if (index !== -1) stack.splice(index, 1);
  };
}

export function topLayer(): Layer | undefined {
  return stack[stack.length - 1];
}

/** Registers what Escape does when no layer is open. `handle` returns true when it acted. */
export function onEscapeFallback(
  order: number,
  handle: (event: KeyboardEvent) => boolean,
): () => void {
  install();
  const entry: Fallback = { order, handle };
  fallbacks.push(entry);
  fallbacks.sort((a, b) => a.order - b.order);
  return () => {
    const index = fallbacks.indexOf(entry);
    if (index !== -1) fallbacks.splice(index, 1);
  };
}

function isInside(layer: Layer, event: Event): boolean {
  const path = event.composedPath();
  return layer.elements.some((el) => path.includes(el));
}

/** Capture phase: the top layer takes Escape before anything else hears it. */
function onLayerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing) return;
  const top = topLayer();
  if (!top) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  top.close();
}

/** Bubble phase: no layer was open and no component handled the press. */
function onFallbackKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
  if (topLayer()) return;
  for (const fallback of [...fallbacks]) {
    if (fallback.handle(event)) {
      event.preventDefault();
      return;
    }
  }
}

function onPointerDown(event: Event): void {
  const top = topLayer();
  pressStartedOutside = !!top && top.dismissOnOutsidePress !== false && !isInside(top, event);
}

function onPointerUp(event: Event): void {
  const top = topLayer();
  const close = pressStartedOutside && !!top && !isInside(top, event);
  pressStartedOutside = false;
  if (close) top!.close();
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Capture on window runs before any component's own handler; the fallbacks wait for the bubble
  // phase, after every component had its chance to handle the press.
  window.addEventListener('keydown', onLayerKeydown, true);
  window.addEventListener('keydown', onFallbackKeydown);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);
}
