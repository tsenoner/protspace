"""Shared HDF5 layer for the embedding backends.

Owned by neither backend: :mod:`protspace.data.embedding.biocentral` and
:mod:`protspace.data.embedding.local` both import from here, so "what counts as
a complete run" has one definition instead of one per backend.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Collection, Iterable, Mapping
from pathlib import Path

import h5py
import numpy as np

logger = logging.getLogger(__name__)

# Identifiers named in a message before it elides the rest.
_PREVIEW = 5

# Who produced the file, on the root, and which residues each vector was computed
# from, on its dataset. In the file rather than in its name because the name is a
# caller's choice and the contract belongs to the file: `protspace embed -o
# mine.h5` gets the same protection a managed cache does.
_BACKEND_ATTR = "protspace_backend"
_MODEL_ATTR = "protspace_model"
_DIGEST_ATTR = "protspace_sequence_sha256"

# Enough SHA-256 that two residue strings colliding is implausible, short enough
# that the attribute stays cheap across 570K proteins.
_DIGEST_CHARS = 16


def sequence_digest(sequence: str) -> str:
    """Return the residue digest stored alongside a protein's vector."""
    return hashlib.sha256(sequence.encode()).hexdigest()[:_DIGEST_CHARS]


def _current_ids(f: h5py.File, sequences: Mapping[str, str]) -> set[str]:
    """Identifiers in the open file whose vector matches the residues in hand.

    One pass over one open file: the digest lives in each dataset's attributes,
    and this runs per protein at up to 570K of them, so reopening the file for
    each would replace a seconds-long resume with 570K file opens.

    A protein carrying no digest predates them and is trusted — refusing it would
    force a full re-embed of every existing cache on upgrade.
    """
    current: set[str] = set()
    for pid, sequence in sequences.items():
        dataset = f.get(pid)
        if dataset is None:
            continue
        stored = dataset.attrs.get(_DIGEST_ATTR)
        if stored is None or str(stored) == sequence_digest(sequence):
            current.add(pid)
    return current


def load_existing_ids(h5_path: Path) -> set[str]:
    """Every dataset key in *h5_path*, without checking residue identity.

    Superseded by :func:`covered_ids`, which it delegates to, and kept as the
    name out-of-repo callers already import. Resume goes through
    :func:`begin_run` instead: a key on its own is no evidence the vector under
    it was computed from the residues this run holds.
    """
    return covered_ids(h5_path)


def covered_ids(h5_path: Path, sequences: Mapping[str, str] | None = None) -> set[str]:
    """Identifiers *h5_path* holds a usable vector for.

    Without *sequences* that is every dataset key. With them the answer is scoped
    to the identifiers in hand and excludes any whose stored residue digest
    disagrees: a protein whose sequence changed is on disk under residues that
    are no longer the ones being embedded, so counting it as covered would let a
    re-embed that never landed pass for a complete run.
    """
    h5_path = Path(h5_path)
    if not h5_path.exists():
        return set()
    with h5py.File(h5_path, "r") as f:
        if sequences is None:
            return set(f.keys())
        return _current_ids(f, sequences)


def begin_run(
    h5_path: Path,
    sequences: Mapping[str, str],
    *,
    backend: str,
    model: str,
) -> dict[str, str]:
    """Claim *h5_path* for *backend*/*model* and return what is left to embed.

    Resume matches on identifier alone, which is evidence of a reusable vector
    only once the file is known to have been written by this producer and each
    identifier still carries the residues its vector was computed from. Another
    producer's file is refused rather than extended -- both backends resume the
    same way, so mixing them is silent -- and a protein whose residues changed is
    outstanding work again.

    A file recording no producer predates the stamps: it is adopted and stamped,
    because refusing it would force a full re-embed of every existing cache.
    """
    h5_path = Path(h5_path)
    if not h5_path.exists():
        return dict(sequences)

    # Read-only first, so a file this run has no claim to is left exactly as it
    # was -- not extended, not truncated by an append-mode open.
    with h5py.File(h5_path, "r") as f:
        recorded_backend = f.attrs.get(_BACKEND_ATTR)
        recorded_model = f.attrs.get(_MODEL_ATTR)
        unstamped = recorded_backend is None and recorded_model is None
        if not unstamped and (str(recorded_backend), str(recorded_model)) != (
            backend,
            model,
        ):
            raise ValueError(
                f"{h5_path} holds embeddings produced by the "
                f"{recorded_backend} backend with model {recorded_model}, but "
                f"this run is {backend} with {model}. Resuming would mix two "
                f"models' vectors into one dataset. Select that backend and "
                f"model, choose another output path, or refetch the embeddings "
                f"(--refetch embed)."
            )
        current = _current_ids(f, sequences)

    if unstamped:
        logger.info(
            "Adopting %s: it records no producer, so this run stamps it as "
            "%s/%s. Use --refetch embed if it was produced by something else.",
            h5_path,
            backend,
            model,
        )
        with h5py.File(h5_path, "a") as f:
            f.attrs[_BACKEND_ATTR] = backend
            f.attrs[_MODEL_ATTR] = model

    remaining = {k: v for k, v in sequences.items() if k not in current}
    resumed = len(sequences) - len(remaining)
    if resumed:
        # Logged here rather than in each backend: both resume through this one
        # call, so the count and its wording stay the same whoever is embedding.
        logger.info(
            "Resuming %s: %d of %d already embedded, %d to go.",
            h5_path,
            resumed,
            len(sequences),
            len(remaining),
        )
    return remaining


def save_embeddings(
    h5_path: Path,
    embeddings: dict[str, np.ndarray],
    *,
    sequences: Mapping[str, str] | None = None,
    backend: str | None = None,
    model: str | None = None,
) -> None:
    """Append embeddings to an HDF5 file (one dataset per protein).

    An identifier already present is left alone -- that is what makes resume
    cheap -- unless *sequences* shows its vector was computed from different
    residues, in which case dataset and digest are both replaced.

    *backend* and *model* stamp a file that carries no producer yet. The stamp
    rides along with the vectors rather than living in a separate step, so an
    interrupted run's partial file is owned too, while a run that wrote nothing
    leaves no stamped-but-empty cache behind for the next run to resume from.
    """
    with h5py.File(h5_path, "a") as f:
        if backend is not None and f.attrs.get(_BACKEND_ATTR) is None:
            f.attrs[_BACKEND_ATTR] = backend
        if model is not None and f.attrs.get(_MODEL_ATTR) is None:
            f.attrs[_MODEL_ATTR] = model

        for protein_id, emb in embeddings.items():
            sequence = sequences.get(protein_id) if sequences else None
            digest = sequence_digest(sequence) if sequence is not None else None
            if protein_id in f:
                stored = f[protein_id].attrs.get(_DIGEST_ATTR)
                if digest is None or str(stored) == digest:
                    continue
                del f[protein_id]
            dataset = f.create_dataset(protein_id, data=emb.astype(np.float32))
            if digest is not None:
                dataset.attrs[_DIGEST_ATTR] = digest


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
    sequences: Mapping[str, str] | None = None,
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

    *sequences* makes that read residue-aware: a protein that was outstanding
    because its sequence changed is still on disk under its old residues, so
    without them its failed re-embed reads as covered.

    *context* is backend detail for the failure message (e.g. how many batches
    failed); *retry_hint* is the closing advice when nothing was produced.
    """
    skipped = dict(skipped or {})
    requested_ids = set(requested)
    expected = requested_ids - set(skipped)
    on_disk = covered_ids(h5_path, sequences)
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
