import { html, type TemplateResult } from 'lit';
import { getBaseAccession } from '@protspace/utils';
import { icon } from '../kit/icon';

/** The base accession, URL-encoded for use as a path segment. */
function accessionSegment(proteinId: string): string {
  return encodeURIComponent(getBaseAccession(proteinId));
}

/**
 * Build the AlphaFold DB entry URL for a protein.
 */
export function buildAlphaFoldUrl(proteinId: string): string {
  return `https://alphafold.ebi.ac.uk/entry/${accessionSegment(proteinId)}`;
}

/**
 * Build the UniProtKB entry URL for a protein.
 */
export function buildUniProtUrl(proteinId: string): string {
  return `https://www.uniprot.org/uniprotkb/${accessionSegment(proteinId)}/entry`;
}

/**
 * Build the InterPro protein page URL for a protein.
 * Works for both reviewed (Swiss-Prot) and unreviewed (TrEMBL) entries.
 */
export function buildInterProUrl(proteinId: string): string {
  return `https://www.ebi.ac.uk/interpro/protein/UniProt/${accessionSegment(proteinId)}/`;
}

/**
 * Build the TED protein page URL for a protein.
 */
export function buildTedUrl(proteinId: string): string {
  return `https://ted.cathdb.info/uniprot/${accessionSegment(proteinId)}`;
}

/** One external destination in a protein's resource row. */
interface ResourceLink {
  /** The link's text. */
  label: string;
  /** Destination URL for a protein ID, versioned or not. */
  build: (proteinId: string) => string;
}

/**
 * The resource row, in render order. Adding a destination here adds it to every row
 * `renderResourceLinks` draws; the template holds no per-resource markup.
 */
export const RESOURCE_LINKS: readonly ResourceLink[] = [
  { label: 'AlphaFold', build: buildAlphaFoldUrl },
  { label: 'UniProt', build: buildUniProtUrl },
  { label: 'InterPro', build: buildInterProUrl },
  { label: 'TED', build: buildTedUrl },
];

/**
 * A protein's external resources as one row that wraps rather than clips in a narrow host: the
 * structure viewer draws it under its header, a pinned plot tooltip above its buttons. Hosts add
 * `resourceLinkStyles`. Each link opens in a new tab and says so to assistive technology.
 */
export function renderResourceLinks(proteinId: string): TemplateResult {
  return html`<ul class="resource-links" part="links" role="list" aria-label="External resources">
    ${RESOURCE_LINKS.map(
      (resource) =>
        html`<li class="resource-links-item">
          <a
            class="header-link"
            href=${resource.build(proteinId)}
            target="_blank"
            rel="noopener noreferrer"
            ><span class="header-link-label">${resource.label}</span>${icon(
              'external-link',
              14,
            )}<span class="resource-links-hint"> (opens in a new tab)</span></a
          >
        </li>`,
    )}
  </ul>`;
}
