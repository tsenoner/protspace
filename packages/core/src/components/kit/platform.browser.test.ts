import { describe, expect, it } from 'vitest';

// The kit builds on these platform features. jsdom has none of them, which is why kit
// behaviour is tested in a real browser.
describe('browser platform the kit relies on', () => {
  it('supports the popover attribute', () => {
    const el = document.createElement('div');
    el.popover = 'manual';
    document.body.append(el);
    el.showPopover();
    expect(el.matches(':popover-open')).toBe(true);
    el.hidePopover();
    el.remove();
  });

  it('opens a modal dialog', () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    expect(dialog.matches(':modal')).toBe(true);
    dialog.close();
    dialog.remove();
  });

  it('adopts constructable stylesheets into the document', () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(':root { --probe: 1px; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    expect(getComputedStyle(document.documentElement).getPropertyValue('--probe').trim()).toBe(
      '1px',
    );
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  });
});
