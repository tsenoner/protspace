import fs from 'node:fs';
import type { SegmentResult, TimingSample } from './probes';

/** The per-segment numbers a budget can cap. `glIsPerRender` is derived. */
const BUDGET_KEYS = [
  'restage',
  'restagePos',
  'restageStyle',
  'render',
  'processData',
  'gridRebuild',
  'legendUpdate',
  'legendRebuild',
  'glSync',
  'uploadBytes',
  'glIsPerRender',
] as const;
type BudgetKey = (typeof BUDGET_KEYS)[number];
type Measured = Record<BudgetKey, number>;
type SegmentBudget = Partial<Record<BudgetKey, number | null>>;

export interface BudgetsFile {
  $comment: string;
  recordedAt: string;
  segments: Record<string, SegmentBudget>;
}

const BUDGETS_COMMENT =
  'Max allowed per segment on data.parquetbundle. null = report only. ' +
  'Update: PERF_UPDATE_BUDGETS=1 pnpm perf:counts, review the diff, commit.';

function measure(result: SegmentResult): Measured {
  const d = result.delta;
  return {
    restage: d.restage,
    restagePos: d.restagePos,
    restageStyle: d.restageStyle,
    render: d.render,
    processData: d.processData,
    gridRebuild: d.gridRebuild,
    legendUpdate: d.legendUpdate,
    legendRebuild: d.legendRebuild,
    glSync: d.glSync,
    uploadBytes: d.uploadBytes,
    glIsPerRender: d.render > 0 ? Math.round((d.glIs / d.render) * 10) / 10 : 0,
  };
}

export function readBudgets(file: string): BudgetsFile {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as BudgetsFile;
}

/**
 * Counts that follow how many frames a load or gesture spans, not our code: report
 * only. Seen varying between runs on one machine (load render 57-59, grid 2-3).
 */
const FRAME_BOUND_KEYS: BudgetKey[] = ['render', 'glSync', 'gridRebuild', 'glIsPerRender'];
const FRAME_BOUND: Record<string, BudgetKey[]> = {
  load: FRAME_BOUND_KEYS,
  import: FRAME_BOUND_KEYS,
  camera: ['render', 'glSync'],
};

/**
 * Budgets from several recordings: the max of each count. A count that differed
 * between recordings depends on timing (how many frames a load or gesture spans),
 * so it would flake as a gate and is recorded as null (report only), as are the
 * FRAME_BOUND keys and any key the previous file set to null. Bytes are budgeted
 * only at 0: any other byte count is a property of the dataset.
 */
export function recordBudgets(
  runs: SegmentResult[][],
  previous: BudgetsFile | null,
  recordedAt: string,
): BudgetsFile {
  const seen: Record<string, Partial<Record<BudgetKey, number[]>>> = {};
  for (const run of runs) {
    for (const result of run) {
      const measured = measure(result);
      const values = (seen[result.name] ??= {});
      for (const key of BUDGET_KEYS) (values[key] ??= []).push(measured[key]);
    }
  }
  const segments: Record<string, SegmentBudget> = {};
  for (const [name, values] of Object.entries(seen)) {
    const old = previous?.segments[name] ?? {};
    const budget: SegmentBudget = {};
    for (const key of BUDGET_KEYS) {
      const recorded = values[key] ?? [];
      const max = Math.max(...recorded);
      const varied = recorded.some((v) => v !== recorded[0]);
      if (old[key] === null || varied || FRAME_BOUND[name]?.includes(key)) budget[key] = null;
      else if (key === 'uploadBytes') budget[key] = max === 0 ? 0 : null;
      else if (key === 'glIsPerRender') budget[key] = Math.ceil(max);
      else budget[key] = max;
    }
    segments[name] = budget;
  }
  return { $comment: BUDGETS_COMMENT, recordedAt, segments };
}

interface BudgetCheck {
  failures: string[];
  tighten: string[];
}

export function checkBudgets(results: SegmentResult[], budgets: BudgetsFile): BudgetCheck {
  const failures: string[] = [];
  const tighten: string[] = [];
  for (const result of results) {
    const budget = budgets.segments[result.name];
    if (!budget) {
      failures.push(`${result.name}: no budget; record one with PERF_UPDATE_BUDGETS=1`);
      continue;
    }
    const measured = measure(result);
    for (const key of BUDGET_KEYS) {
      const limit = budget[key];
      if (limit === null || limit === undefined) continue;
      if (measured[key] > limit)
        failures.push(`${result.name}.${key}: ${measured[key]} > ${limit}`);
      else if (measured[key] < limit)
        tighten.push(`${result.name}.${key}: ${measured[key]} < ${limit}`);
    }
  }
  return { failures, tighten };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const COUNT_COLUMNS: Array<[string, BudgetKey]> = [
  ['restage', 'restage'],
  ['pos', 'restagePos'],
  ['style', 'restageStyle'],
  ['render', 'render'],
  ['glIs/r', 'glIsPerRender'],
  ['sync', 'glSync'],
  ['proc', 'processData'],
  ['legU', 'legendUpdate'],
  ['legR', 'legendRebuild'],
  ['grid', 'gridRebuild'],
];

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  ')).join('\n');
}

/** value/budget per cell, `!` on a cell over budget. */
export function formatCountsTable(results: SegmentResult[], budgets: BudgetsFile | null): string {
  const header = ['segment', ...COUNT_COLUMNS.map(([label]) => label), 'upload', 'pixels'];
  const rows = results.map((result) => {
    const measured = measure(result);
    const budget = budgets?.segments[result.name] ?? {};
    const cell = (key: BudgetKey, text = String(measured[key])) => {
      const limit = budget[key];
      if (limit === null || limit === undefined) return text;
      return `${text}/${key === 'uploadBytes' ? formatBytes(limit) : limit}${measured[key] > limit ? '!' : ''}`;
    };
    const pixels = result.pixelsSame === null ? '-' : result.pixelsSame ? 'same' : 'DIFF!';
    return [
      result.name,
      ...COUNT_COLUMNS.map(([, key]) => cell(key)),
      cell('uploadBytes', formatBytes(measured.uploadBytes)),
      pixels,
    ];
  });
  return table([header, ...rows]);
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type TimingKey = 'inp' | 'loaf' | 'busy' | 'restageMs' | 'p95Frame';
export type TimingMedians = Record<TimingKey, number | null> & { loafScript: string };

export function timingMedians(samples: TimingSample[]): TimingMedians {
  const pick = (key: TimingKey) => {
    const values = samples.map((s) => s[key]).filter((v): v is number => v !== null);
    return values.length ? median(values) : null;
  };
  const longest = samples.reduce<TimingSample | null>(
    (best, s) => (!best || s.loaf > best.loaf ? s : best),
    null,
  );
  return {
    inp: pick('inp'),
    loaf: pick('loaf'),
    busy: pick('busy'),
    restageMs: pick('restageMs'),
    p95Frame: pick('p95Frame'),
    loafScript: longest?.loafScript ?? '',
  };
}

/** `412→118 .29` when there is a reference, else `412`. */
function timingCell(a: number | null, b: number | null | undefined): string {
  if (a === null) return '-';
  const round = (v: number) => String(Math.round(v));
  if (b === undefined) return round(a);
  if (b === null) return `${round(a)}→-`;
  const ratio = a > 0 ? (b / a).toFixed(2).replace(/^0/, '') : '-';
  return `${round(a)}→${round(b)} ${ratio}`;
}

export interface TimingRow {
  segment: string;
  a: TimingMedians;
  /** Second build in --compare, or the stored baseline (then `a` is the reference). */
  b?: TimingMedians;
  pixelsAB?: boolean | null;
}

export function formatTimingTable(title: string, rows: TimingRow[]): string {
  const header = [
    'segment',
    'INP ms',
    'LoAF ms',
    'top script',
    'busy ms',
    'restage ms',
    'p95 frame',
    'pixels A=B',
  ];
  const body = rows.map((row) => [
    row.segment,
    timingCell(row.a.inp, row.b?.inp),
    timingCell(row.a.loaf, row.b?.loaf),
    (row.b?.loafScript || row.a.loafScript || '-').slice(0, 40),
    timingCell(row.a.busy, row.b?.busy),
    timingCell(row.a.restageMs, row.b?.restageMs),
    timingCell(row.a.p95Frame, row.b?.p95Frame),
    row.pixelsAB === undefined || row.pixelsAB === null ? '-' : row.pixelsAB ? 'same' : 'DIFF',
  ]);
  return `${title}\n${table([header, ...body])}`;
}
