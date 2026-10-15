/**
 * Plot reads that have no DOM to find by role: where a protein, a category or a duplicate stack
 * sits on screen, and whether the plot has stopped drawing. Each reads the scatterplot's public
 * automation methods (`getProteinClientPosition`, `getDuplicateStacks`, `dataToClient`), so a spec
 * or a docs capture asks for a point by name and never evaluates in the page itself.
 */
import type { Page } from '@playwright/test';
import type { Point } from './mobile';
import { settle } from './perf/probes';

/** The scatterplot's data and automation methods, as these reads use them. */
interface PlotAutomation extends HTMLElement {
  data?: {
    protein_ids: string[];
    annotations?: Record<string, { values: Array<string | null> }>;
    annotation_data?: Record<string, unknown>;
  } | null;
  selectedAnnotation?: string;
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

      // The column's storage shapes (packages/utils annotation-data-access.ts).
      const codesAt = (index: number): readonly number[] => {
        if (rows instanceof Int32Array) return rows[index] < 0 ? [] : [rows[index]];
        if (Array.isArray(rows)) return (rows[index] as number[] | undefined) ?? [];
        const shaped = rows as {
          kind?: string;
          base?: Int32Array;
          overrides?: Map<number, number[]>;
          offsets?: Int32Array;
          codes?: Int32Array;
        };
        if (shaped.kind === 'sparse-multi' && shaped.base && shaped.overrides) {
          const override = shaped.overrides.get(index);
          if (override) return override;
          return shaped.base[index] < 0 ? [] : [shaped.base[index]];
        }
        if (shaped.kind === 'csr' && shaped.offsets && shaped.codes) {
          return Array.from(
            shaped.codes.subarray(shaped.offsets[index], shaped.offsets[index + 1]),
          );
        }
        return [];
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
