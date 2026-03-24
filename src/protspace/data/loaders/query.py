"""UniProt query → FASTA downloader.

Extracted from UniProtQueryProcessor._search_and_download_fasta
and _extract_identifiers_from_fasta*.
"""

import gzip
import logging
import tempfile
from pathlib import Path

import requests
from tqdm import tqdm

logger = logging.getLogger(__name__)


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

    try:
        response = requests.get(base_url, params=params, stream=True)
        response.raise_for_status()

        # Download to temporary compressed file
        temp_file = tempfile.NamedTemporaryFile(
            mode="wb", suffix=".fasta.gz", delete=False
        )
        temp_gz_file = Path(temp_file.name)

        total_size = int(response.headers.get("content-length", 0))
        with tqdm(
            total=total_size, unit="B", unit_scale=True, desc="Downloading FASTA"
        ) as pbar:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    temp_file.write(chunk)
                    pbar.update(len(chunk))
        temp_file.close()

        # Extract identifiers from compressed FASTA
        identifiers = _extract_identifiers_gz(temp_gz_file)

        # Extract FASTA to final location
        if save_to:
            extracted_path = save_to
            extracted_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            extracted_path = temp_gz_file.with_suffix("")

        with gzip.open(temp_gz_file, "rt") as gz_file:
            content = gz_file.read()
            with open(extracted_path, "w") as out:
                out.write(content)

        temp_gz_file.unlink(missing_ok=True)
        logger.info(f"Downloaded and extracted {len(identifiers)} sequences")

        return identifiers, extracted_path

    except requests.RequestException as e:
        logger.error(f"Error downloading FASTA: {e}")
        raise
    except Exception as e:
        logger.error(f"Error processing FASTA: {e}")
        raise


def extract_identifiers_from_fasta(fasta_path: Path) -> list[str]:
    """Extract UniProt accessions from an uncompressed FASTA file.

    Handles both sp|ACCESSION|NAME and plain >ACCESSION formats.
    """
    identifiers = []
    with open(fasta_path) as f:
        for line in f:
            if line.startswith(">"):
                header = line.strip()
                if "|" in header:
                    parts = header.split("|")
                    if len(parts) >= 2:
                        identifiers.append(parts[1])
                else:
                    identifiers.append(header[1:].split()[0])
    return identifiers


def _extract_identifiers_gz(fasta_gz_path: Path) -> list[str]:
    """Extract UniProt accessions from a gzipped FASTA file."""
    identifiers = []
    with gzip.open(fasta_gz_path, "rt") as f:
        for line in f:
            if line.startswith(">"):
                header = line.strip()
                if "|" in header:
                    parts = header.split("|")
                    if len(parts) >= 2:
                        identifiers.append(parts[1])
                else:
                    identifiers.append(header[1:].split()[0])
    return identifiers
