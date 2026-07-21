/**
 * Cross-language contract test for the .parquetbundle format.
 *
 * The bundles read here are written by the real `protspace bundle` CLI during
 * `beforeAll` (see emit_bundles.py) and read by the real web reader. Nothing is
 * committed: a fixture that cannot go stale is the whole point of the suite.
 *
 * This is the Python -> TypeScript direction, the path every dataset produced by
 * apps/prep takes. The reverse direction (bundles exported by
 * packages/utils/bundle-writer.ts and reopened in the Python tooling) is a
 * documented non-goal of the add-bundle-contract-test change.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { extractRowsFromParquetBundle } from '../../packages/core/src/components/data-loader/utils/bundle';
import {
  convertParquetToVisualizationData,
  convertParquetToVisualizationDataOptimized,
  OPTIMIZED_PATH_ROW_THRESHOLD,
} from '../../packages/core/src/components/data-loader/utils/conversion';
// Imported by source path, like the core reader above: the suite tests the
// working tree, not built package output. (The vitest config still aliases
// `@protspace/utils` — packages/core's own sources import it that way.)
import { BUNDLE_DELIMITER_BYTES } from '../../packages/utils/src/parquet/constants';

const REPO_ROOT = resolve(__dirname, '../..');
const PROTEIN_COUNT = 10;
const PROJECTION_COUNT = 2;
/** Mirrors LARGE_PROTEIN_COUNT in emit_bundles.py. */
const LARGE_PROTEIN_COUNT = 6_000;

/** Mirrors emit_bundles.py — the value the producer percent-encodes. */
const LABEL_WITH_RESERVED_CHAR = 'Kinase (EC 2.7.11.1); regulatory subunit';

let outDir: string;

function loadBundle(variant: string): ArrayBuffer {
  const buffer = readFileSync(join(outDir, `${variant}.parquetbundle`));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'protspace-contract-'));

  // The generator's failure paths run after the temp dir exists, and the cleanup
  // below is only *returned* — so without this the dir leaks on exactly the runs
  // you repeat most while debugging a producer-side break.
  try {
    const result = spawnSync(
      'uv',
      ['run', '--package', 'protspace', 'python', 'tests/contract/emit_bundles.py', outDir],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
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
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }

  return () => rmSync(outDir, { recursive: true, force: true });
});

describe('bundle layouts the producer can write', () => {
  it('reads a 3-part bundle and reports the producer format version', async () => {
    const extraction = await extractRowsFromParquetBundle(loadBundle('minimal'));

    // The CLI renames `identifier` -> `protein_id` on the annotations table only.
    expect(extraction.annotationIdColumn).toBe('protein_id');
    expect(extraction.projectionIdColumn).toBe('identifier');

    expect(extraction.annotationsById.size).toBe(PROTEIN_COUNT);
    expect(extraction.projections).toHaveLength(PROTEIN_COUNT * PROJECTION_COUNT);
    expect(extraction.projectionsMetadata).toHaveLength(PROJECTION_COUNT);

    // Fails if `stamp_format_version` stops being applied by the bundle CLI.
    expect(extraction.formatVersion).toBe(2);
    expect(extraction.settings).toBeNull();
  });

  it('reads a 4-part bundle and normalizes its settings', async () => {
    const extraction = await extractRowsFromParquetBundle(loadBundle('with_settings'));

    expect(extraction.settings).not.toBeNull();
    expect(extraction.settings?.legendSettings.family).toMatchObject({
      maxVisibleValues: 10,
      shapeSize: 24,
      sortMode: 'size-desc',
    });
  });

  it('reads a 5-part bundle, keeping settings and ignoring statistics', async () => {
    const extraction = await extractRowsFromParquetBundle(loadBundle('with_stats'));

    // The statistics part must not leak into the settings slot: the reader used
    // to slice part 4 to end-of-file, which glued statistics onto settings.
    expect(extraction.settings?.legendSettings.family).toMatchObject({ sortMode: 'size-desc' });
    expect(extraction.projections).toHaveLength(PROTEIN_COUNT * PROJECTION_COUNT);
  });

  it('reads a 5-part bundle whose settings slot is the zero-byte sentinel', async () => {
    // `settings === null` alone does NOT test the byteLength guard: extractSettings
    // swallows the magic-byte failure into null anyway, so this assertion passes
    // with the guard removed. The guard's observable effect is that the empty slot
    // is recognised as the producer's sentinel rather than run through the settings
    // parser at all — so assert the parser was never entered.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const extraction = await extractRowsFromParquetBundle(loadBundle('stats_no_settings'));

      expect(extraction.settings).toBeNull();
      expect(extraction.annotationsById.size).toBe(PROTEIN_COUNT);
      expect(extraction.projections).toHaveLength(PROTEIN_COUNT * PROJECTION_COUNT);
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

    // Pinned to the full message, not a bare /5/: byte offsets and row counts in
    // unrelated downstream errors also contain a '5', which would let a reader
    // that stopped enforcing the upper bound keep this test green.
    await expect(extractRowsFromParquetBundle(extra.buffer)).rejects.toThrow(
      /Expected 2 to 4 delimiters in parquetbundle, found 5/,
    );
  });
});

describe('annotation encoding across the language boundary', () => {
  // Every case below reads the same `minimal` bundle, so decode it once. These
  // assertions are all pure reads of the converted result; none mutates it, and
  // none needs a spy installed before the decode (unlike the sentinel case
  // above, which must extract inside the test body to observe console.warn).
  let data: Awaited<ReturnType<typeof convertParquetToVisualizationData>>;

  beforeAll(async () => {
    data = convertParquetToVisualizationData(
      await extractRowsFromParquetBundle(loadBundle('minimal')),
    );
  });

  it('decodes a percent-encoded label back to its literal characters', () => {
    // The producer encodes the reserved ';' as %3B; a v1 reader would surface
    // the escape sequence verbatim.
    expect(data.annotations.family.values).toContain(LABEL_WITH_RESERVED_CHAR);
    expect(data.annotations.family.values.join('|')).not.toContain('%3B');
  });

  it('splits a multi-hit cell into separate labels', () => {
    // "DomA|0.91;DomB|0.82" — a reader that splits on '|' before ';' loses DomB.
    expect(data.annotations.domains.values).toContain('DomA');
    expect(data.annotations.domains.values).toContain('DomB');
  });

  it('reports a missing numeric value as missing rather than zero', () => {
    const lengths = data.numeric_annotation_data?.length;
    // Assert the length first: an out-of-range index yields `undefined`, which
    // would satisfy the null check below even if the reader dropped a protein.
    expect(lengths).toHaveLength(PROTEIN_COUNT);
    // emit_bundles.py nulls the 4th protein's length.
    expect(lengths?.[3] == null || Number.isNaN(lengths?.[3])).toBe(true);
    expect(lengths?.[0]).toBe(100);
  });

  it('exposes the third dimension of a 3D projection', () => {
    const projection3d = data.projections.find((p) => p.name === 'PCA_3');
    expect(projection3d?.dimension).toBe(3);
    expect(projection3d?.data.length).toBe(PROTEIN_COUNT * 3);

    const projection2d = data.projections.find((p) => p.name === 'PCA_2');
    expect(projection2d?.dimension).toBe(2);
  });

  it('produces data that survives serialization despite BigInt-valued columns', () => {
    // `dimensions` is an int64 column, so the raw extraction really does hand back
    // a BigInt (verified: `typeof extraction.projectionsMetadata[0].dimensions`
    // === 'bigint'); conversion is what normalizes it away. Merely converting is
    // not the contract — four tests above already do that — so serialize:
    //   - JSON.stringify throws on BigInt, and is how state is persisted;
    //   - structuredClone tolerates BigInt but rejects functions/DOM refs, and is
    //     the decode.worker.ts postMessage boundary.
    // They catch different regressions; neither subsumes the other.
    expect(() => JSON.stringify(data.projections)).not.toThrow();
    expect(() => structuredClone(data)).not.toThrow();
  });
});

describe('the optimized conversion path real datasets take', () => {
  // Below OPTIMIZED_PATH_ROW_THRESHOLD projection rows the optimized entry point
  // delegates to the small-data implementation, so the 10-protein variants never
  // reach the separated decoder decode.worker.ts uses for production datasets.
  //
  // Guard the fixture against the threshold itself, not a copy of its value: if
  // the threshold is raised above what emit_bundles.py generates, this describe
  // silently degrades into a duplicate of the four small-data tests above. That
  // is the one way this suite can stop protecting without going red — so make it
  // go red. Raising the threshold means raising LARGE_PROTEIN_COUNT in both this
  // file and emit_bundles.py.
  it('generates a fixture that actually crosses the optimized-path threshold', () => {
    expect(LARGE_PROTEIN_COUNT * PROJECTION_COUNT).toBeGreaterThanOrEqual(
      OPTIMIZED_PATH_ROW_THRESHOLD,
    );
  });

  it('decodes the same annotation contract as the small-data path', async () => {
    const extraction = await extractRowsFromParquetBundle(loadBundle('large'));
    expect(extraction.projections.length).toBeGreaterThanOrEqual(OPTIMIZED_PATH_ROW_THRESHOLD);
    expect(extraction.formatVersion).toBe(2);

    const data = await convertParquetToVisualizationDataOptimized(extraction);

    expect(data.protein_ids).toHaveLength(LARGE_PROTEIN_COUNT);
    // The same positional payload as `minimal`, now through the other decoder.
    expect(data.annotations.family.values).toContain(LABEL_WITH_RESERVED_CHAR);
    expect(data.annotations.family.values.join('|')).not.toContain('%3B');
    expect(data.annotations.domains.values).toContain('DomA');
    expect(data.annotations.domains.values).toContain('DomB');

    const lengths = data.numeric_annotation_data?.length;
    expect(lengths).toHaveLength(LARGE_PROTEIN_COUNT);
    expect(lengths?.[3] == null || Number.isNaN(lengths?.[3])).toBe(true);

    expect(() => structuredClone(data)).not.toThrow();
  });
});
