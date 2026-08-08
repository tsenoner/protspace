import type { TedDomain } from '@protspace/utils';

export const TED_UNASSIGNED_COLOR = 0x9ca3af;
const TED_DOMAIN_PALETTE = [
  0x0072b2, 0xe69f00, 0x009e73, 0xcc79a7, 0xd55e00, 0x56b4e9, 0xf0e442, 0x6a3d9a, 0xb15928,
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
