"""Biocentral API embedding logic."""

import logging
import sys
import time
import warnings
from dataclasses import dataclass
from difflib import get_close_matches
from pathlib import Path

import h5py
import numpy as np
from biocentral_api import BiocentralAPI, CommonEmbedder, batched
from tqdm import tqdm

logger = logging.getLogger(__name__)

# Short aliases → CommonEmbedder enum member names.
MODEL_SHORT_KEYS: dict[str, str] = {
    "prot_t5": "ProtT5",
    "prost_t5": "ProstT5",
    "esm2_8m": "ESM_8M",
    "esm2_650m": "ESM2_650M",
    "esm2_3b": "ESM2_3B",
}

# Extra models not in CommonEmbedder — short key → full HuggingFace name.
EXTRA_SHORT_KEYS: dict[str, str] = {
    "esm2_35m": "facebook/esm2_t12_35M_UR50D",
    "esm2_150m": "facebook/esm2_t30_150M_UR50D",
    "ankh_base": "ElnaggarLab/ankh-base",
    "ankh_large": "ElnaggarLab/ankh-large",
    "ankh3_large": "ElnaggarLab/ankh3-large",
    "esmc_300m": "Synthyra/ESMplusplus_small",
    "esmc_600m": "Synthyra/ESMplusplus_large",
}

# Combined lookup for help text and error messages.
ALL_SHORT_KEYS: dict[str, str] = {**MODEL_SHORT_KEYS, **EXTRA_SHORT_KEYS}

DEFAULT_EMBEDDER = "prot_t5"


@dataclass(frozen=True)
class EmbedConfig:
    """Embedding parameters for Biocentral API calls."""

    batch_size: int = 1000


# Reverse lookup: full model name → short key
_FULL_TO_SHORT: dict[str, str] = {
    CommonEmbedder[v].value: k for k, v in MODEL_SHORT_KEYS.items()
} | {v: k for k, v in EXTRA_SHORT_KEYS.items()}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def resolve_embedder(name: str) -> str:
    """Resolve a short alias to the full embedder name.

    Checks ``MODEL_SHORT_KEYS`` (CommonEmbedder models), then
    ``EXTRA_SHORT_KEYS`` (arbitrary HuggingFace models), then enum
    member names, then raw values.  Raises :class:`SystemExit` with
    suggestions if the name is unrecognised.
    """
    if name in MODEL_SHORT_KEYS:
        full = CommonEmbedder[MODEL_SHORT_KEYS[name]].value
        logger.info("Resolved embedder '%s' → '%s'", name, full)
        return full

    # Extra models (not in CommonEmbedder enum)?
    if name in EXTRA_SHORT_KEYS:
        full = EXTRA_SHORT_KEYS[name]
        logger.info("Resolved embedder '%s' → '%s'", name, full)
        return full

    # Direct enum member name?
    try:
        return CommonEmbedder[name].value
    except KeyError:
        pass

    # Already a full model value?
    known_values = {e.value for e in CommonEmbedder} | set(EXTRA_SHORT_KEYS.values())
    if name in known_values:
        return name

    # Unknown — suggest close matches.
    close = get_close_matches(name, ALL_SHORT_KEYS.keys(), n=3, cutoff=0.5)
    msg = f"Unknown embedder shortcut: '{name}'"
    if close:
        msg += f". Did you mean: {', '.join(close)}?"
    else:
        msg += f". Available shortcuts: {', '.join(sorted(ALL_SHORT_KEYS))}"
    print(msg, file=sys.stderr)
    sys.exit(1)


def derive_h5_cache_path(fasta_path: Path, embedder: str) -> Path:
    """Derive default HDF5 cache path: ``{stem}_{short_key}.h5`` next to FASTA."""
    short = _FULL_TO_SHORT.get(embedder, embedder.replace("/", "_"))
    return fasta_path.with_name(f"{fasta_path.stem}_{short}.h5")


# ---------------------------------------------------------------------------
# HDF5 helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------


def embed_sequences(
    sequences: dict[str, str],
    embedder: str,
    h5_path: Path,
    embed_config: EmbedConfig | None = None,
) -> Path:
    """Embed *sequences* via Biocentral API and write to *h5_path*.

    Supports deduplication, length-sorting, batching, resume (skips IDs
    already present in *h5_path*), and a tqdm progress bar.

    Returns the path to the completed HDF5 file.
    """
    cfg = embed_config or EmbedConfig()

    # Resume: skip already-embedded sequences
    existing_ids = load_existing_ids(h5_path)
    if existing_ids:
        logger.info("Found %d existing embeddings in %s", len(existing_ids), h5_path)
    remaining = {k: v for k, v in sequences.items() if k not in existing_ids}
    logger.info(
        "Remaining sequences to embed: %d (skipped %d)",
        len(remaining),
        len(sequences) - len(remaining),
    )

    if not remaining:
        logger.info(
            "All %s sequences already embedded in %s",
            f"{len(sequences):,}",
            h5_path,
        )
        return h5_path

    # Deduplicate sequences (API rejects batches with duplicate sequences)
    seq_to_ids: dict[str, list[str]] = {}
    for pid, seq in remaining.items():
        seq_to_ids.setdefault(seq, []).append(pid)

    n_duplicates = len(remaining) - len(seq_to_ids)
    if n_duplicates:
        logger.info(
            "Found %d duplicate sequence(s) across %d proteins "
            "→ %d unique sequences to embed",
            n_duplicates,
            len(remaining),
            len(seq_to_ids),
        )

    # One representative ID per unique sequence
    unique_seqs = {ids[0]: seq for seq, ids in seq_to_ids.items()}

    # Sort by length to reduce padding waste
    unique_ids = sorted(unique_seqs.keys(), key=lambda pid: len(unique_seqs[pid]))
    logger.info(
        "Sorted %d unique sequences by length (range: %d–%d aa)",
        len(unique_ids),
        len(unique_seqs[unique_ids[0]]),
        len(unique_seqs[unique_ids[-1]]),
    )

    # Connect to Biocentral
    logger.info("Connecting to Biocentral server...")
    api = BiocentralAPI(fixed_server_url="https://biocentral.rostlab.org")
    api = api.wait_until_healthy(max_wait_seconds=30)
    logger.info("Server is healthy")

    # Batch and embed
    api_batches = list(batched(unique_ids, batch_size_limit=cfg.batch_size))
    total_embedded = 0
    failed_batches = 0

    pbar = tqdm(total=len(remaining), desc="Embedding", unit="seq")

    for batch_idx, batch_ids in enumerate(api_batches):
        batch_seqs = {pid: unique_seqs[pid] for pid in batch_ids}

        try:
            with warnings.catch_warnings():
                warnings.filterwarnings(
                    "ignore",
                    message=".*longer than the recommended.*",
                    category=UserWarning,
                )
                result = api.embed(
                    embedder_name=embedder,
                    sequence_data=batch_seqs,
                    reduce=True,
                ).run()

            if result is not None:
                emb_dict = result.to_dict()
                if emb_dict:
                    # Expand embeddings to all IDs sharing the same sequence
                    expanded: dict[str, np.ndarray] = {}
                    for rep_id, emb in emb_dict.items():
                        seq = unique_seqs[rep_id]
                        for pid in seq_to_ids[seq]:
                            expanded[pid] = emb
                    save_embeddings(h5_path, expanded)
                    total_embedded += len(expanded)

                    missing_reps = set(batch_seqs) - set(emb_dict)
                    if missing_reps:
                        logger.warning(
                            "Batch %d: %d unique sequence(s) missing from response",
                            batch_idx + 1,
                            len(missing_reps),
                        )
            else:
                failed_batches += 1
                logger.error(
                    "Batch %d/%d: API returned None",
                    batch_idx + 1,
                    len(api_batches),
                )

            # Count all proteins covered by this batch (including duplicates)
            batch_protein_count = sum(
                len(seq_to_ids[unique_seqs[pid]]) for pid in batch_ids
            )
            pbar.update(batch_protein_count)

        except Exception:
            failed_batches += 1
            logger.exception(
                "Batch %d/%d failed (%d seqs)",
                batch_idx + 1,
                len(api_batches),
                len(batch_ids),
            )
            batch_protein_count = sum(
                len(seq_to_ids[unique_seqs[pid]]) for pid in batch_ids
            )
            pbar.update(batch_protein_count)

        # Small delay between batches
        if batch_idx < len(api_batches) - 1:
            time.sleep(1)

    pbar.close()

    # Summary
    print(f"\nDone. Embedded {total_embedded:,} / {len(remaining):,} sequences.")
    if failed_batches:
        print(f"Failed batches: {failed_batches} (rerun to retry)")
    print(f"Output: {h5_path}")

    return h5_path


def probe_embedder(
    sequences: dict[str, str],
    embedder: str,
) -> None:
    """Submit 2 sequences as a probe and print the result summary."""
    probe_seqs = dict(list(sequences.items())[:2])
    print(f"Probe: submitting {len(probe_seqs)} sequence(s) with {embedder}")
    for pid, seq in probe_seqs.items():
        print(f"  {pid}: {seq[:40]}{'...' if len(seq) > 40 else ''} ({len(seq)} aa)")

    api = BiocentralAPI(fixed_server_url="https://biocentral.rostlab.org")
    api = api.wait_until_healthy(max_wait_seconds=30)

    result = api.embed(
        embedder_name=embedder,
        sequence_data=probe_seqs,
        reduce=True,
    ).run_with_progress()

    if result is None:
        print("ERROR: API returned no result (task may have failed)")
        sys.exit(1)

    emb_dict = result.to_dict()
    print(f"\nReceived {len(emb_dict)} embedding(s):")
    for pid, emb in emb_dict.items():
        print(
            f"  {pid}: shape={emb.shape}, dtype={emb.dtype}, "
            f"range=[{emb.min():.4f}, {emb.max():.4f}]"
        )
