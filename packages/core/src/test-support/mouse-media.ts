import type { CSSResultOrNative } from 'lit';

const MOUSE = '(hover: hover) and (pointer: fine)';
const TOUCH = '(pointer: coarse)';

/**
 * Lays a component's styles out for a mouse, whatever pointer the host reports, and returns the
 * undo. Headless Chromium on Linux finds no pointing device, so neither query matches there, and
 * Chromium offers no way to report a mouse that lasts: `Emulation.setEmulatedMedia` ignores
 * `hover` and `pointer`, and turning touch emulation off (as the touch tests do) puts back the
 * host's pointer, undoing any `--blink-settings` launch flag. So this rewrites the conditions
 * instead: the mouse rules match everywhere and the touch rules nowhere. It throws when `styles`
 * has no mouse rule, so a renamed condition fails the test rather than passing on the touch layout.
 */
export function layOutForMouse(styles: readonly CSSResultOrNative[]): () => void {
  const changed: Array<[MediaList, string]> = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule) {
        const condition = rule.media.mediaText;
        if (condition === MOUSE || condition === TOUCH) {
          changed.push([rule.media, condition]);
          rule.media.mediaText = condition === MOUSE ? 'all' : 'not all';
        }
      }
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const style of styles) {
    const sheet = style instanceof CSSStyleSheet ? style : style.styleSheet;
    if (sheet) visit(sheet.cssRules);
  }
  if (!changed.some(([, condition]) => condition === MOUSE)) {
    throw new Error(`no ${MOUSE} rule to lay out for a mouse`);
  }
  return () => {
    for (const [media, condition] of changed) media.mediaText = condition;
  };
}
