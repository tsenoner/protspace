"""Shared HDF5 layer for the embedding backends.

Owned by neither backend: :mod:`protspace.data.embedding.biocentral` and
:mod:`protspace.data.embedding.local` both import from here, so "what counts as
a complete run" has one definition instead of one per backend.
"""

from __future__ import annotations

import logging
from collections.abc import Collection, Iterable, Mapping
from pathlib import Path

import h5py
import numpy as np

logger = logging.getLogger(__name__)

# Identifiers named in a message before it elides the rest.
_PREVIEW = 5


def load_existing_ids(h5_path: Path) -> set[str]:
    """Return the set of dataset keys already present in *h5_path*."""
    if not h5_path.exists():
        return set()
    with h5py.File(h5_path, "r") as f:
        return set(f.keys())


def save_embeddings(h5_path: Path, embeddings: dict[str, np.ndarray]) -> None:
    """Append embeddings to an HDF5 file (one dataset per protein)."""
    with h5py.File(h5_path, "a") as f:
        for protein_id, emb in embeddings.items():
            if protein_id not in f:
                f.create_dataset(protein_id, data=emb.astype(np.float32))


def validate_headers(ids: Iterable[str]) -> None:
    """Raise :class:`ValueError` if any identifier contains ``/``.

    HDF5 treats ``/`` as a group separator, so such an identifier silently
    becomes a group rather than a dataset and the requested key never exists.
    Both backends call this before doing any work: detecting it afterwards costs
    a full embedding run and reports a shortfall it cannot explain.
    """
    bad = [i for i in ids if "/" in i]
    if bad:
        raise ValueError(
            "Header(s) contain '/', invalid for HDF5 dataset names: " + preview_ids(bad)
        )


def preview_ids(ids: Iterable[str]) -> str:
    """Comma-join *ids*, naming at most ``_PREVIEW`` of them."""
    ordered = sorted(ids)
    shown = ", ".join(ordered[:_PREVIEW])
    return f"{shown}, ..." if len(ordered) > _PREVIEW else shown


def finish_run(
    h5_path: Path,
    requested: Collection[str],
    *,
    skipped: Mapping[str, str] | None = None,
    context: str = "",
    retry_hint: str = "",
) -> Path:
    """Report the run, and raise unless *h5_path* covers everything expected.

    *skipped* maps identifier -> reason for sequences a backend deliberately did
    not attempt because of a documented capability limit (over the length cap,
    GPU OOM at batch size 1). Those are reported but never fail the run: a
    capability limit is not a failure. Everything else absent from the file is.

    The check reads the file rather than a running total. ``save_embeddings``
    skips identifiers already present, so a counter can claim sequences the file
    does not hold.

    *context* is backend detail for the failure message (e.g. how many batches
    failed); *retry_hint* is the closing advice when nothing was produced.
    """
    skipped = dict(skipped or {})
    requested_ids = set(requested)
    expected = requested_ids - set(skipped)
    on_disk = load_existing_ids(h5_path)
    missing = expected - on_disk
    embedded = len(expected) - len(missing)

    if skipped:
        by_reason: dict[str, list[str]] = {}
        for pid, reason in skipped.items():
            by_reason.setdefault(reason, []).append(pid)
        for reason, ids in sorted(by_reason.items()):
            logger.warning(
                "Skipped %d sequence(s) — %s: %s",
                len(ids),
                reason,
                preview_ids(ids),
            )

    if missing:
        detail = (
            f"{embedded:,} of {len(expected):,} outstanding sequence(s) embedded, "
            f"{len(missing):,} still missing"
        )
        if context:
            detail += f" ({context})"
        if embedded == 0:
            raise ValueError(
                f"No new embeddings were produced for {h5_path}: {detail}. "
                f"{retry_hint or 'Rerun to retry.'}"
            )
        raise ValueError(
            f"Embedding incomplete for {h5_path}: {detail}. "
            f"Partial results were kept — rerun to embed only what is missing."
        )

    # Everything we meant to attempt is present. A run that skipped its way to an
    # empty file still produced nothing usable, so it is a failure, not a success.
    # An empty request is not that case -- it means resume already covered it all.
    if requested_ids and not requested_ids & on_disk:
        raise ValueError(
            f"No new embeddings were produced for {h5_path}: all "
            f"{len(requested_ids):,} sequence(s) were skipped "
            f"({preview_ids(set(skipped.values()))})."
        )

    print(
        f"\nDone. Embedded {embedded:,} sequence(s)"
        + (f", skipped {len(skipped):,}" if skipped else "")
        + "."
    )
    print(f"Output: {h5_path}")
    return h5_path
