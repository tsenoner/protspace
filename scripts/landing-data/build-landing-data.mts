/**
 * Build the landing-page visualization assets from the example bundles that ship with the app.
 *
 * The landing page shows real ProtSpace data without loading the explorer or parsing Parquet in
 * the browser, so this script pre-extracts what the page needs into small static files:
 *
 *   apps/web/public/landing/demo.json        manifest: projection bounds, annotation categories
 *                                            (labels, counts, colors) and the binary layout
 *   apps/web/public/landing/demo.bin         quantized UMAP coordinates + per-point category indices
 *   apps/web/public/landing/demo-labels.json protein accessions + names (fetched lazily on hover)
 *   apps/web/public/landing/venom.json       the 811-protein EAT/statistics demo: PCA + UMAP
 *                                            coordinates, projection quality metrics, EAT columns
 *
 * Colors follow the explorer exactly: persisted legend settings inside the bundle win; otherwise
 * categories are ranked by frequency and assigned Kelly's colors in slot order, N/A is
 * `NA_DEFAULT_COLOR` and the collapsed "Other" bucket is the scatter plot's neutral grey.
 *
 * Usage:  pnpm landing:data
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parquetReadObjects } from 'hyparquet';
import { BUNDLE_DELIMITER_BYTES } from '../../packages/utils/src/parquet/constants.ts';
import { findBundleDelimiterPositions } from '../../packages/utils/src/parquet/delimiter-utils.ts';
import { KELLYS_COLORS } from '../../packages/utils/src/visualization/color-scheme.ts';
import {
  NA_DEFAULT_COLOR,
  NA_DISPLAY,
  NA_VALUE,
  normalizeMissingValue,
} from '../../packages/utils/src/visualization/missing-values.ts';
import { annotationLabel } from '../../packages/utils/src/visualization/annotation-metadata.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = resolve(ROOT, 'apps/web/public/landing');
const DEMO_BUNDLE = 'apps/web/public/data.parquetbundle';
const VENOM_BUNDLE = 'apps/web/public/data/venom_eat_stats.parquetbundle';

/** Mirrors `NEUTRAL_VALUE_COLOR` in packages/core/src/components/scatter-plot/config.ts. */
const OTHER_COLOR = '#888888';
/** Mirrors `LEGEND_DEFAULTS.maxVisibleValues` in packages/core/src/components/legend/config.ts. */
const DEFAULT_MAX_VISIBLE = 10;

type Row = Record<string, unknown>;

function splitBundle(path: string): (ArrayBuffer | null)[] {
  const bytes = new Uint8Array(readFileSync(resolve(ROOT, path)));
  const parts: (ArrayBuffer | null)[] = [];
  let start = 0;
  for (const pos of [...findBundleDelimiterPositions(bytes), bytes.length]) {
    const view = bytes.subarray(start, pos);
    parts.push(view.byteLength ? view.slice().buffer : null);
    start = pos + BUNDLE_DELIMITER_BYTES.length;
  }
  return parts;
}

const readRows = (part: ArrayBuffer | null, columns?: string[]): Promise<Row[]> =>
  part ? parquetReadObjects({ file: part, columns }) : Promise.resolve([]);

/** Legend display value: first multi-value item, evidence/score suffix stripped; null for N/A. */
function displayValue(raw: unknown): string | null {
  const value = normalizeMissingValue(raw);
  if (value == null) return null;
  const first = String(value).split(';')[0].split('|')[0].trim();
  return first === '' ? null : first;
}

interface Category {
  label: string;
  count: number;
  color: string;
  kind?: 'other' | 'na';
  /** Number of named categories folded into the "Other" bucket. */
  collapsed?: number;
}

interface PersistedCategories {
  maxVisibleValues?: number;
  categories?: Record<string, { zOrder: number; color: string }>;
}

/**
 * Bucket a column into legend categories the way the explorer does, returning the categories
 * and each row's category index.
 */
function categorize(
  rows: Row[],
  column: string,
  persisted?: PersistedCategories,
): { categories: Category[]; index: Uint8Array } {
  const counts = new Map<string, number>();
  let naCount = 0;
  const values = rows.map((row) => {
    const value = displayValue(row[column]);
    if (value == null) naCount += 1;
    else counts.set(value, (counts.get(value) ?? 0) + 1);
    return value;
  });

  let visible: Category[];
  if (persisted?.categories) {
    visible = Object.entries(persisted.categories)
      .filter(([label]) => label !== NA_VALUE)
      .sort((a, b) => a[1].zOrder - b[1].zOrder)
      .map(([label, { color }]) => ({ label, count: counts.get(label) ?? 0, color }));
  } else {
    // Default slot assignment: rank by frequency (N/A included), Kelly's colors in slot order.
    const ranked: Category[] = [...counts]
      .map(([label, count]) => ({ label, count, color: '' }))
      .concat(naCount ? [{ label: NA_DISPLAY, count: naCount, color: '', kind: 'na' }] : [])
      .sort((a, b) => b.count - a.count)
      .slice(0, persisted?.maxVisibleValues ?? DEFAULT_MAX_VISIBLE);
    ranked.forEach((category, slot) => {
      category.color =
        category.kind === 'na' ? NA_DEFAULT_COLOR : KELLYS_COLORS[slot % KELLYS_COLORS.length];
    });
    visible = ranked.filter((category) => category.kind !== 'na');
  }

  const visibleLabels = new Set(visible.map((category) => category.label));
  const collapsed = [...counts.keys()].filter((label) => !visibleLabels.has(label));
  const categories: Category[] = [...visible];
  const otherIndex = collapsed.length ? categories.length : -1;
  if (otherIndex >= 0) {
    categories.push({
      label: `Other (${collapsed.length} categories)`,
      count: collapsed.reduce((sum, label) => sum + (counts.get(label) ?? 0), 0),
      color: OTHER_COLOR,
      kind: 'other',
      collapsed: collapsed.length,
    });
  }
  const naIndex = naCount ? categories.length : -1;
  if (naIndex >= 0) {
    categories.push({ label: NA_DISPLAY, count: naCount, color: NA_DEFAULT_COLOR, kind: 'na' });
  }

  const lookup = new Map(visible.map((category, i) => [category.label, i]));
  const index = new Uint8Array(rows.length);
  values.forEach((value, i) => {
    index[i] = value == null ? naIndex : (lookup.get(value) ?? otherIndex);
  });
  return { categories, index };
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

async function readProjection(parts: (ArrayBuffer | null)[], name: string) {
  const meta = (await readRows(parts[1])).find((row) => row.projection_name === name);
  if (!meta) throw new Error(`Projection "${name}" not found`);
  const coords = new Map<string, [number, number]>();
  for (const row of await readRows(parts[2], ['projection_name', 'identifier', 'x', 'y'])) {
    if (row.projection_name === name) {
      coords.set(String(row.identifier), [Number(row.x), Number(row.y)]);
    }
  }
  return { info: JSON.parse(String(meta.info_json)) as Record<string, unknown>, coords };
}

async function readSettings(
  part: ArrayBuffer | null,
): Promise<Record<string, PersistedCategories>> {
  const rows = await readRows(part);
  return rows.length ? JSON.parse(String(rows[0].settings_json)) : {};
}

/* ------------------------------------------------------------------------------------------ */
/* Demo dataset: the bundle /explore opens by default                                          */
/* ------------------------------------------------------------------------------------------ */

async function buildDemo() {
  const PROJECTION = 'ProtT5 — UMAP 2';
  const ANNOTATIONS = ['protein_families', 'phylum', 'class', 'order'];

  const parts = splitBundle(DEMO_BUNDLE);
  const rows = await readRows(parts[0], ['protein_id', 'protein_name', ...ANNOTATIONS]);
  const { coords } = await readProjection(parts, PROJECTION);
  const settings = await readSettings(parts[3]);

  const kept = rows.filter((row) => coords.has(String(row.protein_id)));
  if (kept.length !== rows.length) throw new Error('Demo bundle: proteins without coordinates');
  const n = kept.length;

  const xs = kept.map((row) => coords.get(String(row.protein_id))![0]);
  const ys = kept.map((row) => coords.get(String(row.protein_id))![1]);
  const bounds = {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
  const quantize = (value: number, min: number, max: number) =>
    Math.round(((value - min) / (max - min)) * 65535);
  const xy = new Uint16Array(n * 2);
  for (let i = 0; i < n; i++) {
    xy[i * 2] = quantize(xs[i], bounds.xMin, bounds.xMax);
    xy[i * 2 + 1] = quantize(ys[i], bounds.yMin, bounds.yMax);
  }

  const annotations = ANNOTATIONS.map((column) => ({
    column,
    ...categorize(kept, column, settings[column]),
  }));

  const chunks: Buffer[] = [Buffer.from(xy.buffer)];
  const layout: { field: string; type: 'Uint16' | 'Uint8'; offset: number; length: number }[] = [
    { field: 'xy', type: 'Uint16', offset: 0, length: n * 2 },
  ];
  let offset = xy.byteLength;
  for (const annotation of annotations) {
    layout.push({ field: annotation.column, type: 'Uint8', offset, length: n });
    chunks.push(Buffer.from(annotation.index.buffer));
    offset += n;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'demo.bin'), Buffer.concat(chunks));
  writeFileSync(
    resolve(OUT_DIR, 'demo.json'),
    JSON.stringify({
      generatedBy: 'scripts/landing-data/build-landing-data.mts',
      source: DEMO_BUNDLE,
      count: n,
      projection: { name: PROJECTION, ...bounds },
      bin: { file: 'demo.bin', layout },
      labels: { file: 'demo-labels.json' },
      annotations: annotations.map(({ column, categories }) => ({
        column,
        label: annotationLabel(column),
        categories,
      })),
    }),
  );
  writeFileSync(
    resolve(OUT_DIR, 'demo-labels.json'),
    JSON.stringify({
      ids: kept.map((row) => String(row.protein_id)),
      names: kept.map((row) => (row.protein_name == null ? '' : String(row.protein_name))),
    }),
  );

  // Self-check: the quantization must round-trip to well under a device pixel.
  const span = bounds.xMax - bounds.xMin;
  const maxErr = Math.max(
    ...xs.map((x, i) => Math.abs((xy[i * 2] / 65535) * span + bounds.xMin - x)),
  );
  if (maxErr > span / 20000) throw new Error(`Quantization error too large: ${maxErr}`);
  console.warn(`demo: ${n} proteins, ${annotations.map((a) => a.column).join(', ')}`);
}

/* ------------------------------------------------------------------------------------------ */
/* Venom EAT + statistics dataset: real projection quality metrics and real label transfers    */
/* ------------------------------------------------------------------------------------------ */

async function buildVenom() {
  const PROJECTIONS = ['ProtT5 — PCA 2', 'ProtT5 — UMAP 2'];
  const TARGET = 'ec';

  const parts = splitBundle(VENOM_BUNDLE);
  const rows = await readRows(parts[0], [
    'protein_id',
    'protein_name',
    'protein_families',
    TARGET,
    `${TARGET}__pred_value`,
    `${TARGET}__pred_confidence`,
    `${TARGET}__pred_source`,
  ]);
  const ids = rows.map((row) => String(row.protein_id));
  const indexOf = new Map(ids.map((id, i) => [id, i]));

  const projections = [];
  for (const name of PROJECTIONS) {
    const { info, coords } = await readProjection(parts, name);
    projections.push({
      name,
      x: ids.map((id) => round(coords.get(id)![0], 3)),
      y: ids.map((id) => round(coords.get(id)![1], 3)),
      quality: info.quality,
    });
  }

  const families = categorize(rows, 'protein_families');

  // EC categories span curated and transferred values so both draw from one color table.
  const merged = rows.map((row) => ({
    [TARGET]: displayValue(row[TARGET]) ?? displayValue(row[`${TARGET}__pred_value`]),
  }));
  const ec = categorize(merged, TARGET);
  const lookup = new Map(ec.categories.map((category, i) => [category.label, i]));
  const curated = rows.map((row) => {
    const value = displayValue(row[TARGET]);
    return value == null ? -1 : (lookup.get(value) ?? -1);
  });
  const transferred = rows.map((row, i) => {
    const value = displayValue(row[`${TARGET}__pred_value`]);
    if (value == null || curated[i] >= 0) return null;
    return {
      point: i,
      category: lookup.get(value) ?? -1,
      confidence: round(Number(row[`${TARGET}__pred_confidence`]), 3),
      source: indexOf.get(String(row[`${TARGET}__pred_source`])) ?? -1,
    };
  });

  writeFileSync(
    resolve(OUT_DIR, 'venom.json'),
    JSON.stringify({
      generatedBy: 'scripts/landing-data/build-landing-data.mts',
      source: VENOM_BUNDLE,
      count: rows.length,
      ids,
      names: rows.map((row) => (row.protein_name == null ? '' : String(row.protein_name))),
      projections,
      families: {
        column: 'protein_families',
        label: annotationLabel('protein_families'),
        categories: families.categories,
        values: Array.from(families.index),
      },
      eat: {
        column: TARGET,
        label: annotationLabel(TARGET),
        categories: ec.categories.filter((category) => category.kind !== 'na'),
        curated,
        transferred: transferred.filter((entry) => entry != null),
      },
    }),
  );
  console.warn(
    `venom: ${rows.length} proteins, ${transferred.filter(Boolean).length} transferred ${TARGET} values`,
  );
}

await buildDemo();
await buildVenom();
