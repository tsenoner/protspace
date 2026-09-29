/**
 * Download and verify the example bundles the web app serves.
 *
 * `apps/web/src/explore/example-manifest.ts` names every example's file with
 * its byte count and sha256. Repo-hosted files (the startup demo) are checked
 * where they are committed, under `apps/web/public/`. Release-hosted files are
 * downloaded from their GitHub release into `--out`, checked, and only then
 * moved into place; a file already there with the right bytes is kept.
 *
 * Any missing asset, size mismatch or checksum mismatch exits non-zero, which
 * is what fails the deploy (`.github/workflows/deploy.yml`) before anything
 * is published.
 *
 * Usage:
 *   pnpm examples:fetch                          # into apps/web/public/examples/ (gitignored)
 *   pnpm examples:fetch --out apps/web/dist/examples --with-retained   # the deploy
 *
 * Options:
 *   --out DIR          where release-hosted files go (default apps/web/public/examples)
 *   --with-retained    also fetch the previous release's retained files
 *   --base-url URL     release download root (default https://github.com/tsenoner/protspace/releases/download)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { EXAMPLE_MANIFEST } from '../../apps/web/src/explore/example-manifest.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = join(REPO_ROOT, 'apps/web/public');
const DEFAULT_BASE_URL = 'https://github.com/tsenoner/protspace/releases/download';
const ATTEMPTS = 3;

/** A file the manifest pins: where it comes from and what its bytes must be. */
interface PinnedFile {
  label: string;
  release: string;
  file: string;
  bytes: number;
  sha256: string;
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Why `data` is not the pinned file, or `null` when it is. */
function mismatch(data: Uint8Array, pinned: { bytes: number; sha256: string }): string | null {
  if (data.byteLength !== pinned.bytes) {
    return `${data.byteLength} bytes, expected ${pinned.bytes}`;
  }
  const actual = sha256(data);
  return actual === pinned.sha256 ? null : `sha256 ${actual}, expected ${pinned.sha256}`;
}

async function download(url: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 404) {
        throw new Error(`404 Not Found: ${url} (is the release asset published?)`);
      }
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (String(error).includes('404 Not Found') || attempt === ATTEMPTS) break;
      await new Promise((done) => setTimeout(done, 2_000 * attempt));
    }
  }
  throw lastError;
}

/** Downloads `pinned` into `outDir` unless an identical copy is there; returns an error or null. */
async function fetchPinned(
  pinned: PinnedFile,
  outDir: string,
  baseUrl: string,
): Promise<string | null> {
  const target = join(outDir, pinned.file);
  if (existsSync(target) && mismatch(readFileSync(target), pinned) === null) {
    console.log(`ok       ${pinned.label}: ${relative(REPO_ROOT, target)} (already there)`);
    return null;
  }
  const url = `${baseUrl}/${pinned.release}/${pinned.file}`;
  let data: Uint8Array;
  try {
    data = await download(url);
  } catch (error) {
    return `${pinned.label}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const problem = mismatch(data, pinned);
  if (problem) {
    return `${pinned.label}: ${url} does not match its manifest record (${problem})`;
  }
  mkdirSync(outDir, { recursive: true });
  const partial = `${target}.part`;
  writeFileSync(partial, data);
  renameSync(partial, target);
  console.log(`fetched  ${pinned.label}: ${relative(REPO_ROOT, target)}`);
  return null;
}

function verifyRepoFile(label: string, file: string, pinned: { bytes: number; sha256: string }) {
  const path = join(PUBLIC_DIR, file);
  if (!existsSync(path)) {
    return `${label}: ${relative(REPO_ROOT, path)} is missing`;
  }
  const problem = mismatch(readFileSync(path), pinned);
  if (problem) {
    return `${label}: ${relative(REPO_ROOT, path)} does not match its manifest record (${problem}); rerun write_manifest.py`;
  }
  console.log(`ok       ${label}: ${relative(REPO_ROOT, path)} (in the repository)`);
  return null;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: join(PUBLIC_DIR, 'examples') },
      'with-retained': { type: 'boolean', default: false },
      'base-url': { type: 'string', default: DEFAULT_BASE_URL },
    },
  });
  const outDir = resolve(values.out);
  const baseUrl = values['base-url'].replace(/\/$/, '');
  const errors: string[] = [];

  const pinned: PinnedFile[] = [];
  for (const [id, record] of Object.entries(EXAMPLE_MANIFEST.examples)) {
    if (record.hosting === 'repo') {
      const error = verifyRepoFile(id, record.file, record);
      if (error) errors.push(error);
      continue;
    }
    if (!EXAMPLE_MANIFEST.release) {
      errors.push(`${id}: release-hosted, but the manifest names no release`);
      continue;
    }
    pinned.push({ label: id, release: EXAMPLE_MANIFEST.release, ...record });
  }
  if (values['with-retained']) {
    for (const retained of EXAMPLE_MANIFEST.retained) {
      pinned.push({ label: `retained ${retained.release}`, ...retained });
    }
  }

  if (pinned.length === 0) {
    console.log('No release-hosted example bundles in the manifest; nothing to download.');
  }
  for (const file of pinned) {
    const error = await fetchPinned(file, outDir, baseUrl);
    if (error) errors.push(error);
  }

  if (errors.length > 0) {
    // Leave no half-verified directory behind for a deploy step to upload.
    for (const file of pinned) rmSync(join(outDir, `${file.file}.part`), { force: true });
    console.error(`\n${errors.length} example bundle(s) failed verification:`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
