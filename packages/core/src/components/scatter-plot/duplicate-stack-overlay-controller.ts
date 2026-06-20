/**
 * Owns the entire duplicate-stack / spiderfy / badge overlay subsystem, lifted
 * verbatim out of `scatter-plot.ts` (report F-06). It holds all duplicate-stack
 * state (the per-viewport stack list + lookup maps, the expanded key + spider
 * anchor, the debounce/compute job tokens), schedules the debounced overlay
 * update, runs the chunked viewport compute, and coordinates the badge canvas
 * renderer (F-30) + spiderfy SVG layer (F-32) via the shared helpers (F-36/F-51/
 * F-52).
 *
 * Pure/decoupled: this module does NOT import `scatter-plot.ts`. The host wires
 * its overlay group, badges canvas, transform, config, scales, plot data,
 * quadtree, enablement/selection flags, color getter, and the click/hover hooks
 * through the {@link DuplicateStackOverlayDeps} accessor bundle. Event dispatch
 * stays on the host via `onPointActivate`/`onHover`/`onHoverEnd` (INV-05/INV-03).
 *
 * All geometry/style/timing constants and control flow are preserved verbatim
 * from the original inline subsystem; the only edits are `this._x` →
 * `this.deps.getX()` accessors and `this._field` → `this.field` state.
 */

import type { Selection } from 'd3';
import type { ZoomTransform } from 'd3';
import type { PlotData, PlotDataPoint, ScatterplotConfig } from '@protspace/utils';
import { materializePlotDataPoint } from '@protspace/utils';
import { buildDuplicateStacks } from './duplicate-stack-helpers';
import { computeViewportWindow, buildViewKey } from './duplicate-stack-viewport';
import {
  cullAndCapStacks,
  DuplicateBadgesCanvasRenderer,
} from './duplicate-badges-canvas-renderer';
import { SpiderfyLayer } from './spiderfy-layer';
import type { ViewportDuplicateStack } from './duplicate-stack-types';
import type { QuadtreeIndex } from './quadtree-index';

// Duplicate stack UI performance tuning (target: M1 MacBook + Chrome)
const DUPLICATE_BADGES_VIEWPORT_PADDING = 60;
const DUPLICATE_BADGES_UPDATE_DEBOUNCE_MS = 120;
const DUPLICATE_STACK_COMPUTE_CHUNK_SIZE = 25_000;

interface DuplicateStackOverlayDeps {
  getOverlayGroup: () => Selection<SVGGElement, unknown, null, undefined> | null;
  getBadgesCanvas: () => HTMLCanvasElement | undefined;
  getTransform: () => ZoomTransform;
  getConfig: () => Required<ScatterplotConfig>; // _mergedConfig (width/height/margin)
  getScales: () => { x: (n: number) => number; y: (n: number) => number } | null;
  getPlotData: () => PlotData;
  getQuadtree: () => QuadtreeIndex;
  isEnabled: () => boolean; // _mergedConfig.enableDuplicateStackUI
  isSelectionMode: () => boolean;
  getColor: (p: PlotDataPoint) => string; // _getColors(p)[0] ?? '#888888'
  onPointActivate: (event: MouseEvent, p: PlotDataPoint) => void; // host _handleClick
  onHover: (event: MouseEvent, p: PlotDataPoint) => void; // host _handleMouseOver
  onHoverEnd: () => void; // host _clearHoverState
}

export class DuplicateStackOverlayController {
  private stacks: ViewportDuplicateStack[] = [];
  private byKey = new Map<string, ViewportDuplicateStack>();
  private pointIdToKey = new Map<string, string>();
  private expandedKey: string | null = null;
  // Anchor position the user clicked to open the current spider. Stored separately
  // from the per-viewport stack object so it survives the rebuild that happens on
  // every pan/zoom (see applyExpandedAnchor).
  private expandedAnchor: { stackKey: string; x: number; y: number } | null = null;
  private debounceId: number | null = null;
  private cacheKey: string | null = null;
  private computeJobId = 0;
  private computing = false;
  private readonly badges: DuplicateBadgesCanvasRenderer;
  private readonly spiderfy: SpiderfyLayer;

  constructor(private readonly deps: DuplicateStackOverlayDeps) {
    this.badges = new DuplicateBadgesCanvasRenderer({
      getCanvas: () => this.deps.getBadgesCanvas(),
      getTransform: () => this.deps.getTransform(),
      getSize: () => ({
        width: this.deps.getConfig().width,
        height: this.deps.getConfig().height,
      }),
      getExpandedKey: () => this.expandedKey,
    });
    // Spiderfy interaction can lose native 'click' due to d3.zoom gesture handling in some browsers.
    // The layer owns the press/release map and reconstructs taps; dispatch stays on the host (INV-05).
    this.spiderfy = new SpiderfyLayer({
      getColor: (p) => this.deps.getColor(p),
      onActivate: (e, p) => this.deps.onPointActivate(e, p),
      onHover: (e, p) => this.deps.onHover(e, p),
      onHoverEnd: () => this.deps.onHoverEnd(),
    });
  }

  // ----- Public surface (1:1 with the old private methods on the host) -----

  updateSelectionOverlays(options: { duplicateImmediate?: boolean } = {}): void {
    if (!this.deps.getOverlayGroup()) return;
    this.scheduleUpdate(options.duplicateImmediate ?? true);
  }

  cancelDebounce(): void {
    if (this.debounceId !== null) {
      window.clearTimeout(this.debounceId);
      this.debounceId = null;
    }
  }

  cancelCompute(): void {
    // Bump job id so any in-flight chunked compute aborts early.
    this.computeJobId++;
    this.computing = false;
  }

  clearBadges(): void {
    this.badges.clear();
  }

  /**
   * Invalidate only the viewport cache key (next overlay update recomputes) —
   * verbatim from the config-toggle path, which reset the cache without
   * clearing the live stacks/maps.
   */
  resetCacheKey(): void {
    this.cacheKey = null;
  }

  resetState(): void {
    this.stacks = [];
    this.byKey.clear();
    this.pointIdToKey.clear();
    this.expandedKey = null;
    this.expandedAnchor = null;
    this.cacheKey = null;
    this.spiderfy.reset();
  }

  /** True when a duplicate-badge spider is currently expanded. */
  hasExpanded(): boolean {
    return this.expandedKey !== null;
  }

  /** Collapse the currently-open duplicate-badge spider, if any. */
  closeExpanded(): void {
    if (this.expandedKey === null) return;
    this.expandedKey = null;
    this.expandedAnchor = null;
    this.updateOverlays();
  }

  /**
   * Click hit-test hook: returns true (handled) if `point` belongs to a real
   * (>1 member) duplicate stack, toggling its spider. Verbatim from the host
   * click branch.
   */
  maybeSpiderfyPoint(point: PlotDataPoint): boolean {
    if (!this.deps.isEnabled()) return false;
    // If this point belongs to a duplicate stack, spiderfy instead of picking an arbitrary member.
    const stackKey = this.pointIdToKey.get(point.id);
    const stack = stackKey ? this.byKey.get(stackKey) : undefined;
    if (stack && stack.points.length > 1) {
      this.toggleSpiderfy(stack.key, point);
      return true;
    }
    return false;
  }

  /**
   * Click hit-test hook: clicking anywhere outside the expanded stack collapses
   * it. Returns whether a stack was expanded (host treats a collapse-click as a
   * dismiss). Verbatim from the host hit-test.
   */
  collapseExpanded(): boolean {
    const hadExpanded = !!this.expandedKey;
    if (this.expandedKey) {
      this.expandedKey = null;
      this.updateOverlays();
    }
    return hadExpanded;
  }

  // ----- Relocated private bodies (verbatim modulo accessor substitution) -----

  private scheduleUpdate(immediate: boolean): void {
    if (!this.deps.getOverlayGroup()) return;

    // When the feature is disabled, keep this lightweight and synchronous.
    if (!this.deps.isEnabled()) {
      this.updateOverlays();
      return;
    }

    if (immediate) {
      this.cancelDebounce();
      this.updateOverlays();
      return;
    }

    // Cheap path: redraw existing badges with the current zoom transform (no recompute, no DOM churn).
    this.redrawBadgesOnly();

    // Debounce to avoid DOM churn during pan/zoom.
    this.cancelDebounce();
    this.debounceId = window.setTimeout(() => {
      this.debounceId = null;
      this.updateOverlays();
    }, DUPLICATE_BADGES_UPDATE_DEBOUNCE_MS);
  }

  private ensureForViewport(
    viewKey: string,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): boolean {
    if (this.cacheKey === viewKey) return true;
    if (this.computing) return false;

    this.computing = true;
    const jobId = ++this.computeJobId;

    // Query only the slots currently in (or near) the viewport. This is the key perf win.
    const candidateSlots = this.deps.getQuadtree().queryByPixels(minX, minY, maxX, maxY);
    const scales = this.deps.getScales();
    if (!scales) {
      this.computing = false;
      return false;
    }

    const collected: PlotDataPoint[] = [];

    let idx = 0;
    const step = () => {
      if (jobId !== this.computeJobId) return; // cancelled
      const end = Math.min(candidateSlots.length, idx + DUPLICATE_STACK_COMPUTE_CHUNK_SIZE);
      for (; idx < end; idx++) {
        const slot = candidateSlots[idx];
        const p = materializePlotDataPoint(this.deps.getPlotData(), slot);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        collected.push(p);
      }

      if (idx < candidateSlots.length) {
        requestAnimationFrame(step);
        return;
      }

      // Finalize: group via the same pure helper the F-24 tests exercise
      // (same key fn, finite skip, drop-solos, idToKey-records-solos), then
      // re-project each surviving stack's data-space coords to base pixels.
      const { stacks: rawStacks, idToKey } = buildDuplicateStacks(collected);
      const stacks: ViewportDuplicateStack[] = rawStacks.map((s) => ({
        ...s,
        px: scales.x(s.x),
        py: scales.y(s.y),
      }));
      const byKey = new Map<string, ViewportDuplicateStack>(stacks.map((s) => [s.key, s]));

      this.stacks = stacks;
      this.byKey = byKey;
      this.pointIdToKey = idToKey;

      // If the expanded stack is no longer available for this viewport, collapse it.
      if (this.expandedKey && !this.byKey.has(this.expandedKey)) {
        this.expandedKey = null;
        this.expandedAnchor = null;
      }

      // Restore the user's spider anchor on the freshly built stack object so
      // pan/zoom doesn't snap the spider back to whichever group member was
      // iterated first.
      this.applyExpandedAnchor();

      this.cacheKey = viewKey;
      this.computing = false;

      // Re-render overlays for the freshly computed viewport stacks.
      this.updateOverlays();
    };

    requestAnimationFrame(step);
    return false;
  }

  private redrawBadgesOnly(): void {
    if (!this.deps.isEnabled() || this.deps.isSelectionMode()) {
      this.badges.clear();
      return;
    }
    if (!this.deps.getScales()) return;

    const config = this.deps.getConfig();
    const { minX, maxX, minY, maxY } = computeViewportWindow(
      this.deps.getTransform(),
      config,
      DUPLICATE_BADGES_VIEWPORT_PADDING,
    );

    const stacksToRender = cullAndCapStacks(
      this.stacks,
      { minX, maxX, minY, maxY },
      this.expandedKey,
      this.byKey,
    );

    // Note: canvas drawing uses screen coordinates and already keeps badge size constant.
    this.badges.render(stacksToRender);
  }

  private ensureSpiderfyLayer(): Selection<SVGGElement, unknown, null, undefined> | null {
    const overlayGroup = this.deps.getOverlayGroup();
    if (!overlayGroup) return null;
    let spiderfyLayer = overlayGroup.select<SVGGElement>('g.duplicate-spiderfy-layer');
    if (spiderfyLayer.empty()) {
      spiderfyLayer = overlayGroup.append('g').attr('class', 'duplicate-spiderfy-layer');
    }
    return spiderfyLayer;
  }

  private updateOverlays(): void {
    const overlayGroup = this.deps.getOverlayGroup();
    if (!overlayGroup || !this.deps.getScales()) return;

    if (!this.deps.isEnabled()) {
      // Remove both to clean up older DOM from previous versions.
      overlayGroup.selectAll('g.duplicate-stacks-layer, g.duplicate-spiderfy-layer').remove();
      this.expandedKey = null;
      this.badges.clear();
      return;
    }

    // Don't show stack UI while brushing/selecting.
    if (this.deps.isSelectionMode()) {
      overlayGroup.selectAll('g.duplicate-stacks-layer, g.duplicate-spiderfy-layer').remove();
      this.expandedKey = null;
      this.badges.clear();
      return;
    }

    const spiderfyLayer = this.ensureSpiderfyLayer();
    if (!spiderfyLayer) return;

    const transform = this.deps.getTransform();
    const k = transform.k || 1;
    const config = this.deps.getConfig();
    const viewKey = buildViewKey(transform, config.width, config.height);

    // Compute visible window in "base pixel space" (same as quadtree indexing).
    const { minX, maxX, minY, maxY } = computeViewportWindow(
      transform,
      config,
      DUPLICATE_BADGES_VIEWPORT_PADDING,
    );

    // Ensure we have duplicate stacks for the current viewport before trying to render.
    if (!this.ensureForViewport(viewKey, minX, minY, maxX, maxY)) {
      // Keep existing DOM as-is until computation finishes; updateOverlays will rerun.
      return;
    }

    // --- Badges (N) ---
    const stacksToRender = cullAndCapStacks(
      this.stacks,
      { minX, maxX, minY, maxY },
      this.expandedKey,
      this.byKey,
    );

    // Phase 3: render badges via a lightweight 2D canvas overlay (much faster than many SVG nodes).
    // Spiderfy remains in SVG for interaction.
    this.badges.render(stacksToRender);

    // --- Spiderfy ---
    if (!this.expandedKey) {
      this.spiderfy.reset();
      spiderfyLayer.selectAll('*').remove();
      return;
    }

    const stack = this.byKey.get(this.expandedKey);
    if (!stack) {
      this.expandedKey = null;
      spiderfyLayer.selectAll('*').remove();
      return;
    }

    // Hide spiderfy if the stack is off-screen (e.g., after a zoom/pan).
    if (!(stack.px >= minX && stack.px <= maxX && stack.py >= minY && stack.py <= maxY)) {
      this.expandedKey = null;
      spiderfyLayer.selectAll('*').remove();
      return;
    }

    this.spiderfy.render(spiderfyLayer, stack, k);
  }

  private toggleSpiderfy(stackKey: string, anchorPoint?: PlotDataPoint): void {
    this.expandedKey = this.expandedKey === stackKey ? null : stackKey;

    if (this.expandedKey && anchorPoint) {
      // Remember where the user clicked so the spider stays anchored to that
      // point across pan/zoom — byKey rebuilds with fresh
      // objects on every viewport recompute and would otherwise drop the anchor.
      this.expandedAnchor = {
        stackKey: this.expandedKey,
        x: anchorPoint.x,
        y: anchorPoint.y,
      };
      this.applyExpandedAnchor();
    } else {
      this.expandedAnchor = null;
    }

    this.updateOverlays();
  }

  private applyExpandedAnchor(): void {
    const anchor = this.expandedAnchor;
    const scales = this.deps.getScales();
    if (!anchor || !scales) return;
    if (anchor.stackKey !== this.expandedKey) return;
    const stack = this.byKey.get(anchor.stackKey);
    if (!stack) return;
    stack.x = anchor.x;
    stack.y = anchor.y;
    stack.px = scales.x(anchor.x);
    stack.py = scales.y(anchor.y);
  }
}
