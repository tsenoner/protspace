/**
 * Extract the base accession from a protein ID.
 * Strips any version suffix after the first dot (e.g., "P0DQE9.2" → "P0DQE9").
 */
export function getBaseAccession(proteinId: string): string {
  return proteinId.split('.')[0];
}

/**
 * Build the AlphaFold DB entry URL for a protein.
 */
export function buildAlphaFoldUrl(proteinId: string): string {
  return `https://alphafold.ebi.ac.uk/entry/${encodeURIComponent(getBaseAccession(proteinId))}`;
}

/**
 * Build the UniProtKB entry URL for a protein.
 */
export function buildUniProtUrl(proteinId: string): string {
  return `https://www.uniprot.org/uniprotkb/${encodeURIComponent(getBaseAccession(proteinId))}/entry`;
}

/**
 * Build the InterPro protein page URL for a protein.
 * Works for both reviewed (Swiss-Prot) and unreviewed (TrEMBL) entries.
 */
export function buildInterProUrl(proteinId: string): string {
  return `https://www.ebi.ac.uk/interpro/protein/UniProt/${encodeURIComponent(getBaseAccession(proteinId))}/`;
}

/**
 * Build the TED protein page URL for a protein.
 */
export function buildTedUrl(proteinId: string): string {
  return `https://ted.cathdb.info/uniprot/${encodeURIComponent(getBaseAccession(proteinId))}`;
}

/** One external destination in the structure viewer's resource row. */
interface ResourceLink {
  /** Row label, and the text the tooltip is built from. */
  label: string;
  /** Destination URL for a protein ID, versioned or not. */
  build: (proteinId: string) => string;
}

/**
 * The resource row, in render order. Adding a destination here adds it to the
 * header; the template holds no per-resource markup.
 */
export const RESOURCE_LINKS: readonly ResourceLink[] = [
  { label: 'AlphaFold', build: buildAlphaFoldUrl },
  { label: 'UniProt', build: buildUniProtUrl },
  { label: 'InterPro', build: buildInterProUrl },
  { label: 'TED', build: buildTedUrl },
];
