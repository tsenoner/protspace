/**
 * Plot reads that have no DOM to find by role: where a protein, a category or a duplicate stack
 * sits on screen, and whether the plot has stopped drawing. Each reads the scatterplot's public
 * automation methods (`getProteinClientPosition`, `pickInteractivePointAt`, `getDuplicateStacks`,
 * `dataToClient`), so a spec or a docs capture asks for a point by name and never evaluates in the
 * page itself.
 */
import type { Page } from '@playwright/test';
import type { AnnotationData } from '@protspace/utils';
import type { Point } from './mobile';
import { settle } from './perf/probes';

/** The scatterplot's data and automation methods, as these reads use them. */
interface PlotAutomation extends HTMLElement {
  data?: {
    protein_ids: string[];
    annotations?: Record<string, { values: Array<string | null> }>;
    annotation_data?: Record<string, AnnotationData>;
    /** Per annotation, per protein: the transferred (EAT) cell and the protein it came from. */
    annotation_predicted?: Record<string, Array<{ source: string } | null>>;
  } | null;
  selectedAnnotation?: string;
  /** The interactive point within `minRadiusPx` of a point in the plot's own coordinates. */
  pickInteractivePointAt(x: number, y: number, minRadiusPx?: number): { id: string } | null;
  getProteinClientPosition(proteinId: string): Point | null;
  getDuplicateStacks(): Array<{ key: string; x: number; y: number; count: number }>;
  dataToClient(x: number, y: number): Point | null;
}

/**
 * Waits until the plot has stopped drawing: the perf counters and GL probes hold still for two
 * frames and 200 ms (`settle`). Needs `?perfCounters=1` in the page URL, which exposes the
 * counters; throws at once without it, and at `capMs` when the plot keeps drawing.
 */
export async function plotSettled(page: Page, capMs = 3_000): Promise<void> {
  const counted = await page.evaluate(() => window.__protspacePerfCounters !== undefined);
  if (!counted) {
    throw new Error('plotSettled reads the perf counters: load the page with ?perfCounters=1');
  }
  await settle(page, capMs);
}

/** Viewport coordinates of a protein's marker; throws when the protein is not plotted. */
export async function proteinScreenPosition(page: Page, id: string): Promise<Point> {
  const position = await page
    .locator('#myPlot')
    .evaluate(
      (element, proteinId) => (element as PlotAutomation).getProteinClientPosition(proteinId),
      id,
    );
  if (!position) {
    throw new Error(`Protein ${id} is not plotted, or the scatter plot has no geometry yet`);
  }
  return position;
}

/**
 * Viewport coordinates of up to `limit` plotted proteins whose value for the colour-by annotation
 * contains `value` (case-insensitive), inside the plot and without outliers: points further than
 * twice the median absolute deviation from the median, on either axis, are dropped. Spread evenly
 * over the matches. Empty when nothing matches.
 */
export async function clusterScreenPoints(page: Page, value: string, limit = 50): Promise<Point[]> {
  return page.locator('#myPlot').evaluate(
    (element, { needle, max }) => {
      const plot = element as PlotAutomation;
      const annotation = plot.selectedAnnotation;
      const data = plot.data;
      if (!data || !annotation) return [];
      const labels = data.annotations?.[annotation]?.values;
      const rows = data.annotation_data?.[annotation];
      if (!labels || !rows) return [];

      // The column's storage shapes, typed against `AnnotationData` from @protspace/utils (whose
      // `getProteinAnnotationIndices` cannot run in the page), so a new shape fails the type check.
      const codesAt = (index: number): readonly number[] => {
        if (rows instanceof Int32Array) return rows[index] < 0 ? [] : [rows[index]];
        if (Array.isArray(rows)) return (rows as readonly (readonly number[])[])[index] ?? [];
        if ('kind' in rows) {
          switch (rows.kind) {
            case 'sparse-multi': {
              const override = rows.overrides.get(index);
              if (override) return override;
              return rows.base[index] < 0 ? [] : [rows.base[index]];
            }
            case 'csr':
              return Array.from(rows.codes.subarray(rows.offsets[index], rows.offsets[index + 1]));
            default: {
              const unknown: never = rows;
              throw new Error(`Unknown annotation column shape: ${String(unknown)}`);
            }
          }
        }
        throw new Error('Unknown annotation column shape');
      };

      const lower = needle.toLowerCase();
      const rect = plot.getBoundingClientRect();
      const points: Array<{ x: number; y: number }> = [];
      data.protein_ids.forEach((id, index) => {
        const matches = codesAt(index).some((code) =>
          (labels[code] ?? '').toLowerCase().includes(lower),
        );
        if (!matches) return;
        // null when the protein is not plotted (filtered or isolated away)
        const at = plot.getProteinClientPosition(id);
        if (!at) return;
        if (at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom) return;
        points.push(at);
      });
      if (points.length === 0) return [];

      const median = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      };
      const medX = median(points.map((p) => p.x));
      const medY = median(points.map((p) => p.y));
      const madX = median(points.map((p) => Math.abs(p.x - medX))) * 1.4826;
      const madY = median(points.map((p) => Math.abs(p.y - medY))) * 1.4826;
      const kept = points.filter(
        (p) =>
          (madX === 0 || Math.abs(p.x - medX) <= 2 * madX) &&
          (madY === 0 || Math.abs(p.y - medY) <= 2 * madY),
      );
      const cluster = kept.length > 0 ? kept : points;
      const step = Math.max(1, Math.ceil(cluster.length / max));
      return cluster.filter((_, index) => index % step === 0).slice(0, max);
    },
    { needle: value, max: limit },
  );
}

/**
 * The point nearest `at`, within `radius` px, with no interactive protein within `clearancePx` of
 * it: hovering there opens no tooltip, and a wheel zoom there still anchors on what is around it.
 * Throws when the neighbourhood is packed.
 */
export async function emptyScreenPointNear(
  page: Page,
  at: Point,
  radius = 120,
  clearancePx = 8,
): Promise<Point> {
  return page.locator('#myPlot').evaluate(
    (element, { x, y, r, clearance }) => {
      const plot = element as PlotAutomation;
      const rect = plot.getBoundingClientRect();
      for (let d = 0; d <= r; d += 4) {
        const offsets =
          d === 0
            ? [[0, 0]]
            : [
                [d, 0],
                [-d, 0],
                [0, d],
                [0, -d],
                [d, d],
                [-d, -d],
                [d, -d],
                [-d, d],
              ];
        for (const [dx, dy] of offsets) {
          const p = { x: x + dx, y: y + dy };
          if (p.x < rect.left || p.x > rect.right || p.y < rect.top || p.y > rect.bottom) continue;
          if (!plot.pickInteractivePointAt(p.x - rect.left, p.y - rect.top, clearance)) return p;
        }
      }
      throw new Error(`No empty point within ${r}px of ${x},${y}`);
    },
    { x: at.x, y: at.y, r: radius, clearance: clearancePx },
  );
}

/**
 * The duplicate stacks in the current view, at their viewport coordinates. Empty unless the
 * legend's "Show duplicate counts and spread overlaps" setting is on.
 */
export async function duplicateStacks(
  page: Page,
): Promise<Array<{ key: string; x: number; y: number; count: number }>> {
  return page.locator('#myPlot').evaluate((element) => {
    const plot = element as PlotAutomation;
    return plot.getDuplicateStacks().flatMap((stack) => {
      const at = plot.dataToClient(stack.x, stack.y);
      return at ? [{ key: stack.key, x: at.x, y: at.y, count: stack.count }] : [];
    });
  });
}

/**
 * A pair for showing EAT provenance connectors on `annotation`: `source`, a protein other
 * proteins borrowed their value from and that is not itself transferred, and `target`, one of
 * those dependants. Picks the source with the most dependants within 2..`maxDependants` (the
 * renderer draws at most 20 lines: MAX_PROVENANCE_CONNECTORS in
 * apps/web/src/explore/eat-provenance.ts; past it the extra lines are dropped without notice).
 * Both proteins stand `clearancePx` clear of every other plotted protein, so a click there picks
 * that protein and not a neighbour (4 px: the plot's smallest hit radius). Read at call time, not
 * hard-coded, so a rebuilt bundle cannot silently give an empty GIF. Throws when nothing
 * qualifies.
 */
export async function provenancePair(
  page: Page,
  annotation: string,
  options: { maxDependants?: number; clearancePx?: number } = {},
): Promise<{ source: string; target: string; dependantCount: number }> {
  const { maxDependants = 20, clearancePx = 4 } = options;
  const pair = await page.locator('#myPlot').evaluate(
    (element, { key, cap, clearance }) => {
      const plot = element as PlotAutomation;
      const ids = plot.data?.protein_ids;
      const cells = plot.data?.annotation_predicted?.[key];
      if (!ids || !cells) return null;
      const positions = ids.map((id) => plot.getProteinClientPosition(id));
      const standsClear = (index: number | undefined): boolean => {
        const here = index === undefined ? null : positions[index];
        if (!here) return false;
        return positions.every(
          (other, j) =>
            j === index || !other || Math.hypot(other.x - here.x, other.y - here.y) > clearance,
        );
      };
      const indexById = new Map(ids.map((id, index) => [id, index]));
      const dependants = new Map<string, string[]>();
      cells.forEach((cell, i) => {
        const source = cell?.source;
        if (!source) return;
        const list = dependants.get(source);
        if (list) list.push(ids[i]);
        else dependants.set(source, [ids[i]]);
      });
      const ranked = [...dependants.entries()]
        .filter(([source, targets]) => {
          const sourceIndex = indexById.get(source);
          // In the dataset, and not itself transferred: clicking a transferred protein draws its
          // own single source line instead of the fan-out.
          return targets.length >= 2 && sourceIndex !== undefined && !cells[sourceIndex];
        })
        .sort((a, b) => b[1].length - a[1].length);
      for (const [source, targets] of ranked) {
        if (targets.length > cap || !standsClear(indexById.get(source))) continue;
        const target = targets.find((id) => standsClear(indexById.get(id)));
        if (target) return { source, target, dependantCount: targets.length };
      }
      return null;
    },
    { key: annotation, cap: maxDependants, clearance: clearancePx },
  );
  if (!pair) {
    throw new Error(
      `No provenance pair for "${annotation}": needs a non-transferred source with 2-${maxDependants} ` +
        `dependants, it and one of them ${clearancePx} px clear of every other protein`,
    );
  }
  return pair;
}
