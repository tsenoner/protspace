import type { TedDomain } from '@protspace/utils';

// Matches the TED website (ted.cathdb.info): Tableau 10 cycled by domain, and its light gray
// for residues outside every domain. TED colors domains in its own API's list order, which is
// usually but not always TED01, TED02, …; we key by domain number, so rare out-of-order
// entries can differ from the TED page.
export const TED_UNASSIGNED_COLOR = 0xebebeb;
const TED_DOMAIN_PALETTE = [
  0x4e79a7, 0xf28e2c, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc949, 0xaf7aa1, 0xff9da7, 0x9c755f,
  0xbab0ab,
];

export function getTedDomainColor(residueSequenceNumber: number, domains: TedDomain[]): number {
  const domain = domains.find((candidate) =>
    candidate.segments.some(
      ({ start, end }) => residueSequenceNumber >= start && residueSequenceNumber <= end,
    ),
  );

  if (!domain) return TED_UNASSIGNED_COLOR;
  return TED_DOMAIN_PALETTE[(domain.domainNumber - 1) % TED_DOMAIN_PALETTE.length];
}
