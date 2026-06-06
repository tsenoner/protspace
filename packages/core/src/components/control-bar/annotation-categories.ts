import { annotationSource, isPredictedAnnotation } from '@protspace/utils';

/**
 * Canonical taxonomy rank order (used to sort the Taxonomy group hierarchically).
 */
export const TAXONOMY_ORDER = [
  'root',
  'domain',
  'kingdom',
  'phylum',
  'class',
  'order',
  'family',
  'genus',
  'species',
] as const;

export type CategoryName = 'Predicted' | 'UniProt' | 'InterPro' | 'Taxonomy' | 'Other';

export interface GroupedAnnotation {
  category: CategoryName;
  annotations: string[];
}

/**
 * Categorize and sort annotations into grouped categories.
 *
 * Grouping is derived from the shared annotation-metadata registry in `@protspace/utils`:
 * predicted annotations (registry flag or `predicted_` prefix) go into a dedicated "Predicted"
 * group regardless of their source; everything else falls under its source (UniProt, InterPro,
 * Taxonomy) or "Other". Shared by annotation-select and query-condition-row.
 */
export function groupAnnotations(annotations: string[]): GroupedAnnotation[] {
  const categorized: Record<CategoryName, string[]> = {
    Predicted: [],
    UniProt: [],
    InterPro: [],
    Taxonomy: [],
    Other: [],
  };

  for (const annotation of annotations) {
    if (isPredictedAnnotation(annotation)) {
      categorized.Predicted.push(annotation);
      continue;
    }
    const source = annotationSource(annotation);
    switch (source) {
      case 'UniProt':
        categorized.UniProt.push(annotation);
        break;
      case 'InterPro':
        categorized.InterPro.push(annotation);
        break;
      case 'Taxonomy':
        categorized.Taxonomy.push(annotation);
        break;
      default:
        categorized.Other.push(annotation);
        break;
    }
  }

  categorized.Predicted.sort((a, b) => a.localeCompare(b));
  categorized.UniProt.sort((a, b) => a.localeCompare(b));
  categorized.InterPro.sort((a, b) => a.localeCompare(b));
  categorized.Other.sort((a, b) => a.localeCompare(b));
  categorized.Taxonomy.sort((a, b) => {
    const aIndex = TAXONOMY_ORDER.indexOf(a as (typeof TAXONOMY_ORDER)[number]);
    const bIndex = TAXONOMY_ORDER.indexOf(b as (typeof TAXONOMY_ORDER)[number]);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  const groups: GroupedAnnotation[] = [];
  const categoryOrder: CategoryName[] = ['Predicted', 'InterPro', 'Taxonomy', 'UniProt', 'Other'];
  for (const category of categoryOrder) {
    if (categorized[category].length > 0) {
      groups.push({ category, annotations: categorized[category] });
    }
  }

  return groups;
}
