# Annotation Reference

ProtSpace retrieves annotations from three data sources: **UniProt**, **InterPro**, and **NCBI Taxonomy**. Annotations are selected with the `-a` flag in `protspace-local` and `protspace-query`. See the main [README](../README.md) for CLI usage.

## Available Annotations

**UniProt** (15): `annotation_score`, `cc_subcellular_location`, `ec`, `fragment`, `gene_name`, `go_bp`, `go_cc`, `go_mf`, `keyword`, `length_fixed`, `length_quantile`, `protein_existence`, `protein_families`, `reviewed`, `xref_pdb`

**InterPro** (9): `cath`, `cdd`, `panther`, `pfam`, `prints`, `prosite`, `signal_peptide`, `smart`, `superfamily`

**Taxonomy** (9): `root`, `domain`, `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species`

_Always included_: `gene_name`, `protein_name`, `uniprot_kb_id` (fetched regardless of selection)

## Group Presets

Use group names instead of listing individual annotations:

| Group      | Contents / Description                                             |
| ---------- | ------------------------------------------------------------------ |
| `default`  | `ec`, `keyword`, `length_quantile`, `protein_families`, `reviewed` |
| `all`      | All annotations from all sources                                   |
| `uniprot`  | All user-facing UniProt annotations                                |
| `interpro` | All InterPro annotations                                           |
| `taxonomy` | All taxonomy annotations                                           |

Groups are mixable with individual names, e.g. `-a default,interpro` or `-a uniprot,kingdom`.

If `-a` is omitted, the `default` group is used (equivalent to `-a default`).

### Examples

```bash
# No -a flag: uses the default group (curated UniProt subset, fast)
protspace-local -i data.h5

# Explicit group
protspace-local -i data.h5 -a all

# Mix groups with individual annotations
protspace-local -i data.h5 -a default,interpro,kingdom

# Cherry-pick individual annotations
protspace-local -i data.h5 -a pfam,cath,reviewed,kingdom

# Works the same with protspace-query
protspace-query -q "..." -a interpro,kingdom
```

## UniProt Annotations

15 user-facing annotations retrieved from the [UniProt REST API](https://rest.uniprot.org/) via the `unipressed` library (batch size: 100 proteins/request):

| Name                      | Description                                  | Example output                                                 |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `annotation_score`        | UniProt annotation quality score (1-5)       | `5`                                                            |
| `cc_subcellular_location` | Subcellular location(s)                      | `Cytoplasm\|EXP;Nucleus\|IEA`                                  |
| `ec`                      | Enzyme Commission numbers with names         | `2.7.11.1 (Non-specific serine/threonine protein kinase)\|EXP` |
| `fragment`                | Whether the entry is a fragment              | `yes` or original value                                        |
| `gene_name`               | Primary gene name                            | `TP53`                                                         |
| `go_bp`                   | Gene Ontology — Biological Process           | `apoptotic process\|IDA;signal transduction\|IEA`              |
| `go_cc`                   | Gene Ontology — Cellular Component           | `nucleus\|IDA;cytoplasm\|IEA`                                  |
| `go_mf`                   | Gene Ontology — Molecular Function           | `DNA binding\|IDA;protein binding\|IEA`                        |
| `keyword`                 | UniProt keywords                             | `KW-0002 (3D-structure);KW-0025 (Alternative splicing)`        |
| `length_fixed`            | Sequence length in predefined bins           | `200-400`                                                      |
| `length_quantile`         | Sequence length in decile bins               | `100-199`                                                      |
| `protein_existence`       | Evidence level for protein existence         | `Evidence at protein level`                                    |
| `protein_families`        | First protein family                         | `Protein kinase superfamily\|ISS`                              |
| `reviewed`                | Swiss-Prot (reviewed) or TrEMBL (unreviewed) | `true` / `false`                                               |
| `xref_pdb`                | Has experimental 3D structure                | `True` / `False`                                               |

**Always-included fields**: `gene_name`, `protein_name`, and `uniprot_kb_id` are always fetched regardless of which annotations are selected.

**Internal fields** (not user-selectable): `sequence`, `organism_id`, and `length` are fetched automatically when needed by InterPro, taxonomy, or length binning.

**Inactive/obsolete entries**: If a UniProt accession is no longer active, ProtSpace attempts to resolve it via secondary accession search. If resolution fails, the entry receives empty annotation values.

### Transformations Applied

| Annotation                | Transformation                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `annotation_score`        | Float converted to integer (`5.0` → `5`)                                                                                   |
| `ec`                      | Enzyme names appended from ExPASy ENZYME database (`2.7.11.1` → `2.7.11.1 (Non-specific serine/threonine protein kinase)`) |
| `fragment`                | `"fragment"` normalized to `"yes"`                                                                                         |
| `go_bp`, `go_cc`, `go_mf` | Aspect prefix stripped (`P:apoptotic process` → `apoptotic process`)                                                       |
| `keyword`                 | Kept as `KW-ID (Name)` format                                                                                              |
| `protein_families`        | First family only (before `,` or `;`)                                                                                      |
| `xref_pdb`                | Converted to `True`/`False`                                                                                                |
| `length`                  | Split into `length_fixed` (predefined bins) + `length_quantile` (decile bins)                                              |

**Fixed length bins**: `<50`, `50-100`, `100-200`, `200-400`, `400-600`, `600-800`, `800-1000`, `1000-1200`, `1200-1400`, `1400-1600`, `1600-1800`, `1800-2000`, `2000+`

**Quantile bins**: 10 equal-frequency bins computed from the dataset's length distribution.

### Evidence Codes

Four UniProt annotations (plus the three GO fields) carry inline evidence codes indicating the basis for each value. Evidence is appended after a `|` separator: `value|CODE`. Values without evidence have no `|` suffix.

**Fields with evidence**: `cc_subcellular_location`, `ec`, `go_bp` / `go_cc` / `go_mf`, `protein_families`

When multiple evidence sources exist for a single value, the most reliable code is chosen according to this priority order:

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

Codes are derived from [ECO (Evidence & Conclusion Ontology)](https://www.evidenceontology.org/) identifiers returned by the UniProt API. GO terms use native short codes from the `GoEvidenceType` field; other annotations map ECO IDs (e.g., `ECO:0000269` → `EXP`).

Use `--no-scores` to omit evidence codes from output.

## InterPro Annotations

9 signature databases queried via the [InterPro Matches API](https://www.ebi.ac.uk/interpro/matches/api) using MD5 hashes of protein sequences (chunk size: 100):

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

**Output format**: `accession (name)|score1,score2;accession2 (name2)|score1`

Use `--no-scores` to omit bit scores from output.

- **Scores**: Bit scores reported by each member database's analysis tool (e.g. HMMER for Pfam). Higher = stronger match. Scoring systems differ across databases, so values are not directly comparable between e.g. Pfam and SUPERFAMILY.
- **Multiple scores**: Comma-separated values indicate the domain was found at multiple locations in the protein, one score per occurrence.
- `;` separates different domain/signature hits
- Example: `PF00041 (fn3)|162.3;PF00102 (Y_phosphatase)|438.3` — two Pfam domains found once each

**Name resolution**: Three databases (`cath`, `superfamily`, `panther`) resolve human-readable entry names via an InterPro FTP XML download, cached locally for 7 days.

### Transformations Applied

| Annotation       | Transformation                                 |
| ---------------- | ---------------------------------------------- |
| `cath`           | `G3DSA:` prefix removed, sorted alphabetically |
| `signal_peptide` | Converted to `True`/`False`                    |

## Taxonomy Annotations

9 taxonomic ranks resolved via the `taxopy` library using NCBI Taxonomy:

| Name      | Rank                    |
| --------- | ----------------------- |
| `root`    | Cellular/acellular root |
| `domain`  | Domain (or realm)       |
| `kingdom` | Kingdom                 |
| `phylum`  | Phylum                  |
| `class`   | Class                   |
| `order`   | Order                   |
| `family`  | Family                  |
| `genus`   | Genus                   |
| `species` | Species                 |

Taxonomy resolution requires `organism_id` from UniProt, which is fetched automatically when any taxonomy annotation is requested.

## Caching

| Cache          | Location                       | Max Age | Purpose                                           |
| -------------- | ------------------------------ | ------- | ------------------------------------------------- |
| NCBI Taxonomy  | `~/.cache/taxopy_db/`          | 7 days  | Taxonomy lineage resolution                       |
| InterPro names | `~/.cache/protspace/interpro/` | 7 days  | Domain entry names for cath, superfamily, panther |
| EC names       | `~/.cache/protspace/enzyme/`   | 7 days  | Enzyme descriptions from ExPASy                   |

The `default` group requires only the UniProt REST API (plus the ExPASy ENZYME database for EC name resolution). No InterPro or NCBI Taxonomy network calls are needed. `gene_name`, `protein_name`, and `uniprot_kb_id` are always included regardless of group.

For `--keep-tmp` annotation caching behavior, see [CLI Reference](cli.md#annotation-caching---keep-tmp).
