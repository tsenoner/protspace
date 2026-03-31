"""
InterPro-specific annotation transformations.

This module contains transformations for InterPro annotations to convert
raw values into user-friendly formats.
"""

import gzip
import logging
import re
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

PFAM_CLANS_URL = (
    "https://ftp.ebi.ac.uk/pub/databases/Pfam/current_release/Pfam-A.clans.tsv.gz"
)
PFAM_CLANS_CACHE_DIR = Path.home() / ".cache" / "protspace" / "pfam_clans"
PFAM_CLANS_CACHE_MAX_AGE_DAYS = 30


def _get_pfam_clan_mapping() -> dict[str, str]:
    """Download/cache Pfam-A.clans.tsv and return {pfam_acc: 'clan_id (clan_name)'}."""
    cache_dir = PFAM_CLANS_CACHE_DIR
    cache_file = cache_dir / "pfam_clans.tsv"
    timestamp_file = cache_dir / ".timestamp"

    # Check cache freshness
    if cache_file.exists() and timestamp_file.exists():
        try:
            ts = float(timestamp_file.read_text().strip())
            age_days = (time.time() - ts) / 86400
            if age_days < PFAM_CLANS_CACHE_MAX_AGE_DAYS:
                return _parse_pfam_clans_tsv(cache_file)
        except (ValueError, OSError):
            pass

    # Download and cache
    logger.info("Downloading Pfam clan mapping...")
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        resp = requests.get(PFAM_CLANS_URL, timeout=60)
        resp.raise_for_status()
        content = gzip.decompress(resp.content)
        cache_file.write_bytes(content)
        timestamp_file.write_text(str(time.time()))
    except Exception as e:
        logger.warning(f"Failed to download Pfam clan mapping: {e}")
        if cache_file.exists():
            return _parse_pfam_clans_tsv(cache_file)
        return {}

    return _parse_pfam_clans_tsv(cache_file)


def _parse_pfam_clans_tsv(path: Path) -> dict[str, str]:
    """Parse Pfam-A.clans.tsv → {pfam_acc: 'clan_id (clan_name)'}."""
    mapping = {}
    for line in path.read_text().splitlines():
        parts = line.split("\t")
        if len(parts) >= 3 and parts[1]:  # Has clan_id
            pfam_acc = parts[0]
            clan_id = parts[1]
            clan_name = parts[2] if len(parts) > 2 else ""
            mapping[pfam_acc] = f"{clan_id} ({clan_name})" if clan_name else clan_id
    return mapping


class InterProTransformer:
    """Transformations for InterPro-specific annotations."""

    @staticmethod
    def transform_cath(value: str) -> str:
        """
        Clean CATH IDs (remove G3DSA: prefix, sort).

        Args:
            value: CATH IDs (semicolon-separated with G3DSA: prefix)

        Returns:
            Cleaned and sorted CATH IDs (semicolon-separated)
        """
        if not value:
            return value

        cath_value = str(value)
        # Split by semicolon, strip G3DSA: prefix from each value, sort
        cath_values = cath_value.split(";")
        cleaned = [v.replace("G3DSA:", "").strip() for v in cath_values if v.strip()]
        return ";".join(sorted(cleaned))

    @staticmethod
    def transform_signal_peptide(value: str) -> str:
        """
        Convert signal peptide annotation to True/False.

        Args:
            value: Signal peptide annotation string

        Returns:
            "True" if signal peptide present, "False" otherwise
        """
        if not value:
            return "False"

        if "SIGNAL_PEPTIDE" in str(value):
            return "True"

        return "False"

    @staticmethod
    def transform_pfam(value: str) -> str:
        """Pass-through: Pfam is already in correct format from InterPro retriever."""
        return str(value) if value else ""

    @staticmethod
    def transform_pfam_clan(pfam_value: str, clan_mapping: dict[str, str]) -> str:
        """Map Pfam accessions to clan IDs.

        Args:
            pfam_value: Pfam annotation string, e.g. "PF00102 (Y_phosphatase);PF00041 (fn3)"
            clan_mapping: Dict mapping PF accession → "CL0023 (P-loop_NTPase)"

        Returns:
            Semicolon-separated unique clans, e.g. "CL0023 (P-loop_NTPase);CL0192 (HAD)"
        """
        if not pfam_value:
            return ""
        # Extract PF accessions from the formatted string
        accessions = re.findall(r"(PF\d+)", pfam_value)
        seen = set()
        clans = []
        for acc in accessions:
            clan = clan_mapping.get(acc)
            if clan and clan not in seen:
                seen.add(clan)
                clans.append(clan)
        return ";".join(sorted(clans))
