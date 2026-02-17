# Annotation Reference

ProtSpace retrieves annotations from three data sources: **UniProt**, **InterPro**, and **NCBI Taxonomy**. Select annotations with `-a` in `protspace-local` and `protspace-query`.

## Available Annotations

| Source           | Annotations                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UniProt** (15) | `annotation_score`, `cc_subcellular_location`, `ec`, `fragment`, `gene_name`, `go_bp`, `go_cc`, `go_mf`, `keyword`, `length_fixed`, `length_quantile`, `protein_existence`, `protein_families`, `reviewed`, `xref_pdb` |
| **InterPro** (9) | `cath`, `cdd`, `panther`, `pfam`, `prints`, `prosite`, `signal_peptide`, `smart`, `superfamily`                                                                                                                        |
| **Taxonomy** (9) | `root`, `domain`, `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species`                                                                                                                                  |

_Always included_: `gene_name`, `protein_name`, `uniprot_kb_id` (fetched regardless of selection).

## Group Presets

| Group      | Contents                                                           |
| ---------- | ------------------------------------------------------------------ |
| `default`  | `ec`, `keyword`, `length_quantile`, `protein_families`, `reviewed` |
| `all`      | All annotations from all sources                                   |
| `uniprot`  | All UniProt annotations                                            |
| `interpro` | All InterPro annotations                                           |
| `taxonomy` | All taxonomy annotations                                           |

Groups are mixable with individual names. If `-a` is omitted, `default` is used.

```bash
protspace-local -i data.h5                          # default group
protspace-local -i data.h5 -a all                   # everything
protspace-local -i data.h5 -a default,interpro,kingdom
protspace-local -i data.h5 -a pfam,cath,reviewed
protspace-query -q "..." -a interpro,kingdom
```

## Custom CSV Annotations

Provide your own metadata CSV via `-a`. The first column must contain protein identifiers; remaining columns become annotation categories. CSV and database annotations can be combined by specifying `-a` multiple times:

```bash
protspace-local -i data.h5 -a metadata.csv                   # CSV only
protspace-local -i data.h5 -a metadata.csv -a pfam,kingdom   # CSV + DB
protspace-local -i data.h5 -a metadata.csv -a default        # CSV + default group
```

With `--keep-tmp`, only API-fetched annotations are cached; the CSV is always re-read fresh. On column name collisions, CSV values take precedence.

## UniProt Annotations

15 annotations retrieved from the [UniProt REST API](https://rest.uniprot.org/) via `unipressed` (batch size: 100):

| Name                      | Description                          | Example                                                        |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| `annotation_score`        | Annotation quality score (1-5)       | `5`                                                            |
| `cc_subcellular_location` | Subcellular location(s)              | `Cytoplasm\|EXP;Nucleus\|IEA`                                  |
| `ec`                      | Enzyme Commission numbers + names    | `2.7.11.1 (Non-specific serine/threonine protein kinase)\|EXP` |
| `fragment`                | Whether entry is a fragment          | `yes`                                                          |
| `gene_name`               | Primary gene name                    | `TP53`                                                         |
| `go_bp`                   | GO — Biological Process              | `apoptotic process\|IDA;signal transduction\|IEA`              |
| `go_cc`                   | GO — Cellular Component              | `nucleus\|IDA;cytoplasm\|IEA`                                  |
| `go_mf`                   | GO — Molecular Function              | `DNA binding\|IDA;protein binding\|IEA`                        |
| `keyword`                 | UniProt keywords                     | `KW-0002 (3D-structure);KW-0025 (Alternative splicing)`        |
| `length_fixed`            | Sequence length in predefined bins   | `200-400`                                                      |
| `length_quantile`         | Sequence length in decile bins       | `100-199`                                                      |
| `protein_existence`       | Evidence level for protein existence | `Evidence at protein level`                                    |
| `protein_families`        | First protein family                 | `Protein kinase superfamily\|ISS`                              |
| `reviewed`                | Swiss-Prot / TrEMBL                  | `true` / `false`                                               |
| `xref_pdb`                | Has experimental 3D structure        | `True` / `False`                                               |

**Internal fields** (not user-selectable): `sequence`, `organism_id`, `length` are fetched automatically when needed by InterPro, taxonomy, or length binning. Inactive/obsolete accessions are resolved via secondary accession search; unresolvable entries get empty values.

### Transformations

| Annotation                | Transformation                                                                  |
| ------------------------- | ------------------------------------------------------------------------------- |
| `annotation_score`        | Float → integer                                                                 |
| `ec`                      | Enzyme names appended from ExPASy ENZYME database                               |
| `fragment`                | `"fragment"` normalized to `"yes"`                                              |
| `go_bp`, `go_cc`, `go_mf` | Aspect prefix stripped (`P:apoptotic process` → `apoptotic process`)            |
| `protein_families`        | First family only (before `,` or `;`)                                           |
| `xref_pdb`                | Converted to `True`/`False`                                                     |
| `length`                  | Split into `length_fixed` (predefined bins) and `length_quantile` (decile bins) |

**Fixed length bins**: `<50`, `50-100`, `100-200`, `200-400`, `400-600`, `600-800`, `800-1000`, `1000-1200`, `1200-1400`, `1400-1600`, `1600-1800`, `1800-2000`, `2000+`. **Quantile bins**: 10 equal-frequency bins from the dataset's length distribution.

### Evidence Codes

Seven fields carry inline evidence codes appended after `|`: `cc_subcellular_location`, `ec`, `go_bp`, `go_cc`, `go_mf`, `protein_families`. When multiple sources exist, the most reliable is chosen according to this priority (top = strongest):

| Code   | Meaning                             |
| ------ | ----------------------------------- |
| `EXP`  | Experimental evidence               |
| `HDA`  | High throughput direct assay        |
| `IDA`  | Inferred from direct assay          |
| `TAS`  | Traceable author statement          |
| `NAS`  | Non-traceable author statement      |
| `IC`   | Curator inference                   |
| `ISS`  | Inferred from sequence similarity   |
| `SAM`  | Sequence analysis method            |
| `COMB` | Combinatorial evidence              |
| `IMP`  | Imported                            |
| `IEA`  | Inferred from electronic annotation |

Codes are derived from [ECO (Evidence & Conclusion Ontology)](https://www.evidenceontology.org/) identifiers; GO terms use native `GoEvidenceType` short codes. Use `--no-scores` to strip evidence codes.

## InterPro Annotations

9 signature databases queried via the [InterPro Matches API](https://www.ebi.ac.uk/interpro/matches/api) using MD5 sequence hashes (chunk size: 100):

| Name             | Database         | Description                       |
| ---------------- | ---------------- | --------------------------------- |
| `pfam`           | Pfam             | Protein families                  |
| `superfamily`    | SUPERFAMILY      | Structural/functional domains     |
| `cath`           | CATH-Gene3D      | Protein structure classifications |
| `signal_peptide` | Phobius          | Signal peptide predictions        |
| `smart`          | SMART            | Domain architectures              |
| `cdd`            | CDD              | Conserved domains                 |
| `panther`        | PANTHER          | Protein families and subfamilies  |
| `prosite`        | PROSITE patterns | Protein motifs                    |
| `prints`         | PRINTS           | Protein fingerprints              |

**Output format**: `accession (name)|score;accession2 (name2)|score` — `;` separates distinct domain/signature hits.

**Scores** are bit scores from each database's analysis tool (e.g. HMMER for Pfam). Higher = stronger match; not comparable across databases. Comma-separated scores indicate multiple domain locations in the protein. Use `--no-scores` to strip scores.

Three databases (`cath`, `superfamily`, `panther`) resolve human-readable entry names via InterPro FTP XML (cached 7 days). `cath` has `G3DSA:` prefix removed; `signal_peptide` is converted to `True`/`False`.

## Taxonomy Annotations

9 taxonomic ranks resolved via `taxopy` (NCBI Taxonomy): `root`, `domain`, `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species`. `root` is the cellular/acellular classification; `domain` is the top-level biological domain (e.g. Bacteria, Archaea, Eukaryota). Requires `organism_id` from UniProt (fetched automatically).

## Caching

| Cache          | Location                       | Max Age | Purpose                                           |
| -------------- | ------------------------------ | ------- | ------------------------------------------------- |
| NCBI Taxonomy  | `~/.cache/taxopy_db/`          | 7 days  | Taxonomy lineage resolution                       |
| InterPro names | `~/.cache/protspace/interpro/` | 7 days  | Domain entry names for cath, superfamily, panther |
| EC names       | `~/.cache/protspace/enzyme/`   | 7 days  | Enzyme descriptions from ExPASy                   |

The `default` group only requires the UniProt REST API (+ ExPASy for EC names). For `--keep-tmp` annotation caching, see [CLI Reference](cli.md#annotation-caching---keep-tmp).
