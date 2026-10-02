import { schemeTableau10 } from 'd3';
import type { TedDomain } from '@protspace/utils';

// Matches the TED website (ted.cathdb.info): Tableau 10 cycled by domain, and its light gray
// for residues outside every domain. TED colors domains in its own API's list order, which is
// usually but not always TED01, TED02, …; we key by domain number, so rare out-of-order
// entries can differ from the TED page.
export const TED_UNASSIGNED_COLOR = 0xebebeb;
const TED_DOMAIN_PALETTE = schemeTableau10.map((hex) => parseInt(hex.slice(1), 16));

export function getTedDomainColor(residueSequenceNumber: number, domains: TedDomain[]): number {
  const domain = domains.find((candidate) =>
    candidate.segments.some(
      ({ start, end }) => residueSequenceNumber >= start && residueSequenceNumber <= end,
    ),
  );

  if (!domain) return TED_UNASSIGNED_COLOR;
  return TED_DOMAIN_PALETTE[(domain.domainNumber - 1) % TED_DOMAIN_PALETTE.length];
}
