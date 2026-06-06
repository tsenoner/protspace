/**
 * Canonical annotation-metadata registry — the single source of truth the frontend uses to
 * describe each known annotation column (friendly label, source, predicted flag, description,
 * docs link). It drives the annotation dropdown grouping, the legend "Predicted" badge, and the
 * documentation popover, and it is the input for the generated `docs/guide/annotations.md` page.
 *
 * CONTRACT with the backend: column names and the set of predicted annotations mirror the
 * `protspace` Python package's `docs/annotations.md`. Predicted (ML) annotations use the
 * `predicted_` prefix; any column whose name starts with `predicted_` is treated as a prediction
 * even if it is not listed here. Keep this registry in sync with the backend reference when the
 * annotation set changes.
 */

export type AnnotationSource = 'UniProt' | 'InterPro' | 'Taxonomy' | 'TED' | 'Biocentral' | 'Other';

export interface AnnotationMeta {
  /** Friendly display label, e.g. "EC number". */
  label: string;
  /** Origin of the annotation; drives dropdown grouping. */
  source: AnnotationSource;
  /** Whether the values are produced by an ML model rather than curation/experiment. */
  isPredicted: boolean;
  /** Short human-readable description for the documentation popover. */
  description: string;
  /** Optional link to the fuller documentation entry (site-relative). */
  docsUrl?: string;
}

/** Prefix marking ML-predicted annotation columns (backend convention). */
export const PREDICTED_PREFIX = 'predicted_';

const docs = (anchor: string): string => `/guide/annotations#${anchor}`;

/**
 * Registry keyed by exact annotation column name. Seeded from the backend
 * `protspace/docs/annotations.md` reference.
 */
export const ANNOTATION_METADATA: Record<string, AnnotationMeta> = {
  // --- UniProt (experimental / curated) ---
  annotation_score: {
    label: 'Annotation score',
    source: 'UniProt',
    isPredicted: false,
    description: 'UniProt annotation quality score from 1 (low) to 5 (high).',
    docsUrl: docs('annotation_score'),
  },
  cc_subcellular_location: {
    label: 'Subcellular location',
    source: 'UniProt',
    isPredicted: false,
    description: 'Subcellular location(s) of the protein, with evidence codes.',
    docsUrl: docs('cc_subcellular_location'),
  },
  ec: {
    label: 'EC number',
    source: 'UniProt',
    isPredicted: false,
    description: 'Enzyme Commission number(s) and enzyme name describing catalytic activity.',
    docsUrl: docs('ec'),
  },
  fragment: {
    label: 'Fragment',
    source: 'UniProt',
    isPredicted: false,
    description: 'Whether the sequence entry is a fragment rather than the complete protein.',
    docsUrl: docs('fragment'),
  },
  gene_name: {
    label: 'Gene name',
    source: 'UniProt',
    isPredicted: false,
    description: 'Primary gene name for the protein.',
    docsUrl: docs('gene_name'),
  },
  go_bp: {
    label: 'GO — Biological Process',
    source: 'UniProt',
    isPredicted: false,
    description: 'Gene Ontology Biological Process terms, with evidence codes.',
    docsUrl: docs('go_bp'),
  },
  go_cc: {
    label: 'GO — Cellular Component',
    source: 'UniProt',
    isPredicted: false,
    description: 'Gene Ontology Cellular Component terms, with evidence codes.',
    docsUrl: docs('go_cc'),
  },
  go_mf: {
    label: 'GO — Molecular Function',
    source: 'UniProt',
    isPredicted: false,
    description: 'Gene Ontology Molecular Function terms, with evidence codes.',
    docsUrl: docs('go_mf'),
  },
  keyword: {
    label: 'Keywords',
    source: 'UniProt',
    isPredicted: false,
    description: 'Controlled-vocabulary UniProt keywords summarising protein attributes.',
    docsUrl: docs('keyword'),
  },
  length: {
    label: 'Sequence length',
    source: 'UniProt',
    isPredicted: false,
    description: 'Length of the protein sequence in amino acids.',
    docsUrl: docs('length'),
  },
  protein_existence: {
    label: 'Protein existence',
    source: 'UniProt',
    isPredicted: false,
    description: 'Evidence level for the existence of the protein.',
    docsUrl: docs('protein_existence'),
  },
  protein_families: {
    label: 'Protein family',
    source: 'UniProt',
    isPredicted: false,
    description: 'Protein family membership (first family), with evidence code.',
    docsUrl: docs('protein_families'),
  },
  reviewed: {
    label: 'Reviewed (Swiss-Prot)',
    source: 'UniProt',
    isPredicted: false,
    description: 'Whether the entry is reviewed (Swiss-Prot) or unreviewed (TrEMBL).',
    docsUrl: docs('reviewed'),
  },
  xref_pdb: {
    label: 'Has PDB structure',
    source: 'UniProt',
    isPredicted: false,
    description: 'Whether an experimental 3D structure exists in the PDB for this protein.',
    docsUrl: docs('xref_pdb'),
  },

  // --- InterPro (experimental / signature databases) ---
  pfam: {
    label: 'Pfam',
    source: 'InterPro',
    isPredicted: false,
    description: 'Protein family classification from Pfam, with bit scores.',
    docsUrl: docs('pfam'),
  },
  pfam_clan: {
    label: 'Pfam clan',
    source: 'InterPro',
    isPredicted: false,
    description: 'Higher-level Pfam clan grouping derived from Pfam family membership.',
    docsUrl: docs('pfam_clan'),
  },
  superfamily: {
    label: 'SUPERFAMILY',
    source: 'InterPro',
    isPredicted: false,
    description: 'Structural and functional domain assignments from SUPERFAMILY.',
    docsUrl: docs('superfamily'),
  },
  cath: {
    label: 'CATH-Gene3D',
    source: 'InterPro',
    isPredicted: false,
    description: 'Protein structure classification from CATH-Gene3D.',
    docsUrl: docs('cath'),
  },
  signal_peptide: {
    label: 'Signal peptide (Phobius)',
    source: 'InterPro',
    isPredicted: false,
    description: 'Signal peptide prediction from Phobius.',
    docsUrl: docs('signal_peptide'),
  },
  smart: {
    label: 'SMART',
    source: 'InterPro',
    isPredicted: false,
    description: 'Domain architecture assignments from SMART.',
    docsUrl: docs('smart'),
  },
  cdd: {
    label: 'CDD',
    source: 'InterPro',
    isPredicted: false,
    description: 'Conserved domain assignments from CDD.',
    docsUrl: docs('cdd'),
  },
  panther: {
    label: 'PANTHER',
    source: 'InterPro',
    isPredicted: false,
    description: 'Protein family and subfamily classification from PANTHER.',
    docsUrl: docs('panther'),
  },
  prosite: {
    label: 'PROSITE',
    source: 'InterPro',
    isPredicted: false,
    description: 'Protein motif matches from PROSITE patterns.',
    docsUrl: docs('prosite'),
  },
  prints: {
    label: 'PRINTS',
    source: 'InterPro',
    isPredicted: false,
    description: 'Protein fingerprint matches from PRINTS.',
    docsUrl: docs('prints'),
  },

  // --- Taxonomy (experimental) ---
  root: {
    label: 'Root',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Cellular / acellular classification at the root of the taxonomy.',
    docsUrl: docs('taxonomy'),
  },
  domain: {
    label: 'Domain',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Top-level biological domain (e.g. Bacteria, Archaea, Eukaryota).',
    docsUrl: docs('taxonomy'),
  },
  kingdom: {
    label: 'Kingdom',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Taxonomic kingdom of the source organism.',
    docsUrl: docs('taxonomy'),
  },
  phylum: {
    label: 'Phylum',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Taxonomic phylum of the source organism.',
    docsUrl: docs('taxonomy'),
  },
  class: {
    label: 'Class',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Taxonomic class of the source organism.',
    docsUrl: docs('taxonomy'),
  },
  order: {
    label: 'Order',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Taxonomic order of the source organism.',
    docsUrl: docs('taxonomy'),
  },
  family: {
    label: 'Family',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Taxonomic family of the source organism.',
    docsUrl: docs('taxonomy'),
  },
  genus: {
    label: 'Genus',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Taxonomic genus of the source organism.',
    docsUrl: docs('taxonomy'),
  },
  species: {
    label: 'Species',
    source: 'Taxonomy',
    isPredicted: false,
    description: 'Taxonomic species of the source organism.',
    docsUrl: docs('taxonomy'),
  },

  // --- TED (experimental / structure-based) ---
  ted_domains: {
    label: 'TED domains',
    source: 'TED',
    isPredicted: false,
    description:
      'Structure-based domains with CATH classification and pLDDT confidence, from TED (AlphaFold).',
    docsUrl: docs('ted_domains'),
  },

  // --- Biocentral (ML predictions) ---
  predicted_subcellular_location: {
    label: 'Subcellular location',
    source: 'Biocentral',
    isPredicted: true,
    description: '10-class subcellular localization predicted by the LightAttention model.',
    docsUrl: docs('predicted_subcellular_location'),
  },
  predicted_membrane: {
    label: 'Membrane',
    source: 'Biocentral',
    isPredicted: true,
    description: 'Membrane vs. soluble prediction from the LightAttention model.',
    docsUrl: docs('predicted_membrane'),
  },
  predicted_signal_peptide: {
    label: 'Signal peptide',
    source: 'Biocentral',
    isPredicted: true,
    description: 'Signal-peptide presence predicted by the TMbed model (from topology).',
    docsUrl: docs('predicted_signal_peptide'),
  },
  predicted_transmembrane: {
    label: 'Transmembrane',
    source: 'Biocentral',
    isPredicted: true,
    description: 'Transmembrane type (none / alpha-helical / beta-barrel) predicted by TMbed.',
    docsUrl: docs('predicted_transmembrane'),
  },
};

/**
 * Convert a raw annotation column name into a readable label, e.g. `my_score` → `My score`.
 * Used as the fallback label for columns not present in the registry.
 */
export function prettifyAnnotationName(column: string): string {
  const cleaned = column.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return column;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Resolve metadata for any annotation column. Returns the registry entry when known, otherwise a
 * synthesized entry: a prettified label, `Other` source, empty description (so no docs popover is
 * shown), and a predicted flag derived from the `predicted_` prefix convention.
 */
export function getAnnotationMeta(column: string): AnnotationMeta {
  const known = ANNOTATION_METADATA[column];
  if (known) return known;
  return {
    label: prettifyAnnotationName(column),
    source: 'Other',
    isPredicted: column.startsWith(PREDICTED_PREFIX),
    description: '',
  };
}

/**
 * Whether an annotation is a prediction: the registry flag when known, otherwise the
 * `predicted_` prefix fallback.
 */
export function isPredictedAnnotation(column: string): boolean {
  const known = ANNOTATION_METADATA[column];
  if (known) return known.isPredicted;
  return column.startsWith(PREDICTED_PREFIX);
}

/** Friendly display label for an annotation (registry label, else prettified column name). */
export function annotationLabel(column: string): string {
  return ANNOTATION_METADATA[column]?.label ?? prettifyAnnotationName(column);
}

/** Source/group for an annotation (registry source, else `Other`). */
export function annotationSource(column: string): AnnotationSource {
  return ANNOTATION_METADATA[column]?.source ?? 'Other';
}
