"""
UniProt-specific annotation transformations.

This module contains transformations for UniProt annotations to convert
raw values into user-friendly formats.
"""

import json
import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

# ExPASy ENZYME database for EC name resolution
ENZYME_DAT_URL = "https://ftp.expasy.org/databases/enzyme/enzyme.dat"
ENZYME_CACHE_DIR = Path.home() / ".cache" / "protspace" / "enzyme"
CACHE_MAX_AGE_DAYS = 7


class UniProtTransformer:
    """Transformations for UniProt-specific annotations."""

    @staticmethod
    def transform_annotation_score(value: str) -> str:
        """
        Convert float annotation score to integer string.

        Args:
            value: Annotation score as string (e.g., "5.0")

        Returns:
            Integer string (e.g., "5")
        """
        if not value:
            return value

        try:
            return str(int(float(value)))
        except (ValueError, TypeError):
            return value

    @staticmethod
    def transform_protein_families(value: str) -> str:
        """
        Extract first family (before comma/semicolon).

        Preserves inline evidence codes: "Insulin family, Subfamily 1|ISS"
        → "Insulin family|ISS".

        Args:
            value: Protein families string (may contain multiple families),
                   optionally with evidence code suffix

        Returns:
            First family only, with evidence preserved if present
        """
        if not value:
            return value

        protein_families_value = str(value)

        # Split off evidence code if present
        if "|" in protein_families_value:
            main, evidence = protein_families_value.rsplit("|", 1)
        else:
            main, evidence = protein_families_value, ""

        if "," in main:
            first = main.split(",")[0].strip()
        elif ";" in main:
            first = main.split(";")[0].strip()
        else:
            first = main

        if evidence:
            return f"{first}|{evidence}"
        return first

    @staticmethod
    def transform_xref_pdb(value: str) -> str:
        """
        Convert PDB IDs to True/False.

        Args:
            value: PDB IDs (semicolon-separated) or empty string

        Returns:
            "True" if PDB structures exist, "False" otherwise
        """
        if value and str(value).strip():
            return "True"
        return "False"

    @staticmethod
    def transform_fragment(value: str) -> str:
        """
        Convert 'fragment' to 'yes'.

        Args:
            value: Fragment status string

        Returns:
            "yes" if fragment, original value otherwise
        """
        if not value:
            return value

        if str(value).strip().lower() == "fragment":
            return "yes"

        return value

    @staticmethod
    def transform_cc_subcellular_location(value: str) -> str:
        """
        Keep subcellular location as semicolon-separated values.

        This is a pass-through as the new parser already provides clean format.

        Args:
            value: Semicolon-separated location values

        Returns:
            Original value (already in correct format)
        """
        return str(value) if value else ""

    @staticmethod
    def transform_go_terms(value: str) -> str:
        """
        Strip GO aspect prefixes (F:, P:, C:) from semicolon-separated GO terms.

        Args:
            value: Semicolon-separated GO terms (e.g., "F:kinase activity;F:ATP binding")

        Returns:
            Terms with prefixes stripped (e.g., "kinase activity;ATP binding")
        """
        if not value:
            return value

        terms = value.split(";")
        cleaned = []
        for term in terms:
            term = term.strip()
            if len(term) > 2 and term[1] == ":":
                cleaned.append(term[2:])
            else:
                cleaned.append(term)
        return ";".join(cleaned)

    @staticmethod
    def transform_ec(value: str, ec_name_map: dict[str, str]) -> str:
        """
        Append enzyme names to EC numbers using ExPASy ENZYME database.

        Preserves inline evidence codes: "2.7.11.1|EXP" → "2.7.11.1 (Name)|EXP".

        Args:
            value: Semicolon-separated EC numbers, optionally with evidence
                   (e.g., "2.7.11.1|EXP;2.7.11.24")
            ec_name_map: Mapping from EC number to enzyme name

        Returns:
            EC numbers with names and evidence preserved
        """
        if not value:
            return value

        ec_numbers = value.split(";")
        result = []
        for ec in ec_numbers:
            ec = ec.strip()
            if not ec:
                continue
            # Split off evidence code if present
            if "|" in ec:
                ec_num, evidence = ec.rsplit("|", 1)
            else:
                ec_num, evidence = ec, ""
            name = ec_name_map.get(ec_num, "")
            if name:
                entry = f"{ec_num} ({name})"
            else:
                entry = ec_num
            if evidence:
                entry = f"{entry}|{evidence}"
            result.append(entry)
        return ";".join(result)

    @classmethod
    def _get_ec_name_map(cls) -> dict[str, str]:
        """
        Download and cache the ExPASy ENZYME database, returning {ec_number: name}.

        The data is downloaded from the ExPASy FTP server and cached locally
        as JSON for up to CACHE_MAX_AGE_DAYS days.
        """
        cache_dir = ENZYME_CACHE_DIR
        cache_file = cache_dir / "ec_names.json"
        timestamp_file = cache_dir / "ec_names.timestamp"

        # Check cache freshness
        if cache_file.exists() and timestamp_file.exists():
            try:
                ts = float(timestamp_file.read_text().strip())
                age_days = (time.time() - ts) / 86400
                if age_days < CACHE_MAX_AGE_DAYS:
                    logger.info("Loading EC name map from cache")
                    return json.loads(cache_file.read_text())
            except (ValueError, OSError, json.JSONDecodeError) as e:
                logger.warning(f"Cache read failed ({e}), will re-download")

        # Download and parse
        logger.info(f"Downloading {ENZYME_DAT_URL} ...")
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)

            resp = requests.get(ENZYME_DAT_URL, timeout=120)
            resp.raise_for_status()

            ec_map = cls._parse_enzyme_dat(resp.text)

            # Persist cache
            cache_file.write_text(json.dumps(ec_map))
            timestamp_file.write_text(str(time.time()))

            logger.info(f"EC name map cached successfully ({len(ec_map)} entries)")
            return ec_map

        except Exception as e:
            logger.warning(f"Failed to download/parse enzyme.dat: {e}")
            # If a stale cache exists, use it as fallback
            if cache_file.exists():
                try:
                    logger.info("Falling back to stale EC name cache")
                    return json.loads(cache_file.read_text())
                except (json.JSONDecodeError, OSError):
                    pass
            return {}

    @staticmethod
    def _parse_enzyme_dat(text: str) -> dict[str, str]:
        """
        Parse ExPASy enzyme.dat text to extract {ec_number: description}.

        Each entry is delimited by '//' and contains:
        - ID   <ec_number>
        - DE   <description>

        Args:
            text: Raw text content of enzyme.dat

        Returns:
            Dictionary mapping EC numbers to enzyme names
        """
        ec_map = {}
        current_id = None
        current_de_parts = []

        for line in text.splitlines():
            if line.startswith("ID   "):
                current_id = line[5:].strip()
                current_de_parts = []
            elif line.startswith("DE   "):
                current_de_parts.append(line[5:].strip())
            elif line.startswith("//"):
                if current_id and current_de_parts:
                    de = " ".join(current_de_parts)
                    # Remove trailing period
                    if de.endswith("."):
                        de = de[:-1]
                    ec_map[current_id] = de
                current_id = None
                current_de_parts = []

        return ec_map
