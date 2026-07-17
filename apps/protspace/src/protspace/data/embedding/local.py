"""Local (on-device / Colab-GPU) protein embedding backend.

A drop-in alternative to :mod:`protspace.data.embedding.biocentral` that
computes per-protein embeddings with a local GPU (or CPU) via HuggingFace
``transformers`` instead of the remote Biocentral API — so the pipeline keeps
working when Biocentral is down (issue #59).

``embed_sequences`` keeps the Biocentral function's positional signature and
HDF5 output contract (one float32 per-protein vector per dataset, resume-by-key),
so the rest of the pipeline (``load_h5`` → reduce/annotate/bundle) is unchanged
regardless of which backend produced the ``.h5``. One deliberate difference: its
``embedder`` argument is a *short key* (e.g. ``"prot_t5"``), resolved to a
checkpoint locally — not the full model name the Biocentral backend expects.

Torch and transformers are heavy and optional — they live in the ``[local]``
extra (``pip install "protspace[local]"``) and are imported lazily inside the
functions that need them, so importing this module stays cheap.

Checkpoint choices are deliberately aligned with the Biocentral path for output
consistency: ESM-C maps to Synthyra's ESM++ reimplementation (same weights as
native, MSE ~1e-9, ungated, loads via plain transformers), and ProtT5/ProstT5
use the fp16 encoder exports (T4-friendly, embedding-equivalent). The exact
numerical parity of local vs. Biocentral pooling is validated separately (a
cross-check script), not asserted here.
"""

import logging
import re
from dataclasses import dataclass
from difflib import get_close_matches
from pathlib import Path

import numpy as np
from tqdm import tqdm

from protspace.data.embedding.biocentral import load_existing_ids, save_embeddings

logger = logging.getLogger(__name__)

# Short key → (HuggingFace checkpoint, model family). Covers the same 12
# shortcuts as the Biocentral backend (ALL_SHORT_KEYS).
LOCAL_CHECKPOINTS: dict[str, tuple[str, str]] = {
    "prot_t5": ("Rostlab/prot_t5_xl_half_uniref50-enc", "prot_t5"),
    "prost_t5": ("Rostlab/ProstT5_fp16", "prost_t5"),
    "esm2_8m": ("facebook/esm2_t6_8M_UR50D", "esm"),
    "esm2_35m": ("facebook/esm2_t12_35M_UR50D", "esm"),
    "esm2_150m": ("facebook/esm2_t30_150M_UR50D", "esm"),
    "esm2_650m": ("facebook/esm2_t33_650M_UR50D", "esm"),
    "esm2_3b": ("facebook/esm2_t36_3B_UR50D", "esm"),
    "ankh_base": ("ElnaggarLab/ankh-base", "ankh"),
    "ankh_large": ("ElnaggarLab/ankh-large", "ankh"),
    "ankh3_large": ("ElnaggarLab/ankh3-large", "ankh"),
    "esmc_300m": ("Synthyra/ESMplusplus_small", "esmc"),
    "esmc_600m": ("Synthyra/ESMplusplus_large", "esmc"),
}

# Model families whose tokenizer wraps the sequence with a leading special
# token (CLS / <AA2fold>) as well as a trailing EOS. T5 encoders (ProtT5, Ankh)
# add only a trailing EOS.
_STRIP_BOTH_ENDS = frozenset({"esm", "esmc", "prost_t5"})

_RARE_RESIDUES = re.compile(r"[BJOUZ]")


@dataclass(frozen=True)
class LocalEmbedConfig:
    """Local-backend parameters.

    ``batch_size`` is a *GPU micro-batch* (how many sequences run through the
    model at once) — distinct from Biocentral's ``EmbedConfig.batch_size``,
    which is an API-request batch. It auto-halves on GPU OOM.
    """

    batch_size: int = 8
    max_length: int = 2000

    def __post_init__(self) -> None:
        if self.batch_size < 1:
            raise ValueError(f"batch_size must be >= 1, got {self.batch_size}")
        if self.max_length < 1:
            raise ValueError(f"max_length must be >= 1, got {self.max_length}")


# ---------------------------------------------------------------------------
# Pure helpers (torch-free)
# ---------------------------------------------------------------------------


def resolve_default_backend() -> str:
    """Pick the default embedding backend for the current environment.

    Returns ``"local"`` only inside a Google Colab runtime that also has a CUDA
    GPU available; otherwise ``"biocentral"``. Torch is optional, so its absence
    (or any probe failure) falls back to the remote backend.
    """
    import sys

    if "google.colab" not in sys.modules:
        return "biocentral"
    try:
        import torch

        if torch.cuda.is_available():
            return "local"
    except Exception:  # torch missing or CUDA probe failed
        pass
    return "biocentral"


def resolve_local_checkpoint(name: str) -> tuple[str, str]:
    """Resolve a short embedder key to ``(hf_checkpoint, model_family)``.

    Raises :class:`ValueError` (with close-match suggestions) for unknown keys.
    """
    if name in LOCAL_CHECKPOINTS:
        return LOCAL_CHECKPOINTS[name]

    close = get_close_matches(name, LOCAL_CHECKPOINTS.keys(), n=3, cutoff=0.5)
    msg = f"Unknown local embedder shortcut: '{name}'."
    if close:
        msg += f" Did you mean: {', '.join(close)}?"
    else:
        msg += f" Available: {', '.join(sorted(LOCAL_CHECKPOINTS))}"
    raise ValueError(msg)


def preprocess_sequence(seq: str, mod_type: str) -> str:
    """Prepare a raw amino-acid sequence for tokenization by *mod_type*.

    Maps rare residues (B, J, O, U, Z) to X, space-joins residues for the
    ProtT5/ProstT5 SentencePiece tokenizers, and prepends the ``<AA2fold>``
    control token for ProstT5.

    Ankh is deliberately NOT space-joined: its T5 vocab has bare single-AA
    tokens (``"M"``) but maps the word-start form (``"▁M"``) to ``<unk>``, so a
    raw string tokenizes to clean per-residue tokens whereas space-joining (or
    ``is_split_into_words=True``) injects a ``<unk>`` before every residue.
    (Exact pooling parity vs Biocentral is pinned in the PR3 cross-check.)
    """
    seq = _RARE_RESIDUES.sub("X", seq)
    if mod_type in ("prot_t5", "prost_t5"):
        seq = " ".join(seq)
    if mod_type == "prost_t5":
        seq = "<AA2fold> " + seq
    return seq


def pool_residues(hidden: np.ndarray, seq_len: int, mod_type: str) -> np.ndarray:
    """Mean-pool per-residue hidden states into one per-protein vector.

    *hidden* is ``(padded_len, dim)`` for a single sequence; *seq_len* is the
    number of real (non-padding) tokens including special tokens. Special
    tokens are stripped per family before pooling; right-padding beyond
    *seq_len* is ignored.
    """
    if mod_type in _STRIP_BOTH_ENDS:
        residues = hidden[1 : seq_len - 1]
    else:  # prot_t5, ankh — no leading special token, strip trailing EOS
        residues = hidden[: seq_len - 1]
    return residues.mean(axis=0).astype(np.float32)


def validate_headers(ids) -> None:
    """Raise :class:`ValueError` if any identifier contains ``/``.

    HDF5 treats ``/`` as a group separator, so it cannot appear in a dataset
    name.
    """
    bad = [i for i in ids if "/" in i]
    if bad:
        raise ValueError(
            "Header(s) contain '/', invalid for HDF5 dataset names: " + ", ".join(bad)
        )


# ---------------------------------------------------------------------------
# Model loading + inference (lazy torch/transformers)
# ---------------------------------------------------------------------------


def setup_model(checkpoint: str, mod_type: str):
    """Load ``(model, tokenizer, device)`` for *checkpoint* / *mod_type*."""
    import torch
    from transformers import (
        AutoModelForMaskedLM,
        AutoTokenizer,
        EsmModel,
        T5EncoderModel,
        T5Tokenizer,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Loading %s (%s) on %s", checkpoint, mod_type, device)

    if mod_type == "esm":
        tokenizer = AutoTokenizer.from_pretrained(checkpoint)
        model = EsmModel.from_pretrained(checkpoint)
    elif mod_type == "esmc":
        # Synthyra ESM++: custom modeling code, tokenizer attached to model.
        model = AutoModelForMaskedLM.from_pretrained(checkpoint, trust_remote_code=True)
        tokenizer = model.tokenizer
    elif mod_type == "ankh":
        tokenizer = AutoTokenizer.from_pretrained(checkpoint)
        model = T5EncoderModel.from_pretrained(checkpoint)
    elif mod_type in ("prot_t5", "prost_t5"):
        # fp16 on GPU (matches the half-precision checkpoints); fp32 on CPU,
        # where half-precision matmul is unsupported/slow.
        dtype = torch.float16 if device.type == "cuda" else torch.float32
        tokenizer = T5Tokenizer.from_pretrained(
            checkpoint, do_lower_case=(mod_type == "prot_t5")
        )
        model = T5EncoderModel.from_pretrained(checkpoint, torch_dtype=dtype)
    else:  # pragma: no cover - guarded by resolve_local_checkpoint
        raise ValueError(f"Unknown model family: {mod_type}")

    return model.to(device).eval(), tokenizer, device


def _embed_batch(
    processed: list[str], mod_type: str, model, tokenizer, device, max_length: int
) -> list[np.ndarray]:
    """Embed a batch of pre-processed sequences → list of per-protein vectors."""
    import torch

    if mod_type == "esmc":
        # ESM++'s custom tokenizer takes only the basic call signature.
        inputs = tokenizer(processed, return_tensors="pt", padding=True)
    else:
        inputs = tokenizer(
            processed,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=max_length + 2,  # room for the special tokens
            add_special_tokens=True,
        )
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.inference_mode():
        hidden = model(**inputs).last_hidden_state

    hidden_np = hidden.cpu().float().numpy()
    attn = inputs.get("attention_mask")
    if attn is not None:
        lengths = attn.sum(dim=1).tolist()
    else:  # fallback: assume no padding
        lengths = [hidden_np.shape[1]] * len(processed)

    return [
        pool_residues(hidden_np[j], int(lengths[j]), mod_type)
        for j in range(len(processed))
    ]


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def embed_sequences(
    sequences: dict[str, str],
    embedder: str,
    h5_path: Path,
    embed_config: LocalEmbedConfig | None = None,
) -> Path:
    """Embed *sequences* locally and append them to *h5_path*.

    Mirrors :func:`protspace.data.embedding.biocentral.embed_sequences`:
    resumes by skipping IDs already present, writes one float32 per-protein
    vector per dataset, and returns *h5_path*. *embedder* is a short key
    (e.g. ``"prot_t5"``); it is resolved to a HuggingFace checkpoint locally.
    """
    cfg = embed_config or LocalEmbedConfig()
    checkpoint, mod_type = resolve_local_checkpoint(embedder)
    validate_headers(sequences.keys())

    if embedder == "esm2_3b":
        logger.warning(
            "esm2_3b (3B params) may exceed a free Colab T4 (~15 GB VRAM). "
            "If it OOMs, switch to an L4/A100 runtime or a smaller model."
        )

    h5_path = Path(h5_path)
    existing = load_existing_ids(h5_path)
    remaining = {k: v for k, v in sequences.items() if k not in existing}
    if existing:
        logger.info("Resuming: %d already embedded in %s", len(existing), h5_path)

    # Drop sequences over the length cap; on-device attention is O(L^2) and
    # long sequences OOM. Unlike the Biocentral backend (no cap), name the
    # skipped IDs so the completeness difference is visible, not a bare count.
    too_long = {k for k, v in remaining.items() if len(v) > cfg.max_length}
    if too_long:
        preview = ", ".join(sorted(too_long)[:5])
        if len(too_long) > 5:
            preview += ", ..."
        logger.warning(
            "Skipping %d sequence(s) longer than max_length=%d aa: %s",
            len(too_long),
            cfg.max_length,
            preview,
        )
        remaining = {k: v for k, v in remaining.items() if k not in too_long}

    if remaining:
        import torch

        # Shortest-first: efficient padding, and once a batch OOMs we never
        # need to grow the batch size back.
        ordered_ids = sorted(remaining, key=lambda k: len(remaining[k]))
        logger.info("Embedding %d sequence(s) with %s", len(ordered_ids), embedder)

        model, tokenizer, device = setup_model(checkpoint, mod_type)
        try:
            i = 0
            bs = cfg.batch_size
            pbar = tqdm(total=len(ordered_ids), desc="Embedding", unit="seq")
            while i < len(ordered_ids):
                batch_ids = ordered_ids[i : i + bs]
                processed = [
                    preprocess_sequence(remaining[pid], mod_type) for pid in batch_ids
                ]
                try:
                    vecs = _embed_batch(
                        processed, mod_type, model, tokenizer, device, cfg.max_length
                    )
                    save_embeddings(h5_path, dict(zip(batch_ids, vecs, strict=True)))
                    i += bs
                    pbar.update(len(batch_ids))
                except torch.cuda.OutOfMemoryError:
                    torch.cuda.empty_cache()
                    if bs > 1:
                        bs = max(1, bs // 2)
                        logger.warning("GPU OOM — reducing batch size to %d", bs)
                    else:
                        logger.warning(
                            "Skipping %s (len=%d, OOM at batch_size=1)",
                            batch_ids[0],
                            len(remaining[batch_ids[0]]),
                        )
                        i += 1
                        pbar.update(1)
            pbar.close()
        finally:
            # Release GPU memory. The `del` must run in this frame (not a
            # helper) so the caller's references drop before empty_cache;
            # gc.collect() breaks the esmc tokenizer<->model reference cycle.
            import gc

            del model, tokenizer
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    # A finished .h5 must hold at least one embedding, else downstream load_h5
    # fails on an empty file. Fail loudly instead of returning a path to an
    # empty/absent file (every sequence too long, or all OOM-skipped).
    if not load_existing_ids(h5_path):
        raise ValueError(
            f"No embeddings were produced for {h5_path}: all {len(sequences)} "
            f"sequence(s) were skipped (longer than max_length={cfg.max_length} "
            f"aa, or GPU OOM at batch size 1)."
        )
    return h5_path
