/**
 * Checks of a file a manifest pins by its size and sha256, shared by
 * `scripts/examples/fetch.mts` and `docs/scripts/generate-examples.mts`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = join(REPO_ROOT, 'apps/web/public');

/** What a pinned file's bytes must be. */
export interface Fingerprint {
  bytes: number;
  sha256: string;
}

/** The size and sha256 of `data`. */
function fingerprint(data: Uint8Array): Fingerprint {
  return { bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') };
}

/** Why `actual` is not the pinned file, or `null` when it is. */
export function mismatch(actual: Fingerprint, pinned: Fingerprint): string | null {
  if (actual.bytes !== pinned.bytes) {
    return `${actual.bytes} bytes, expected ${pinned.bytes}`;
  }
  return actual.sha256 === pinned.sha256
    ? null
    : `sha256 ${actual.sha256}, expected ${pinned.sha256}`;
}

/** Why the file at `path` is not the pinned file (`'missing'` when there is none), or `null`. */
export function fileMismatch(path: string, pinned: Fingerprint): string | null {
  return existsSync(path) ? mismatch(fingerprint(readFileSync(path)), pinned) : 'missing';
}

/**
 * Why the repository's copy of a repo-hosted example, `apps/web/public/<file>`,
 * is not the file its manifest record pins, or `null` when it is.
 */
export function repoFileProblem(
  label: string,
  record: Fingerprint & { file: string },
): string | null {
  const path = join(PUBLIC_DIR, record.file);
  const problem = fileMismatch(path, record);
  if (problem === null) {
    return null;
  }
  const shown = relative(REPO_ROOT, path);
  return problem === 'missing'
    ? `${label}: ${shown} is missing`
    : `${label}: ${shown} does not match its manifest record (${problem}); rerun write_manifest.py --refresh`;
}
