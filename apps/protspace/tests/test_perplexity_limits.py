"""t-SNE perplexity: a floor of 5, no fixed ceiling, and below the protein count.

The config refused anything above 50, although scikit-learn only needs the
perplexity below the number of samples; and that limit went unchecked, so the
default 30 on 20 proteins ended in scikit-learn's traceback after the embeddings
and annotations were done.
"""

from __future__ import annotations

import re
from dataclasses import fields
from pathlib import Path

import numpy as np
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.loaders.embedding_set import EmbeddingSet
from protspace.data.processors.pipeline import (
    PipelineConfig,
    ReducerParams,
    ReductionPipeline,
    check_method_params,
    parse_methods_arg,
)
from protspace.utils.constants import DimensionReductionConfig
from protspace.utils.reducers import TSNEReducer, tsne_perplexity_problem

GUIDE = Path(__file__).resolve().parents[3] / "docs" / "guide" / "python-cli.md"


def _embeddings(n: int) -> EmbeddingSet:
    data = np.random.default_rng(0).normal(size=(n, 8)).astype(np.float32)
    return EmbeddingSet("prot_t5", data, [f"P{i:05d}" for i in range(n)])


def test_the_guide_states_the_configs_range():
    (meta,) = [
        f.metadata for f in fields(DimensionReductionConfig) if f.name == "perplexity"
    ]
    assert dict(meta) == {"gte": 5}
    (row,) = [
        line for line in GUIDE.read_text().splitlines() if "`--perplexity`" in line
    ]
    assert "≥ 5" in row and "50" not in row
    assert "below the number of proteins" in row


@pytest.mark.parametrize(
    ("perplexity", "n", "expected", "hint"),
    [
        (30, 20, "perplexity 30 is not below the number of proteins (20)", "(here 6)"),
        (20, 20, "perplexity 20 is not below the number of proteins (20)", "(here 6)"),
        # No perplexity fits, so there is no value to suggest.
        (30, 5, "t-SNE needs more than 5 proteins", None),
    ],
)
def test_the_message_names_both_numbers(perplexity, n, expected, hint):
    problem = tsne_perplexity_problem(perplexity, n)
    assert expected in problem
    if hint is not None:
        assert hint in problem


def test_a_perplexity_below_the_count_passes():
    assert tsne_perplexity_problem(19, 20) is None


def test_the_reducer_refuses_it_without_a_traceback_from_sklearn():
    reducer = TSNEReducer(DimensionReductionConfig(perplexity=30))
    with pytest.raises(
        ValueError, match=re.escape("not below the number of proteins (20)")
    ):
        reducer.fit_transform(_embeddings(20).data)


def test_the_pipeline_refuses_it_before_fetching_annotations(tmp_path, monkeypatch):
    def fetched(*_a, **_k):
        raise AssertionError("annotations fetched before the perplexity was checked")

    monkeypatch.setattr(ReductionPipeline, "_fetch_annotations", fetched)
    pipeline = ReductionPipeline(
        PipelineConfig(
            methods=parse_methods_arg(["pca2", "tsne2"]), output_path=tmp_path / "x"
        )
    )
    with pytest.raises(ValueError, match=re.escape("perplexity 30 is not below")):
        pipeline.run([_embeddings(20)])


def test_a_per_method_override_is_checked_too():
    methods = parse_methods_arg(["tsne2:perplexity=60"])
    with pytest.raises(ValueError, match="perplexity 60"):
        check_method_params(methods, ReducerParams(), 50)
    check_method_params(methods, ReducerParams(), 300)
    # n_neighbors above the count is not refused: UMAP/PaCMAP lower it themselves.
    check_method_params(
        parse_methods_arg(["umap2:n_neighbors=25"]), ReducerParams(), 20
    )


@pytest.mark.parametrize(
    ("n", "methods", "expected", "option"),
    [
        (
            20,
            "tsne2",
            "perplexity 30 is not below the number of proteins (20)",
            "--perplexity",
        ),
        # The value came from -m, so --perplexity is not what to change.
        (20, "tsne2:perplexity=25", "perplexity 25 is not below", "-m/--methods"),
        (20, "tsne2:perplexity=10,tsne2", "perplexity 30 is not below", "--perplexity"),
        # No perplexity fits; t-SNE has to leave the methods.
        (4, "tsne2", "t-SNE needs more than 5 proteins", "-m/--methods"),
    ],
)
def test_project_says_so_as_a_usage_error(tmp_path, n, methods, expected, option):
    import h5py

    h5 = tmp_path / "small.h5"
    with h5py.File(h5, "w") as f:
        for i, row in enumerate(_embeddings(n).data):
            f.create_dataset(f"P{i:05d}", data=row)
    # Wide, so Rich does not wrap the message inside its error box.
    result = CliRunner().invoke(
        app,
        ["project", "-i", f"{h5}:prot_t5", "-m", methods, "-o", str(tmp_path / "out")],
        env={"COLUMNS": "1000"},
    )
    assert result.exit_code == 2
    # CI forces colour, and Rich styles the option name inside the phrase.
    output = re.sub(r"\x1b\[[0-9;]*m", "", result.output)
    assert expected in output
    assert f"Invalid value for '{option}'" in output


class _Embedded(Exception):
    """embed_fasta was reached."""


def _fasta(path: Path, ids) -> Path:
    path.write_text("".join(f">{pid}\nMKVLAAGIVG\n" for pid in ids))
    return path


def _prepare(tmp_path, monkeypatch, fastas):
    from protspace.data.loaders import fasta as fasta_loader

    def embed_fasta(*_a, **_kw):
        raise _Embedded

    monkeypatch.setattr(fasta_loader, "embed_fasta", embed_fasta)
    inputs = [arg for path in fastas for arg in ("-i", str(path))]
    return CliRunner().invoke(
        app,
        ["prepare", *inputs, "-m", "tsne2", "-o", str(tmp_path / "out")],
        env={"COLUMNS": "1000"},
    )


def test_prepare_refuses_it_before_embedding_a_fasta(tmp_path, monkeypatch):
    fasta = _fasta(tmp_path / "small.fasta", [f"P{i:05d}" for i in range(20)])

    result = _prepare(tmp_path, monkeypatch, [fasta])

    assert not isinstance(result.exception, _Embedded)
    assert result.exit_code == 2
    assert "perplexity 30 is not below the number of proteins (20)" in result.output


def test_prepare_counts_every_fasta_before_refusing(tmp_path, monkeypatch):
    """Inputs of one name are merged, so two FASTAs of 20 project 40 proteins,
    which perplexity 30 suits: no single file's count may refuse the run."""
    first = _fasta(tmp_path / "a.fasta", [f"P{i:05d}" for i in range(20)])
    second = _fasta(tmp_path / "b.fasta", [f"Q{i:05d}" for i in range(20)])

    result = _prepare(tmp_path, monkeypatch, [first, second])

    assert isinstance(result.exception, _Embedded)
