/**
 * The docs media manifest's vocabulary: what one capture entry says, how its output files are
 * named, which files it expands to, and the checks every entry must pass. Pure (types from
 * Playwright and the app, no Node or Playwright values), so the app's Vitest can test it
 * (`apps/web/src/explore/docs-images.test.ts`) and the hook's lint can read it without a browser.
 */
import type { Locator, Page } from '@playwright/test';
import type { LayoutState } from '../../apps/web/src/explore/layout-defaults';

export type Theme = 'light' | 'dark';
export type CaptureKind = 'png' | 'gif';
export type ViewportName = 'desktop' | 'tablet' | 'phone';

/** A rectangle of the page, in CSS pixels from the viewport's top left. */
export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a scene's `setup` and `steps` act through. In a screenshot, `hold` and `label` resolve at
 * once and the pointer and keys act without overlays; in a GIF, `hold` paces the recording and
 * every action shows its overlay.
 */
export interface CaptureApi {
  readonly kind: CaptureKind;
  readonly theme: Theme;
  hold(ms: number): Promise<void>;
  click(target: Locator | { x: number; y: number }, options?: { label?: string }): Promise<void>;
  press(key: string, options?: { label?: string }): Promise<void>;
  moveTo(target: Locator | { x: number; y: number }, options?: { steps?: number }): Promise<void>;
  drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    options?: { steps?: number },
  ): Promise<void>;
  label(text: string): Promise<void>;
}

/** One docs image: what to open, what to do, what to shoot, and the pages that show it. */
export interface CaptureEntry {
  /** File stem under docs/explore/images/, lowercase kebab-case, optionally under `examples/`. */
  name: string;
  kind: CaptureKind;
  viewport: ViewportName | { width: number; height: number };
  /** Default `['light']`; `'dark'` adds `<name>-dark.png` (screenshots only). */
  themes?: readonly Theme[];
  /** Device scale of a desktop screenshot; default 2. */
  scale?: 1 | 2;
  /** An example's catalog id, opened by its `?dataset=` link; default the startup demo. */
  dataset?: string;
  /** Stored before the page loads, over the default layout. */
  layout?: Partial<LayoutState>;
  /** Brings the page to the scene's start; a GIF is trimmed to start where it ends. */
  setup?: (page: Page, cap: CaptureApi) => Promise<void>;
  /** The scene: the state to shoot, or the actions to record. */
  steps?: (page: Page, cap: CaptureApi) => Promise<void>;
  /** What to shoot; default the viewport. */
  target?: (page: Page) => Locator | Promise<Locator | Clip>;
  /** Leave the pointer where the steps put it (a hover state), instead of parking it. */
  keepPointer?: boolean;
  /** The test's timeout; default 90 s. */
  timeoutMs?: number;
  /** A GIF's size limit; default `DEFAULT_GIF_BUDGET`. */
  budgetBytes?: number;
  /** Where a GIF's fps and width ladder starts. */
  gif?: { fps?: number; width?: number };
  /** The docs pages that show the image, relative to docs/, e.g. 'explore/index.md'. */
  docs: readonly string[];
}

export const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
export const TABLET_VIEWPORT = { width: 800, height: 1280 };
/** 3 MiB. */
export const DEFAULT_GIF_BUDGET = 3 * 1024 * 1024;

/** An entry's output file for one theme: `x.png`, `x-dark.png`, `examples/demo.png`, `zoom.gif`. */
export function outputFile(name: string, kind: CaptureKind, theme: Theme): string {
  return `${name}${theme === 'dark' ? '-dark' : ''}.${kind}`;
}

/** One output file of an entry. */
export interface CaptureVariant {
  entry: CaptureEntry;
  theme: Theme;
  file: string;
}

const THEME_ORDER: readonly Theme[] = ['light', 'dark'];

/** Every output file, in manifest order, light before dark; only those of `kind` when given. */
export function captureVariants(
  entries: readonly CaptureEntry[],
  kind?: CaptureKind,
): CaptureVariant[] {
  return entries
    .filter((entry) => kind === undefined || entry.kind === kind)
    .flatMap((entry) => {
      const themes = entry.themes ?? ['light'];
      return THEME_ORDER.filter((theme) => themes.includes(theme)).map((theme) => ({
        entry,
        theme,
        file: outputFile(entry.name, entry.kind, theme),
      }));
    });
}

const NAME = /^(examples\/)?[a-z0-9]+(-[a-z0-9]+)*$/;

/** One message per problem in the manifest; empty when every entry is valid. */
export function validateManifest(entries: readonly CaptureEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const at = `"${entry.name}"`;
    if (seen.has(entry.name)) problems.push(`${at}: the name is used twice`);
    seen.add(entry.name);
    if (/\.[a-z0-9]+$/i.test(entry.name)) {
      problems.push(`${at}: the name has an extension; the runner adds .png or .gif`);
    } else if (!NAME.test(entry.name)) {
      problems.push(`${at}: the name is not lowercase kebab-case (optionally under examples/)`);
    } else if (entry.name.endsWith('-dark')) {
      problems.push(`${at}: a name ending in -dark is the dark variant's; use themes instead`);
    }
    if (entry.kind === 'gif' && entry.themes?.includes('dark')) {
      problems.push(`${at}: a GIF is light only; show the dark theme in a screenshot`);
    }
    if (entry.kind === 'png' && (entry.budgetBytes !== undefined || entry.gif !== undefined)) {
      problems.push(`${at}: budgetBytes and gif apply to GIFs only`);
    }
    if (entry.scale !== undefined && (entry.kind !== 'png' || entry.viewport !== 'desktop')) {
      problems.push(`${at}: scale applies to desktop screenshots only`);
    }
    if (entry.docs.length === 0) {
      problems.push(`${at}: docs names no page that shows the image`);
    }
    for (const page of entry.docs) {
      if (!page.endsWith('.md')) problems.push(`${at}: docs page "${page}" is not a .md file`);
    }
  }
  return problems;
}

/** A GIF's frame rate and width in pixels. */
export interface GifSettings {
  fps: number;
  width: number;
}

/** Where a GIF's ladder starts unless its entry says otherwise. */
export const GIF_START: GifSettings = { fps: 30, width: 1000 };

const LADDER_FPS = [20, 15];
const LADDER_WIDTHS = [800, 640];

/**
 * The settings a GIF is converted at, in order, until one fits its budget: the start, then each
 * lower frame rate of 20 and 15, then each narrower width of 800 and 640 at the last rate.
 * `gifLadder()` is 30/1000, 20/1000, 15/1000, 15/800, 15/640.
 */
export function gifLadder(start: Partial<GifSettings> = {}): GifSettings[] {
  const first = { ...GIF_START, ...start };
  const ladder = [first];
  for (const fps of LADDER_FPS) {
    if (fps < first.fps) ladder.push({ fps, width: first.width });
  }
  const { fps } = ladder[ladder.length - 1];
  for (const width of LADDER_WIDTHS) {
    if (width < first.width) ladder.push({ fps, width });
  }
  return ladder;
}

/**
 * What the runner writes beside a GIF's recording (`temp-videos/<name>.json`) for `gif.ts`: where
 * the scene starts in the video, the size limit and the ladder's first rung.
 */
export interface GifSidecar {
  name: string;
  trimStartMs: number;
  budgetBytes: number;
  start: GifSettings;
}
