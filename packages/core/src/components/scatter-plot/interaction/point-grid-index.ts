import type * as d3 from 'd3';
import type { PlotData } from '@protspace/utils';

/**
 * Screen-space point index for hit-testing and rubber-band/lasso selection.
 *
 * Backed by a uniform grid over flat typed arrays rather than a d3 quadtree: the quadtree
 * allocated one heap object per visible point, which cost 512 ms to build at 573K points
 * against 37 ms for the grid.
 *
 * Behaviour matches the quadtree it replaced:
 *  - non-finite screen coordinates are not indexed;
 *  - `queryByPixels` / `queryByPolygon` use an inclusive AABB test and return every match,
 *    including coincident points (result order is not contractual);
 *  - `findNearest` uses a strict `< radius` cutoff and, for exactly coincident points, returns
 *    the LAST one in `slots` order, which is what `d3.quadtree.find` did (a coincident point
 *    is pushed to the head of the leaf chain by `add`, and `find` only reads the head).
 *
 * Two cases diverge, both harmless and both left as they are:
 *  - among equidistant but NON-coincident points d3 returns the first it visits and this
 *    returns the last (`d2 <= best` below). Which point of several at the same distance wins
 *    a hover is arbitrary either way;
 *  - a negative radius returns a hit here where d3 returned -1. Unreachable: every caller
 *    passes a positive pixel radius.
 */

/** Upper bound on grid cells per axis, so a pathological screen extent cannot blow up memory. */
const MAX_GRID_SIDE = 2048;
const MIN_CELL_PX = 8;
const MAX_CELL_PX = 64;

export class PointGridIndex {
  private scales: {
    x: d3.ScaleLinear<number, number>;
    y: d3.ScaleLinear<number, number>;
  } | null = null;

  /** True once `rebuild` ran with scales and a non-empty slot list (mirrors the old `qt != null`). */
  private built = false;
  /** Number of indexed (finite-coordinate) points. */
  private n = 0;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private slotOf = new Int32Array(0);

  private originX = 0;
  private originY = 0;
  private cell = MIN_CELL_PX;
  private gridW = 0;
  private gridH = 0;
  /** `cellStart[c] .. cellStart[c + 1]` indexes `cellItems`, which holds point indices ascending. */
  private cellStart = new Int32Array(1);
  private cellItems = new Int32Array(0);
  /** Queries skip slot `s` unless `visible[s] === 1`; null answers for every indexed slot. */
  private visible: Uint8Array | null = null;

  setScales(
    scales: {
      x: d3.ScaleLinear<number, number>;
      y: d3.ScaleLinear<number, number>;
    } | null,
  ) {
    this.scales = scales;
  }

  /**
   * Answer queries for the slots `visible` marks (indexed by slot) and skip the rest, as an
   * index rebuilt with only those slots would. Lets a caller index every slot once and change
   * which are visible without a rebuild. `rebuild` and `clear` drop it.
   */
  setVisible(visible: Uint8Array | null) {
    this.visible = visible;
  }

  rebuild(pd: PlotData, slots: ArrayLike<number>) {
    this.visible = null;
    if (!this.scales || slots.length === 0) {
      this.clear();
      return;
    }

    // Precompute screen-space coordinates once at rebuild time.
    // This makes query/hit-testing significantly cheaper, because we avoid calling
    // scale functions for every candidate slot during interactions.
    const sx = this.scales.x;
    const sy = this.scales.y;
    const total = slots.length;
    const px = new Float32Array(total);
    const py = new Float32Array(total);
    const slotOf = new Int32Array(total);

    let n = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < total; i++) {
      const slot = slots[i];
      const x = sx(pd.xs[slot]);
      const y = sy(pd.ys[slot]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      px[n] = x;
      py[n] = y;
      slotOf[n] = slot;
      // Read back the stored float32 values so the bounds cannot exclude a point by a rounding ulp.
      const fx = px[n];
      const fy = py[n];
      if (fx < minX) minX = fx;
      if (fx > maxX) maxX = fx;
      if (fy < minY) minY = fy;
      if (fy > maxY) maxY = fy;
      n++;
    }

    if (n === 0) {
      // Every coordinate was non-finite: indexed but empty, exactly like an empty d3 tree.
      this.clear();
      this.built = true;
      return;
    }

    this.built = true;
    this.px = px;
    this.py = py;
    this.slotOf = slotOf;
    this.n = n;

    const w = maxX - minX;
    const h = maxY - minY;
    let cell = Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, 2 * Math.sqrt((w * h) / n)));
    cell = Math.max(cell, w / MAX_GRID_SIDE, h / MAX_GRID_SIDE);
    const gridW = Math.floor(w / cell) + 1;
    const gridH = Math.floor(h / cell) + 1;
    const cells = gridW * gridH;

    // Counting sort of point indices into cells.
    const cellStart = new Int32Array(cells + 1);
    const cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const gx = clampIndex((px[i] - minX) / cell, gridW);
      const gy = clampIndex((py[i] - minY) / cell, gridH);
      const c = gy * gridW + gx;
      cellOf[i] = c;
      cellStart[c + 1]++;
    }
    for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
    const cursor = cellStart.slice(0, cells);
    const cellItems = new Int32Array(n);
    for (let i = 0; i < n; i++) cellItems[cursor[cellOf[i]]++] = i;

    this.originX = minX;
    this.originY = minY;
    this.cell = cell;
    this.gridW = gridW;
    this.gridH = gridH;
    this.cellStart = cellStart;
    this.cellItems = cellItems;
  }

  findNearest(screenX: number, screenY: number, radius: number): number {
    if (!this.built || this.n === 0) return -1;
    const { px, py, cell, gridW, gridH, cellStart, cellItems, slotOf, visible } = this;

    const r2 = radius * radius;
    let best = Infinity;
    let bestSlot = -1;

    const cx = clampIndex((screenX - this.originX) / cell, gridW);
    const cy = clampIndex((screenY - this.originY) / cell, gridH);
    const maxRing = Math.max(gridW, gridH);

    for (let k = 0; k <= maxRing; k++) {
      // Any point in ring k is at least (k - 1) * cell away: the probe sits somewhere inside
      // its own cell, so it can be up to one full cell nearer than the ring's own offset.
      const ringMin = (k - 1) * cell;
      if (ringMin > radius) break;
      if (ringMin > 0 && ringMin * ringMin > best) break;

      const rx0 = cx - k;
      const rx1 = cx + k;
      const ry0 = cy - k;
      const ry1 = cy + k;
      const gy0 = ry0 < 0 ? 0 : ry0;
      const gy1 = ry1 >= gridH ? gridH - 1 : ry1;
      const gx0 = rx0 < 0 ? 0 : rx0;
      const gx1 = rx1 >= gridW ? gridW - 1 : rx1;

      for (let gy = gy0; gy <= gy1; gy++) {
        const onYEdge = gy === ry0 || gy === ry1;
        for (let gx = gx0; gx <= gx1; gx++) {
          // Interior cells belong to a smaller ring and were already visited.
          if (!onYEdge && gx !== rx0 && gx !== rx1) continue;
          const c = gy * gridW + gx;
          const end = cellStart[c + 1];
          for (let t = cellStart[c]; t < end; t++) {
            const i = cellItems[t];
            if (visible && visible[slotOf[i]] !== 1) continue;
            const dx = screenX - px[i];
            const dy = screenY - py[i];
            const d2 = dx * dx + dy * dy;
            // `<= best` with ascending iteration means the last coincident point wins,
            // matching d3.quadtree.find.
            if (d2 < r2 && d2 <= best) {
              best = d2;
              bestSlot = slotOf[i];
            }
          }
        }
      }
    }

    return bestSlot;
  }

  isBuilt(): boolean {
    return this.built;
  }

  clear() {
    this.built = false;
    this.visible = null;
    this.n = 0;
    this.px = new Float32Array(0);
    this.py = new Float32Array(0);
    this.slotOf = new Int32Array(0);
    this.gridW = 0;
    this.gridH = 0;
    this.cellStart = new Int32Array(1);
    this.cellItems = new Int32Array(0);
  }

  queryByPixels(minX: number, minY: number, maxX: number, maxY: number): number[] {
    return this.collectInBox(minX, minY, maxX, maxY);
  }

  queryByPolygon(vertices: ReadonlyArray<[number, number]>): number[] {
    if (!this.built || vertices.length < 3) return [];

    // Compute AABB of polygon for fast cell pruning
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

    return this.collectInPolygon(minX, minY, maxX, maxY, vertices);
  }

  /**
   * Same result (and order) as testing every point in the polygon's AABB with `pointInPolygon`,
   * but each cell is classified first: only cells an edge passes through test their points.
   * A cell no edge touches lies wholly on one side of the boundary, so every point in it gets
   * the answer its centre gets. Adjacent untouched cells in a row share that answer, so the
   * centre is tested once per run of them. Points in crossed cells are tested only against
   * the edges whose y-range reaches the cell row; no other edge can flip their result.
   */
  private collectInPolygon(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    polygon: ReadonlyArray<[number, number]>,
  ): number[] {
    const results: number[] = [];
    if (!this.built || this.n === 0) return results;
    const { px, py, cell, gridW, gridH, cellStart, cellItems, slotOf, visible } = this;

    const gx0 = clampIndex((minX - this.originX) / cell, gridW);
    const gx1 = clampIndex((maxX - this.originX) / cell, gridW);
    const gy0 = clampIndex((minY - this.originY) / cell, gridH);
    const gy1 = clampIndex((maxY - this.originY) / cell, gridH);
    const cols = gx1 - gx0 + 1;
    const rows = gy1 - gy0 + 1;
    if (!(cols > 0 && rows > 0)) return results;

    const left = this.originX + gx0 * cell;
    const top = this.originY + gy0 * cell;
    const pad = cellMargin(polygon, left, top, cell);
    const crossed =
      pad === null ? null : markCrossedCells(polygon, left, top, cell, cols, rows, pad);
    // Edges of the current row as (xi, yi, xj, yj), in `pointInPolygon`'s operand order.
    const rowEdges = new Float64Array(polygon.length * 4);

    for (let r = 0; r < rows; r++) {
      const row = (gy0 + r) * gridW + gx0;
      let runInside: boolean | null = null;
      let edgeCount = -1;
      for (let k = 0; k < cols; k++) {
        const c = row + k;
        const end = cellStart[c + 1];
        if (crossed === null || crossed[r * cols + k] === 1) {
          runInside = null;
          if (edgeCount < 0 && pad !== null) {
            edgeCount = collectRowEdges(
              polygon,
              top + r * cell - pad,
              top + (r + 1) * cell + pad,
              rowEdges,
            );
          }
          for (let t = cellStart[c]; t < end; t++) {
            const i = cellItems[t];
            const x = px[i];
            const y = py[i];
            if (x < minX || x > maxX || y < minY || y > maxY) continue;
            if (
              pad === null
                ? !pointInPolygon(x, y, polygon)
                : !pointInEdges(x, y, rowEdges, edgeCount)
            ) {
              continue;
            }
            const slot = slotOf[i];
            if (visible && visible[slot] !== 1) continue;
            results.push(slot);
          }
          continue;
        }
        if (runInside === null) {
          runInside = pointInPolygon(left + (k + 0.5) * cell, top + (r + 0.5) * cell, polygon);
        }
        if (!runInside) continue;
        for (let t = cellStart[c]; t < end; t++) {
          const slot = slotOf[cellItems[t]];
          if (visible && visible[slot] !== 1) continue;
          results.push(slot);
        }
      }
    }

    return results;
  }

  /** Slots inside the inclusive AABB. */
  private collectInBox(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const results: number[] = [];
    if (!this.built || this.n === 0) return results;
    const { px, py, cell, gridW, gridH, cellStart, cellItems, slotOf, visible } = this;

    // NaN bounds collapse to an empty cell range, which matches the old code returning nothing.
    const gx0 = clampIndex((minX - this.originX) / cell, gridW);
    const gx1 = clampIndex((maxX - this.originX) / cell, gridW);
    const gy0 = clampIndex((minY - this.originY) / cell, gridH);
    const gy1 = clampIndex((maxY - this.originY) / cell, gridH);

    for (let gy = gy0; gy <= gy1; gy++) {
      const row = gy * gridW;
      for (let gx = gx0; gx <= gx1; gx++) {
        const c = row + gx;
        const end = cellStart[c + 1];
        for (let t = cellStart[c]; t < end; t++) {
          const i = cellItems[t];
          const x = px[i];
          const y = py[i];
          if (x < minX || x > maxX || y < minY || y > maxY) continue;
          const slot = slotOf[i];
          if (visible && visible[slot] !== 1) continue;
          results.push(slot);
        }
      }
    }

    return results;
  }
}

/** Floor `v` to an integer cell index inside `[0, size)`. NaN stays NaN so ranges collapse. */
function clampIndex(v: number, size: number): number {
  const i = Math.floor(v);
  if (i < 0) return 0;
  if (i >= size) return size - 1;
  return i;
}

/**
 * How far to grow each cell before classifying it: far more than the rounding in
 * `pointInPolygon` and in the cell assignment. Null when a vertex is non-finite, which leaves
 * every point to the plain per-point test.
 */
function cellMargin(
  vertices: ReadonlyArray<[number, number]>,
  left: number,
  top: number,
  cell: number,
): number | null {
  let magnitude = Math.max(Math.abs(left), Math.abs(top));
  for (const [x, y] of vertices) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    magnitude = Math.max(magnitude, Math.abs(x), Math.abs(y));
  }
  return cell / 64 + magnitude * 1e-9;
}

/**
 * Flag (1) every cell of the `cols` x `rows` block at (`left`, `top`) that a polygon edge may
 * touch. The test is conservative: each cell is grown by `pad`, and an edge spares a cell only
 * when all four grown corners lie strictly on one side of its line. So an unflagged cell holds
 * no point that sits on, or within rounding of, an edge.
 */
function markCrossedCells(
  vertices: ReadonlyArray<[number, number]>,
  left: number,
  top: number,
  cell: number,
  cols: number,
  rows: number,
  pad: number,
): Uint8Array {
  const crossed = new Uint8Array(cols * rows);
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [ax, ay] = vertices[j];
    const [bx, by] = vertices[i];
    const k0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad - left) / cell));
    const k1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + pad - left) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - pad - top) / cell));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + pad - top) / cell));
    const dx = bx - ax;
    const dy = by - ay;
    for (let r = r0; r <= r1; r++) {
      // Corner offsets from `a`, grown by `pad`.
      const y0 = top + r * cell - pad - ay;
      const y1 = top + (r + 1) * cell + pad - ay;
      for (let k = k0; k <= k1; k++) {
        const x0 = left + k * cell - pad - ax;
        const x1 = left + (k + 1) * cell + pad - ax;
        const s0 = dx * y0 - dy * x0;
        const s1 = dx * y0 - dy * x1;
        const s2 = dx * y1 - dy * x0;
        const s3 = dx * y1 - dy * x1;
        const allPos = s0 > 0 && s1 > 0 && s2 > 0 && s3 > 0;
        const allNeg = s0 < 0 && s1 < 0 && s2 < 0 && s3 < 0;
        if (!allPos && !allNeg) crossed[r * cols + k] = 1;
      }
    }
  }
  return crossed;
}

/**
 * Copy into `out` the edges whose y-range meets `[y0, y1]` and return their count. An edge
 * entirely above or below that band has both ends on the same side of any `py` inside it, so
 * it never toggles `pointInPolygon` there.
 */
function collectRowEdges(
  vertices: ReadonlyArray<[number, number]>,
  y0: number,
  y1: number,
  out: Float64Array,
): number {
  let count = 0;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    if (Math.max(yi, yj) < y0 || Math.min(yi, yj) > y1) continue;
    out[count * 4] = xi;
    out[count * 4 + 1] = yi;
    out[count * 4 + 2] = xj;
    out[count * 4 + 3] = yj;
    count++;
  }
  return count;
}

/** `pointInPolygon` over the first `count` edges of `edges`, with the same arithmetic. */
function pointInEdges(px: number, py: number, edges: Float64Array, count: number): boolean {
  let inside = false;
  for (let e = 0; e < count * 4; e += 4) {
    const xi = edges[e];
    const yi = edges[e + 1];
    const xj = edges[e + 2];
    const yj = edges[e + 3];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
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
