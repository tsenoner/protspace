/**
 * Download and verify the bundle files ProtSpace pins in GitHub releases: the
 * web app's example bundles, or (`--perf`) the WebGL perf harness's datasets.
 *
 * `apps/web/src/explore/example-manifest.ts` names every example's file with
 * its byte count and sha256. Repo-hosted files (the startup demo) are checked
 * where they are committed, under `apps/web/public/`. Release-hosted files are
 * downloaded from their GitHub release into `--out`, in parallel, each streamed
 * into a `.part` file while it is hashed, and moved into place only once it
 * matches; a file already there with the right bytes is kept, so a directory
 * restored from a CI cache downloads nothing.
 *
 * With `--perf`, the list is `perf/datasets.manifest.json` (the `perf-datasets`
 * release, written by `generate_examples/stage_perf.py`) and the files go to the
 * gitignored `perf/datasets/`, where `perf/webgl-perf.spec.ts` serves them.
 *
 * Any missing asset, size mismatch or checksum mismatch exits non-zero, which
 * is what fails the deploy (`.github/workflows/deploy.yml`) before anything
 * is published. So do two pinned files that would land at the same path with
 * different bytes (a retained file named like a current one), since one would
 * overwrite the other; every file then has a path of its own.
 *
 * Usage:
 *   pnpm examples:fetch                          # into apps/web/public/examples/ (gitignored)
 *   pnpm examples:fetch --out apps/web/dist/examples --with-retained   # the deploy
 *   pnpm perf:fetch [--only 573K_swissprot,5K]   # into perf/datasets/ (gitignored)
 *
 * Options:
 *   --out DIR          where downloaded files go
 *   --with-retained    examples: also fetch the previous release's retained files
 *   --perf             fetch the perf datasets instead of the examples
 *   --only IDS         perf: only these comma-separated dataset ids
 *   --base-url URL     release download root (default https://github.com/tsenoner/protspace/releases/download)
 */
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { EXAMPLE_MANIFEST } from '../../apps/web/src/explore/example-manifest.ts';
import { EXAMPLES_DIR } from '../../apps/web/src/explore/example-served-path.ts';
import { readPerfManifest } from '../../perf/datasets-manifest.ts';
import { fileMismatch, mismatch, repoFileProblem, type Fingerprint } from './pinned.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = join(REPO_ROOT, 'apps/web/public');
const PERF_MANIFEST = join(REPO_ROOT, 'perf/datasets.manifest.json');
const PERF_DATASETS_DIR = join(REPO_ROOT, 'perf/datasets');
const DEFAULT_BASE_URL = 'https://github.com/tsenoner/protspace/releases/download';
const ATTEMPTS = 3;

/** A file the manifest pins: where it comes from and what its bytes must be. */
interface PinnedFile extends Fingerprint {
  label: string;
  release: string;
  file: string;
}

/** The release has no such asset: retrying cannot help. */
class AssetNotFoundError extends Error {}

/**
 * Downloads `url` into `target`, hashing the bytes as they stream past, and
 * returns their size and sha256. Retries a failed attempt, but not a 404.
 */
async function downloadTo(url: string, target: string): Promise<Fingerprint> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 404) {
        throw new AssetNotFoundError(`404 Not Found: ${url} (is the release asset published?)`);
      }
      if (!response.ok || !response.body) {
        throw new Error(`${response.status} ${response.statusText}: ${url}`);
      }
      const hash = createHash('sha256');
      let bytes = 0;
      await pipeline(
        Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            hash.update(chunk);
            bytes += chunk.byteLength;
            yield chunk;
          }
        },
        createWriteStream(target),
      );
      return { bytes, sha256: hash.digest('hex') };
    } catch (error) {
      lastError = error;
      if (error instanceof AssetNotFoundError || attempt === ATTEMPTS) break;
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
  if (fileMismatch(target, pinned) === null) {
    console.log(`ok       ${pinned.label}: ${relative(REPO_ROOT, target)} (already there)`);
    return null;
  }
  const url = `${baseUrl}/${pinned.release}/${pinned.file}`;
  const partial = `${target}.part`;
  mkdirSync(outDir, { recursive: true });
  let problem: string | null;
  try {
    problem = mismatch(await downloadTo(url, partial), pinned);
  } catch (error) {
    rmSync(partial, { force: true });
    return `${pinned.label}: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (problem) {
    rmSync(partial, { force: true });
    return `${pinned.label}: ${url} does not match its manifest record (${problem})`;
  }
  renameSync(partial, target);
  console.log(`fetched  ${pinned.label}: ${relative(REPO_ROOT, target)}`);
  return null;
}

/** The perf datasets to fetch: every one, or those `only` names (unknown ids are errors). */
function perfFiles(only: string | undefined, errors: string[]): PinnedFile[] {
  let manifest;
  try {
    manifest = readPerfManifest(PERF_MANIFEST);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return [];
  }
  const wanted = only
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  for (const id of wanted ?? []) {
    if (!manifest.datasets.some((dataset) => dataset.id === id)) {
      errors.push(`${id}: not in ${relative(REPO_ROOT, PERF_MANIFEST)}`);
    }
  }
  return manifest.datasets
    .filter((dataset) => !wanted || wanted.includes(dataset.id))
    .map((dataset) => ({ label: dataset.id, release: manifest.release, ...dataset }));
}

/**
 * Every pinned file lands at `<out>/<file>`. Two with one name and different
 * bytes (a retained file named like a current one) would overwrite each other,
 * so a deploy could serve stale bytes under the current name: that is an
 * error, raised before anything is downloaded. An identical duplicate is
 * fetched once.
 */
function claimTargets(pinned: PinnedFile[], errors: string[]): PinnedFile[] {
  const owners = new Map<string, PinnedFile>();
  for (const file of pinned) {
    const owner = owners.get(file.file);
    if (!owner) {
      owners.set(file.file, file);
    } else if (owner.sha256 !== file.sha256 || owner.bytes !== file.bytes) {
      errors.push(
        `${file.label}: ${file.file} is also ${owner.label}'s file, with other bytes; ` +
          'one would overwrite the other (rename the new file and rerun write_manifest.py)',
      );
    }
  }
  return [...owners.values()];
}

/** The example files to fetch; repo-hosted ones are verified in place instead. */
function exampleFiles(withRetained: boolean, errors: string[]): PinnedFile[] {
  const pinned: PinnedFile[] = [];
  for (const [id, record] of Object.entries(EXAMPLE_MANIFEST.examples)) {
    if (record.hosting === 'repo') {
      const error = repoFileProblem(id, record);
      if (error) {
        errors.push(error);
      } else {
        console.log(`ok       ${id}: apps/web/public/${record.file} (in the repository)`);
      }
      continue;
    }
    if (!EXAMPLE_MANIFEST.release) {
      errors.push(`${id}: release-hosted, but the manifest names no release`);
      continue;
    }
    pinned.push({ label: id, release: EXAMPLE_MANIFEST.release, ...record });
  }
  if (withRetained) {
    for (const retained of EXAMPLE_MANIFEST.retained) {
      pinned.push({ label: `retained ${retained.release}`, ...retained });
    }
  }
  if (pinned.length === 0) {
    console.log('No release-hosted example bundles in the manifest; nothing to download.');
  }
  return pinned;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      'with-retained': { type: 'boolean', default: false },
      perf: { type: 'boolean', default: false },
      only: { type: 'string' },
      'base-url': { type: 'string', default: DEFAULT_BASE_URL },
    },
  });
  const outDir = resolve(
    values.out ?? (values.perf ? PERF_DATASETS_DIR : join(PUBLIC_DIR, EXAMPLES_DIR)),
  );
  const baseUrl = values['base-url'].replace(/\/$/, '');
  const errors: string[] = [];
  const pinned = claimTargets(
    values.perf ? perfFiles(values.only, errors) : exampleFiles(values['with-retained'], errors),
    errors,
  );

  if (errors.length === 0) {
    const results = await Promise.all(pinned.map((file) => fetchPinned(file, outDir, baseUrl)));
    errors.push(...results.filter((error): error is string => error !== null));
  }

  if (errors.length > 0) {
    // Leave no half-verified directory behind for a deploy step to upload.
    for (const file of pinned) rmSync(join(outDir, `${file.file}.part`), { force: true });
    const what = values.perf ? 'perf dataset' : 'example bundle';
    console.error(`\n${errors.length} ${what}(s) failed verification:`);
    for (const error of errors) console.error(`  - ${error}`);
    return 1;
  }
  return 0;
}

process.exitCode = await main();
