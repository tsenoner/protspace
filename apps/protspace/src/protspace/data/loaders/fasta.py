"""FASTA → embedding loader via Biocentral API.

Extracted from LocalProcessor._embed_fasta_to_h5.
"""

from __future__ import annotations

import logging
from collections.abc import Collection, Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from protspace.data.loaders.embedding_set import EmbeddingSet
from protspace.data.loaders.h5 import load_h5, parse_identifier

if TYPE_CHECKING:
    from protspace.data.embedding.biocentral import EmbedConfig
    from protspace.data.embedding.local import LocalEmbedConfig

logger = logging.getLogger(__name__)


def parse_fasta_normalized(fasta_path: Path) -> dict[str, str]:
    """Parse *fasta_path* into ``{normalized identifier: sequence}``.

    Header identifiers are remapped the same way H5 keys are
    (``sp|P12345|NAME`` -> ``P12345``) so the two always agree.
    """
    from protspace.data.io.fasta import parse_fasta

    return {
        parse_identifier(header): sequence
        for header, sequence in parse_fasta(fasta_path).items()
    }


def embed_fasta(
    fasta_path: Path,
    embedder: str,
    *,
    backend: str = "biocentral",
    embed_config: EmbedConfig | LocalEmbedConfig | None = None,
    embedding_cache: Path | None = None,
) -> EmbeddingSet:
    """Parse FASTA, embed via the chosen *backend*, return an EmbeddingSet.

    FASTA headers are parsed to extract UniProt accessions before embedding
    (regardless of backend), so H5 keys are clean identifiers (e.g. P12345
    instead of sp|P12345|NAME). The model_name attribute is written to H5 root
    attrs.

    *backend* is ``"biocentral"`` (remote API) or ``"local"`` (on-device GPU/CPU
    via the ``[local]`` extra). *embed_config* must match the backend
    (``EmbedConfig`` vs ``LocalEmbedConfig``); when None each backend uses its
    own default.
    """
    if backend not in ("biocentral", "local"):
        raise ValueError(f"Unknown backend {backend!r}; use 'local' or 'biocentral'.")

    from protspace.data.embedding.biocentral import derive_h5_cache_path

    # Keys are remapped: sp|P12345|NAME → P12345 (shared by both backends).
    sequences = parse_fasta_normalized(fasta_path)
    if not sequences:
        raise ValueError(f"No sequences found in {fasta_path}")

    if backend == "local":
        from protspace.data.embedding.local import embed_sequences

        # The local backend takes the short key and resolves it internally.
        model_id = embedder
    else:
        from protspace.data.embedding.biocentral import (
            embed_sequences,
            resolve_embedder,
        )

        # Biocentral wants the resolved full model name.
        model_id = resolve_embedder(embedder)

    h5_path = (
        Path(embedding_cache)
        if embedding_cache
        else derive_h5_cache_path(fasta_path, model_id)
    )

    h5_path = embed_sequences(
        sequences,
        model_id,
        h5_path,
        embed_config=embed_config,
    )

    # Write model_name attr to H5 so load_h5 can resolve it later
    import h5py

    with h5py.File(h5_path, "a") as f:
        f.attrs["model_name"] = embedder

    return _restrict_to(load_h5([h5_path], name_override=embedder), sequences)


def _restrict_to(embedding_set: EmbeddingSet, wanted: Collection[str]) -> EmbeddingSet:
    """Drop rows for proteins outside *wanted*, keeping the loaded row order.

    The embedding cache legitimately accumulates proteins across inputs — that is
    what makes resume work — so what a run is about is decided by the FASTA in
    hand rather than by everything the cache has ever held. Returning the
    accumulation unions unrelated datasets into one bundle.

    Identifiers go through ``parse_identifier`` because a cache written elsewhere
    may be keyed ``sp|P12345|NAME`` while the FASTA-derived keys are parsed.
    """
    requested = set(wanted)
    keep = [
        i
        for i, header in enumerate(embedding_set.headers)
        if parse_identifier(header) in requested
    ]
    if len(keep) == len(embedding_set.headers):
        return embedding_set

    logger.info(
        "Returning %d of %d cached protein(s): the rest belong to other inputs "
        "sharing this embedding cache.",
        len(keep),
        len(embedding_set.headers),
    )
    embedding_set.data = embedding_set.data[keep]
    embedding_set.headers = [embedding_set.headers[i] for i in keep]
    return embedding_set


def check_fasta_coverage(
    fasta_path: Path,
    headers: Iterable[str],
    *,
    required: bool = False,
) -> None:
    """Report embedded proteins that *fasta_path* does not cover.

    Directional on purpose. A FASTA covering MORE than the embeddings is routine
    -- a resumed embedding cache legitimately holds fewer proteins than the FASTA
    it was built from -- and the extra entries are simply unused downstream.

    The other direction is damaging. ``compute_similarity`` zero-fills the row
    for a protein it cannot find, leaving that protein's self-similarity at 0,
    and the similarity-to-distance conversion only fires when the WHOLE diagonal
    is 1. One uncovered protein therefore suppresses the conversion for every
    pair and inverts the entire MDS projection -- so under ``--similarity`` this
    is an error, not a warning.

    Both sides go through ``parse_identifier``: ``load_h5`` keeps raw HDF5 keys
    while FASTA-derived identifiers are always parsed, so comparing them raw
    would report every protein uncovered for a ``sp|...``-keyed file.
    """
    from protspace.data.io.fasta import parse_fasta

    fasta_ids = {parse_identifier(h) for h in parse_fasta(fasta_path)}
    embedded = {parse_identifier(h) for h in headers}
    uncovered = embedded - fasta_ids
    if not uncovered:
        return

    ordered = sorted(uncovered)
    preview = ", ".join(ordered[:5]) + (", ..." if len(ordered) > 5 else "")
    detail = (
        f"{len(uncovered):,} of {len(embedded):,} embedded protein(s) are absent "
        f"from {fasta_path}: {preview}"
    )
    if required:
        raise ValueError(
            f"{detail}. Similarity needs every embedded protein present in the "
            f"FASTA: an uncovered protein leaves its self-similarity at 0, which "
            f"suppresses the similarity-to-distance conversion for the whole "
            f"matrix and inverts the projection. Supply a FASTA that covers them, "
            f"or drop -s/--similarity."
        )
    logger.warning("%s", detail)
