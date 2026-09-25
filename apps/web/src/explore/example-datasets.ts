/**
 * The static catalog of example datasets: the startup demo plus the bundles
 * that ship under `apps/web/public/data/` (see `datasets.json`, which the
 * perf harness reads independently — the two lists are allowed to differ).
 *
 * Order matters: the demo is first, then the rest ascend by protein count, to
 * match the Import menu's "Examples" section (see `openspec/changes/example-datasets/design.md`).
 * Labels and descriptions are verbatim from that design doc's catalog table.
 */
export interface ExampleDataset {
  id: string;
  label: string;
  description: string;
  url: string;
}

export const EXAMPLE_DATASETS: readonly ExampleDataset[] = [
  {
    id: 'demo',
    label: 'Demo · 7.8K · 0.9 MB',
    description:
      'Mixed UniProt sample with ESM2 and ProtT5 projections, taxonomy, Pfam/CATH and EC.',
    url: './data.parquetbundle',
  },
  {
    id: 'venom_eat_stats',
    label: 'Venom EAT · 811 · 0.2 MB',
    description:
      'Venom proteins with EAT-transferred EC and protein-family predictions, GO terms and cluster labels.',
    url: './data/venom_eat_stats.parquetbundle',
  },
  {
    id: 'phosphatase',
    label: 'Phosphatases · 1.6K · 0.4 MB',
    description:
      'Phosphatases with rich domain annotations (Pfam, SMART, CDD, PANTHER, TED) and predicted localisation.',
    url: './data/phosphatase.parquetbundle',
  },
  {
    id: '5K',
    label: 'Swiss-Prot 5K · 5.2K · 0.2 MB',
    description: 'Small Swiss-Prot subset with a 3D PCA projection and length bins.',
    url: './data/5K.parquetbundle',
  },
  {
    id: '7K_toxprot',
    label: 'ToxProt · 7.4K · 0.6 MB',
    description: 'Animal toxins from UniProt ToxProt with taxonomy, domains and signal peptides.',
    url: './data/7K_toxprot.parquetbundle',
  },
  {
    id: '35K_ec_brenda',
    label: 'EC (BRENDA) · 35K · 4.5 MB',
    description: 'Enzymes with BRENDA EC numbers.',
    url: './data/35K_ec_brenda.parquetbundle',
  },
  {
    id: 'beta_lactamase_ec',
    label: 'β-lactamases (EC) · 36K · 2.1 MB',
    description: 'β-lactamases selected by EC number.',
    url: './data/beta_lactamase_ec.parquetbundle',
  },
  {
    id: '40K',
    label: 'Swiss-Prot 40K · 40K · 1.8 MB',
    description: 'Swiss-Prot subset with a 3D PCA projection.',
    url: './data/40K.parquetbundle',
  },
  {
    id: '105K_homoSapiens_drosophilaMelanogaster',
    label: 'Human + fly · 106K · 10.1 MB',
    description: 'Human and Drosophila melanogaster proteomes.',
    url: './data/105K_homoSapiens_drosophilaMelanogaster.parquetbundle',
  },
  {
    id: '127K_beta_lactamase',
    label: 'β-lactamases · 127K · 8.7 MB',
    description: 'β-lactamase family, broad selection.',
    url: './data/127K_beta_lactamase.parquetbundle',
  },
  {
    id: 'beta_lactamase_pn',
    label: 'β-lactamases (PN) · 248K · 12.2 MB',
    description: 'Large β-lactamase set for stress-testing at 248K points.',
    url: './data/beta_lactamase_pn.parquetbundle',
  },
];

export function findExampleDataset(id: string): ExampleDataset | undefined {
  return EXAMPLE_DATASETS.find((entry) => entry.id === id);
}
