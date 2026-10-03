import { readFileSync } from 'node:fs';

/** One dataset of the `perf-datasets` release. */
interface PerfDataset {
  id: string;
  file: string;
  bytes: number;
  sha256: string;
  /** In the default sweep (`pnpm perf` without `PERF_DATASETS`). */
  default: boolean;
}

/** `perf/datasets.manifest.json`: the `perf-datasets` release's files, which `pnpm perf:fetch` downloads. */
interface PerfManifest {
  release: string;
  datasets: PerfDataset[];
}

/**
 * Reads the perf manifest at `path` (`perf/datasets.manifest.json`), for the
 * benchmark (`webgl-perf.spec.ts`) and for `pnpm perf:fetch`
 * (`scripts/examples/fetch.mts`). Throws when it is not `{ release, datasets }`.
 */
export function readPerfManifest(path: string): PerfManifest {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Partial<PerfManifest> | null;
  if (typeof manifest?.release !== 'string' || !Array.isArray(manifest.datasets)) {
    throw new Error(
      `${path} is not { release, datasets: [...] }; ` +
        'rewrite it with apps/protspace/scripts/generate_examples/stage_perf.py',
    );
  }
  return manifest as PerfManifest;
}
