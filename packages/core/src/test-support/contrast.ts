import { theme } from '../styles/theme';
import { colourChannels } from './css-colour';

/**
 * The token blocks a test can read: the light roles, the dark ones, and the system block (the dark
 * roles under the OS media query).
 */
type ThemeBlock = ':root' | ":root[data-theme='dark']" | ":root[data-theme='system']";

/** Every innermost rule of theme.cssText as [selector, body], comments stripped. */
function rules(): Array<[string, string]> {
  const css = theme.cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [
    selector.trim(),
    body,
  ]);
}

/** The --ps-* values declared by the rules whose selector is exactly `selector`, merged. */
function declared(selector: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const [ruleSelector, body] of rules()) {
    if (ruleSelector !== selector) continue;
    for (const [, name, value] of body.matchAll(/(--ps-[\w-]+)\s*:\s*([^;]+);/g))
      values.set(name, value.trim());
  }
  return values;
}

/**
 * The raw token values one theme ships, as theme.ts declares them. The dark block redeclares only
 * the roles; anything it leaves out (sizes, the fixed paper roles) falls back to :root, as in CSS.
 */
export function tokensOf(selector: ThemeBlock): Map<string, string> {
  const light = declared(':root');
  return selector === ':root' ? light : new Map([...light, ...declared(selector)]);
}

const hexByte = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * `value` as an opaque `#rrggbb`. A translucent colour is composited over `over` (itself any
 * opaque form); without a backdrop it has no single colour, so that throws.
 */
export function toHex(value: string, over?: string): string {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((digit) => digit + digit).join('')}`;
  const [r, g, b, alpha] = colourChannels(v);
  if (alpha >= 1) return `#${[r, g, b].map(hexByte).join('')}`;
  if (over === undefined) throw new Error(`${value} is translucent: pass the colour under it`);
  const base = toHex(over);
  return `#${[r, g, b]
    .map((c, i) => {
      const under = parseInt(base.slice(1 + 2 * i, 3 + 2 * i), 16);
      return hexByte(alpha * c + (1 - alpha) * under);
    })
    .join('')}`;
}

/** WCAG 2 relative luminance of an opaque `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two opaque colours (any form `toHex` reads), from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(toHex(a)), luminance(toHex(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
