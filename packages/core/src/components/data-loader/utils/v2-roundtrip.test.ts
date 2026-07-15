import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createParquetBundle,
  getProteinAnnotationIndices,
  isNAValue,
  type VisualizationData,
} from '@protspace/utils';
import { extractRowsFromParquetBundle } from './bundle';
import { convertParquetToVisualizationDataOptimized } from './conversion';

function perProteinAnnotationSets(
  data: VisualizationData,
  annotationNames: readonly string[],
): Record<string, Record<string, string[]>> {
  return Object.fromEntries(
    data.protein_ids.map((proteinId, proteinIndex) => [
      proteinId,
      Object.fromEntries(
        annotationNames.map((annotationName) => {
          const annotation = data.annotations[annotationName];
          const rows = data.annotation_data[annotationName];
          const values = getProteinAnnotationIndices(rows, proteinIndex)
            .map((valueIndex) => annotation.values[valueIndex])
            .filter((value): value is string => value != null && !isNAValue(value))
            .sort();
          return [annotationName, values];
        }),
      ),
    ]),
  );
}

/**
 * Task J1: cross-repo golden-fixture proof (#56/#57/#58).
 *
 * `__fixtures__/v2-sample.parquetbundle` is a REAL bundle produced by the
 * `protspace` backend's v2 writer (`stamp_format_version` + `encode_field` +
 * `write_bundle`), not a hand-rolled mock. It carries:
 *  - P1's `cath` cell: two hits separated by the structural `;` — the first
 *    hit's name legitimately contains a `;` (percent-encoded by the backend
 *    as `%3B` so it survives the split), the second hit is a bare CATH code
 *    with no name at all.
 *  - P2's `cath` cell: a single bare CATH code with no name (regression
 *    guard against fabricating a name for an unnamed hit).
 *  - `go_bp`: an evidence-coded value (`label|EVIDENCE`) on P1, empty on P2.
 *
 * Regenerate with (from the `protspace` repo):
 *   uv run python - <<'PY'
 *   import pyarrow as pa
 *   from pathlib import Path
 *   from protspace.data.annotations.encoding import encode_field, stamp_format_version
 *   from protspace.data.io.bundle import write_bundle
 *   sc = encode_field("Ribosomal Protein L15; Chain: K; domain 2")
 *   ann = stamp_format_version(pa.table({
 *       "protein_id": ["P1", "P2"],
 *       "cath": [f"G3DSA:1.10.10.10 ({sc})|50.2;G3DSA:6.20.10.10|60.5", "6.20.10.10"],
 *       "go_bp": ["apoptotic process|IDA", ""],
 *   }))
 *   meta = pa.table({"projection_name": ["pca2"], "dimensions": [2], "info_json": ["{}"]})
 *   data = pa.table({
 *       "projection_name": ["pca2", "pca2"],
 *       "identifier": ["P1", "P2"], "x": [0.0, 1.0], "y": [0.0, 1.0],
 *   })
 *   write_bundle([ann, meta, data], Path("../protspace_web/packages/core/src/components/data-loader/"
 *       "utils/__fixtures__/v2-sample.parquetbundle"))
 *   PY
 */
describe('v2 bundle round-trip (cross-repo golden fixture)', () => {
  it('reads the real footer format_version=2 and decodes cath/go_bp correctly', async () => {
    const buf = readFileSync(new URL('./__fixtures__/v2-sample.parquetbundle', import.meta.url));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    // Exercises the REAL readFormatVersion footer read (bundle.ts), not a stub.
    const extraction = await extractRowsFromParquetBundle(arrayBuffer);
    expect(extraction.formatVersion).toBe(2);

    // Same entry point production code + conversion-numeric.test.ts use for a
    // BundleExtractionResult: convertParquetToVisualizationDataOptimized threads
    // extraction.formatVersion through to the v2 decode path.
    const result = await convertParquetToVisualizationDataOptimized(extraction);

    const cathValues = result.annotations.cath.values;

    // The ';'-bearing name decodes to ONE category, with the literal ';' restored
    // and no leaked percent-escape.
    expect(cathValues).toContain('G3DSA:1.10.10.10 (Ribosomal Protein L15; Chain: K; domain 2)');
    // Must not be shattered into fragments by a naive split on ';' — the
    // ';'-bearing hit is a naive-split victim only if it fragments into
    // 'Ribosomal Protein L15' / ' Chain: K' / ' domain 2)' pieces.
    expect(cathValues).not.toContain('G3DSA:1.10.10.10 (Ribosomal Protein L15');
    expect(cathValues).not.toContain(' Chain: K');
    expect(cathValues).not.toContain(' domain 2)');
    // Must not still carry the raw percent-encoding.
    expect(cathValues.some((v) => v.includes('%3B'))).toBe(false);
    // Exactly three distinct categories: the decoded multi-';' name, P1's bare
    // second hit, and P2's bare (unnamed) hit — no extra fragments leaked in.
    expect(cathValues).toHaveLength(3);

    // P1's second hit is a bare code with no name — its own category, untouched.
    expect(cathValues).toContain('G3DSA:6.20.10.10');

    // P2's cath cell is an unnamed bare code — shows as-is, no fabricated name.
    expect(cathValues).toContain('6.20.10.10');

    // go_bp: evidence-coded value parses into a label + evidence code.
    const p1Idx = result.protein_ids.indexOf('P1');
    const goBpData = result.annotation_data.go_bp as readonly (readonly number[])[];
    const goBpValues = result.annotations.go_bp.values;
    const goBpEvidence = result.annotation_evidence?.go_bp;
    expect(goBpData[p1Idx].map((i) => goBpValues[i])).toEqual(['apoptotic process']);
    expect(goBpEvidence).toBeDefined();
    expect(goBpEvidence![p1Idx]).toEqual(['IDA']);
  });

  it('writes and reloads golden v2 categorical structure plus every EAT companion', async () => {
    const file = readFileSync(new URL('./__fixtures__/v2-sample.parquetbundle', import.meta.url));
    const goldenBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const golden = await convertParquetToVisualizationDataOptimized(
      await extractRowsFromParquetBundle(goldenBuffer),
    );
    const p2Index = golden.protein_ids.indexOf('P2');
    golden.annotation_predicted = {
      go_bp: golden.protein_ids.map((_, proteinIndex) =>
        proteinIndex === p2Index
          ? {
              value: 'transferred;label|literal%;second hit',
              values: ['transferred;label|literal%', 'second hit'],
              scores: [[0.91], null],
              evidence: [null, 'EXP'],
              confidence: 0.83,
              source: 'P1|reference;literal%',
            }
          : null,
      ),
    };

    const annotationNames = ['cath', 'go_bp'] as const;
    const expectedAnnotationSets = perProteinAnnotationSets(golden, annotationNames);
    const expectedEvidence = structuredClone(golden.annotation_evidence);
    const expectedScores = structuredClone(golden.annotation_scores);

    const written = createParquetBundle(golden);
    const extraction = await extractRowsFromParquetBundle(written);
    expect(extraction.formatVersion).toBe(2);
    expect(extraction.annotationsById.get('P2')).toMatchObject({
      go_bp__pred_value: 'transferred%3Blabel%7Cliteral%25|0.91;second hit|EXP',
      go_bp__pred_source: 'P1%7Creference%3Bliteral%25',
    });

    const reloaded = await convertParquetToVisualizationDataOptimized(extraction);
    expect(perProteinAnnotationSets(reloaded, annotationNames)).toEqual(expectedAnnotationSets);
    expect(reloaded.annotation_evidence).toEqual(expectedEvidence);
    expect(reloaded.annotation_scores).toEqual(expectedScores);
    expect(reloaded.annotation_predicted?.go_bp?.[p2Index]).toMatchObject({
      value: 'transferred;label|literal%;second hit',
      values: ['transferred;label|literal%', 'second hit'],
      scores: [[0.91], null],
      evidence: [null, 'EXP'],
      source: 'P1|reference;literal%',
    });
    expect(reloaded.annotation_predicted?.go_bp?.[p2Index]?.confidence).toBeCloseTo(0.83, 6);
  });
});

describe('v1 bundle format-version detection regression', () => {
  it('detects an existing v1 fixture as formatVersion 1 via the real footer read (not the catch->1 fallback)', async () => {
    const filePath = resolve(
      __dirname,
      '../../../../../../apps/web/tests/fixtures/data_custom.parquetbundle',
    );
    const buf = readFileSync(filePath);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const extraction = await extractRowsFromParquetBundle(arrayBuffer);

    // A v1 bundle has no `protspace_format_version` key-value metadata, so
    // readFormatVersion's normal (non-exceptional) path returns 1 -- this fixture
    // must actually parse as valid parquet (proving we hit that path, not the
    // try/catch's `catch -> 1` fallback for a bundle that fails to parse at all).
    expect(extraction.formatVersion).toBe(1);
    expect(extraction.projections.length).toBeGreaterThan(0);
  });
});
