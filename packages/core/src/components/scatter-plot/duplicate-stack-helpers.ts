/**
 * Pure helpers for duplicate-stack grouping. Two points belong to the same
 * stack iff they share exact coordinates in the *current* projection — UMAP
 * and t-SNE generally jitter even identical embeddings apart, so badging
 * by embedding identity (across projections) would lie about where the other
 * members render.
 *
 * The chunked, viewport-aware implementation lives in `scatter-plot.ts`;
 * these helpers exist so the algorithm itself can be unit-tested
 * (legend-hide, projection-switch — see #121).
 */

export interface DuplicateStackPoint {
  id: string;
  x: number;
  y: number;
}

interface DuplicateStack<P extends DuplicateStackPoint> {
  key: string;
  x: number;
  y: number;
  points: P[];
}

/**
 * Per-projection coord key — two points belong to the same stack iff this
 * key matches. Identical embeddings that produce identical coords in PCA
 * but distinct coords in UMAP will share a stack only in PCA, which is the
 * intended behavior.
 */
export function getDuplicateStackKey(p: { x: number; y: number }): string {
  return `${p.x}|${p.y}`;
}

/**
 * Build duplicate-stack groups from a flat list of (already-visible) points.
 * Solos (single-point groups) are dropped from the returned stacks/byKey
 * but still recorded in idToKey so callers can look up stack membership
 * by point id.
 */
export function buildDuplicateStacks<P extends DuplicateStackPoint>(
  points: P[],
): {
  stacks: DuplicateStack<P>[];
  byKey: Map<string, DuplicateStack<P>>;
  idToKey: Map<string, string>;
} {
  const stackMap = new Map<string, DuplicateStack<P>>();
  const idToKey = new Map<string, string>();

  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const key = getDuplicateStackKey(p);
    let stack = stackMap.get(key);
    if (!stack) {
      stack = { key, x: p.x, y: p.y, points: [] };
      stackMap.set(key, stack);
    }
    stack.points.push(p);
    idToKey.set(p.id, key);
  }

  const stacks: DuplicateStack<P>[] = [];
  const byKey = new Map<string, DuplicateStack<P>>();
  for (const s of stackMap.values()) {
    if (s.points.length > 1) {
      stacks.push(s);
      byKey.set(s.key, s);
    }
  }

  return { stacks, byKey, idToKey };
}
