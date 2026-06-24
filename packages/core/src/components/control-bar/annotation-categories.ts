import { annotationSource, compareTaxonomyRank, type AnnotationSource } from '@protspace/utils';

/** Dropdown section names — one per annotation source, plus a Statistics section for
 * computed columns (the predicted flag is shown per-row, not as a group). */
export type CategoryName =
  | 'Biocentral'
  | 'InterPro'
  | 'TED'
  | 'Taxonomy'
  | 'UniProt'
  | 'Statistics'
  | 'Other';

export interface GroupedAnnotation {
  category: CategoryName;
  annotations: string[];
}

/** Prefixes of computed per-protein statistic columns (route-projection-statistics):
 * one `cluster_<projection>` + one `silhouette_<projection>` per projection. Grouping
 * them keeps ~12 computed columns from flooding the catch-all "Other" section. */
const COMPUTED_STAT_PREFIXES = ['cluster_', 'silhouette_'];

function isComputedStatistic(annotation: string): boolean {
  return COMPUTED_STAT_PREFIXES.some((prefix) => annotation.startsWith(prefix));
}

/** Map an annotation's source to its dropdown section. */
function categoryForSource(source: AnnotationSource): CategoryName {
  switch (source) {
    case 'Biocentral':
      return 'Biocentral';
    case 'InterPro':
      return 'InterPro';
    case 'TED':
      return 'TED';
    case 'Taxonomy':
      return 'Taxonomy';
    case 'UniProt':
      return 'UniProt';
    default:
      return 'Other';
  }
}

// Display order of the dropdown sections (predicted sources first, then the rest;
// computed Statistics grouped just before the catch-all Other).
const CATEGORY_ORDER: CategoryName[] = [
  'Biocentral',
  'InterPro',
  'TED',
  'Taxonomy',
  'UniProt',
  'Statistics',
  'Other',
];

/**
 * Categorize and sort annotations into grouped sections for the dropdown.
 *
 * Grouping is by annotation source (from the shared `@protspace/utils` registry), so each source
 * keeps its own section. The "predicted" nature is orthogonal — it is surfaced as a per-row
 * ⚡ badge (see {@link isPredictedAnnotation}), not by pulling predictions into a separate group.
 * Within a section annotations are alphabetical, except Taxonomy, which is ordered by rank depth
 * (general → specific). Shared by annotation-select and query-condition-row.
 */
export function groupAnnotations(annotations: string[]): GroupedAnnotation[] {
  const categorized: Record<CategoryName, string[]> = {
    Biocentral: [],
    InterPro: [],
    TED: [],
    Taxonomy: [],
    UniProt: [],
    Statistics: [],
    Other: [],
  };

  for (const annotation of annotations) {
    const category = isComputedStatistic(annotation)
      ? 'Statistics'
      : categoryForSource(annotationSource(annotation));
    categorized[category].push(annotation);
  }

  for (const category of CATEGORY_ORDER) {
    if (category === 'Taxonomy') {
      categorized.Taxonomy.sort(compareTaxonomyRank);
    } else {
      categorized[category].sort((a, b) => a.localeCompare(b));
    }
  }

  const groups: GroupedAnnotation[] = [];
  for (const category of CATEGORY_ORDER) {
    if (categorized[category].length > 0) {
      groups.push({ category, annotations: categorized[category] });
    }
  }

  return groups;
}
