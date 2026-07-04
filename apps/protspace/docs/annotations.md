# Annotation Reference

ProtSpace retrieves annotations from five data sources: **UniProt**, **InterPro**, **Taxonomy**, **TED Domains**, and **Biocentral Predictions**. Select annotations with `-a` in `protspace prepare`.

## Available Annotations

| Source               | Annotations                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UniProt** (14)     | `annotation_score`, `cc_subcellular_location`, `ec`, `fragment`, `gene_name`, `go_bp`, `go_cc`, `go_mf`, `keyword`, `length`, `protein_existence`, `protein_families`, `reviewed`, `xref_pdb` |
| **InterPro** (10)    | `cath`, `cdd`, `panther`, `pfam`, `pfam_clan`, `prints`, `prosite`, `signal_peptide`, `smart`, `superfamily`                                                                                           |
| **Taxonomy** (9)     | `root`, `domain`, `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species`                                                                                                                  |
| **TED** (1)          | `ted_domains`                                                                                                                                                                                          |
| **Biocentral** (4)   | `predicted_subcellular_location`, `predicted_membrane`, `predicted_signal_peptide`, `predicted_transmembrane`                                                                                           |

_Always included_: `gene_name`, `protein_name`, `uniprot_kb_id` (fetched regardless of selection).

### Input Requirements

Annotation sources have different requirements for protein identifiers:

| Requirement | Sources | Works with `-f` FASTA? |
| ----------- | ------- | ---------------------- |
| **UniProt accession** | UniProt, Taxonomy, TED | No — accession needed |
| **Protein sequence** | InterPro, Biocentral, Pfam CLANS | Yes — provide `-f` |

If your H5 keys are not valid UniProt accessions (e.g., `NCBI|...`, custom IDs), accession-dependent annotations will be empty. Sequence-dependent annotations can still work if you provide the original FASTA file with `-f`.

## Group Presets

| Group        | Contents                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| `default`    | `ec`, `keyword`, `length`, `protein_families`, `reviewed`                   |
| `all`        | All annotations from all sources                                            |
| `uniprot`    | All UniProt annotations                                                     |
| `interpro`   | All InterPro annotations (incl. `pfam_clan`)                                |
| `taxonomy`   | All taxonomy annotations                                                    |
| `ted`        | All TED domain annotations                                                  |
| `biocentral` | All Biocentral prediction annotations                                       |

Groups are mixable with individual names. If `-a` is omitted, `default` is used.

```bash
protspace prepare -i data.h5:prot_t5                          # default group
protspace prepare -i data.h5:prot_t5 -a all                   # everything
protspace prepare -i data.h5:prot_t5 -a default,interpro,kingdom
protspace prepare -i data.h5:prot_t5 -a ted,biocentral        # all predictions
protspace prepare -i data.h5:prot_t5 -a pfam,cath,reviewed
protspace prepare -q "..." -e prot_t5 -a interpro,kingdom
```

## Custom CSV Annotations

Provide your own metadata CSV via `-a`. The first column must contain protein identifiers; remaining columns become annotation categories. CSV and database annotations can be combined by specifying `-a` multiple times:

```bash
protspace prepare -i data.h5:prot_t5 -a metadata.csv                   # CSV only
protspace prepare -i data.h5:prot_t5 -a metadata.csv -a pfam,kingdom   # CSV + DB
protspace prepare -i data.h5:prot_t5 -a metadata.csv -a default        # CSV + default group
```

With `--keep-tmp`, only API-fetched annotations are cached; the CSV is always re-read fresh. On column name collisions, CSV values take precedence.

## UniProt Annotations

14 annotations retrieved from the [UniProt REST API](https://rest.uniprot.org/) (batch size: 100):

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
| `length`                  | Sequence length (amino acids)        | `393`                                                          |
| `protein_existence`       | Evidence level for protein existence | `Evidence at protein level`                                    |
| `protein_families`        | First protein family                 | `Protein kinase superfamily\|ISS`                              |
| `reviewed`                | Swiss-Prot / TrEMBL                  | `true` / `false`                                               |
| `xref_pdb`                | Has experimental 3D structure        | `True` / `False`                                               |

**Internal fields** (not user-selectable): `sequence`, `organism_id` are fetched automatically when needed by InterPro and taxonomy lookups. Inactive/obsolete accessions are resolved via secondary accession search; unresolvable entries get empty values.

### Transformations

| Annotation                | Transformation                                                       |
| ------------------------- | -------------------------------------------------------------------- |
| `annotation_score`        | Float → integer                                                      |
| `ec`                      | Enzyme names appended from ExPASy ENZYME database                    |
| `fragment`                | `"fragment"` normalized to `"yes"`                                   |
| `go_bp`, `go_cc`, `go_mf` | Aspect prefix stripped (`P:apoptotic process` → `apoptotic process`) |
| `protein_families`        | First family only (before `,` or `;`)                                |
| `xref_pdb`                | Converted to `True`/`False`                                          |

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

### Derived Annotation

| Name        | Source | Description                                               |
| ----------- | ------ | --------------------------------------------------------- |
| `pfam_clan` | Pfam   | Maps Pfam families to CLANS (higher-level groupings)      |

**Output format**: `CL0023 (P-loop_NTPase);CL0192 (HAD)` — semicolon-separated unique clan IDs with names. Requires `pfam` (fetched automatically). Clan mapping from [Pfam FTP](https://ftp.ebi.ac.uk/pub/databases/Pfam/current_release/Pfam-A.clans.tsv.gz) (cached 30 days).

## TED Domain Annotations

Structure-based domain annotations from [TED (The Encyclopedia of Domains)](https://ted.cathdb.info/) via the [AlphaFold Database API](https://alphafold.ebi.ac.uk/):

| Name          | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `ted_domains` | Structural domains with CATH classification and confidence |

**Output format**: `2.60.40.720 (Immunoglobulin-like)|95.1;3.40.50.300|88.3` — semicolon-separated domains. Each domain has a CATH superfamily code, name (when available, resolved from InterPro CATH-Gene3D cache), and pLDDT confidence score. Unclassified domains show as `unclassified|{plddt}`.

**Data source**: Per-protein lookup via `alphafold.ebi.ac.uk/api/domains/{accession}`. Domains are predicted from AlphaFold structures using a consensus of Chainsaw, Merizo, and UniDoc methods.

## Taxonomy Annotations

9 taxonomic ranks resolved via the [UniProt Taxonomy API](https://rest.uniprot.org/taxonomy/search): `root`, `domain`, `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species`. `root` is the cellular/acellular classification; `domain` is the top-level biological domain (e.g. Bacteria, Archaea, Eukaryota). Requires `organism_id` from UniProt (fetched automatically).

## Biocentral Prediction Annotations

Per-protein predictions from the [Biocentral API](https://biocentral.rostlab.org/) using pre-trained models. Requires protein sequences (fetched automatically from UniProt).

| Name                             | Model                                | Description                                |
| -------------------------------- | ------------------------------------ | ------------------------------------------ |
| `predicted_subcellular_location` | LightAttention                       | 10-class subcellular localization          |
| `predicted_membrane`             | LightAttention                       | Membrane / Soluble                         |
| `predicted_signal_peptide`       | TMbed                                | True / False (derived from topology)       |
| `predicted_transmembrane`        | TMbed                                | none / alpha-helical / beta-barrel         |

**Data source**: Batch predictions via Biocentral API (`api.predict()`). TMbed provides per-residue topology labels (`H`=TM helix, `B`=TM beta strand, `S`=signal peptide); signal peptide and transmembrane type are summarized from these labels.

## Caching

| Cache          | Location                          | Max Age  | Purpose                                           |
| -------------- | --------------------------------- | -------- | ------------------------------------------------- |
| CATH names     | `~/.cache/protspace/cath/`        | 30 days  | CATH hierarchy names (all levels) for TED and cath |
| InterPro names | `~/.cache/protspace/interpro/`    | 7 days   | Domain entry names for superfamily, panther        |
| EC names       | `~/.cache/protspace/enzyme/`      | 7 days   | Enzyme descriptions from ExPASy                   |
| Pfam clans     | `~/.cache/protspace/pfam_clans/`  | 30 days  | Pfam family → clan mapping                        |

The `default` group only requires the UniProt REST API (+ ExPASy for EC names). For `--keep-tmp` annotation caching, see [CLI Reference](cli.md#annotation-caching---keep-tmp).

## Prediction Overlay Columns (EAT Transfer)

Running `protspace transfer` appends three new columns to the bundle's annotations table for each requested column `COL`. The curated `COL` column is never modified.

| Column | Type | Meaning |
| --- | --- | --- |
| `COL__pred_value` | string | The transferred label from the nearest annotated reference protein |
| `COL__pred_confidence` | float | Reliability index in [0, 1] — 1 = identical embeddings (formula depends on `--metric`/`--k`, see below) |
| `COL__pred_source` | string | The reference protein the label was transferred from (provenance) |

A protein is considered "predicted" for `COL` when `COL` is empty but `COL__pred_value` is present. Use `COL__pred_confidence` to threshold low-reliability transfers.

`COL__pred_source` is *provenance*: it lets a viewer link a predicted protein back to the reference its label came from (e.g. a connector line or a "transferred from &lt;neighbour&gt;" tooltip in the web frontend). It is not intended as a colour-by feature — it holds roughly one distinct value per predicted protein. The web frontend reserves the `__pred_` column-name namespace and keeps these overlay columns out of its annotation-selection dropdown.

The reliability index depends on the `--metric` and `--k` used during transfer:

- **Default (`--metric cosine`, `--k 1`):** `clamp(1 - cosine_distance, 0, 1)`, where `cosine_distance` is in [0, 2] (1 = identical direction, 0 = orthogonal/opposite). Cosine is the default because the confidence is naturally bounded and directly interpretable.
- **`--metric euclidean` (`--k 1`):** `0.5 / (0.5 + distance)` — the published goPredSim transform, calibrated for ProtT5. On embedding spaces whose raw distances are much larger than ~0.5 it collapses toward 0 even for near neighbours, so treat it as a *ranking* rather than a calibrated probability.
- **`--k > 1`:** the goPredSim mean reliability — `(1/m) · Σ s(d)` of the per-neighbour similarity over the `k` nearest neighbours carrying the chosen label, with `m = min(k, number of references)`. Because of this normalization, values are **not** comparable across different `--k` settings.

See [`protspace transfer`](cli.md#protspace-transfer) for usage and option details.
