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
import { getProteinAnnotationValues } from '../../packages/utils/src/visualization/plot-data-accessors';

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
  negativeTransmembraneCategory: string;
  missingTransmembraneIndex: number;
  malformedTmbedIndex: number;
  nullLengthIndex: number;
  statisticsColumns: string[];
  statisticsCategory: string;
}

let outDir: string;
let manifest: Manifest;

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
  it('reads a 3-part bundle and reports the producer format version', async () => {
    const extraction = await extractRowsFromParquetBundle(loadBundle('minimal'));

    // The CLI renames `identifier` -> `protein_id` on the annotations table only.
    expect(extraction.annotationIdColumn).toBe('protein_id');
    expect(extraction.projectionIdColumn).toBe('identifier');

    expect(extraction.annotationsById.size).toBe(manifest.proteinCount);
    expect(extraction.projections).toHaveLength(manifest.proteinCount * manifest.projectionCount);
    expect(extraction.projectionsMetadata).toHaveLength(manifest.projectionCount);

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

  it('reads a 5-part bundle, keeping settings and carrying statistics', async () => {
    const extraction = await extractRowsFromParquetBundle(loadBundle('with_stats'));

    // The statistics part must not leak into the settings slot: the reader used
    // to slice part 4 to end-of-file, which glued statistics onto settings.
    expect(extraction.settings?.legendSettings.family).toMatchObject({ sortMode: 'size-desc' });
    expect(extraction.projections).toHaveLength(manifest.proteinCount * manifest.projectionCount);

    // Unparsed but preserved, so re-exporting the bundle doesn't drop it. Assert
    // the magic bytes: a part sliced with the wrong bounds is still non-null.
    expect(extraction.statistics).not.toBeNull();
    expect(new TextDecoder().decode(new Uint8Array(extraction.statistics!, 0, 4))).toBe('PAR1');

    // The render-side view of the same part. Carrying the bytes is what an export
    // needs; parsing them is what every ⓘ popover and score strip needs, and the
    // reader's schema guard fails that half silently (it warns and returns null,
    // which is indistinguishable from a bundle prepared without `--stats`). So
    // assert the parse against the producer's own schema, from the manifest.
    expect(extraction.statisticsRows).not.toBeNull();
    // Sorted on both sides: a column added or renamed on either half of the seam
    // must fail, but the physical column order is not part of the contract.
    expect(Object.keys(extraction.statisticsRows![0]).sort()).toEqual(
      [...manifest.statisticsColumns].sort(),
    );
    // NULL `category` is the aggregate rows; a set one is the per-category
    // decomposition. Both must survive, since the reader tells them apart by it.
    const categories = extraction.statisticsRows!.map((row) => row.category);
    expect(categories).toContain(manifest.statisticsCategory);
    expect(categories.filter((category) => category == null)).not.toHaveLength(0);
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
      expect(extraction.annotationsById.size).toBe(manifest.proteinCount);
      expect(extraction.projections).toHaveLength(manifest.proteinCount * manifest.projectionCount);
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
    expect(data.annotations.family.values).toContain(manifest.labelWithReservedChar);
    expect(data.annotations.family.values.join('|')).not.toContain('%3B');
  });

  it('splits a multi-hit cell into separate labels', () => {
    // "DomA|0.91;DomB|0.82" — a reader that splits on '|' before ';' loses DomB.
    expect(data.annotations.domains.values).toContain('DomA');
    expect(data.annotations.domains.values).toContain('DomB');
  });

  it('preserves a negative TMbed prediction as a category', () => {
    expect(data.annotations.predicted_transmembrane.values).toContain(
      manifest.negativeTransmembraneCategory,
    );
  });

  it('preserves a missing TMbed payload as N/A', () => {
    expect(
      getProteinAnnotationValues(
        data,
        manifest.missingTransmembraneIndex,
        'predicted_transmembrane',
      ),
    ).toEqual(['__NA__']);
  });

  it('preserves a missing TMbed payload as N/A for signal peptide', () => {
    expect(
      getProteinAnnotationValues(
        data,
        manifest.missingTransmembraneIndex,
        'predicted_signal_peptide',
      ),
    ).toEqual(['__NA__']);
  });

  it('preserves a malformed TMbed payload as N/A', () => {
    expect(
      getProteinAnnotationValues(data, manifest.malformedTmbedIndex, 'predicted_transmembrane'),
    ).toEqual(['__NA__']);
    expect(
      getProteinAnnotationValues(data, manifest.malformedTmbedIndex, 'predicted_signal_peptide'),
    ).toEqual(['__NA__']);
  });

  it('reports a missing numeric value as missing rather than zero', () => {
    const lengths = data.numeric_annotation_data?.length;
    // Assert the length first: an out-of-range index yields `undefined`, which
    // would satisfy the null check below even if the reader dropped a protein.
    expect(lengths).toHaveLength(manifest.proteinCount);
    expect(
      lengths?.[manifest.nullLengthIndex] == null ||
        Number.isNaN(lengths?.[manifest.nullLengthIndex]),
    ).toBe(true);
    expect(lengths?.[0]).toBe(100);
  });

  it('exposes the third dimension of a 3D projection', () => {
    const projection3d = data.projections.find((p) => p.name === 'PCA_3');
    expect(projection3d?.dimension).toBe(3);
    expect(projection3d?.data.length).toBe(manifest.proteinCount * 3);

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
  // Guard the fixture against the real threshold, not a copy of its value: if the
  // threshold is raised above what emit_bundles.py generates, this block silently
  // degrades into a duplicate of the small-data tests above — the one way this
  // suite can stop protecting without going red. Asserted below against the
  // generated bundle rather than against the manifest, so a generator that stops
  // clearing the threshold fails here rather than quietly agreeing with itself.
  it('decodes the same annotation contract as the small-data path', async () => {
    const extraction = await extractRowsFromParquetBundle(loadBundle('large'));
    expect(extraction.projections.length).toBeGreaterThanOrEqual(OPTIMIZED_PATH_ROW_THRESHOLD);
    expect(extraction.formatVersion).toBe(2);

    const data = await convertParquetToVisualizationDataOptimized(extraction);

    expect(data.protein_ids).toHaveLength(manifest.largeProteinCount);
    // The same positional payload as `minimal`, now through the other decoder.
    expect(data.annotations.family.values).toContain(manifest.labelWithReservedChar);
    expect(data.annotations.family.values.join('|')).not.toContain('%3B');
    expect(data.annotations.domains.values).toContain('DomA');
    expect(data.annotations.domains.values).toContain('DomB');
    expect(data.annotations.predicted_transmembrane.values).toContain(
      manifest.negativeTransmembraneCategory,
    );
    expect(
      getProteinAnnotationValues(
        data,
        manifest.missingTransmembraneIndex,
        'predicted_transmembrane',
      ),
    ).toEqual(['__NA__']);

    const lengths = data.numeric_annotation_data?.length;
    expect(lengths).toHaveLength(manifest.largeProteinCount);
    expect(
      lengths?.[manifest.nullLengthIndex] == null ||
        Number.isNaN(lengths?.[manifest.nullLengthIndex]),
    ).toBe(true);

    expect(() => structuredClone(data)).not.toThrow();
  });
});
