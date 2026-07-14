import type { Selection } from 'd3';
import type { PlotData, ScalePair } from '@protspace/utils';
import { plotDataId } from '@protspace/utils';

export interface ProvenanceConnectorPair {
  sourceProteinId: string;
  targetProteinId: string;
  confidence: number;
}

export interface ProvenanceConnectorRequest {
  pairs: readonly ProvenanceConnectorPair[];
  /** Number of visible candidates before the deterministic fan-out cap. */
  totalCandidates: number;
}

export interface ProvenanceConnectorStatus {
  shown: number;
  total: number;
  missingEndpoints: number;
}

interface ConnectorOverlayDeps {
  getOverlayGroup: () => Selection<SVGGElement, unknown, null, undefined> | null;
  getPlotData: () => PlotData;
  getScales: () => ScalePair | null;
  onStatusChange: (status: ProvenanceConnectorStatus | null) => void;
}

interface ResolvedConnector extends ProvenanceConnectorPair {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Owns the transient EAT provenance SVG layer. Requests retain protein ids—not coordinates—so a
 * rerender always resolves against the current projection, plane, filter, and isolation view.
 * Pan/zoom is intentionally absent: the interaction controller transforms the parent overlay group.
 */
export class ConnectorOverlayController {
  private request: ProvenanceConnectorRequest | null = null;
  private indexedPlotData: PlotData | null = null;
  private idToSlot = new Map<string, number>();

  constructor(private readonly deps: ConnectorOverlayDeps) {}

  set(request: ProvenanceConnectorRequest): void {
    this.request = {
      pairs: request.pairs.map((pair) => ({ ...pair })),
      totalCandidates: Math.max(0, Math.trunc(request.totalCandidates)),
    };
    this.render();
  }

  clear(): void {
    this.request = null;
    this.deps.getOverlayGroup()?.selectAll('.connector-lines-layer').remove();
    this.deps.onStatusChange(null);
  }

  /** Release lookup state owned by the previous dataset without weakening stable-view reuse. */
  invalidateDataCache(): void {
    this.indexedPlotData = null;
    this.idToSlot = new Map();
  }

  hasActiveRequest(): boolean {
    return this.request !== null;
  }

  render(): void {
    const overlay = this.deps.getOverlayGroup();
    const request = this.request;
    if (!overlay || !request) {
      if (overlay) overlay.selectAll('.connector-lines-layer').remove();
      this.deps.onStatusChange(null);
      return;
    }

    const plotData = this.deps.getPlotData();
    const scales = this.deps.getScales();
    const idToSlot = this.getIdToSlot(plotData);

    const resolved: ResolvedConnector[] = [];
    if (scales) {
      for (const pair of request.pairs) {
        const sourceSlot = idToSlot.get(pair.sourceProteinId);
        const targetSlot = idToSlot.get(pair.targetProteinId);
        if (sourceSlot === undefined || targetSlot === undefined) continue;
        resolved.push({
          ...pair,
          x1: scales.x(plotData.xs[sourceSlot]),
          y1: scales.y(plotData.ys[sourceSlot]),
          x2: scales.x(plotData.xs[targetSlot]),
          y2: scales.y(plotData.ys[targetSlot]),
        });
      }
    }

    const layer = overlay
      .selectAll<SVGGElement, null>('g.connector-lines-layer')
      .data([null])
      .join('g')
      .attr('class', 'connector-lines-layer')
      .attr('aria-hidden', 'true');

    layer
      .selectAll<SVGLineElement, ResolvedConnector>('line.eat-provenance-connector')
      .data(resolved, (pair) => `${pair.sourceProteinId}\u0000${pair.targetProteinId}`)
      .join('line')
      .attr('class', 'eat-provenance-connector')
      .attr('x1', (pair) => pair.x1)
      .attr('y1', (pair) => pair.y1)
      .attr('x2', (pair) => pair.x2)
      .attr('y2', (pair) => pair.y2);

    const endpoints = new Map<string, { id: string; x: number; y: number }>();
    for (const pair of resolved) {
      endpoints.set(pair.sourceProteinId, { id: pair.sourceProteinId, x: pair.x1, y: pair.y1 });
      endpoints.set(pair.targetProteinId, { id: pair.targetProteinId, x: pair.x2, y: pair.y2 });
    }
    layer
      .selectAll<SVGCircleElement, { id: string; x: number; y: number }>(
        'circle.eat-provenance-endpoint',
      )
      .data([...endpoints.values()], (endpoint) => endpoint.id)
      .join('circle')
      .attr('class', 'eat-provenance-endpoint')
      .attr('cx', (endpoint) => endpoint.x)
      .attr('cy', (endpoint) => endpoint.y)
      .attr('r', 7);

    this.deps.onStatusChange({
      shown: resolved.length,
      total: request.totalCandidates,
      missingEndpoints: request.pairs.length - resolved.length,
    });
  }

  /** Build the O(N) protein lookup only when the rendered PlotData identity changes. */
  private getIdToSlot(plotData: PlotData): ReadonlyMap<string, number> {
    if (plotData === this.indexedPlotData) return this.idToSlot;

    const idToSlot = new Map<string, number>();
    for (let slot = 0; slot < plotData.length; slot++) {
      idToSlot.set(plotDataId(plotData, slot), slot);
    }
    this.indexedPlotData = plotData;
    this.idToSlot = idToSlot;
    return idToSlot;
  }
}
