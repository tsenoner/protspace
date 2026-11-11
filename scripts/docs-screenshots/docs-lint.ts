/**
 * The docs media and link checks, as pure functions over page texts and file lists. The
 * pre-commit hook runs them against the disk and the capture manifest (`check.ts`); the app's
 * Vitest runs them against the pages it globs (`apps/web/src/explore/docs-images.test.ts`). So
 * this module imports nothing from Node or Playwright.
 *
 * A page is named relative to `docs/` (`explore/index.md`); a media file relative to
 * `docs/explore/images/` (`zoom.webm`, `examples/demo.png`).
 */
import {
  captureVariants,
  DEFAULT_VIDEO_BUDGET,
  THEMES,
  VIDEO_FILES,
  variantStem,
  viewportSize,
  type CaptureEntry,
} from './capture-plan';

/** A docs page: its path relative to `docs/` and its markdown. */
export interface DocsPage {
  path: string;
  text: string;
}

/** One file a page shows from `docs/explore/images/`: an image, or one file of a video. */
export interface ImageRef {
  page: string;
  /** Relative to `docs/explore/images/`. */
  file: string;
  classes: readonly string[];
  /**
   * Fetched only once shown: every markdown image (the VitePress config lazy-loads them) and a
   * raw `<img>` with `loading="lazy"`.
   */
  lazy: boolean;
  /** 1-based. */
  line: number;
  /** A raw `<img>` whose inline `style` sets `display`, which beats the light/dark head rule. */
  inlineDisplay?: true;
  /** A raw `<img>` with a `width` and no `height`: it has no box until it loads. */
  heightless?: true;
  /** Shown by a `<DocsVideo>`, which renders both themes itself: the tag's stated frame size. */
  video?: { width: number | null; height: number | null };
}

/**
 * A `<DocsVideo name="zoom" alt="…" width="1280" height="720" />` on a page: the theme's
 * component (docs/.vitepress/theme/docs-video.ts) shows `<name>.webm` or `<name>-dark.webm`, with
 * their MP4s and posters, whichever matches the docs' mode.
 */
export interface VideoTag {
  page: string;
  /** Relative to `docs/explore/images/`, without extension or `-dark`. */
  name: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  line: number;
}

/** One file the capture manifest writes, and the pages that must show it. */
export interface MediaOutput {
  file: string;
  /** The largest the file may be: a video's WebM and MP4. */
  budgetBytes?: number;
  /** The frame size a video's tag must state; on the light WebM, one per video. */
  size?: { width: number; height: number };
  /** Relative to `docs/`. */
  docs: readonly string[];
}

/** An image file on disk. The hook knows its size; the app test does not. */
export interface ImageFile {
  file: string;
  bytes?: number;
}

/** Names of removed UI the user guide must not use any more. */
const STALE_TERMS: readonly RegExp[] = [
  /control bar/i,
  /isolate button/i,
  /apply & isolate/i,
  /cog icon/i,
  /tips popover/i,
  /take a tour/i,
  /extract (values )?from other/i,
  /settings dialog/i,
  /theme menu/i,
  // The Export menu's items before it became a two-step panel and the figure editor got a button.
  /quick (png|pdf|export)/i,
  /figure editor…/i,
  /by separation/i,
  /row's ⋯/i,
  // The predicted mark is the PRED badge now.
  /⚡/u,
  /sparkles/i,
];

/** The pages the stale-term check reads: the user guide, not the developer docs. */
const USER_GUIDE = /^(index\.md|explore\/.+\.md|guide\/.+\.md)$/;
const IMAGES_DIR = 'explore/images/';
const DARK = /-dark\.(png|gif|webm|mp4|jpg)$/;
/** The files a page shows through `<DocsVideo>`, never as an image. */
const VIDEO_FILE = /\.(webm|mp4|jpg)$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const lightTwinOf = (file: string): string => file.replace(/-dark(\.[a-z0-9]+)$/, '$1');
const darkTwinOf = (file: string): string => file.replace(/(\.[a-z0-9]+)$/, '-dark$1');

/** The page's lines with front matter and fenced code blanked, so line numbers still count. */
function prose(text: string): string[] {
  const lines = text.split('\n');
  let inFrontMatter = lines[0]?.trim() === '---';
  let fence: string | null = null;
  return lines.map((line, index) => {
    if (inFrontMatter) {
      if (index > 0 && line.trim() === '---') inFrontMatter = false;
      return '';
    }
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return '';
    }
    if (marker) {
      fence = marker;
      return '';
    }
    return line;
  });
}

/** A line with its inline code spans blanked: a link or image written as code is neither. */
const withoutInlineCode = (line: string): string =>
  line.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));

/** `target` resolved against the folder of `fromPage`, as a path relative to `docs/`. */
function resolve(fromPage: string, target: string): string | null {
  const parts = target.startsWith('/') ? [] : fromPage.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

const MD_IMAGE = /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)(\{[^}\n]*\})?/g;
const HTML_IMG = /<img\b[^>]*>/gi;
const DOCS_VIDEO = /<DocsVideo\b[^>]*>/g;

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? null;
}

/** The file under `docs/explore/images/` that `src` on `page` names, or null. */
function imageFile(page: string, src: string): string | null {
  if (SCHEME.test(src)) return null;
  const path = resolve(page, src.split(/[?#]/)[0]);
  return path !== null && path.startsWith(IMAGES_DIR) ? path.slice(IMAGES_DIR.length) : null;
}

const pixels = (value: string | null): number | null =>
  value !== null && /^\d+$/.test(value) ? Number(value) : null;

/** The `<DocsVideo>` tags on `page`, in page order. */
export function videoTags(page: DocsPage): VideoTag[] {
  const tags: VideoTag[] = [];
  prose(page.text).forEach((raw, index) => {
    for (const match of withoutInlineCode(raw).matchAll(DOCS_VIDEO)) {
      tags.push({
        page: page.path,
        name: attribute(match[0], 'name'),
        alt: attribute(match[0], 'alt'),
        width: pixels(attribute(match[0], 'width')),
        height: pixels(attribute(match[0], 'height')),
        line: index + 1,
      });
    }
  });
  return tags;
}

/** A video's files for both themes: `zoom.webm`, `zoom.mp4`, `zoom.jpg`, `zoom-dark.webm`, … */
export function videoFiles(name: string): string[] {
  return THEMES.flatMap((theme) =>
    VIDEO_FILES.map((extension) => `${variantStem(name, theme)}.${extension}`),
  );
}

/**
 * The files `page` shows from `docs/explore/images/`, in page order: each image, and each file of
 * each `<DocsVideo>`.
 */
export function imageRefs(page: DocsPage): ImageRef[] {
  const refs: ImageRef[] = [];
  prose(page.text).forEach((raw, index) => {
    const text = withoutInlineCode(raw);
    const found: Array<{ at: number; ref: ImageRef }> = [];
    for (const match of text.matchAll(DOCS_VIDEO)) {
      const name = attribute(match[0], 'name');
      if (name === null) continue;
      const video = {
        width: pixels(attribute(match[0], 'width')),
        height: pixels(attribute(match[0], 'height')),
      };
      for (const file of videoFiles(name)) {
        const ref: ImageRef = {
          page: page.path,
          file,
          classes: [],
          lazy: true,
          line: index + 1,
          video,
        };
        found.push({ at: match.index ?? 0, ref });
      }
    }
    for (const match of text.matchAll(MD_IMAGE)) {
      const file = imageFile(page.path, match[1]);
      if (file === null) continue;
      const classes = [...(match[2] ?? '').matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      const ref = { page: page.path, file, classes, lazy: true, line: index + 1 };
      found.push({ at: match.index ?? 0, ref });
    }
    for (const match of text.matchAll(HTML_IMG)) {
      const src = attribute(match[0], 'src');
      const file = src === null ? null : imageFile(page.path, src);
      if (file === null) continue;
      const classes = (attribute(match[0], 'class') ?? '').split(/\s+/).filter(Boolean);
      const lazy = attribute(match[0], 'loading') === 'lazy';
      const ref: ImageRef = { page: page.path, file, classes, lazy, line: index + 1 };
      if (/(^|;)\s*display\s*:/i.test(attribute(match[0], 'style') ?? '')) ref.inlineDisplay = true;
      if (attribute(match[0], 'width') !== null && attribute(match[0], 'height') === null) {
        ref.heightless = true;
      }
      found.push({ at: match.index ?? 0, ref });
    }
    found.sort((a, b) => a.at - b.at).forEach(({ ref }) => refs.push(ref));
  });
  return refs;
}

/** VitePress's slugify (vitepress 1.6), applied to a heading's text without its markup. */
const SPECIAL = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** The anchor VitePress gives a heading with this markdown text. */
export function headingSlug(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(SPECIAL, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*$/;
const ATTRS = /[ \t]*\{([^}]*)\}[ \t]*$/;

/** Every anchor on the page: heading slugs (repeats as `slug-1`, `slug-2`) and explicit `{#id}`. */
export function pageAnchors(page: DocsPage): Set<string> {
  const anchors = new Set<string>();
  for (const line of prose(page.text)) {
    const heading = HEADING.exec(line)?.[1];
    if (heading === undefined) continue;
    const attrs = ATTRS.exec(heading);
    const id = attrs ? /#([^\s#.}]+)/.exec(attrs[1])?.[1] : undefined;
    if (id) {
      anchors.add(id);
      continue;
    }
    const slug = headingSlug(
      (attrs ? heading.slice(0, attrs.index) : heading).replace(/[ \t]+#+$/, ''),
    );
    let unique = slug;
    for (let n = 1; anchors.has(unique); n++) unique = `${slug}-${n}`;
    anchors.add(unique);
  }
  return anchors;
}

const MD_LINK = /(?<!!)\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const REF_LINK = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/;
const HREF = /\bhref\s*=\s*"([^"]*)"/gi;

function linksOn(line: string): string[] {
  const text = withoutInlineCode(line);
  const links = [...text.matchAll(MD_LINK), ...text.matchAll(HREF)].map((match) => match[1]);
  const reference = REF_LINK.exec(text)?.[1];
  return reference ? [...links, reference] : links;
}

/** The page a link's path part names, or null when it names none of `known` (VitePress checks those). */
function linkedPage(from: string, target: string, known: ReadonlySet<string>): string | null {
  if (target === '') return from;
  const resolved = resolve(from, target.replace(/\.html$/, ''));
  if (resolved === null) return null;
  const candidates =
    target.endsWith('/') || resolved === ''
      ? [resolved === '' ? 'index.md' : `${resolved}/index.md`]
      : resolved.endsWith('.md')
        ? [resolved]
        : [`${resolved}.md`, `${resolved}/index.md`];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

function decode(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

function anchorProblems(pages: readonly DocsPage[]): string[] {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const known = new Set(byPath.keys());
  const anchorSets = new Map<string, Set<string>>();
  const anchorsOf = (path: string): Set<string> => {
    let anchors = anchorSets.get(path);
    if (!anchors) {
      anchors = pageAnchors(byPath.get(path)!);
      anchorSets.set(path, anchors);
    }
    return anchors;
  };
  const problems: string[] = [];
  for (const page of pages) {
    prose(page.text).forEach((line, index) => {
      for (const href of linksOn(line)) {
        const hash = href.indexOf('#');
        if (hash < 0 || SCHEME.test(href)) continue;
        const target = linkedPage(page.path, href.slice(0, hash), known);
        const anchor = decode(href.slice(hash + 1));
        if (target === null || anchor === '' || anchorsOf(target).has(anchor)) continue;
        problems.push(`${page.path}:${index + 1}: ${href} points at no heading on ${target}`);
      }
    });
  }
  return problems;
}

function staleProblems(pages: readonly DocsPage[]): string[] {
  const problems: string[] = [];
  for (const page of pages) {
    if (!USER_GUIDE.test(page.path)) continue;
    prose(page.text).forEach((line, index) => {
      for (const term of STALE_TERMS) {
        const words = term.exec(line)?.[0];
        if (words) problems.push(`${page.path}:${index + 1}: "${words}" names removed UI`);
      }
    });
  }
  return problems;
}

/** The problems of one `<DocsVideo>` tag that need no files: a name, alt text and a frame size. */
function videoTagProblems(tag: VideoTag): string[] {
  const at = `${tag.page}:${tag.line}`;
  if (tag.name === null) return [`${at}: <DocsVideo> needs a name, its file stem in images/`];
  const problems: string[] = [];
  if (!tag.alt) problems.push(`${at}: <DocsVideo name="${tag.name}"> needs alt text`);
  if (tag.width === null || tag.height === null) {
    problems.push(
      `${at}: <DocsVideo name="${tag.name}"> needs a width and a height in pixels, or the page shifts as it loads`,
    );
  }
  return problems;
}

function imageProblems(pages: readonly DocsPage[], files: readonly ImageFile[]): string[] {
  const problems: string[] = [];
  const onDisk = new Set(files.map((file) => file.file));
  const twinless = new Set(
    [...onDisk].filter((file) => DARK.test(file) && !onDisk.has(lightTwinOf(file))),
  );
  for (const file of twinless) {
    problems.push(`${file}: a -dark file needs its light twin ${lightTwinOf(file)}`);
  }
  for (const file of onDisk) {
    if (DARK.test(file) || onDisk.has(darkTwinOf(file))) continue;
    problems.push(
      `${file}: no dark twin ${darkTwinOf(file)}; every docs image and video comes in light and dark`,
    );
  }
  const shown = new Set<string>();
  for (const page of pages) {
    for (const tag of videoTags(page)) problems.push(...videoTagProblems(tag));
    const refs = imageRefs(page);
    // One message per image and its twin: a pair written backwards is one mistake, not two.
    const pairProblems = new Map<string, string>();
    const note = (ref: ImageRef, text: string) => {
      const key = lightTwinOf(ref.file);
      if (!pairProblems.has(key)) pairProblems.set(key, `${page.path}:${ref.line}: ${text}`);
    };
    for (const ref of refs) {
      shown.add(ref.file);
      if (!onDisk.has(ref.file))
        problems.push(`${page.path}:${ref.line}: ${ref.file} does not exist`);
      if (ref.heightless) {
        problems.push(
          `${page.path}:${ref.line}: ${ref.file} sets a width but no height; give both, or the page shifts as it loads`,
        );
      }
    }
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      // A <DocsVideo> shows its own twins.
      if (ref.video) continue;
      if (VIDEO_FILE.test(ref.file)) {
        note(ref, `${ref.file} is part of a video: show it with <DocsVideo name="…">`);
        continue;
      }
      if (ref.file.endsWith('.gif')) {
        note(ref, `${ref.file}: animations are looping videos now; show one with <DocsVideo>`);
        continue;
      }
      if (!onDisk.has(ref.file) || twinless.has(ref.file)) continue;
      if (DARK.test(ref.file)) {
        note(
          ref,
          `${ref.file} is shown outside a light/dark pair: put it on the line after its light twin, with {.dark-only}`,
        );
        continue;
      }
      const twin = darkTwinOf(ref.file);
      if (!onDisk.has(twin)) {
        // The file check above reports the missing twin.
        if (ref.classes.includes('light-only')) {
          note(
            ref,
            `${ref.file} is marked light-only but has no dark twin, so dark mode shows nothing`,
          );
        }
        continue;
      }
      const next = refs[i + 1];
      if (!next || next.file !== twin || next.line > ref.line + 1) {
        note(
          ref,
          `${ref.file} has a dark twin: follow it on the next line with ${twin} and {.dark-only}`,
        );
        continue;
      }
      i++; // the pair consumes its dark twin
      const styled = [ref, next].find((r) => r.inlineDisplay);
      if (styled) {
        note(
          styled,
          `${styled.file} sets display in its inline style, which shows both twins in either theme; style it with a class`,
        );
      } else if (!ref.classes.includes('light-only')) {
        note(ref, `${ref.file} needs {.light-only} (class="light-only") in its pair`);
      } else if (!next.classes.includes('dark-only')) {
        note(next, `${twin} needs {.dark-only} (class="dark-only") in its pair`);
      } else if (!next.lazy) {
        note(
          next,
          `${twin} must load lazily (loading="lazy"), or every light reader fetches it too`,
        );
      }
    }
    problems.push(...pairProblems.values());
  }
  for (const file of onDisk) {
    if (!shown.has(file) && !twinless.has(file)) {
      problems.push(`${file}: no docs page shows it; delete it or show it on a page`);
    }
  }
  return problems;
}

/**
 * The checks that need only the pages and the media files: refs to missing files, orphans, files
 * without their dark twin, the light/dark pair rules, `<DocsVideo>` tags, raw images with a width
 * but no height, `#anchor` links, and names of removed UI in the user guide.
 */
export function lintDocs(pages: readonly DocsPage[], files: readonly ImageFile[]): string[] {
  return [...imageProblems(pages, files), ...anchorProblems(pages), ...staleProblems(pages)];
}

/** The files the manifest writes, with each one's budget, frame size and pages. */
export function manifestOutputs(entries: readonly CaptureEntry[]): MediaOutput[] {
  return entries.flatMap((entry) =>
    captureVariants([entry]).flatMap((variant) =>
      variant.files.map((file) => {
        const output: MediaOutput = { file, docs: entry.docs };
        if (entry.kind === 'video' && !file.endsWith('.jpg')) {
          output.budgetBytes = entry.budgetBytes ?? DEFAULT_VIDEO_BUDGET;
        }
        if (entry.kind === 'video' && file === `${entry.name}.webm`) {
          output.size = viewportSize(entry.viewport);
        }
        return output;
      }),
    ),
  );
}

/**
 * The checks that need the capture manifest: every output on disk, within its budget and shown by
 * each page its entry names, a video's tag stating its frame size; every media file made by an
 * entry.
 */
export function lintManifest(
  outputs: readonly MediaOutput[],
  files: readonly ImageFile[],
  pages: readonly DocsPage[],
): string[] {
  const problems: string[] = [];
  const onDisk = new Map(files.map((file) => [file.file, file]));
  const byPath = new Map(pages.map((page) => [page.path, page]));
  for (const output of outputs) {
    const file = onDisk.get(output.file);
    if (!file) {
      problems.push(`${output.file}: in the manifest but not on disk; capture it`);
    } else if (
      output.budgetBytes !== undefined &&
      file.bytes !== undefined &&
      file.bytes > output.budgetBytes
    ) {
      problems.push(
        `${output.file}: ${file.bytes} bytes, over its ${output.budgetBytes}-byte budget`,
      );
    }
    for (const doc of output.docs) {
      const page = byPath.get(doc);
      if (!page) {
        problems.push(`${output.file}: its docs page ${doc} does not exist`);
        continue;
      }
      const refs = imageRefs(page).filter((ref) => ref.file === output.file);
      if (refs.length === 0) problems.push(`${output.file}: ${doc} does not show it`);
      const { size } = output;
      if (!size) continue;
      for (const ref of refs) {
        const stated = ref.video;
        if (!stated || stated.width === null || stated.height === null) continue;
        if (stated.width !== size.width || stated.height !== size.height) {
          problems.push(
            `${doc}:${ref.line}: the video is ${size.width}×${size.height}, but its <DocsVideo> says ${stated.width}×${stated.height}`,
          );
        }
      }
    }
  }
  const made = new Set(outputs.map((output) => output.file));
  for (const file of files) {
    if (!made.has(file.file)) {
      problems.push(
        `${file.file}: no manifest entry makes it; add one under scripts/docs-screenshots/scenes/ or delete the file`,
      );
    }
  }
  return problems;
}
