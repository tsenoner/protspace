"""HDF5 embedding loader.

Extracted from LocalProcessor._load_h5_files and _collect_datasets.
"""

import logging
import re
from pathlib import Path
from typing import NamedTuple

import h5py
import numpy as np

from protspace.data.loaders.embedding_set import MODEL_DISPLAY_NAMES, EmbeddingSet

logger = logging.getLogger(__name__)

EMBEDDING_EXTENSIONS = {".hdf", ".hdf5", ".h5"}

# Model keys a file name may end in, lowercased -> registry spelling. MMseqs2 is
# a sequence-similarity matrix, never an HDF5 file.
_KNOWN_MODELS = {key.lower(): key for key in MODEL_DISPLAY_NAMES if key != "MMseqs2"}

# UniProt FASTA header pattern: >sp|ACCESSION|NAME or >tr|ACCESSION|NAME
_UNIPROT_HEADER_RE = re.compile(
    r"^(?:sp|tr)\|([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})\|"
)


def split_h5_spec(spec: str) -> tuple[Path, str | None]:
    """Parse an HDF5 input spec with an optional ``:name`` override.

    ``file.h5:model_name`` -> ``(Path("file.h5"), "model_name")``.

    Colon/Windows-safe: the split uses the LAST colon and is only taken when the
    right side looks like a name (not a path separator) and the left side has a
    file suffix.  So ``C:\\data\\emb.h5`` and ``C:\\data\\emb.h5:prot_t5`` parse
    correctly instead of splitting on the drive-letter colon.
    """
    if ":" in spec:
        last_colon = spec.rfind(":")
        path_part, name_part = spec[:last_colon], spec[last_colon + 1 :]
        if (
            name_part
            and not name_part.startswith(("/", "\\"))
            and Path(path_part).suffix
        ):
            return Path(path_part), name_part
    return Path(spec), None


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


def _model_from_file_name(stem: str) -> str | None:
    """The known model key a file stem ends in, or None.

    Tries the whole stem, then its trailing ``_``-delimited tokens, longest
    first, so ``seqs_esm2_650m`` and ``esm2_650m`` both give ``esm2_650m``.
    Keys contain underscores themselves, which is why whole token runs are
    compared rather than the last token alone.
    """
    tokens = stem.lower().split("_")
    for start in range(len(tokens)):
        key = _KNOWN_MODELS.get("_".join(tokens[start:]))
        if key:
            return key
    return None


def _model_from_file_names(h5_files: list[Path]) -> str | None:
    """The one known model key every file's name ends in, or None.

    Raises:
        ValueError: If the file names point to two or more different models.
            Read as one input, their vectors would be merged into one space and
            every protein the second model shares with the first dropped as a
            duplicate.
    """
    by_file = {f: _model_from_file_name(f.stem) for f in h5_files}
    keys = set(by_file.values())
    if len(keys - {None}) > 1:
        listing = ", ".join(f"{f.name} ({key})" for f, key in by_file.items() if key)
        raise ValueError(
            f"Files from different models in one input: {listing}.\n"
            f"  Load each model's files as a separate input."
        )
    return keys.pop() if len(keys) == 1 else None


def embedding_files(path: Path) -> list[Path]:
    """The HDF5 files an input names: the file itself, or a directory's files."""
    if path.is_dir():
        return sorted(f for ext in EMBEDDING_EXTENSIONS for f in path.glob(f"*{ext}"))
    return [path]


class NamedInput(NamedTuple):
    """An input path and the embedding name resolved for it.

    ``name`` is None for an input that is not HDF5 (a FASTA, named by its
    embedder). ``from_file_name`` marks a name read off the file name or stem
    rather than stated by ``:name`` or the ``model_name`` attribute.
    """

    path: Path
    name: str | None
    from_file_name: bool = False


def resolve_input_names(
    specs: list[tuple[Path, str | None]], *, command: str
) -> list[NamedInput]:
    """Name every HDF5 input of a command before any matrix is loaded.

    Order: ``file.h5:name`` > the ``model_name`` attribute > a known model key
    the file name ends in > the file stem, the last only when this is the
    command's only input. The name decides how several inputs combine -- the
    same name merges them, different names intersect them -- so with more than
    one input an unnamed one is an error rather than a guess.

    Args:
        specs: ``(path, explicit name)`` per input, as ``split_h5_spec`` parses
            them. Inputs that are not HDF5 pass through with ``name=None`` but
            still count as inputs.
        command: The CLI command, for the corrected command line in the error.

    Raises:
        ValueError: If several inputs are given and an HDF5 one has no name.
    """
    resolved: list[NamedInput] = []
    unnamed: list[Path] = []
    for path, explicit in specs:
        if not (path.is_dir() or path.suffix.lower() in EMBEDDING_EXTENSIONS):
            resolved.append(NamedInput(path, None))
            continue
        if explicit:
            resolved.append(NamedInput(path, explicit))
            continue
        files = embedding_files(path)
        name = _resolve_model_name(files) if files else None
        if name:
            resolved.append(NamedInput(path, name))
            continue
        name = _model_from_file_names(files) or _model_from_file_name(path.stem)
        if name:
            logger.info(f"Embedding name '{name}' taken from the file name {path}")
            resolved.append(NamedInput(path, name, from_file_name=True))
            continue
        unnamed.append(path)
        resolved.append(NamedInput(path, None, from_file_name=True))

    if unnamed and len(specs) == 1:
        path = unnamed[0]
        where = "its file names" if path.is_dir() else "the file name"
        logger.info(
            f"No embedding name for {path} (no 'model_name' attribute, no known "
            f"model in {where}); using '{path.stem}'. "
            f"To name it, append the model: {path}:<model>, e.g. {path}:esm2_650m."
        )
        return [NamedInput(path, path.stem, from_file_name=True)]
    if unnamed:
        raise ValueError(_unnamed_inputs_message(specs, unnamed, command))
    return resolved


def _unnamed_inputs_message(
    specs: list[tuple[Path, str | None]], unnamed: list[Path], command: str
) -> str:
    if command == "project":
        why = "project labels each input's projections with its embedding name."
        hint = "; each input needs a different name"
    else:
        why = (
            "The name decides how inputs combine: inputs with the same name are "
            "merged (union of their proteins), inputs with different names are "
            "intersected (only proteins present in all of them)."
        )
        hint = "; give files from the same model the same name to merge them"
    args = " ".join(
        f"-i {path}:<model>"
        if path in unnamed
        else f"-i {path}:{name}"
        if name
        else f"-i {path}"
        for path, name in specs
    )
    return (
        f"No embedding name for {', '.join(str(p) for p in unnamed)}: no "
        f"'model_name' attribute and no known model at the end of the file name.\n"
        f"  {why}\n"
        f"  Fix: name each HDF5 input, e.g.\n"
        f"       protspace {command} {args} ...\n"
        f"  where <model> is the embedder that produced the file (esm2_650m, "
        f"prot_t5, ...){hint}."
    )


def load_h5(
    h5_files: list[Path],
    *,
    name_override: str | None = None,
) -> EmbeddingSet:
    """Load and merge HDF5 embedding files into an EmbeddingSet.

    Args:
        h5_files: Paths to HDF5 files to load and merge.
        name_override: Explicit name (takes precedence over everything else).
            Without one the name comes from the ``model_name`` attribute, then
            from a known model key the file names end in; a CLI command
            resolves it with ``resolve_input_names`` first and passes it here.

    Returns:
        EmbeddingSet with merged embeddings.

    Raises:
        ValueError: If no valid embeddings found, per-residue embeddings
            detected, or no name can be resolved.
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
                header = raw_key
                if header in seen_ids:
                    duplicates_count += 1
                    logger.debug(f"Skipping duplicate protein ID: {header}")
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

    # Resolve name: explicit > H5 attr > model key in the file names > error
    name = (
        name_override
        or _resolve_model_name(h5_files)
        or _model_from_file_names(h5_files)
    )
    if name is None:
        file_list = ", ".join(str(f) for f in h5_files)
        raise ValueError(
            f"HDF5 file has no 'model_name' attribute and its name ends in no known "
            f"model: {file_list}\n"
            f"  Fix: name the embedding after the model that produced it: "
            f"'<file>.h5:<model>' on the command line (e.g. :esm2_650m), or "
            f"load_h5(..., name_override='<model>') in Python."
        )

    return EmbeddingSet(name=name, data=arr, headers=headers)
