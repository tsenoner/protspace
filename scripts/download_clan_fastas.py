#!/usr/bin/env python3
"""Download reviewed (Swiss-Prot) FASTA files for Pfam clans via InterPro API.

Usage:
    uv run python scripts/download_clan_fastas.py
    uv run python scripts/download_clan_fastas.py --clans CL0001 CL0090
    uv run python scripts/download_clan_fastas.py --max-proteins 500
"""

import argparse
import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

INTERPRO_BASE = "https://www.ebi.ac.uk/interpro/api"

# Curated set of biologically interesting, small-to-medium clans
DEFAULT_CLANS = [
    "CL0090",  # Globin          — 10 families, classic protein fold
    "CL0079",  # Cystine-knot    — 14 families, toxins/growth factors
    "CL0018",  # bZIP            — 3 families, transcription factors
    "CL0013",  # Beta-lactamase  — 6 families, antibiotic resistance
    "CL0042",  # Flavoprotein    — 7 families, redox enzymes
    "CL0114",  # HMG-box         — 9 families, DNA-binding
]


def fetch_clan_metadata(clan_id: str) -> dict:
    """Fetch clan name and description from InterPro."""
    url = f"{INTERPRO_BASE}/set/pfam/{clan_id}"
    resp = requests.get(url, headers={"Accept": "application/json"})
    resp.raise_for_status()
    return resp.json()["metadata"]


def fetch_clan_sequences(
    clan_id: str,
    max_proteins: int | None = None,
) -> list[tuple[str, str, str]]:
    """Fetch reviewed protein sequences for a Pfam clan.

    Returns list of (accession, name, sequence) tuples.
    """
    url = (
        f"{INTERPRO_BASE}/protein/reviewed/set/pfam/{clan_id}"
        f"/?page_size=200&extra_fields=sequence"
    )

    proteins: list[tuple[str, str, str]] = []
    page = 0
    while url:
        resp = requests.get(url, headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()

        for result in data["results"]:
            meta = result["metadata"]
            seq = result["extra_fields"]["sequence"]
            proteins.append((meta["accession"], meta["name"], seq))

            if max_proteins and len(proteins) >= max_proteins:
                return proteins

        page += 1
        url = data.get("next")
        if url:
            time.sleep(0.3)  # polite delay

    return proteins


def write_fasta(
    proteins: list[tuple[str, str, str]],
    output_path: Path,
    line_width: int = 60,
) -> None:
    """Write proteins to a FASTA file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        for acc, name, seq in proteins:
            f.write(f">{acc} {name}\n")
            for i in range(0, len(seq), line_width):
                f.write(seq[i : i + line_width] + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Download Swiss-Prot FASTA files for Pfam clans via InterPro API."
    )
    parser.add_argument(
        "--clans",
        nargs="+",
        default=DEFAULT_CLANS,
        help=f"Clan IDs to download (default: {' '.join(DEFAULT_CLANS)})",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("data/clans"),
        help="Output directory (default: data/clans)",
    )
    parser.add_argument(
        "--max-proteins",
        type=int,
        default=None,
        help="Max proteins per clan (default: all)",
    )
    parser.add_argument(
        "-v", "--verbose", action="count", default=0,
    )
    args = parser.parse_args()

    level = {0: logging.WARNING, 1: logging.INFO}.get(args.verbose, logging.DEBUG)
    logging.basicConfig(
        level=level, format="%(asctime)s %(levelname)-8s %(message)s", datefmt="%H:%M:%S"
    )

    for clan_id in args.clans:
        # Get clan name for display
        try:
            meta = fetch_clan_metadata(clan_id)
            clan_name = meta["name"]["name"]
            print(f"\n{'='*60}")
            print(f"{clan_id} — {clan_name}")
            print(f"{'='*60}")
        except Exception as e:
            print(f"\nERROR fetching metadata for {clan_id}: {e}")
            continue

        # Fetch sequences
        print("Fetching reviewed sequences...")
        proteins = fetch_clan_sequences(clan_id, max_proteins=args.max_proteins)

        if not proteins:
            print("  No sequences found, skipping.")
            continue

        # Write FASTA
        # Use lowercase clan name for filename
        safe_name = clan_name.replace("-", "_").replace(" ", "_").lower()
        output_path = args.output_dir / f"{clan_id}_{safe_name}.fasta"
        write_fasta(proteins, output_path)

        lengths = [len(seq) for _, _, seq in proteins]
        print(f"  Sequences: {len(proteins):,}")
        print(f"  Lengths:   min={min(lengths)}, median={sorted(lengths)[len(lengths)//2]}, max={max(lengths)}")
        print(f"  Output:    {output_path}")

    print("\nDone.")


if __name__ == "__main__":
    main()
