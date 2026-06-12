// Rough model: 10s of fixed overhead + 0.25s per sequence.
// Calibrated against the observation that ~700 sequences embeds in ~3 min.
const BASE_OVERHEAD_SECONDS = 10;
const SECONDS_PER_SEQUENCE = 0.25;

export async function countFastaSequences(file: File): Promise<number> {
  // Stream the file so we never hold the whole upload in memory. '>' (0x3e)
  // and '\n' (0x0a) are single-byte in UTF-8 and never appear as continuation
  // bytes, so we can scan raw bytes without decoding.
  const reader = file.stream().getReader();
  let count = 0;
  let atLineStart = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.length; i++) {
        const byte = value[i];
        if (atLineStart && byte === 0x3e /* '>' */) count++;
        atLineStart = byte === 0x0a /* '\n' */;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return count;
}

export function estimateEmbedSeconds(seqCount: number): number {
  if (seqCount <= 0) return BASE_OVERHEAD_SECONDS;
  return BASE_OVERHEAD_SECONDS + SECONDS_PER_SEQUENCE * seqCount;
}

export function formatEstimate(seconds: number): string {
  if (seconds < 60) {
    const rounded = Math.max(10, Math.round(seconds / 10) * 10);
    return `~${rounded} sec`;
  }
  const minutes = seconds / 60;
  if (minutes < 2) return '~1 min';
  if (minutes < 10) {
    const half = Math.round(minutes * 2) / 2;
    return `~${half} min`;
  }
  return `~${Math.round(minutes)} min`;
}

export function formatEmbeddingLabel(seqCount: number): string {
  return `Embedding sequences (${formatEstimate(estimateEmbedSeconds(seqCount))})…`;
}
