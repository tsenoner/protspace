"""CATH hierarchy name resolution via the official CATH names file.

Downloads and caches ``cath-names-v4_4_0.txt`` which provides human-readable
names at all 4 CATH levels (Class, Architecture, Topology, Superfamily).
Unnamed superfamilies inherit their parent topology name.
"""

import json
import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

CATH_NAMES_URL = (
    "https://download.cathdb.info/cath/releases/latest-release/"
    "cath-classification-data/cath-names.txt"
)
CATH_CACHE_DIR = Path.home() / ".cache" / "protspace" / "cath"
CACHE_MAX_AGE_DAYS = 30


def get_cath_names() -> dict[str, str]:
    """Return ``{cath_code: name}`` mapping at all hierarchy levels.

    Downloads and caches the CATH names file. For unnamed superfamilies,
    the parent topology name is used as fallback.
    """
    cache_dir = CATH_CACHE_DIR
    cache_file = cache_dir / "cath_names.json"
    timestamp_file = cache_dir / "cath_names.timestamp"

    # Check cache
    if cache_file.exists() and timestamp_file.exists():
        try:
            ts = float(timestamp_file.read_text().strip())
            age_days = (time.time() - ts) / 86400
            if age_days < CACHE_MAX_AGE_DAYS:
                logger.info("Loading CATH names from cache")
                return json.loads(cache_file.read_text())
        except (ValueError, OSError, json.JSONDecodeError) as e:
            logger.warning(f"CATH cache read failed ({e}), will re-download")

    # Download
    logger.info(f"Downloading CATH names from {CATH_NAMES_URL} ...")
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        resp = requests.get(CATH_NAMES_URL, timeout=30)
        resp.raise_for_status()

        raw_path = cache_dir / "cath-names.txt"
        raw_path.write_text(resp.text)

        names = _parse_cath_names(raw_path)

        cache_file.write_text(json.dumps(names))
        timestamp_file.write_text(str(time.time()))
        logger.info(f"Cached {len(names)} CATH names")
        return names

    except Exception as e:
        logger.warning(f"Failed to download CATH names: {e}")
        if cache_file.exists():
            try:
                logger.info("Falling back to stale CATH cache")
                return json.loads(cache_file.read_text())
            except (json.JSONDecodeError, OSError):
                pass
        return {}


def _parse_cath_names(path: Path) -> dict[str, str]:
    """Parse a CATH names file (CNF 2.0 format).

    Each line: ``cath_code  representative_domain  :Name``
    Unnamed superfamilies (empty after ``:``) inherit their parent topology name.
    """
    names: dict[str, str] = {}
    unnamed_superfamilies: list[str] = []

    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        # Split at the colon — everything after is the name
        colon_idx = line.find(":")
        if colon_idx == -1:
            continue

        name = line[colon_idx + 1 :].strip()
        code = line[:colon_idx].split()[0]

        if name:
            names[code] = name
        elif len(code.split(".")) == 4:
            unnamed_superfamilies.append(code)

    # Fill unnamed superfamilies with parent topology name
    for code in unnamed_superfamilies:
        parent = ".".join(code.split(".")[:3])
        if parent in names:
            names[code] = names[parent]

    return names
