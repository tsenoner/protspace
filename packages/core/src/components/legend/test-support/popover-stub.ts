/**
 * jsdom has no popover API. A ps-menu or ps-popover only needs the two calls to exist to open in a
 * jsdom test (positioning runs on zero-sized boxes there); anything that checks what is shown,
 * where, or which layer is on top belongs in a *.browser.test.ts.
 */
export function stubPopoverApi(): void {
  if (typeof HTMLElement.prototype.showPopover === 'function') return;
  Object.assign(HTMLElement.prototype, {
    showPopover(): void {},
    hidePopover(): void {},
  });
}
