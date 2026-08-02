"""Shared Typer option type aliases for CLI commands.

Import these in any CLI command to avoid duplicating option definitions.
"""

import importlib.util
from enum import StrEnum
from pathlib import Path
from typing import Annotated

import typer


class Metric(StrEnum):
    euclidean = "euclidean"
    cosine = "cosine"
    manhattan = "manhattan"


class ClusterSelection(StrEnum):
    """How `--stats` chooses the cluster count K."""

    elbow = "elbow"  # inertia elbow (default)
    silhouette = "silhouette"  # max-silhouette K
    both = "both"  # emit both clusterings


class Backend(StrEnum):
    """Which engine computes the embeddings from FASTA sequences."""

    biocentral = "biocentral"  # remote Biocentral API (default)
    local = "local"  # on-device GPU/CPU via transformers ([local] extra)


# ---------------------------------------------------------------------------
# Embedder help text, shared by `prepare -e` and `embed -e`
# ---------------------------------------------------------------------------

# Mirrors ALL_SHORT_KEYS in data.embedding.biocentral, which is not imported
# here because it pulls h5py/numpy/biocentral_api (~400 ms) into every CLI
# startup, including `--help`. test_cli_no_similarity.py fails if they drift.
EMBEDDER_MODELS: tuple[str, ...] = (
    "prot_t5",
    "prost_t5",
    "esm2_8m",
    "esm2_35m",
    "esm2_150m",
    "esm2_650m",
    "esm2_3b",
    "ankh_base",
    "ankh_large",
    "ankh3_large",
    "esmc_300m",
    "esmc_600m",
)
EMBEDDER_HELP_MODELS = f"Models: {', '.join(EMBEDDER_MODELS)}."
EMBEDDER_HELP_LICENSE = "Note: ankh_* and ankh3_* are non-commercial (CC-BY-NC-SA-4.0)."


# ---------------------------------------------------------------------------
# Shared option types
# ---------------------------------------------------------------------------

Opt_Verbose = Annotated[
    int,
    typer.Option(
        "-v",
        "--verbose",
        count=True,
        help="Verbosity: -v=INFO, -vv=DEBUG.",
        show_default=False,
    ),
]

# Projection options (shared by prepare and project)
Opt_Methods = Annotated[
    list[str] | None,
    typer.Option(
        "-m",
        "--methods",
        help=(
            "DR methods. Comma-sep or repeat: -m pca2,umap2 or -m pca2 -m umap2. "
            "Inline params: -m 'umap2:n_neighbors=50;min_dist=0.1'."
        ),
        rich_help_panel="Projection",
    ),
]
Opt_Similarity = Annotated[
    bool,
    typer.Option(
        "-s",
        "--similarity",
        # `\[` escapes the bracket for Rich, which otherwise eats it as markup.
        help="Compute sequence similarity DR via MMseqs2 (\\[similarity] extra).",
        rich_help_panel="Projection",
    ),
]


def require_similarity_extra() -> None:
    """Fail fast when `-s/--similarity` is used without the `similarity` extra.

    Checked in the CLI layer rather than at the `pymmseqs` import site so the
    user hears about it before any embedding work runs, and as a clean
    `Error:` line rather than a traceback.
    """
    if importlib.util.find_spec("pymmseqs") is None:
        raise typer.BadParameter(
            'MMseqs2 is not installed. Install it with: pip install "protspace[similarity]"',
            param_hint="-s/--similarity",
        )


Opt_Metric = Annotated[
    Metric,
    typer.Option(help="Distance metric for UMAP/t-SNE.", rich_help_panel="Projection"),
]
Opt_RandomState = Annotated[
    int,
    typer.Option(help="Random seed.", rich_help_panel="Projection"),
]
Opt_NNeighbors = Annotated[
    int,
    typer.Option(
        help="UMAP/PaCMAP/LocalMAP neighbors. Larger=more global.",
        rich_help_panel="Projection",
        min=2,
    ),
]
Opt_MinDist = Annotated[
    float,
    typer.Option(
        help="UMAP min distance.", rich_help_panel="Projection", min=0.0, max=0.99
    ),
]
Opt_Perplexity = Annotated[
    float,
    typer.Option(
        help="t-SNE perplexity. Should be < n_samples/3.",
        rich_help_panel="Projection",
        min=5.0,
    ),
]
Opt_LearningRate = Annotated[
    float,
    typer.Option(help="t-SNE learning rate.", rich_help_panel="Projection", min=1.0),
]
Opt_MnRatio = Annotated[
    float,
    typer.Option(
        help="PaCMAP/LocalMAP mid-near ratio.",
        rich_help_panel="Projection",
        min=0.0,
        max=1.0,
    ),
]
Opt_FpRatio = Annotated[
    float,
    typer.Option(
        help="PaCMAP/LocalMAP further ratio.",
        rich_help_panel="Projection",
        min=0.0,
    ),
]
Opt_NInit = Annotated[
    int,
    typer.Option(help="MDS initializations.", rich_help_panel="Projection", min=1),
]
Opt_MaxIter = Annotated[
    int,
    typer.Option(help="MDS max iterations.", rich_help_panel="Projection", min=1),
]
Opt_Eps = Annotated[
    float,
    typer.Option(help="MDS convergence tolerance.", rich_help_panel="Projection"),
]

# Embedding options (shared by prepare and embed)
Opt_Backend = Annotated[
    Backend,
    typer.Option(
        "-b",
        "--backend",
        help=(
            "Embedding engine: 'biocentral' (remote API, default) or 'local' "
            "(on-device GPU/CPU; needs `pip install protspace\\[local]`)."
        ),
        rich_help_panel="Embedding",
    ),
]

Opt_BatchSize = Annotated[
    int | None,
    typer.Option(
        min=1,
        help=(
            "Sequences per batch. Backend default when unset: 1000 "
            "(Biocentral API call) or 8 (local GPU micro-batch)."
        ),
        rich_help_panel="Embedding",
    ),
]

# Input options (shared by prepare and project)
Opt_Fasta = Annotated[
    Path | None,
    typer.Option(
        "-f",
        "--fasta",
        help="FASTA for -s/--similarity when input is HDF5.",
        rich_help_panel="Input",
    ),
]
