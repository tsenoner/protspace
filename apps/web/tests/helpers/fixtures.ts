import { basename } from 'node:path';
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

/**
 * The startup demo the suite runs against: the ToxProt demo as first shipped,
 * 7,831 proteins with `ec`, a multi-valued `keyword`, and a curated
 * `protein_families` legend with an "Other" row.
 */
const STARTUP_FIXTURE = fixture('demo_toxprot_7831.parquetbundle');

/**
 * The URL the app loads the startup demo from during E2E: Vite's dev-only
 * `/@fs/` route to the fixture, handed to the app as `VITE_STARTUP_DATASET_URL`
 * by the web server in `playwright.config.ts`.
 */
export const STARTUP_DATASET_URL = `/@fs${STARTUP_FIXTURE}`;

/** Matches the startup load's request, for scenarios that abort, hold or refetch it. */
export const STARTUP_URL_GLOB = `**/${basename(STARTUP_FIXTURE)}`;

/** 5,181 proteins; `phylum`, `protein_existence`, `length_fixed`, `length_quantile`; PCA 2 and PCA 3 (3D). */
export const TOXPROT_5181_FIXTURE = fixture('toxprot_5181_pca3d.parquetbundle');

/**
 * The same 5,181 proteins in the v3 format, as `protspace convert` wrote them:
 * an import that shows no legacy-format notice.
 */
export const TOXPROT_5181_V3_FIXTURE = fixture('toxprot_5181_pca3d_v3.parquetbundle');

/** Phosphatases: 1,587 proteins, 40 annotations, ESM2-650M PCA 2 and UMAP 2. */
export const PHOSPHATASE_1587_FIXTURE = fixture('phosphatase_1587.parquetbundle');

/** 40,026 proteins; `protein_existence`, `length_*`, `pfam`, `cath`, `superfamily`, `signal_peptide`; PCA 2 and PCA 3. */
export const PE1_40026_FIXTURE = fixture('pe1_40026_pca3d.parquetbundle');

/**
 * The example role fixtures (`helpers/example-fixtures.ts`), derived from the
 * fixtures above by `derive-example-role-fixtures.py` in the fixtures folder.
 * Each holds the view names of the catalog example its role stands for, as
 * that script's docstring lists.
 */
export const ROLE_SMALL_FIXTURE = fixture('example_role_small_5181.parquetbundle');
export const ROLE_OTHER_FIXTURE = fixture('example_role_other_1587.parquetbundle');
export const ROLE_SLOW_FIXTURE = fixture('example_role_slow_40026.parquetbundle');
export const ROLE_EAT_FIXTURE = fixture('example_role_eat_811.parquetbundle');
