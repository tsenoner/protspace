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


def test_a_perplexity_above_50_is_accepted():
    DimensionReductionConfig(perplexity=51)
    DimensionReductionConfig(perplexity=500)
    with pytest.raises(ValueError, match="perplexity"):
        DimensionReductionConfig(perplexity=4)


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
    ("perplexity", "n", "expected"),
    [
        (30, 20, "perplexity 30 is not below the number of proteins (20)"),
        (20, 20, "perplexity 20 is not below the number of proteins (20)"),
        (30, 5, "t-SNE needs more than 5 proteins"),
    ],
)
def test_the_message_names_both_numbers(perplexity, n, expected):
    problem = tsne_perplexity_problem(perplexity, n)
    assert expected in problem
    if n > 5:
        assert f"(here {max(5, n // 3)})" in problem
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


def test_project_says_so_as_a_usage_error(tmp_path):
    import h5py

    h5 = tmp_path / "small.h5"
    with h5py.File(h5, "w") as f:
        for i, row in enumerate(_embeddings(20).data):
            f.create_dataset(f"P{i:05d}", data=row)
    # Wide, so Rich does not wrap the message inside its error box.
    result = CliRunner().invoke(
        app,
        ["project", "-i", f"{h5}:prot_t5", "-m", "tsne2", "-o", str(tmp_path / "out")],
        env={"COLUMNS": "1000"},
    )
    assert result.exit_code == 2
    assert "perplexity 30 is not below the number of proteins (20)" in result.output
