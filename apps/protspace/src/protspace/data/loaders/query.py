"""UniProt query → FASTA downloader.

Extracted from UniProtQueryProcessor._search_and_download_fasta
and _extract_identifiers_from_fasta*.
"""

import gzip
import hashlib
import logging
import shutil
import tempfile
from pathlib import Path

import requests
from tqdm import tqdm

from protspace.data.io.atomic import staged_write

logger = logging.getLogger(__name__)


def query_cache_path(cache_dir: Path, query: str) -> Path:
    """Return the retained FASTA path owned by one exact query text.

    One shared file name per output directory hands a later run the previous
    query's sequences: the file exists and parses, so nothing downstream can
    tell it apart from the one this query would have produced.
    """
    digest = hashlib.sha256(query.encode()).hexdigest()[:12]
    return cache_dir / "queries" / f"{digest}.fasta"


def resolve_query_fasta(
    query: str, cache_dir: Path | None, refetch_stages: frozenset[str]
) -> tuple[list[str], Path]:
    """Return ``(headers, fasta_path)`` for *query*, reusing only its own FASTA.

    Path, reuse rule and download live together because they are one decision:
    whether the retained FASTA on disk is the one *query* would produce. A caller
    that owned the rule separately would have to be changed in step with the
    path, and the two would drift.
    """
    fasta_save = query_cache_path(cache_dir, query) if cache_dir else None
    if (
        fasta_save
        and fasta_save.exists()
        and fasta_save.stat().st_size > 0
        and "query" not in refetch_stages
    ):
        headers = extract_identifiers_from_fasta(fasta_save)
        logger.warning("Using cached FASTA (%s sequences)", f"{len(headers):,}")
        return headers, fasta_save
    return query_uniprot(query, save_to=fasta_save)


def query_uniprot(
    query: str,
    *,
    save_to: Path | None = None,
) -> tuple[list[str], Path]:
    """Search UniProt and download FASTA.

    Args:
        query: UniProt search query string.
        save_to: If provided, save extracted FASTA here. Otherwise uses a temp file.

    Returns:
        Tuple of (identifiers, fasta_path).
    """
    logger.info(f"Searching UniProt for query: '{query}'")

    base_url = "https://rest.uniprot.org/uniprotkb/stream"
    params = {"compressed": "true", "format": "fasta", "query": query}
    temp_gz_file: Path | None = None

    try:
        response = requests.get(base_url, params=params, stream=True)
        response.raise_for_status()

        # Download to temporary compressed file
        total_size = int(response.headers.get("content-length", 0))
        with tempfile.NamedTemporaryFile(
            mode="wb", suffix=".fasta.gz", delete=False
        ) as temp_file:
            temp_gz_file = Path(temp_file.name)
            with tqdm(
                total=total_size,
                unit="B",
                unit_scale=True,
                desc="Downloading FASTA",
            ) as pbar:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        temp_file.write(chunk)
                        pbar.update(len(chunk))

        # Published by rename either way: a retained FASTA's existence is the next
        # run's cache hit, so it may not appear until the whole stream has been
        # decompressed. Without *save_to* the extraction is the caller's own file.
        extracted = Path(save_to) if save_to else temp_gz_file.with_suffix("")
        with staged_write(extracted) as staged:
            identifiers = _extract_fasta(temp_gz_file, staged)

        logger.info(f"Downloaded and extracted {len(identifiers)} sequences")
        return identifiers, extracted

    except requests.RequestException as e:
        logger.error(f"Error downloading FASTA: {e}")
        raise
    except Exception as e:
        logger.error(f"Error processing FASTA: {e}")
        raise
    finally:
        if temp_gz_file is not None:
            temp_gz_file.unlink(missing_ok=True)


def _extract_fasta(gz_path: Path, target: Path) -> list[str]:
    """Decompress *gz_path* into *target* and return its identifiers.

    Streamed rather than read whole: a broad query decompresses to gigabytes. A
    truncated or corrupt download raises here, before anything is published.
    """
    with gzip.open(gz_path, "rt") as gz_file, open(target, "w") as out:
        shutil.copyfileobj(gz_file, out)
    return extract_identifiers_from_fasta(target)


def extract_identifiers_from_fasta(fasta_path: Path) -> list[str]:
    """Extract protein identifiers from an uncompressed FASTA file."""
    from protspace.data.loaders.h5 import parse_identifier

    identifiers = []
    with open(fasta_path) as f:
        for line in f:
            if line.startswith(">"):
                raw = line[1:].strip().split()[0]
                identifiers.append(parse_identifier(raw))
    return identifiers
