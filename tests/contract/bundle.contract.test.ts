/**
 * Cross-language contract test for the .parquetbundle format.
 *
 * The bundles read here are written by the real `protspace bundle` CLI during
 * `beforeAll` (see emit_bundles.py) and read by the real web reader. Nothing is
 * committed: a fixture that cannot go stale is the whole point of the suite.
 *
 * This is the Python -> TypeScript direction, the path every dataset produced by
 * apps/prep takes. Every read goes through `decodeParquetBundle`, the single entry
 * point the decode worker and data-loader use, so the suite follows whatever format
 * version the producer currently writes (v3 since the columnar container landed). The reverse direction (bundles exported by
 * packages/utils/bundle-writer.ts and reopened in the Python tooling) is a
 * documented non-goal of the add-bundle-contract-test change.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parquetMetadata } from 'hyparquet';

import { decodeParquetBundle } from '../../packages/core/src/components/data-loader/utils/bundle';
// Imported by source path, like the core reader above: the suite tests the
// working tree, not built package output. (The vitest config still aliases
// `@protspace/utils` — packages/core's own sources import it that way.)
import { BUNDLE_DELIMITER_BYTES } from '../../packages/utils/src/parquet/constants';
import { findBundleDelimiterPositions } from '../../packages/utils/src/parquet/delimiter-utils';

const REPO_ROOT = resolve(__dirname, '../..');

/**
 * What the generator says it wrote, read from the manifest it emits alongside
 * the bundles — so the producer stays the single source of these values instead
 * of being mirrored here, where a drift fails in the consumer.
 */
interface Manifest {
  proteinCount: number;
  largeProteinCount: number;
  projectionCount: number;
  labelWithReservedChar: string;
  nullLengthIndex: number;
  statisticsColumns: string[];
  statisticsCategory: string;
}

/** The format the producer writes today: six slots, payloads last. */
const PRODUCER_FORMAT_VERSION = 3;
const PRODUCER_PART_COUNT = 6;

let outDir: string;
let manifest: Manifest;

function loadBundle(variant: string): ArrayBuffer {
  const buffer = readFileSync(join(outDir, `${variant}.parquetbundle`));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** The container's physical layout: its part count and part 1's declared format. */
function inspectContainer(bundle: ArrayBuffer): { partCount: number; formatVersion: number } {
  const positions = findBundleDelimiterPositions(new Uint8Array(bundle));
  const kv = parquetMetadata(bundle.slice(0, positions[0])).key_value_metadata ?? [];
  const version = kv.find((entry) => entry.key === 'protspace_format_version')?.value;
  return { partCount: positions.length + 1, formatVersion: Number(version ?? 1) };
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'protspace-contract-'));

  // The generator's failure paths run after the temp dir exists, and the cleanup
  // below is only *returned* — so without this the dir leaks on exactly the runs
  // you repeat most while debugging a producer-side break.
  try {
    // --no-dev: `uv run` re-syncs the environment before executing, and without
    // this it syncs to the DEFAULT group set — silently undoing the workflow's
    // `uv sync --no-dev` one step later and pulling torch + the CUDA wheels back
    // in. Measured in CI: the teardown prune reported "Removed 47247 files
    // (5.9GiB)" for a job whose install step had reported 58 packages.
    // --locked: fail if uv.lock has drifted from pyproject rather than silently
    // re-resolving, so the contract runs against the versions we pinned.
    const result = spawnSync(
      'uv',
      [
        'run',
        '--package',
        'protspace',
        '--no-dev',
        '--locked',
        'python',
        'tests/contract/emit_bundles.py',
        outDir,
      ],
      // vitest's hookTimeout cannot fire while the main thread is blocked in
      // spawnSync, and the workflow's job timeout is the only other backstop —
      // so bound the child itself. maxBuffer: the 1 MiB default truncates the
      // producer traceback in exactly the failure you need to read.
      { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
    );

    // Without this the suite would fail later on a missing file, hiding the real
    // producer-side traceback. The generator is also never allowed to be skipped:
    // an absent Python toolchain must fail the job, not quietly pass it.
    if (result.error) {
      throw new Error(`Could not run the bundle generator: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `Bundle generator exited with ${result.status}\n` +
          `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    }
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
      expect(inspectContainer(loadBundle(variant))).toEqual({
        partCount: PRODUCER_PART_COUNT,
        formatVersion: PRODUCER_FORMAT_VERSION,
      });
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
});
