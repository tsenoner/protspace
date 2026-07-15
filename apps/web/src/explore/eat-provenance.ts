import type { ProvenanceConnectorRequest } from '@protspace/core';
import type { PredictedCell, VisualizationData } from '@protspace/utils';

interface SourceCandidate {
  targetProteinId: string;
  targetProteinIndex: number;
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
  private readonly sourceProteinIndexes = new WeakMap<
    VisualizationData,
    Map<string, ReadonlyMap<string, number>>
  >();

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
      candidates.push({
        targetProteinId,
        targetProteinIndex: proteinIndex,
        confidence: cell.confidence,
      });
      mutable.set(cell.source, candidates);
    }
    for (const candidates of mutable.values()) candidates.sort(compareSourceCandidates);
    byAnnotation.set(annotation, mutable);
    return mutable;
  }

  private getSourceProteinIndex(
    data: VisualizationData,
    annotation: string,
    sourceProteinId: string,
  ): number | undefined {
    let byAnnotation = this.sourceProteinIndexes.get(data);
    if (!byAnnotation) {
      byAnnotation = new Map();
      this.sourceProteinIndexes.set(data, byAnnotation);
    }
    let sourcePositions = byAnnotation.get(annotation);
    if (!sourcePositions) {
      const sourceIds = new Set(
        (data.annotation_predicted?.[annotation] ?? []).flatMap((cell) =>
          cell ? [cell.source] : [],
        ),
      );
      const positions = new Map<string, number>();
      data.protein_ids.forEach((proteinId, index) => {
        if (sourceIds.has(proteinId)) positions.set(proteinId, index);
      });
      sourcePositions = positions;
      byAnnotation.set(annotation, sourcePositions);
    }
    return sourcePositions.get(sourceProteinId);
  }

  resolve(
    data: VisualizationData,
    annotation: string,
    clickedProteinId: string,
    clickedProteinIndex: number,
    isLegendEligible: (proteinId: string, proteinIndex: number) => boolean,
    isInCurrentView: (proteinIndex: number) => boolean,
  ): ProvenanceConnectorRequest | null {
    if (!isLegendEligible(clickedProteinId, clickedProteinIndex)) return null;

    const predictedCell: PredictedCell | null =
      data.annotation_predicted?.[annotation]?.[clickedProteinIndex] ?? null;
    if (predictedCell) {
      const sourceProteinIndex =
        predictedCell.sourceIndex ??
        this.getSourceProteinIndex(data, annotation, predictedCell.source) ??
        -1;
      if (sourceProteinIndex >= 0 && !isLegendEligible(predictedCell.source, sourceProteinIndex)) {
        return null;
      }
      const sourceInCurrentView = sourceProteinIndex >= 0 && isInCurrentView(sourceProteinIndex);
      return {
        pairs: [
          {
            sourceProteinId: predictedCell.source,
            targetProteinId: clickedProteinId,
            confidence: predictedCell.confidence,
          },
        ],
        totalCandidates: 1,
        unavailableCandidates: sourceInCurrentView ? 0 : 1,
      };
    }

    const candidates = this.getSourceIndex(data, annotation).get(clickedProteinId) ?? [];
    const pairs = [];
    let totalCandidates = 0;
    let unavailableCandidates = 0;
    for (const candidate of candidates) {
      if (!isLegendEligible(candidate.targetProteinId, candidate.targetProteinIndex)) continue;
      totalCandidates++;
      if (!isInCurrentView(candidate.targetProteinIndex)) {
        unavailableCandidates++;
        continue;
      }
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
      unavailableCandidates,
    };
  }
}
