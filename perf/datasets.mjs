// The benchmark datasets for the .mjs perf tools (perf.mjs, scale.mjs): the files of
// perf/datasets.manifest.json, which `pnpm perf:fetch` downloads into the gitignored perf/datasets/.
// TypeScript callers use readPerfManifest (perf/datasets-manifest.ts) instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, 'datasets.manifest.json');
const DATASETS_DIR = path.join(HERE, 'datasets');

/**
 * The file of the perf dataset `id`. Returns `{ file }` when it is downloaded, else
 * `{ error }`: an unknown id lists the known ones, a missing file names the fetch command.
 */
export function perfDatasetFile(id) {
  const { datasets } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const dataset = datasets.find((d) => d.id === id);
  if (!dataset) {
    return { error: `no dataset ${id}; known: ${datasets.map((d) => d.id).join(', ')}` };
  }
  const file = path.join(DATASETS_DIR, dataset.file);
  if (!fs.existsSync(file)) {
    return {
      error: `${path.relative(process.cwd(), file)} is missing; run pnpm perf:fetch --only ${id}`,
    };
  }
  return { file };
}
