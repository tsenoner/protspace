import type { ProvenanceConnectorRequest } from '@protspace/core';
import type { PredictedCell, VisualizationData } from '@protspace/utils';

interface SourceCandidate {
  targetProteinId: string;
  confidence: number;
}

type SourceIndex = ReadonlyMap<string, readonly SourceCandidate[]>;

const MAX_PROVENANCE_CONNECTORS = 20;

function compareSourceCandidates(left: SourceCandidate, right: SourceCandidate): number {
  const confidenceOrder = right.confidence - left.confidence;
  if (confidenceOrder !== 0) return confidenceOrder;
  return left.targetProteinId < right.targetProteinId
    ? -1
    : left.targetProteinId > right.targetProteinId
      ? 1
      : 0;
}

/**
 * Resolves EAT clicks without rescanning every transferred cell on repeated source interactions.
 * WeakMap ownership ensures replaced datasets and their indexes can be garbage-collected together.
 */
export class EatProvenanceResolver {
  private readonly sourceIndexes = new WeakMap<VisualizationData, Map<string, SourceIndex>>();
  private readonly proteinIndexes = new WeakMap<VisualizationData, ReadonlyMap<string, number>>();

  getSourceIndex(data: VisualizationData, annotation: string): SourceIndex {
    let byAnnotation = this.sourceIndexes.get(data);
    if (!byAnnotation) {
      byAnnotation = new Map();
      this.sourceIndexes.set(data, byAnnotation);
    }
    const cached = byAnnotation.get(annotation);
    if (cached) return cached;

    const mutable = new Map<string, SourceCandidate[]>();
    const cells = data.annotation_predicted?.[annotation] ?? [];
    for (let proteinIndex = 0; proteinIndex < cells.length; proteinIndex++) {
      const cell = cells[proteinIndex];
      const targetProteinId = data.protein_ids[proteinIndex];
      if (!cell || !targetProteinId) continue;
      const candidates = mutable.get(cell.source) ?? [];
      candidates.push({ targetProteinId, confidence: cell.confidence });
      mutable.set(cell.source, candidates);
    }
    for (const candidates of mutable.values()) candidates.sort(compareSourceCandidates);
    byAnnotation.set(annotation, mutable);
    return mutable;
  }

  resolve(
    data: VisualizationData,
    annotation: string,
    clickedProteinId: string,
    visibleProteinIds: ReadonlySet<string>,
  ): ProvenanceConnectorRequest | null {
    const proteinIndex = this.getProteinIndex(data).get(clickedProteinId);
    if (proteinIndex === undefined || !visibleProteinIds.has(clickedProteinId)) return null;

    const predictedCell: PredictedCell | null =
      data.annotation_predicted?.[annotation]?.[proteinIndex] ?? null;
    if (predictedCell) {
      if (!visibleProteinIds.has(predictedCell.source)) return null;
      return {
        pairs: [
          {
            sourceProteinId: predictedCell.source,
            targetProteinId: clickedProteinId,
            confidence: predictedCell.confidence,
          },
        ],
        totalCandidates: 1,
      };
    }

    const candidates = this.getSourceIndex(data, annotation).get(clickedProteinId) ?? [];
    const pairs = [];
    let totalCandidates = 0;
    for (const candidate of candidates) {
      if (!visibleProteinIds.has(candidate.targetProteinId)) continue;
      totalCandidates++;
      if (pairs.length < MAX_PROVENANCE_CONNECTORS) {
        pairs.push({
          sourceProteinId: clickedProteinId,
          targetProteinId: candidate.targetProteinId,
          confidence: candidate.confidence,
        });
      }
    }
    if (totalCandidates === 0) return null;

    return {
      pairs,
      totalCandidates,
    };
  }

  private getProteinIndex(data: VisualizationData): ReadonlyMap<string, number> {
    const cached = this.proteinIndexes.get(data);
    if (cached) return cached;
    const index = new Map(data.protein_ids.map((proteinId, position) => [proteinId, position]));
    this.proteinIndexes.set(data, index);
    return index;
  }
}
