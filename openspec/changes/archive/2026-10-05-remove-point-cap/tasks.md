## 1. Renderer

- [x] 1.1 Drop the rendered-id tracking and the `isPointRendered` hover and click guard.
- [x] 1.2 Bound planned capacity by min(2^26, `MAX_TEXTURE_SIZE²`); refuse a dataset past 2^26
      with a `point-limit-exceeded` warning, shown as "Too many points to draw."
- [x] 1.3 Stage every point in the live and export renderers; delete `utils/limits.ts` and its
      invariant test.

## 2. Loader

- [x] 2.1 Format v3: no row limit; each part's preallocation is bounded by its byte size.
- [x] 2.2 Legacy v1/v2: keep the 2,000,000-row guard, with an error naming `protspace convert`.
- [x] 2.3 Drop the second `validateRowsBasic` call in `decodeParquetBundle`, which
      `validateProjectionRows` already runs on the same rows.

## 3. Verification and docs

- [x] 3.1 Stress run at 2.5M and 5M on an Apple M4: every point drawn, no warning, every
      interaction completes.
- [x] 3.2 FAQ: the drawable limit, the legacy guard, and measured load and interaction times.
