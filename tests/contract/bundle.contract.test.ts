/**
 * Cross-language contract test for the .parquetbundle format.
 *
 * The bundles read here are written by the real `protspace bundle` CLI during
 * `beforeAll` (see emit_bundles.py) and read by the real web reader. Nothing is
 * committed: a fixture that cannot go stale is the whole point of the suite.
 *
 * The main direction is Python -> TypeScript, the path every dataset produced by
 * apps/prep takes. Every read goes through `decodeParquetBundle`, the single entry
 * point the decode worker and data-loader use, so the suite follows whatever format
 * version the producer currently writes (v3 since the columnar container landed).
 *
 * Two more paths cross the seam since v3 became the only written format: a legacy
 * v2 file upgraded by `protspace convert`, and the reverse direction, a bundle the
 * web app exports (packages/utils/src/parquet/bundle-writer.ts) reopened by the
 * Python tooling (read_bundles.py). Both are generated here too, never committed.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parquetMetadata, parquetRead } from 'hyparquet';

import { decodeParquetBundle } from '../../packages/core/src/components/data-loader/utils/bundle';
// Imported by source path, like the core reader above: the suite tests the
// working tree, not built package output. (The vitest config still aliases
// `@protspace/utils` — packages/core's own sources import it that way.)
import { BUNDLE_DELIMITER_BYTES } from '../../packages/utils/src/parquet/constants';
import { findBundleDelimiterPositions } from '../../packages/utils/src/parquet/delimiter-utils';
import { createParquetBundle } from '../../packages/utils/src/parquet/bundle-writer';
import { DataProcessor } from '../../packages/utils/src/visualization/data-processor';
import {
  getProteinAnnotationValues,
  getProteinScores,
} from '../../packages/utils/src/visualization/plot-data-accessors';
import { NA_VALUE } from '../../packages/utils/src/visualization/missing-values';
import type { VisualizationData } from '../../packages/utils/src/types';

const REPO_ROOT = resolve(__dirname, '../..');

/**
 * What the generator says it wrote, read from the manifest it emits alongside
 * the bundles — so the producer stays the single source of these values instead
 * of being mirrored here, where a drift fails in the consumer.
 */
interface Manifest {
  proteinCount: number;
  largeProteinCount: number;
  axisScale: [number, number, number];
  largeExpected: {
    family: string[];
    domains: string[][];
    domainScores: number[][];
    length: (number | null)[];
  };
  projectionCount: number;
  labelWithReservedChar: string;
  nullLengthIndex: number;
  statisticsColumns: string[];
  statisticsCategory: string;
  gapId: string;
  annotationOnlyId: string;
  projectionOnlyId: string;
  booleanById: Record<string, boolean | null>;
}

/** The format the producer writes today: six slots, payloads last. */
const PRODUCER_CONTAINER_VERSION = 3;
const PRODUCER_PART_COUNT = 6;
/** What part 1 of every bundle the producer writes declares about itself. */
const PRODUCER_CONTAINER = {
  partCount: PRODUCER_PART_COUNT,
  containerVersion: PRODUCER_CONTAINER_VERSION,
  // The cell-grammar key belongs to legacy parts and v2-shaped tables, never to a v3 part 1.
  cellGrammar: null,
};

let outDir: string;
let manifest: Manifest;

function loadBundle(variant: string): ArrayBuffer {
  const buffer = readFileSync(join(outDir, `${variant}.parquetbundle`));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * The container's physical layout: its part count and the two version keys of part 1's
 * footer, the container version (v3 only) and the legacy cell grammar (v1/v2 only).
 */
function inspectContainer(bundle: ArrayBuffer): {
  partCount: number;
  containerVersion: number | null;
  cellGrammar: string | null;
} {
  const positions = findBundleDelimiterPositions(new Uint8Array(bundle));
  const kv = parquetMetadata(bundle.slice(0, positions[0])).key_value_metadata ?? [];
  const value = (key: string) => kv.find((entry) => entry.key === key)?.value ?? null;
  const container = value('protspace_container_version');
  return {
    partCount: positions.length + 1,
    containerVersion: container === null ? null : Number(container),
    cellGrammar: value('protspace_format_version'),
  };
}

/** Run one of this suite's Python scripts in the protspace environment; returns stdout. */
function runPython(script: string, args: string[]): string {
  // --no-dev: `uv run` re-syncs the environment before executing, and without
  // this it syncs to the DEFAULT group set — silently undoing the workflow's
  // `uv sync --no-dev` one step later and pulling torch + the CUDA wheels back
  // in. Measured in CI: the teardown prune reported "Removed 47247 files
  // (5.9GiB)" for a job whose install step had reported 58 packages.
  // --locked: fail if uv.lock has drifted from pyproject rather than silently
  // re-resolving, so the contract runs against the versions we pinned.
  const result = spawnSync(
    'uv',
    ['run', '--package', 'protspace', '--no-dev', '--locked', 'python', script, ...args],
    // vitest's hookTimeout cannot fire while the main thread is blocked in
    // spawnSync, and the workflow's job timeout is the only other backstop —
    // so bound the child itself. maxBuffer: the 1 MiB default truncates the
    // producer traceback in exactly the failure you need to read.
    { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
  );

  // Without this the suite would fail later on a missing file, hiding the real
  // producer-side traceback. The script is also never allowed to be skipped:
  // an absent Python toolchain must fail the job, not quietly pass it.
  if (result.error) {
    throw new Error(`Could not run ${script}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${script} exited with ${result.status}\n` +
        `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
  return result.stdout;
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'protspace-contract-'));

  // The generator's failure paths run after the temp dir exists, and the cleanup
  // below is only *returned* — so without this the dir leaks on exactly the runs
  // you repeat most while debugging a producer-side break.
  try {
    runPython('tests/contract/emit_bundles.py', [outDir]);
    manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf-8'));
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }

  return () => rmSync(outDir, { recursive: true, force: true });
});

describe('bundle layouts the producer can write', () => {
  it('writes the current container layout and declares its format version', () => {
    // Fails if the producer stops stamping part 1, or drops the fixed six-slot layout
    // the v3 reader indexes positionally (payloads at parts[5]).
    for (const variant of ['minimal', 'with_settings', 'with_stats', 'stats_no_settings']) {
      expect(inspectContainer(loadBundle(variant))).toEqual(PRODUCER_CONTAINER);
    }
  });

  it('reads a bundle without settings or statistics', async () => {
    const { data, settings } = await decodeParquetBundle(loadBundle('minimal'));

    expect(data.protein_ids).toHaveLength(manifest.proteinCount);
    expect(data.projections).toHaveLength(manifest.projectionCount);
    expect(settings).toBeNull();
    expect(data.statistics).toBeUndefined();
  });

  it('reads a bundle with settings and normalizes them', async () => {
    const { settings } = await decodeParquetBundle(loadBundle('with_settings'));

    expect(settings).not.toBeNull();
    expect(settings?.legendSettings.family).toMatchObject({
      maxVisibleValues: 10,
      shapeSize: 24,
      sortMode: 'size-desc',
    });
  });

  it('reads a bundle with settings and statistics, keeping the two apart', async () => {
    const { data, settings } = await decodeParquetBundle(loadBundle('with_stats'));

    // The statistics part must not leak into the settings slot: the reader used
    // to slice part 4 to end-of-file, which glued statistics onto settings.
    expect(settings?.legendSettings.family).toMatchObject({ sortMode: 'size-desc' });
    expect(data.protein_ids).toHaveLength(manifest.proteinCount);

    // Unparsed but preserved, so re-exporting the bundle doesn't drop it. Assert
    // the magic bytes: a part sliced with the wrong bounds is still non-null.
    expect(data.statistics).toBeDefined();
    expect(new TextDecoder().decode(new Uint8Array(data.statistics!, 0, 4))).toBe('PAR1');

    // The render-side view of the same part. Carrying the bytes is what an export
    // needs; parsing them is what every ⓘ popover and score strip needs, and the
    // reader's schema guard fails that half silently (it warns and returns null,
    // which is indistinguishable from a bundle prepared without `--stats`). So
    // assert the parse against the producer's own schema, from the manifest.
    expect(data.statisticsRows).toBeDefined();
    // Sorted on both sides: a column added or renamed on either half of the seam
    // must fail, but the physical column order is not part of the contract.
    expect(Object.keys(data.statisticsRows![0]).sort()).toEqual(
      [...manifest.statisticsColumns].sort(),
    );
    // NULL `category` is the aggregate rows; a set one is the per-category
    // decomposition. Both must survive, since the reader tells them apart by it.
    const categories = data.statisticsRows!.map((row) => row.category);
    expect(categories).toContain(manifest.statisticsCategory);
    expect(categories.filter((category) => category == null)).not.toHaveLength(0);
  });

  it('reads a bundle whose settings slot is the zero-byte sentinel', async () => {
    // `settings === null` alone does NOT test the zero-byte handling: extractSettings
    // swallows the magic-byte failure into null anyway, so this assertion passes
    // with the handling removed. Its observable effect is that the empty slot is
    // recognised as the producer's sentinel rather than run through the settings
    // parser at all — so assert the parser was never entered.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { data, settings } = await decodeParquetBundle(loadBundle('stats_no_settings'));

      expect(settings).toBeNull();
      expect(data.protein_ids).toHaveLength(manifest.proteinCount);
      expect(data.statisticsRows).toBeDefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects a file carrying more parts than the format defines', async () => {
    const original = new Uint8Array(loadBundle('with_stats'));
    const extra = new Uint8Array(original.length + BUNDLE_DELIMITER_BYTES.length + 4);
    extra.set(original, 0);
    extra.set(BUNDLE_DELIMITER_BYTES, original.length);
    extra.set([0x50, 0x41, 0x52, 0x31], original.length + BUNDLE_DELIMITER_BYTES.length);

    // Pinned to the full message, not a bare /6/: byte offsets and row counts in
    // unrelated downstream errors also contain a '6', which would let a reader
    // that stopped enforcing the upper bound keep this test green.
    await expect(decodeParquetBundle(extra.buffer)).rejects.toThrow(
      /Expected 2 to 5 delimiters in parquetbundle, found 6/,
    );
  });
});

/**
 * The annotation contract every decoded bundle must satisfy, whatever its size.
 * `minimal` and `large` both carry the same positional payload from emit_bundles.py.
 */
function expectAnnotationContract(
  data: Awaited<ReturnType<typeof decodeParquetBundle>>['data'],
  proteinCount: number,
) {
  // The producer encodes the reserved ';' as %3B; a reader that skipped the
  // decode would surface the escape sequence verbatim.
  expect(data.annotations.family.values).toContain(manifest.labelWithReservedChar);
  expect(data.annotations.family.values.join('|')).not.toContain('%3B');

  // "DomA|0.91;DomB|0.82" — a reader that splits on '|' before ';' loses DomB.
  expect(data.annotations.domains.values).toContain('DomA');
  expect(data.annotations.domains.values).toContain('DomB');

  const lengths = data.numeric_annotation_data?.length;
  // Assert the length first: an out-of-range index yields `undefined`, which
  // would satisfy the null check below even if the reader dropped a protein.
  expect(lengths).toHaveLength(proteinCount);
  expect(
    lengths?.[manifest.nullLengthIndex] == null ||
      Number.isNaN(lengths?.[manifest.nullLengthIndex]),
  ).toBe(true);
  expect(lengths?.[0]).toBe(100);

  // structuredClone is the decode.worker.ts postMessage boundary; JSON.stringify
  // is how projection state is persisted and throws on a leaked BigInt.
  expect(() => structuredClone(data)).not.toThrow();
  expect(() => JSON.stringify(data.projections)).not.toThrow();
}

describe('annotation encoding across the language boundary', () => {
  it('decodes labels, multi-hit cells and missing numerics', async () => {
    const { data } = await decodeParquetBundle(loadBundle('minimal'));
    expectAnnotationContract(data, manifest.proteinCount);
  });

  it('exposes the third dimension of a 3D projection', async () => {
    const { data } = await decodeParquetBundle(loadBundle('minimal'));
    const projection3d = data.projections.find((p) => p.name === 'PCA_3');
    expect(projection3d?.dimension).toBe(3);
    expect(projection3d?.data.length).toBe(manifest.proteinCount * 3);

    const projection2d = data.projections.find((p) => p.name === 'PCA_2');
    expect(projection2d?.dimension).toBe(2);
  });

  it('decodes the same contract for a dataset of production scale', async () => {
    const { data } = await decodeParquetBundle(loadBundle('large'));
    expect(data.protein_ids).toHaveLength(manifest.largeProteinCount);
    expectAnnotationContract(data, manifest.largeProteinCount);
  });

  it('spans several data pages per column, as a production-scale bundle does', async () => {
    // The reader copies each decoded chunk at its row offset; a bundle that fits one
    // page per column only ever exercises offset 0, so the large variant has to be
    // past the page size, and this guards that it still is.
    const bundle = loadBundle('large');
    const positions = findBundleDelimiterPositions(new Uint8Array(bundle));
    const part = (index: number) =>
      bundle.slice(
        index === 0 ? 0 : positions[index - 1] + BUNDLE_DELIMITER_BYTES.length,
        positions[index],
      );
    for (const [index, column] of [
      [0, 'family'],
      [2, 'PCA_3__z'],
    ] as const) {
      const rowStarts: number[] = [];
      await parquetRead({
        file: part(index),
        columns: [column],
        onChunk: ({ rowStart }) => rowStarts.push(rowStart),
      });
      expect(Math.max(...rowStarts), column).toBeGreaterThan(0);
    }
  });

  it('decodes every row of the large bundle, not just the first ones', async () => {
    const { data } = await decodeParquetBundle(loadBundle('large'));
    const expected = manifest.largeExpected;
    const n = manifest.largeProteinCount;
    const lengths = data.numeric_annotation_data!.length;

    // Compared as whole arrays, so a failure names the first row that differs
    // instead of stopping at one assertion per row.
    const decoded = {
      family: [] as string[][],
      domains: [] as string[][],
      scores: [] as unknown[],
    };
    for (let row = 0; row < n; row++) {
      decoded.family.push(getProteinAnnotationValues(data, row, 'family'));
      decoded.domains.push(getProteinAnnotationValues(data, row, 'domains'));
      decoded.scores.push(getProteinScores(data, row, 'domains'));
    }
    expect(decoded.family).toEqual(expected.family.map((label) => [label]));
    expect(decoded.domains).toEqual(expected.domains);
    expect(decoded.scores).toEqual(expected.domainScores.map((scores) => scores.map((s) => [s])));
    expect(Array.from(lengths, (value) => (Number.isNaN(value) ? null : value))).toEqual(
      expected.length,
    );

    for (const projection of data.projections) {
      const { dimension } = projection;
      const want = new Float32Array(n * dimension);
      for (let row = 0; row < n; row++) {
        for (let axis = 0; axis < dimension; axis++) {
          want[row * dimension + axis] = row * manifest.axisScale[axis];
        }
      }
      expect(projection.data, projection.name).toEqual(want);
    }
  });
});

/** The finite points the scatter plot would draw for a projection, by protein id. */
function drawnIds(data: VisualizationData, projectionName: string): string[] {
  const index = data.projections.findIndex((p) => p.name === projectionName);
  const plot = DataProcessor.processVisualizationData(data, index);
  return Array.from({ length: plot.length }, (_, slot) => {
    const protein = plot.originalIndices ? plot.originalIndices[slot] : slot;
    return data.protein_ids[protein];
  });
}

describe('proteins the annotations and projections disagree on', () => {
  it('keeps a protein one projection misses, with NaN there and not drawn there', async () => {
    const { data } = await decodeParquetBundle(loadBundle('coverage'));
    const row = data.protein_ids.indexOf(manifest.gapId);
    expect(row).toBeGreaterThanOrEqual(0);

    // NaN, never (0, 0): the origin is a real coordinate.
    const pca3 = data.projections.find((p) => p.name === 'PCA_3')!;
    expect(Array.from(pca3.data.subarray(row * 3, row * 3 + 3))).toEqual([NaN, NaN, NaN]);
    expect(drawnIds(data, 'PCA_3')).not.toContain(manifest.gapId);
    expect(drawnIds(data, 'PCA_2')).toContain(manifest.gapId);
  });

  it('leaves out a protein no projection covers', async () => {
    // The file keeps it in part 1 (lossless); the browser shows only placed proteins.
    const { data } = await decodeParquetBundle(loadBundle('coverage'));
    expect(data.protein_ids).not.toContain(manifest.annotationOnlyId);
    expect(data.protein_ids).toHaveLength(Object.keys(manifest.booleanById).length);
  });

  it('shows a projected protein without an annotations row as N/A', async () => {
    const { data } = await decodeParquetBundle(loadBundle('coverage'));
    const row = data.protein_ids.indexOf(manifest.projectionOnlyId);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(getProteinAnnotationValues(data, row, 'family')).toEqual([NA_VALUE]);
    expect(getProteinAnnotationValues(data, row, 'reviewed')).toEqual([NA_VALUE]);
    expect(drawnIds(data, 'PCA_2')).toContain(manifest.projectionOnlyId);
  });

  it('shows an Arrow BOOLEAN column as true / false', async () => {
    const { data } = await decodeParquetBundle(loadBundle('coverage'));
    for (const [id, value] of Object.entries(manifest.booleanById)) {
      const row = data.protein_ids.indexOf(id);
      if (row < 0) continue; // the annotation-only protein, asserted absent above
      expect(getProteinAnnotationValues(data, row, 'reviewed')).toEqual([
        value == null ? NA_VALUE : String(value),
      ]);
    }
  });
});

/**
 * What a decoded dataset means, independent of the storage a reader chose (a legacy
 * load and a v3 load hold the same hits in different shapes): per protein, the
 * values and scores of every categorical annotation and the value of every numeric one.
 */
function meaning(data: VisualizationData) {
  const annotations: Record<string, unknown> = {};
  for (const [key, annotation] of Object.entries(data.annotations)) {
    annotations[key] =
      annotation.kind === 'numeric'
        ? Array.from(data.numeric_annotation_data?.[key] ?? [])
        : data.protein_ids.map((_, row) => ({
            values: getProteinAnnotationValues(data, row, key),
            scores: getProteinScores(data, row, key),
          }));
  }
  return {
    protein_ids: data.protein_ids,
    projections: data.projections.map(({ name, dimension, data: coordinates, metadata }) => ({
      name,
      dimension,
      coordinates: Array.from(coordinates),
      metadata,
    })),
    annotations,
  };
}

describe('protspace convert', () => {
  it('upgrades a v2 bundle to v3 that reads back as the same dataset', async () => {
    // Fails if convert drops a part, re-spells a cell, or loses the projection gap.
    const legacy = await decodeParquetBundle(loadBundle('legacy_v2'));
    const converted = await decodeParquetBundle(loadBundle('converted'));

    expect(legacy.formatVersion).toBe(2);
    expect(inspectContainer(loadBundle('legacy_v2'))).toEqual({
      partCount: 5,
      containerVersion: null,
      cellGrammar: '2',
    });
    expect(inspectContainer(loadBundle('converted'))).toEqual(PRODUCER_CONTAINER);
    expect(converted.formatVersion).toBe(PRODUCER_CONTAINER_VERSION);

    expect(meaning(converted.data)).toEqual(meaning(legacy.data));
    expect(converted.data.protein_ids).toContain(manifest.gapId);
    expect(converted.settings).toEqual(legacy.settings);
    expect(new Uint8Array(converted.data.statistics!)).toEqual(
      new Uint8Array(legacy.data.statistics!),
    );
  });
});

type PythonSummary = {
  annotations: Record<string, Record<string, unknown>>;
  types: Record<string, string>;
  projections: Record<string, Record<string, number[]>>;
  statistics: string | null;
  hasSettings: boolean;
};

describe('bundles the web app exports, read by the Python tooling', () => {
  it.each(['coverage', 'with_stats'])(
    'reads a web re-export of %s as the dataset Python wrote',
    async (variant) => {
      // The web writer re-encodes every part but the statistics from memory, so this
      // catches a TS writer that Python cannot decode, or decodes to other values.
      const { data, settings } = await decodeParquetBundle(loadBundle(variant));
      const exported = join(outDir, `web_${variant}.parquetbundle`);
      writeFileSync(
        exported,
        new Uint8Array(
          createParquetBundle(data, {
            includeSettings: !!settings,
            settings: settings ?? undefined,
          }),
        ),
      );
      const original = join(outDir, `${variant}.parquetbundle`);
      const summaries: Record<string, PythonSummary> = JSON.parse(
        runPython('tests/contract/read_bundles.py', [original, exported]),
      );
      const [written, reexported] = [summaries[original], summaries[exported]];

      expect(inspectContainer(loadBundle(`web_${variant}`))).toEqual(PRODUCER_CONTAINER);
      // The only intended difference: a protein no projection places is not in the
      // browser's dataset, so it is not in what the browser exports.
      expect(manifest.annotationOnlyId in written.annotations).toBe(variant === 'coverage');
      delete written.annotations[manifest.annotationOnlyId];
      // Same column types, not just the same values: the writer echoes the manifest's
      // sourceType, so Python reads the BOOLEAN column as bool and a float64 column of
      // whole numbers as double, exactly as from the file it wrote itself.
      expect(reexported.types).toEqual(written.types);
      if (variant === 'coverage') {
        expect(written.types.reviewed).toBe('bool');
        // A hash past 2^53 (stored as exact labels) and the ±2^53 edge (stored as numbers).
        expect(written.types.hash).toBe('int64');
        expect(written.types.edge).toBe('int64');
      }
      expect(reexported.annotations).toEqual(written.annotations);
      expect(reexported.projections).toEqual(written.projections);
      expect(reexported.statistics).toBe(written.statistics);
      expect(reexported.hasSettings).toBe(written.hasSettings);
    },
  );
});
