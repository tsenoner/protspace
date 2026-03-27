#!/usr/bin/env python3
"""
Generate UniProt query strings for Pfam families in a specified clan.

This script reads the Pfam-A.clans.tsv file, extracts all Pfam IDs
associated with a specified clan, and generates UniProt query strings
split into batches (to handle UniProt's 100 OR condition limit).

By default, queries include "AND reviewed:true" filter for SwissProt entries only.
Use --all-entries to include all entries (SwissProt + TrEMBL).

Usage:
    python create_pfam_clan_query.py --clan CL0023
    python create_pfam_clan_query.py --clan CL0192 --all-entries
    python create_pfam_clan_query.py --clan CL0023 --output-dir custom/path
"""

import argparse
from pathlib import Path


def read_pfam_clans(filepath: str, clan_id: str) -> tuple[list[str], str]:
    """
    Read Pfam-A.clans.tsv and extract Pfam IDs for a specific clan.

    Args:
        filepath: Path to the Pfam-A.clans.tsv file
        clan_id: Clan identifier to filter for (e.g., 'CL0023')

    Returns:
        Tuple of (list of Pfam IDs, clan name)
    """
    pfam_ids = []
    clan_name = None

    with open(filepath) as f:
        for line in f:
            # Skip empty lines
            if not line.strip():
                continue

            # Split by tab
            fields = line.strip().split("\t")

            # Check if line has at least 2 fields and matches the clan
            if len(fields) >= 2 and fields[1] == clan_id:
                pfam_id = fields[0]
                pfam_ids.append(pfam_id)
                # Get clan name from the third field if available
                if clan_name is None and len(fields) >= 3:
                    clan_name = fields[2]

    return pfam_ids, clan_name


def create_uniprot_query(
    pfam_ids: list[str], max_or_conditions: int = 100, reviewed_only: bool = True
) -> list[str]:
    """
    Create UniProt query strings from a list of Pfam IDs, splitting into batches if needed.

    UniProt has a limit of 100 OR conditions per query, so we need to split large
    queries into multiple batches.

    Args:
        pfam_ids: List of Pfam IDs (e.g., ['PF00001', 'PF00002'])
        max_or_conditions: Maximum number of OR conditions per query (default: 100)
        reviewed_only: Add "AND reviewed:true" filter to queries (default: True)

    Returns:
        List of UniProt query strings, each with max 100 OR conditions
    """
    queries = []

    # Split pfam_ids into batches
    for i in range(0, len(pfam_ids), max_or_conditions):
        batch = pfam_ids[i : i + max_or_conditions]

        # Create query terms for each Pfam ID in this batch
        query_terms = [f"(xref:pfam-{pfam_id})" for pfam_id in batch]

        # Join with OR
        query_string = " OR ".join(query_terms)

        # Add reviewed filter if requested
        if reviewed_only:
            query_string = f"({query_string}) AND reviewed:true"

        queries.append(query_string)

    return queries


def main():
    """Main function to generate and print the UniProt query."""
    parser = argparse.ArgumentParser(
        description="Generate UniProt query strings for Pfam families in a clan"
    )
    parser.add_argument(
        "--clan",
        "-c",
        required=True,
        help="Clan identifier (e.g., CL0023)",
    )
    parser.add_argument(
        "--pfam-clans-file",
        "-f",
        default=None,
        help="Path to Pfam-A.clans.tsv file (default: data/clans/Pfam-A.clans.tsv)",
    )
    parser.add_argument(
        "--output-dir",
        "-o",
        default=None,
        help="Output directory (default: data/clans/<clan_id>)",
    )
    parser.add_argument(
        "--max-or-conditions",
        "-m",
        type=int,
        default=100,
        help="Maximum OR conditions per query (default: 100)",
    )
    parser.add_argument(
        "--all-entries",
        "-a",
        action="store_true",
        help="Include all entries (SwissProt + TrEMBL). By default, only reviewed (SwissProt) entries are included.",
    )

    args = parser.parse_args()

    # Set default paths relative to project root
    # Script is at scripts/pfam_clans/, so go up 2 levels to reach project root
    script_dir = Path(__file__).parent.parent.parent

    if args.pfam_clans_file:
        tsv_file = Path(args.pfam_clans_file)
    else:
        tsv_file = script_dir / "data" / "clans" / "Pfam-A.clans.tsv"

    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        output_dir = script_dir / "data" / "clans" / args.clan

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Check if file exists
    if not tsv_file.exists():
        print(f"Error: File not found: {tsv_file}")
        print("Please provide the path to Pfam-A.clans.tsv using --pfam-clans-file")
        return

    # Read Pfam IDs for specified clan
    clan_id = args.clan
    pfam_ids, clan_name = read_pfam_clans(str(tsv_file), clan_id)

    if not pfam_ids:
        print(f"Error: No Pfam families found for clan {clan_id}")
        print("Please check that the clan ID is correct.")
        return

    clan_display = f"{clan_id} ({clan_name})" if clan_name else clan_id

    # Determine if we're filtering for reviewed entries
    reviewed_only = not args.all_entries
    entry_type = "SwissProt (reviewed)" if reviewed_only else "All (SwissProt + TrEMBL)"

    # Create UniProt queries (split into batches)
    queries = create_uniprot_query(
        pfam_ids, max_or_conditions=args.max_or_conditions, reviewed_only=reviewed_only
    )

    # Create uniprot_query subdirectory
    query_dir = output_dir / "uniprot_query"
    query_dir.mkdir(parents=True, exist_ok=True)

    # Save each query to a separate file
    for i, query in enumerate(queries, 1):
        batch_num = i
        output_file = query_dir / f"{clan_id}_batch{batch_num}.txt"
        with open(output_file, "w") as f:
            f.write(query)

    # Print summary
    print(f"Generated UniProt queries for clan {clan_display}")
    print(f"  Pfam families: {len(pfam_ids)}")
    print(f"  Query batches: {len(queries)}")
    print(f"  Entry filter: {entry_type}")
    print(f"  Output: {query_dir}")


if __name__ == "__main__":
    main()
