/**
 * `pnpm docs:images:check`, in the pre-commit hook: the docs-lint rules against the disk. Every
 * file under docs/explore/images/ must come from the capture manifest, have its dark twin, be
 * shown by the pages its entry names, and keep a video within its budget; the pages' image refs,
 * light/dark pairs, `<DocsVideo>` tags, #anchor links and user-guide wording must hold. Reads
 * files only; runs no browser.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  lintDocs,
  lintManifest,
  manifestOutputs,
  type DocsPage,
  type ImageFile,
} from './docs-lint';
import { MANIFEST } from './manifest';
import { IMAGES_DIR } from './paths';

const DOCS_DIR = path.join(__dirname, '../../docs');
/** Every image and video format, so a stray JPEG or SVG fails as uncovered instead of slipping past. */
const MEDIA_FILE = /\.(png|gif|jpe?g|webp|svg|webm|mp4|mov)$/i;

/** Every file under `dir`, skipping dot folders (`.vitepress`) and node_modules. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const posix = (file: string): string => file.split(path.sep).join('/');

const pages: DocsPage[] = walk(DOCS_DIR)
  .filter((file) => file.endsWith('.md') && path.basename(file) !== 'README.md')
  // Mirrors `srcExclude` in docs/.vitepress/config.mts: these are not built pages.
  .filter((file) => !posix(path.relative(DOCS_DIR, file)).startsWith('superpowers/'))
  .map((file) => ({
    path: posix(path.relative(DOCS_DIR, file)),
    text: fs.readFileSync(file, 'utf8'),
  }));

const files: ImageFile[] = walk(IMAGES_DIR)
  .filter((file) => MEDIA_FILE.test(file))
  .map((file) => ({ file: posix(path.relative(IMAGES_DIR, file)), bytes: fs.statSync(file).size }));

const outputs = manifestOutputs(MANIFEST);
const manifestProblems = lintManifest(outputs, files, pages);
const problems = [...lintDocs(pages, files), ...manifestProblems];
if (problems.length > 0) {
  console.error(`docs:images:check: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  if (manifestProblems.length > 0)
    console.error(
      'Capture an image with `pnpm docs:screenshots -g "<name>"` or a video with ' +
        '`pnpm docs:animations -g "<name>" && pnpm docs:videos <name>`; see docs/explore/images/README.md.',
    );
  process.exit(1);
}
console.log(
  `✓ ${files.length} docs media files match the manifest (${outputs.length} outputs) and ${pages.length} pages.`,
);
