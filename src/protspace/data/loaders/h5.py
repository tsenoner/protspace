"""HDF5 embedding loader.

Extracted from LocalProcessor._load_h5_files and _collect_datasets.
"""

import logging
import re
from pathlib import Path

import h5py
import numpy as np

from protspace.data.loaders.embedding_set import EmbeddingSet

logger = logging.getLogger(__name__)

EMBEDDING_EXTENSIONS = {".hdf", ".hdf5", ".h5"}

# UniProt FASTA header pattern: >sp|ACCESSION|NAME or >tr|ACCESSION|NAME
_UNIPROT_HEADER_RE = re.compile(
    r"^(?:sp|tr)\|([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})\|"
)


def parse_identifier(raw_key: str) -> str:
    """Extract protein identifier from an H5 key.

    Handles UniProt FASTA headers: sp|P12345|NAME → P12345
    Falls back to the raw key if no UniProt pattern matches.
    """
    m = _UNIPROT_HEADER_RE.match(raw_key)
    if m:
        return m.group(1)
    # If it contains pipes but doesn't match UniProt, take the second field
    if "|" in raw_key:
        parts = raw_key.split("|")
        if len(parts) >= 2:
            return parts[1]
    return raw_key


def _collect_datasets(hdf_handle: h5py.File) -> list[tuple[str, h5py.Dataset]]:
    """Collect (name, dataset) pairs from an HDF5 file.

    Handles both flat layouts (datasets at root) and one level of groups.
    """
    pairs: list[tuple[str, h5py.Dataset]] = []
    for key, item in hdf_handle.items():
        if isinstance(item, h5py.Group):
            for sub_key, sub_item in item.items():
                if not isinstance(sub_item, h5py.Group):
                    pairs.append((sub_key, sub_item))
        else:
            pairs.append((key, item))
    return pairs


def _resolve_model_name(h5_files: list[Path]) -> str | None:
    """Read model_name from HDF5 root attributes.

    Returns the model name if found consistently across files, else None.
    """
    names: set[str] = set()
    for h5_file in h5_files:
        with h5py.File(h5_file, "r") as f:
            name = f.attrs.get("model_name")
            if name is not None:
                names.add(str(name))
    if len(names) == 1:
        return names.pop()
    if len(names) > 1:
        logger.warning(
            f"Multiple model_name values found across H5 files: {names}. "
            f"Using first: {next(iter(names))}"
        )
        return next(iter(names))
    return None


def load_h5(
    h5_files: list[Path],
    *,
    name_override: str | None = None,
) -> EmbeddingSet:
    """Load and merge HDF5 embedding files into an EmbeddingSet.

    Args:
        h5_files: Paths to HDF5 files to load and merge.
        name_override: CLI-provided name (takes precedence over H5 attr).

    Returns:
        EmbeddingSet with merged embeddings.

    Raises:
        ValueError: If no valid embeddings found or per-residue embeddings detected.
    """
    data, headers = [], []
    seen_ids: set[str] = set()
    duplicates_count = 0
    expected_dim = None
    dim_mismatch_count = 0

    for h5_file in h5_files:
        with h5py.File(h5_file, "r") as hdf_handle:
            pairs = _collect_datasets(hdf_handle)
            if not pairs:
                raise ValueError(
                    f"No datasets found in '{h5_file}'. "
                    f"The HDF5 file may be empty or have an unsupported layout."
                )

            for raw_key, dataset in pairs:
                header = parse_identifier(raw_key)
                if header in seen_ids:
                    duplicates_count += 1
                    continue

                emb = np.array(dataset)

                # Handle 2D embeddings like (1, 1024) — squeeze to 1D
                if emb.ndim == 2 and emb.shape[0] == 1:
                    emb = emb.squeeze(axis=0)
                elif emb.ndim > 1:
                    raise ValueError(
                        f"Embedding '{header}' has shape {dataset.shape} which looks "
                        f"like per-residue embeddings. ProtSpace requires per-protein "
                        f"embeddings (1D vectors). Use mean-pooling or CLS token "
                        f"extraction to create per-protein embeddings."
                    )

                emb = emb.flatten()

                if expected_dim is None:
                    expected_dim = emb.shape[0]
                elif emb.shape[0] != expected_dim:
                    dim_mismatch_count += 1
                    logger.warning(
                        f"Skipping '{header}': dimension {emb.shape[0]} "
                        f"doesn't match expected {expected_dim}"
                    )
                    continue

                data.append(emb)
                headers.append(header)
                seen_ids.add(header)

    if not data:
        raise ValueError(
            "No valid embeddings found. Check that the HDF5 file contains "
            "per-protein embedding vectors."
        )

    if duplicates_count > 0:
        logger.warning(
            f"Found {duplicates_count} duplicate protein IDs across files. "
            f"Kept first occurrence of each."
        )

    if dim_mismatch_count > 0:
        logger.warning(
            f"Skipped {dim_mismatch_count} embeddings with mismatched dimensions."
        )

    arr = np.array(data)

    # Upcast float16 → float32
    if arr.dtype == np.float16:
        arr = arr.astype(np.float32)

    # Filter NaN embeddings
    nan_mask = np.isnan(arr).any(axis=1)
    if nan_mask.any():
        num_nan = int(nan_mask.sum())
        total = len(arr)
        logger.warning(
            f"Found {num_nan} embeddings with NaN values out of {total} total. "
            f"Removing these entries ({num_nan / total * 100:.2f}%)."
        )
        arr = arr[~nan_mask]
        headers = [h for h, is_nan in zip(headers, nan_mask, strict=True) if not is_nan]
        if len(arr) == 0:
            raise ValueError(
                "All embeddings contain NaN values. Please check your input file."
            )

    # Resolve name: CLI override > H5 attr > error
    if name_override:
        name = name_override
    else:
        name = _resolve_model_name(h5_files)
        if name is None:
            file_list = ", ".join(str(f) for f in h5_files)
            example = f"-i {h5_files[0]}:prot_t5" if h5_files else "-i file.h5:prot_t5"
            raise ValueError(
                f"HDF5 file has no 'model_name' attribute: {file_list}\n"
                f"  Fix: specify the model name with the colon syntax, e.g.\n"
                f"       protspace prepare {example} -o output"
            )

    return EmbeddingSet(name=name, data=arr, headers=headers)
