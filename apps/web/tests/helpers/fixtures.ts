import { fileURLToPath } from 'node:url';

/**
 * Bundles the E2E suite reads, pinned under `apps/web/tests/fixtures/`.
 *
 * Tests never read the bundles the product serves: those are the example
 * catalog's, and change whenever an example is rebuilt. Each fixture here is a
 * byte-identical copy of a bundle the suite was written against (the same git
 * blob, so the copy costs no history), named for what it holds.
 */
const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** 5,181 proteins; `phylum`, `protein_existence`, `length_fixed`, `length_quantile`; PCA 2 and PCA 3 (3D). */
export const TOXPROT_5181_FIXTURE = fixture('toxprot_5181_pca3d.parquetbundle');

/** Phosphatases: 1,587 proteins, 40 annotations, ESM2-650M PCA 2 and UMAP 2. */
export const PHOSPHATASE_1587_FIXTURE = fixture('phosphatase_1587.parquetbundle');
