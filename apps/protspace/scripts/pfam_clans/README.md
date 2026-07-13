# Pfam Clan Query Generator

Generate UniProt query strings for all Pfam families in a specified clan, automatically handling UniProt's 100 OR condition limit.

## Quick Start

```bash
# Generate queries for SwissProt (reviewed) entries
python scripts/pfam_clans/create_pfam_clan_query.py --clan CL0023

# Include all entries (SwissProt + TrEMBL)
python scripts/pfam_clans/create_pfam_clan_query.py --clan CL0023 --all-entries
```

## Usage

```bash
python scripts/pfam_clans/create_pfam_clan_query.py --clan CLAN_ID [OPTIONS]
```

### Arguments

| Argument              | Short | Description                              | Default                       |
| --------------------- | ----- | ---------------------------------------- | ----------------------------- |
| `--clan`              | `-c`  | Clan identifier (required)               | -                             |
| `--pfam-clans-file`   | `-f`  | Path to Pfam-A.clans.tsv                 | `data/clans/Pfam-A.clans.tsv` |
| `--output-dir`        | `-o`  | Output directory                         | `data/clans/<clan_id>`        |
| `--max-or-conditions` | `-m`  | Max OR conditions per query              | 100                           |
| `--all-entries`       | `-a`  | Include all entries (SwissProt + TrEMBL) | False (SwissProt only)        |

## Output

Creates query files in `data/clans/<CLAN_ID>/uniprot_query/`:

- `<CLAN_ID>_batch1.txt`
- `<CLAN_ID>_batch2.txt`
- ...

Queries are split into batches of 100 OR conditions (UniProt's limit).

By default, queries include `AND reviewed:true` to filter for SwissProt (manually curated) entries only.

## Examples

### Example 1: P-loop NTPase (CL0023)

```bash
python scripts/pfam_clans/create_pfam_clan_query.py --clan CL0023
```

Output:

```
Generated UniProt queries for clan CL0023 (P-loop_NTPase)
  Pfam families: 285
  Query batches: 3
  Entry filter: SwissProt (reviewed)
  Output: data/clans/CL0023
```

### Example 2: Include All Entries

```bash
python scripts/pfam_clans/create_pfam_clan_query.py --clan CL0023 --all-entries
```

### Example 3: Custom Output Directory

```bash
python scripts/pfam_clans/create_pfam_clan_query.py --clan CL0023 --output-dir my_analysis/
```

## Using Queries with UniProt

1. Go to https://www.uniprot.org/
2. Paste a query from one of the batch files
3. Download results as FASTA, TSV, or other formats
4. Repeat for each batch file and combine results

## Data Structure

```
data/clans/
├── Pfam-A.clans.tsv              # Pfam to clan mapping
└── <CLAN_ID>/                     # Per-clan outputs
    └── uniprot_query/             # UniProt query files
        ├── <CLAN_ID>_batch1.txt
        ├── <CLAN_ID>_batch2.txt
        └── ...
```

## Working with Batch Embeddings

If you have embeddings split across multiple batch files (e.g., `batch1.h5`, `batch2.h5`, `batch3.h5`), you have two options:

### Option 1: Use ProtSpace Directory Input (Recommended)

ProtSpace can directly process directories containing multiple H5 files:

```bash
# Pass the directory path instead of individual files
protspace prepare -i data/clans/CL0023/embs -m pca2 -o output/CL0023
```

ProtSpace will automatically:

- Find all `.h5` files in the directory
- Merge them internally
- Handle duplicate protein IDs (keeps first occurrence)

### Option 2: Manually Merge Batches

Use the merge script to create a single H5 file:

```bash
# Merge all H5 files in a directory
python scripts/pfam_clans/merge_h5_batches.py --input-dir data/clans/CL0023/embs

# Specify custom output file
python scripts/pfam_clans/merge_h5_batches.py --input-dir data/clans/CL0023/embs --output merged.h5
```

Then use with ProtSpace:

```bash
protspace prepare -i data/clans/CL0023/embs/merged.h5 -m pca2 -o output/CL0023
```

## Notes

- **UniProt Limit**: UniProt restricts queries to 100 OR conditions, hence the batch splitting
- **SwissProt vs TrEMBL**: SwissProt entries are manually curated (higher quality), TrEMBL entries are automatically annotated (more comprehensive)
- **Default Behavior**: Queries filter for SwissProt only unless `--all-entries` is specified
- **Batch Processing**: When working with multiple embedding batches, use directory input or merge script

## References

- [Pfam Database](https://pfam.xfam.org/)
- [Pfam Clans](https://pfam.xfam.org/clans)
- [UniProt](https://www.uniprot.org/)
