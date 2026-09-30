import type { CsrAnnotationData, CsrEvidence, CsrScores } from '../types.js';

/**
 * Which hits a rebuilt CSR column holds, row by row.
 *
 * `offsets` are the new column's row offsets (`rows + 1` entries, the last one
 * `hits.length`). Each entry of `hits` is either a source hit index (`>= 0`), copied
 * with its score run and evidence code, or `~code` (see {@link syntheticHit}): a new
 * hit carrying `code` and no score or evidence.
 */
export interface CsrHitPlan {
  readonly offsets: Int32Array;
  readonly hits: Int32Array;
}

/** Plan entry for a hit that has no source: it carries `code` and nothing else. */
export function syntheticHit(code: number): number {
  return ~code;
}

/**
 * Build a CSR column from `plan`, carrying each copied hit's score run and evidence code
 * along with its label, so a rebuild can never leave them addressing another hit.
 *
 * `remap`, when given, renumbers every copied source code (`remap[code]`); synthetic
 * hits carry their code as planned.
 */
export function gatherCsr(
  src: CsrAnnotationData,
  plan: CsrHitPlan,
  remap?: Int32Array,
): CsrAnnotationData {
  const { offsets, hits } = plan;
  const hitCount = hits.length;
  if (offsets[0] !== 0 || offsets[offsets.length - 1] !== hitCount) {
    throw new Error(`CSR plan offsets do not span its ${hitCount} hits`);
  }

  const codes = new Int32Array(hitCount);
  for (let k = 0; k < hitCount; k++) {
    const hit = hits[k];
    codes[k] = hit < 0 ? ~hit : remap ? remap[src.codes[hit]] : src.codes[hit];
  }

  let scores: CsrScores | undefined;
  if (src.scores) {
    const from = src.scores.offsets;
    const scoreOffsets = new Int32Array(hitCount + 1);
    let total = 0;
    for (let k = 0; k < hitCount; k++) {
      const hit = hits[k];
      if (hit >= 0) total += from[hit + 1] - from[hit];
      scoreOffsets[k + 1] = total;
    }
    const values = new Float64Array(total);
    for (let k = 0; k < hitCount; k++) {
      const hit = hits[k];
      if (hit >= 0 && from[hit + 1] > from[hit]) {
        values.set(src.scores.values.subarray(from[hit], from[hit + 1]), scoreOffsets[k]);
      }
    }
    scores = { offsets: scoreOffsets, values };
  }

  let evidence: CsrEvidence | undefined;
  if (src.evidence) {
    const evidenceCodes = new Int32Array(hitCount);
    for (let k = 0; k < hitCount; k++) {
      const hit = hits[k];
      evidenceCodes[k] = hit < 0 ? -1 : src.evidence.codes[hit];
    }
    evidence = { codes: evidenceCodes, dict: src.evidence.dict };
  }

  return {
    kind: 'csr',
    offsets,
    codes,
    length: offsets.length - 1,
    ...(scores ? { scores } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * Renumber a CSR column through `remap`, dropping every hit whose new code is negative,
 * and — when `emptyRowCode` is non-negative — give every row left without a hit one
 * synthetic hit with that code.
 *
 * `filledRows` counts the rows that received one. The source column itself comes back
 * when nothing would change.
 */
export function remapCsr(
  src: CsrAnnotationData,
  remap: Int32Array | null,
  emptyRowCode = -1,
): { column: CsrAnnotationData; filledRows: number } {
  const { offsets: srcOffsets, codes: srcCodes, length: rows } = src;
  const fill = emptyRowCode >= 0;
  const keep = (hit: number) => !remap || remap[srcCodes[hit]] >= 0;

  const offsets = new Int32Array(rows + 1);
  let total = 0;
  let filledRows = 0;
  for (let row = 0; row < rows; row++) {
    let kept = 0;
    for (let hit = srcOffsets[row]; hit < srcOffsets[row + 1]; hit++) if (keep(hit)) kept++;
    if (kept === 0 && fill) {
      kept = 1;
      filledRows++;
    }
    total += kept;
    offsets[row + 1] = total;
  }
  if (!remap && filledRows === 0) return { column: src, filledRows };

  const hits = new Int32Array(total);
  let write = 0;
  for (let row = 0; row < rows; row++) {
    for (let hit = srcOffsets[row]; hit < srcOffsets[row + 1]; hit++) {
      if (keep(hit)) hits[write++] = hit;
    }
    if (write === offsets[row] && fill) hits[write++] = syntheticHit(emptyRowCode);
  }
  return { column: gatherCsr(src, { offsets, hits }, remap ?? undefined), filledRows };
}
