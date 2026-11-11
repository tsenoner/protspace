/** The focused element, looking through open shadow roots. */
export function deepActiveElement(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el as HTMLElement | null;
}

/**
 * Whether `node` renders inside `container`, following slot assignments and shadow hosts. A menu
 * item slotted through ps-menu into ps-popover is inside the popover, though not its DOM child.
 */
export function flatContains(container: Node, node: Node | null): boolean {
  while (node) {
    if (node === container) return true;
    node = (node as Element).assignedSlot ?? node.parentNode ?? (node as ShadowRoot).host ?? null;
  }
  return false;
}
