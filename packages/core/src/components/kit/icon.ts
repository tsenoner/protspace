import type { TemplateResult } from 'lit';
import { html, unsafeStatic } from 'lit/static-html.js';
import {
  ArrowDown01,
  ArrowDown10,
  ArrowDownAZ,
  ArrowDownNarrowWide,
  ArrowDownWideNarrow,
  ArrowDownZA,
  ArrowUpDown,
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  Download,
  Ellipsis,
  Expand,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  Info,
  Lasso,
  List,
  Maximize,
  Minus,
  Moon,
  MousePointer,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  PictureInPicture2,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquareDashed,
  SquarePen,
  Sun,
  SunMoon,
  Target,
  Undo2,
  Upload,
  X,
  ZoomIn,
  type IconNode,
} from 'lucide';

// The curated set. Each phase adds the icons it first needs; explicit imports keep the bundle to them.
const ICONS = {
  'arrow-down-0-1': ArrowDown01,
  'arrow-down-1-0': ArrowDown10,
  'arrow-down-a-z': ArrowDownAZ,
  'arrow-down-narrow-wide': ArrowDownNarrowWide,
  'arrow-down-wide-narrow': ArrowDownWideNarrow,
  'arrow-down-z-a': ArrowDownZA,
  'arrow-up-down': ArrowUpDown,
  box: Box,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'circle-help': CircleHelp,
  copy: Copy,
  download: Download,
  ellipsis: Ellipsis,
  expand: Expand,
  'external-link': ExternalLink,
  eye: Eye,
  'eye-off': EyeOff,
  filter: Filter,
  'grip-vertical': GripVertical,
  info: Info,
  lasso: Lasso,
  list: List,
  maximize: Maximize,
  minus: Minus,
  moon: Moon,
  'mouse-pointer': MousePointer,
  'panel-right': PanelRight,
  'panel-right-close': PanelRightClose,
  'panel-right-open': PanelRightOpen,
  'picture-in-picture-2': PictureInPicture2,
  search: Search,
  'sliders-horizontal': SlidersHorizontal,
  sparkles: Sparkles,
  'square-dashed': SquareDashed,
  'square-pen': SquarePen,
  sun: Sun,
  'sun-moon': SunMoon,
  target: Target,
  'undo-2': Undo2,
  upload: Upload,
  x: X,
  'zoom-in': ZoomIn,
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
