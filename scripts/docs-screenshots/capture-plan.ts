/**
 * The docs media manifest's vocabulary: what one capture entry says, how its output files are
 * named, which files it expands to, and the checks every entry must pass. Pure (types from
 * Playwright and the app, no Node or Playwright values), so the app's Vitest can test it
 * (`apps/web/src/explore/docs-images.test.ts`) and the hook's lint can read it without a browser.
 */
import type { Locator, Page } from '@playwright/test';
import type { LayoutState } from '../../apps/web/src/explore/layout-defaults';

export type Theme = 'light' | 'dark';
/** A screenshot, or an animation recorded as a looping video. */
export type CaptureKind = 'png' | 'video';
export type ViewportName = 'desktop' | 'tablet' | 'phone';

/** Every entry is captured in both, light first: the docs show the one matching their mode. */
export const THEMES: readonly Theme[] = ['light', 'dark'];

/**
 * A video's files, in the order a page's `<video>` lists them: VP9 WebM first, H.264 MP4 for
 * browsers without VP9, and the JPEG poster (the scene's first frame), which shows before the
 * video plays and instead of it under reduced motion.
 */
export const VIDEO_FILES = ['webm', 'mp4', 'jpg'] as const;

/** A rectangle of the page, in CSS pixels from the viewport's top left. */
export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a scene's `setup` and `steps` act through. In a screenshot, `hold` and `label` resolve at
 * once and the pointer and keys act without overlays; in a video, `hold` paces the recording and
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

/** One docs image or video: what to open, what to do, what to shoot, and the pages that show it. */
export interface CaptureEntry {
  /** File stem under docs/explore/images/, lowercase kebab-case, optionally under `examples/`. */
  name: string;
  kind: CaptureKind;
  viewport: ViewportName | { width: number; height: number };
  /** Device scale of a desktop screenshot; default 2. */
  scale?: 1 | 2;
  /** An example's catalog id, opened by its `?dataset=` link; default the startup demo. */
  dataset?: string;
  /** Stored before the page loads, over the default layout. */
  layout?: Partial<LayoutState>;
  /** Brings the page to the scene's start; a video is trimmed to start where it ends. */
  setup?: (page: Page, cap: CaptureApi) => Promise<void>;
  /** The scene: the state to shoot, or the actions to record. */
  steps?: (page: Page, cap: CaptureApi) => Promise<void>;
  /** What to shoot; default the viewport. Screenshots only: a video records the viewport. */
  target?: (page: Page) => Locator | Promise<Locator | Clip>;
  /** Leave the pointer where the steps put it (a hover state), instead of parking it. */
  keepPointer?: boolean;
  /** The test's timeout; default 90 s. */
  timeoutMs?: number;
  /** A video's size limit, for its WebM and its MP4 each; default `DEFAULT_VIDEO_BUDGET`. */
  budgetBytes?: number;
  /** The docs pages that show the image, relative to docs/, e.g. 'explore/index.md'. */
  docs: readonly string[];
}

export const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
export const TABLET_VIEWPORT = { width: 800, height: 1280 };
/** Playwright's Pixel 7, which the runner emulates for `phone`. */
export const PHONE_VIEWPORT = { width: 412, height: 839 };
/** 1.25 MiB, per encoding: the largest video (duplicate-badges, 0.96 MiB) with room to spare. */
export const DEFAULT_VIDEO_BUDGET = 1.25 * 1024 * 1024;

/** An entry's file stem for one theme: `x`, `x-dark`, `examples/demo-dark`. */
export function variantStem(name: string, theme: Theme): string {
  return theme === 'dark' ? `${name}-dark` : name;
}

/**
 * An entry's output files for one theme: `x.png`, `x-dark.png`, `examples/demo.png`;
 * `zoom.webm`, `zoom.mp4`, `zoom.jpg`.
 */
export function outputFiles(name: string, kind: CaptureKind, theme: Theme): string[] {
  const stem = variantStem(name, theme);
  return kind === 'png' ? [`${stem}.png`] : VIDEO_FILES.map((extension) => `${stem}.${extension}`);
}

/** One theme of an entry: its stem, its files, and the title of the test that captures it. */
export interface CaptureVariant {
  entry: CaptureEntry;
  theme: Theme;
  stem: string;
  files: string[];
  /** The first file, so `-g "<name>"` captures both themes and `-g "<name>-dark"` the dark one. */
  title: string;
}

/** Every variant, in manifest order, light before dark; only those of `kind` when given. */
export function captureVariants(
  entries: readonly CaptureEntry[],
  kind?: CaptureKind,
): CaptureVariant[] {
  return entries
    .filter((entry) => kind === undefined || entry.kind === kind)
    .flatMap((entry) =>
      THEMES.map((theme) => {
        const files = outputFiles(entry.name, entry.kind, theme);
        return { entry, theme, stem: variantStem(entry.name, theme), files, title: files[0] };
      }),
    );
}

/** A viewport's size in CSS pixels. */
export function viewportSize(viewport: CaptureEntry['viewport']): {
  width: number;
  height: number;
} {
  if (typeof viewport === 'object') return viewport;
  if (viewport === 'desktop') return DESKTOP_VIEWPORT;
  if (viewport === 'tablet') return TABLET_VIEWPORT;
  return PHONE_VIEWPORT;
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
      problems.push(`${at}: the name has an extension; the runner adds it`);
    } else if (!NAME.test(entry.name)) {
      problems.push(`${at}: the name is not lowercase kebab-case (optionally under examples/)`);
    } else if (entry.name.endsWith('-dark')) {
      problems.push(`${at}: a name ending in -dark is the dark variant's; every entry gets one`);
    }
    if (entry.kind === 'png' && entry.budgetBytes !== undefined) {
      problems.push(`${at}: budgetBytes applies to videos only`);
    }
    if (entry.kind === 'video') {
      if (entry.target !== undefined) {
        problems.push(`${at}: a video records the whole viewport; target applies to screenshots`);
      }
      const { width, height } = viewportSize(entry.viewport);
      if (width % 2 !== 0 || height % 2 !== 0) {
        problems.push(
          `${at}: a video's viewport needs an even width and height (${width}×${height})`,
        );
      }
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

/**
 * What the runner writes beside a video's recording (`temp-videos/<stem>.json`) for `video.ts`:
 * where the scene starts in the recording, the size limit and the frame size.
 */
export interface VideoSidecar {
  stem: string;
  trimStartMs: number;
  budgetBytes: number;
  width: number;
  height: number;
}
