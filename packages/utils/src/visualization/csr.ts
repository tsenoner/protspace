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

/** Score runs up to this many values are copied in a loop rather than through a subarray. */
const SHORT_RUN = 16;

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

  const srcCodes = src.codes;
  const fromScores = src.scores?.offsets;
  const srcEvidence = src.evidence?.codes;
  const codes = new Int32Array(hitCount);
  const scoreOffsets = fromScores ? new Int32Array(hitCount + 1) : null;
  const evidenceCodes = srcEvidence ? new Int32Array(hitCount) : null;
  // One pass for the codes, the score offsets and the evidence codes.
  let total = 0;
  for (let k = 0; k < hitCount; k++) {
    const hit = hits[k];
    if (hit < 0) {
      codes[k] = ~hit;
      if (evidenceCodes) evidenceCodes[k] = -1;
    } else {
      codes[k] = remap ? remap[srcCodes[hit]] : srcCodes[hit];
      if (fromScores) total += fromScores[hit + 1] - fromScores[hit];
      if (evidenceCodes) evidenceCodes[k] = srcEvidence![hit];
    }
    if (scoreOffsets) scoreOffsets[k + 1] = total;
  }

  let scores: CsrScores | undefined;
  if (src.scores && fromScores && scoreOffsets) {
    const srcValues = src.scores.values;
    const values = new Float64Array(total);
    // Scores are copied a run at a time: consecutive source hits own adjacent score
    // runs, and so do the hits they become, since a synthetic hit in between owns none.
    let k = 0;
    while (k < hitCount) {
      const first = hits[k];
      if (first < 0) {
        k++;
        continue;
      }
      let last = first;
      let next = k + 1;
      while (next < hitCount) {
        const hit = hits[next];
        if (hit >= 0 && hit !== last + 1) break;
        if (hit >= 0) last = hit;
        next++;
      }
      const start = fromScores[first];
      const end = fromScores[last + 1];
      const to = scoreOffsets[k];
      if (end - start > SHORT_RUN) {
        values.set(srcValues.subarray(start, end), to);
      } else {
        for (let i = start; i < end; i++) values[to + i - start] = srcValues[i];
      }
      k = next;
    }
    scores = { offsets: scoreOffsets, values };
  }

  const evidence: CsrEvidence | undefined =
    src.evidence && evidenceCodes ? { codes: evidenceCodes, dict: src.evidence.dict } : undefined;

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
  if (!remap) {
    let emptyRow = false;
    for (let row = 0; fill && !emptyRow && row < rows; row++) {
      emptyRow = srcOffsets[row + 1] === srcOffsets[row];
    }
    if (!emptyRow) return { column: src, filledRows: 0 };
  }

  // Planned in one pass into a buffer sized for the most hits the plan can hold: every
  // source hit, plus one synthetic hit per row when rows are filled.
  const hitsBuffer = new Int32Array(srcOffsets[rows] - srcOffsets[0] + (fill ? rows : 0));
  const offsets = new Int32Array(rows + 1);
  let write = 0;
  let filledRows = 0;
  for (let row = 0; row < rows; row++) {
    const rowStart = write;
    const end = srcOffsets[row + 1];
    for (let hit = srcOffsets[row]; hit < end; hit++) {
      if (!remap || remap[srcCodes[hit]] >= 0) hitsBuffer[write++] = hit;
    }
    if (write === rowStart && fill) {
      hitsBuffer[write++] = syntheticHit(emptyRowCode);
      filledRows++;
    }
    offsets[row + 1] = write;
  }
  const hits = hitsBuffer.subarray(0, write);
  return { column: gatherCsr(src, { offsets, hits }, remap ?? undefined), filledRows };
}

/**
 * Rank the `labelCount` labels by the hits that carry them, as every v3 encoder orders a
 * dictionary: by descending hit count, ties by first occurrence, so code 0 is the most
 * frequent label (the palette slot order; Python's `_frequency_order` must agree). Labels
 * no hit carries, and codes `skip` flags, are left out; hits `< 0` are ignored.
 *
 * `order` lists the kept codes in rank order; `remap` maps a code to its rank, `-1` when it
 * was left out. The bundle writer and the v3 reader both rank through this one kernel, so
 * an exported dictionary and a loaded one can never disagree on palette slots.
 */
export function rankByFrequency(
  hitCodes: ArrayLike<number>,
  labelCount: number,
  skip?: Uint8Array | null,
): { order: number[]; remap: Int32Array } {
  const counts = new Int32Array(labelCount);
  const first = new Int32Array(labelCount);
  for (let hit = 0; hit < hitCodes.length; hit++) {
    const code = hitCodes[hit];
    if (code >= 0 && !skip?.[code] && counts[code]++ === 0) first[code] = hit;
  }
  const order: number[] = [];
  for (let code = 0; code < labelCount; code++) if (counts[code] > 0) order.push(code);
  order.sort((a, b) => counts[b] - counts[a] || first[a] - first[b]);
  const remap = new Int32Array(labelCount).fill(-1);
  for (let rank = 0; rank < order.length; rank++) remap[order[rank]] = rank;
  return { order, remap };
}
