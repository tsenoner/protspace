/**
 * The largest point count accepted for one projection, end to end.
 *
 * 2,000,000 is the measured browser LOAD ceiling, not a renderer limit — the
 * renderer draws every point it is handed. At that size a load peaks at ~2.61 GB
 * of a ~4.40 GB V8 heap and takes ~42 s (#456, MacBook Pro M4 Pro / 48 GB,
 * Chrome 151).
 *
 * The loader's row cap and the renderer's staging clamp both derive from this
 * symbol so they cannot drift apart again. They previously did: the loader
 * admitted 2,000,000 rows while the renderer drew at most 1,000,000 points, so a
 * single-projection bundle at the loader's limit displayed half its proteins,
 * silently, cut by array position. The renderer's clamp was also the
 * viewport-culling threshold, and that aliasing is what made rendering degrade
 * ~850x at exactly the largest two-projection dataset the loader would accept.
 *
 * Because `projections_data` is long-format — one row per (protein x projection)
 * — capping ROWS here bounds proteins-per-projection for any projection count,
 * so the renderer's clamp is unreachable through any file a user can load. It
 * survives only because a `@protspace/core` embedder can assign `.data`
 * directly, bypassing validation.
 *
 * Do NOT raise this without re-measuring peak heap. At the measured ~1.3 GB per
 * million, 3M is ~4.0 GB against that ~4.40 GB limit — 8% headroom — and 5M does
 * not fit at all. Raising it converts today's clean "dataset too large" refusal
 * into an unrecoverable out-of-memory crash after a ~100 s wait.
 */
export const MAX_POINTS_PER_PROJECTION = 2_000_000;
