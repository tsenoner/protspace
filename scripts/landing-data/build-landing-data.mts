/**
 * Build the landing-page visualization assets from the startup demo the app ships and the venom
 * EAT test fixture.
 *
 * The landing page shows real ProtSpace data without loading the explorer or parsing Parquet in
 * the browser, so this script pre-extracts what the page needs into small static files:
 *
 *   apps/web/public/landing/demo.json        manifest: projection names, annotation categories
 *                                            (labels, counts, colors) and the binary layout
 *   apps/web/public/landing/demo.bin         quantized coordinates for four projections +
 *                                            per-point category indices
 *   apps/web/public/landing/demo-labels.json protein accessions + names (fetched lazily on hover)
 *   apps/web/public/landing/venom.json       the 811-protein EAT/statistics demo: EAT columns and
 *                                            per-family silhouette scores
 *
 * Colors and counts follow the explorer: persisted legend settings inside the bundle win; otherwise
 * categories are ranked by frequency and assigned Kelly's colors in slot order, N/A is
 * `NA_DEFAULT_COLOR` and the collapsed "Other" bucket is the scatter plot's neutral grey. As in the
 * explorer's legend, a protein with several values counts once for each. The preview draws one
 * color per point, so such a protein takes the color of its first value the legend shows, where
 * the explorer draws all of them.
 *
 * Usage:  pnpm landing:data
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parquetReadObjects } from 'hyparquet';
import type { LegendPersistedSettings } from '../../packages/utils/src/types.ts';
import { BUNDLE_DELIMITER_BYTES } from '../../packages/utils/src/parquet/constants.ts';
import { findBundleDelimiterPositions } from '../../packages/utils/src/parquet/delimiter-utils.ts';
import { normalizeBundleSettings } from '../../packages/utils/src/parquet/settings-validation.ts';
import { KELLYS_COLORS } from '../../packages/utils/src/visualization/color-scheme.ts';
import {
  NA_DEFAULT_COLOR,
  NA_DISPLAY,
  NA_VALUE,
  normalizeMissingValue,
} from '../../packages/utils/src/visualization/missing-values.ts';
import { annotationLabel } from '../../packages/utils/src/visualization/annotation-metadata.ts';
import { NEUTRAL_VALUE_COLOR as OTHER_COLOR } from '../../packages/core/src/components/scatter-plot/config.ts';
import type { Category } from '../../apps/web/src/landing/landing-data.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = resolve(ROOT, 'apps/web/public/landing');
const DEMO_BUNDLE = 'apps/web/public/data.parquetbundle';
/**
 * The 811-protein venom EAT set: the bytes the app once served as `data/venom_eat_stats`, kept as a
 * test fixture (and a `perf-datasets` asset) since it left the example catalog.
 */
const VENOM_BUNDLE = 'apps/web/tests/fixtures/venom_eat_stats_811.parquetbundle';

/** Mirrors `LEGEND_DEFAULTS.maxVisibleValues` in packages/core/src/components/legend/config.ts. */
const DEFAULT_MAX_VISIBLE = 10;

type Row = Record<string, unknown>;

/**
 * The explorer's loader (`extractRowsFromParquetBundle` in core) can't be imported here: tsx
 * loads core's sources as CommonJS and hyparquet ships ESM only. Parts are split the same way.
 */
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

/** Per-column legend settings, in either the current or the legacy flat settings format. */
async function readLegendSettings(
  part: ArrayBuffer | null,
): Promise<Record<string, PersistedCategories>> {
  const rows = await readRows(part);
  if (!rows.length) return {};
  return normalizeBundleSettings(JSON.parse(String(rows[0].settings_json)))?.legendSettings ?? {};
}

/**
 * Legend display values, split as the explorer's loader splits a cell: every `;`-separated item,
 * evidence/score suffix stripped, missing and empty items dropped; `[]` for N/A.
 */
function displayValues(raw: unknown): string[] {
  const value = normalizeMissingValue(raw);
  if (value == null) return [];
  return String(value)
    .split(';')
    .map((item) => item.split('|')[0].trim())
    .filter((label) => label !== '' && normalizeMissingValue(label) != null);
}

/** The first legend display value; null for N/A. */
const displayValue = (raw: unknown): string | null => displayValues(raw)[0] ?? null;

type PersistedCategories = Partial<
  Pick<LegendPersistedSettings, 'maxVisibleValues' | 'categories'>
>;

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
    const labels = displayValues(row[column]);
    if (labels.length === 0) naCount += 1;
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    return labels;
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
      .map(([label, count]): Category => ({ label, count, color: '' }))
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
  values.forEach((labels, i) => {
    const shown = labels.find((label) => lookup.has(label));
    index[i] = labels.length === 0 ? naIndex : shown ? lookup.get(shown)! : otherIndex;
  });
  return { categories, index };
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

async function readProjection(parts: (ArrayBuffer | null)[], name: string) {
  const coords = new Map<string, [number, number]>();
  for (const row of await readRows(parts[2], ['projection_name', 'identifier', 'x', 'y'])) {
    if (row.projection_name === name) {
      coords.set(String(row.identifier), [Number(row.x), Number(row.y)]);
    }
  }
  if (!coords.size) throw new Error(`Projection "${name}" not found`);
  return coords;
}

/* ------------------------------------------------------------------------------------------ */
/* Demo dataset: the bundle /explore opens by default                                          */
/* ------------------------------------------------------------------------------------------ */

/** Quantize one projection to Uint16 pairs; the self-check keeps the error under a device pixel. */
function quantizeProjection(name: string, xs: number[], ys: number[]) {
  const bounds = {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
  const xSpan = bounds.xMax - bounds.xMin;
  const ySpan = bounds.yMax - bounds.yMin;
  if (!(xSpan > 0 && ySpan > 0)) throw new Error(`${name}: degenerate projection bounds`);
  const quantize = (value: number, min: number, span: number) =>
    Math.round(((value - min) / span) * 65535);
  const xy = new Uint16Array(xs.length * 2);
  for (let i = 0; i < xs.length; i++) {
    xy[i * 2] = quantize(xs[i], bounds.xMin, xSpan);
    xy[i * 2 + 1] = quantize(ys[i], bounds.yMin, ySpan);
  }
  const axisError = (values: number[], offset: number, min: number, span: number) =>
    values.reduce(
      (max, v, i) => Math.max(max, Math.abs((xy[i * 2 + offset] / 65535) * span + min - v)),
      0,
    );
  const xErr = axisError(xs, 0, bounds.xMin, xSpan);
  const yErr = axisError(ys, 1, bounds.yMin, ySpan);
  if (xErr > xSpan / 20000 || yErr > ySpan / 20000) {
    throw new Error(`${name}: quantization error too large: x ${xErr}, y ${yErr}`);
  }
  return { name, xy };
}

async function buildDemo() {
  /** The first is what /explore opens by default and what the hero shows. */
  const PROJECTIONS = [
    'ProtT5 — UMAP 2',
    'ProtT5 — PCA 2',
    'ESM2-650M — UMAP 2',
    'ESM2-650M — PCA 2',
  ];
  const ANNOTATIONS = ['protein_families', 'phylum', 'class', 'order'];

  const parts = splitBundle(DEMO_BUNDLE);
  const rows = await readRows(parts[0], ['protein_id', 'protein_name', ...ANNOTATIONS]);
  const settings = await readLegendSettings(parts[3]);
  const ids = rows.map((row) => String(row.protein_id));

  const projections = [];
  for (const name of PROJECTIONS) {
    const coords = await readProjection(parts, name);
    if (!ids.every((id) => coords.has(id)))
      throw new Error(`${name}: proteins without coordinates`);
    projections.push(
      quantizeProjection(
        name,
        ids.map((id) => coords.get(id)![0]),
        ids.map((id) => coords.get(id)![1]),
      ),
    );
  }
  const n = rows.length;

  const annotations = ANNOTATIONS.map((column) => ({
    column,
    ...categorize(rows, column, settings[column]),
  }));

  const chunks: Buffer[] = [];
  const layout: { field: string; offset: number; length: number }[] = [];
  let offset = 0;
  projections.forEach((projection, k) => {
    layout.push({ field: `xy${k}`, offset, length: n * 2 });
    chunks.push(Buffer.from(projection.xy.buffer));
    offset += projection.xy.byteLength;
  });
  for (const annotation of annotations) {
    layout.push({ field: annotation.column, offset, length: n });
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
      projections: projections.map(({ name }) => ({ name })),
      bin: { file: 'demo.bin', layout },
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
      ids,
      names: rows.map((row) => (row.protein_name == null ? '' : String(row.protein_name))),
    }),
  );
  console.warn(
    `demo: ${n} proteins, ${PROJECTIONS.length} projections, ${annotations.map((a) => a.column).join(', ')}`,
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Venom EAT + statistics dataset: real label transfers and real per-category separation     */
/* ------------------------------------------------------------------------------------------ */

async function buildVenom() {
  const PROJECTION = 'ProtT5 — UMAP 2';
  /** The embedding PROJECTION was computed from, as the stats table names that space. */
  const EMBEDDING = 'prot_t5';
  const TARGET = 'ec';
  /** Scored for separation; taxonomic family, as the explorer's legend strips show it. */
  const SCORED = 'family';

  const parts = splitBundle(VENOM_BUNDLE);
  const rows = await readRows(parts[0], [
    'protein_id',
    SCORED,
    TARGET,
    `${TARGET}__pred_value`,
    `${TARGET}__pred_confidence`,
    `${TARGET}__pred_source`,
  ]);
  const ids = rows.map((row) => String(row.protein_id));
  const indexOf = new Map(ids.map((id, i) => [id, i]));

  // EC categories span curated and transferred values so both draw from one color table.
  const merged = rows.map((row) => ({
    [TARGET]: displayValue(row[TARGET]) ?? displayValue(row[`${TARGET}__pred_value`]),
  }));
  const ec = categorize(merged, TARGET);
  const lookup = new Map(
    ec.categories.flatMap((category, i) => (category.kind ? [] : [[category.label, i] as const])),
  );
  // Values folded into the Other bucket index Other, as their points are colored.
  const otherIndex = ec.categories.findIndex((category) => category.kind === 'other');
  const categoryOf = (value: string) => lookup.get(value) ?? otherIndex;
  const curated = rows.map((row) => {
    const curatedValue = displayValue(row[TARGET]);
    return curatedValue == null ? -1 : categoryOf(curatedValue);
  });
  const transferred = rows.map((row, i) => {
    const predicted = displayValue(row[`${TARGET}__pred_value`]);
    if (predicted == null || curated[i] >= 0) return null;
    return {
      point: i,
      category: categoryOf(predicted),
      confidence: round(Number(row[`${TARGET}__pred_confidence`]), 3),
      source: indexOf.get(String(row[`${TARGET}__pred_source`])) ?? -1,
    };
  });

  // Per-category silhouette in the 2D map and in the embedding it came from, one entry per
  // scored category, colored as its legend row (collapsed categories in Other's grey).
  const silhouette = (await readRows(parts[4])).filter(
    (row) =>
      row.annotation === SCORED &&
      row.stat_family === 'annotation_validity' &&
      row.label_kind === 'annotation' &&
      row.metric === 'silhouette' &&
      row.space_name === (row.space_kind === 'embedding' ? EMBEDDING : PROJECTION),
  );
  const score = (kind: string, category: string | null) => {
    const row = silhouette.find(
      (entry) => entry.space_kind === kind && (entry.category || null) === category,
    );
    if (!row) throw new Error(`venom: no ${kind} silhouette for ${category ?? 'the annotation'}`);
    return round(Number(row.value), 3);
  };
  const settings = await readLegendSettings(parts[3]);
  const legend = categorize(rows, SCORED, settings[SCORED]).categories;
  const legendRow = (label: string) =>
    legend.find((category) => !category.kind && category.label === label);
  const scored = [
    ...new Set(silhouette.filter((row) => row.category).map((row) => String(row.category))),
  ];

  writeFileSync(
    resolve(OUT_DIR, 'venom.json'),
    JSON.stringify({
      generatedBy: 'scripts/landing-data/build-landing-data.mts',
      source: VENOM_BUNDLE,
      ids,
      eat: {
        categories: ec.categories.filter((category) => category.kind !== 'na'),
        curated,
        transferred: transferred.filter((entry) => entry != null),
      },
      separation: {
        label: annotationLabel(SCORED),
        projection: PROJECTION,
        overall: { map: score('projection', null), embedding: score('embedding', null) },
        categories: scored.map((label) => {
          const row = legendRow(label);
          return {
            label,
            color: row?.color ?? OTHER_COLOR,
            // Categories the legend collapses into Other, drawn underneath in its grey.
            ...(row ? {} : { kind: 'other' as const }),
            map: score('projection', label),
            embedding: score('embedding', label),
          };
        }),
      },
    }),
  );
  console.warn(
    `venom: ${rows.length} proteins, ${transferred.filter(Boolean).length} transferred ${TARGET} values`,
  );
}

await buildDemo();
await buildVenom();
