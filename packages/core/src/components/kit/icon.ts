import type { TemplateResult } from 'lit';
import { html, unsafeStatic } from 'lit/static-html.js';
import {
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Info,
  Minus,
  Search,
  SquarePen,
  Target,
  Upload,
  X,
  type IconNode,
} from 'lucide';

// The curated set. Each phase adds the icons it first needs; explicit imports keep the bundle to them.
const ICONS = {
  check: Check,
  'chevron-down': ChevronDown,
  'circle-help': CircleHelp,
  download: Download,
  info: Info,
  minus: Minus,
  search: Search,
  'square-pen': SquarePen,
  target: Target,
  upload: Upload,
  x: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;
export type IconSize = 14 | 16 | 20;

const cache = new Map<string, string>();

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The SVG source of an icon. Icons are decorative (aria-hidden): the control around one carries
 * the accessible name. One stroke width everywhere (design decision 8).
 */
export function iconMarkup(name: IconName, size: IconSize = 16): string {
  const key = `${name}:${size}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    // A Lucide icon is ['svg', defaultAttributes, children]; only the children are kept.
    const children = (ICONS[name][2] ?? [])
      .map(([tag, attrs]) => {
        const attributes = Object.entries(attrs)
          .map(([attr, value]) => `${attr}="${escapeAttr(String(value))}"`)
          .join(' ');
        return `<${tag} ${attributes}></${tag}>`;
      })
      .join('');
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" class="ps-icon" width="${size}" height="${size}" ` +
      `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
    cache.set(key, svg);
  }
  return svg;
}

/**
 * An icon for a Lit template. The markup comes from the static Lucide set, never from input.
 * Lit caches static markup by its text, so each icon and size is parsed once.
 */
export function icon(name: IconName, size: IconSize = 16): TemplateResult {
  return html`${unsafeStatic(iconMarkup(name, size))}`;
}
