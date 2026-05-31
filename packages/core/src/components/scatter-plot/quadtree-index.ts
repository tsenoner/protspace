import * as d3 from 'd3';
import type { PlotData } from '@protspace/utils';

type IndexedSlot = {
  slot: number;
  px: number;
  py: number;
};

export class QuadtreeIndex {
  private qt: d3.Quadtree<IndexedSlot> | null = null;
  private scales: {
    x: d3.ScaleLinear<number, number>;
    y: d3.ScaleLinear<number, number>;
  } | null = null;

  setScales(
    scales: {
      x: d3.ScaleLinear<number, number>;
      y: d3.ScaleLinear<number, number>;
    } | null,
  ) {
    this.scales = scales;
  }

  rebuild(pd: PlotData, slots: ArrayLike<number>) {
    if (!this.scales || slots.length === 0) {
      this.qt = null;
      return;
    }

    // Precompute screen-space coordinates once at rebuild time.
    // This makes query/hit-testing significantly cheaper, because we avoid calling
    // scale functions for every candidate slot during interactions.
    const sx = this.scales.x;
    const sy = this.scales.y;
    const n = slots.length;
    const indexed: IndexedSlot[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const slot = slots[i];
      indexed[i] = { slot, px: sx(pd.xs[slot]), py: sy(pd.ys[slot]) };
    }

    this.qt = d3
      .quadtree<IndexedSlot>()
      .x((d) => d.px)
      .y((d) => d.py)
      .addAll(indexed);
  }

  findNearest(screenX: number, screenY: number, radius: number): number {
    if (!this.qt) return -1;
    const found = this.qt.find(screenX, screenY, radius);
    return found ? found.slot : -1;
  }

  hasTree(): boolean {
    return !!this.qt;
  }

  clear() {
    this.qt = null;
  }

  queryByPixels(minX: number, minY: number, maxX: number, maxY: number): number[] {
    if (!this.qt) {
      return [];
    }

    const results: number[] = [];
    this.qt.visit((node, x0, y0, x1, y1) => {
      if (!node.length) {
        let leaf: d3.QuadtreeLeaf<IndexedSlot> | undefined = node as d3.QuadtreeLeaf<IndexedSlot>;
        while (leaf) {
          const ip = leaf.data;
          if (ip.px >= minX && ip.px <= maxX && ip.py >= minY && ip.py <= maxY) {
            results.push(ip.slot);
          }
          leaf = leaf.next as d3.QuadtreeLeaf<IndexedSlot> | undefined;
        }
      }
      return x0 > maxX || x1 < minX || y0 > maxY || y1 < minY;
    });

    return results;
  }

  queryByPolygon(vertices: ReadonlyArray<[number, number]>): number[] {
    if (!this.qt || vertices.length < 3) return [];

    // Compute AABB of polygon for fast quadtree pruning
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of vertices) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const results: number[] = [];
    this.qt.visit((node, x0, y0, x1, y1) => {
      // Prune quadtree nodes outside the polygon's bounding box
      if (x0 > maxX || x1 < minX || y0 > maxY || y1 < minY) return true;
      if (!node.length) {
        let leaf: d3.QuadtreeLeaf<IndexedSlot> | undefined = node as d3.QuadtreeLeaf<IndexedSlot>;
        while (leaf) {
          const ip = leaf.data;
          if (
            ip.px >= minX &&
            ip.px <= maxX &&
            ip.py >= minY &&
            ip.py <= maxY &&
            pointInPolygon(ip.px, ip.py, vertices)
          ) {
            results.push(ip.slot);
          }
          leaf = leaf.next as d3.QuadtreeLeaf<IndexedSlot> | undefined;
        }
      }
      return false;
    });

    return results;
  }
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(
  px: number,
  py: number,
  vertices: ReadonlyArray<[number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
