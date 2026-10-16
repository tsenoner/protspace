"""`prepare` names `--refetch` only when the run reused cached work.

The hint follows the "Using cached ..." warnings, so a fresh run into a new
output directory, which reuses nothing, must not print it. Read from
`result.output`: `setup_logging` replaces the root handlers, so caplog never
sees CLI logs.
"""

import re
from pathlib import Path
from types import SimpleNamespace

import h5py
import numpy as np
import pandas as pd
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.cli.common_options import REFETCH_SHORTHANDS, REFETCH_STAGES
from protspace.cli.prepare import _embed_all
from protspace.data.annotations.cache import fetch_annotations
from protspace.data.annotations.encoding import annotation_cache_version_attrs
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.cache_hits import record_cache_hits
from protspace.data.loaders.query import query_cache_path, resolve_query_fasta
from protspace.data.loaders.similarity import compute_similarity
from tests.cli_output import plain

HINT = "to recompute them, or --refetch all"


def _uniprot_row(identifier):
    return {
        "gene_name": f"G_{identifier}",
        "protein_name": f"Protein {identifier}",
        "uniprot_kb_id": f"{identifier}_HUMAN",
    }


def _serve_uniprot(monkeypatch):
    def fetch(retriever):
        retriever.releases = {"2026_03"}
        return [
            ProteinAnnotations(identifier=h, annotations=_uniprot_row(h))
            for h in retriever.headers
        ]

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)


def _inputs(tmp_path):
    h5_path = tmp_path / "emb.h5"
    rng = np.random.default_rng(0)
    headers = ["P1", "P2", "P3", "P4"]
    with h5py.File(h5_path, "w") as f:
        for h in headers:
            f.create_dataset(h, data=rng.normal(size=8).astype(np.float32))
    # CSV-only annotations: no UniProt fetch, so the projection cache is the
    # only cached work a rerun can reuse.
    csv_path = tmp_path / "labels.csv"
    pd.DataFrame({"identifier": headers, "group": list("aabb")}).to_csv(
        csv_path, index=False
    )
    return h5_path, csv_path


def _prepare(h5_path, annotations, output_dir, *extra, method="pca2"):
    result = CliRunner().invoke(
        app,
        [
            "prepare",
            "-i",
            f"{h5_path}:E",
            "-a",
            str(annotations),
            "-m",
            method,
            "-o",
            str(output_dir),
            "--no-log",
            *extra,
        ],
    )
    assert result.exit_code == 0, result.output
    return plain(result.output)


def test_fresh_run_prints_no_hint_and_rerun_does(tmp_path):
    h5_path, csv_path = _inputs(tmp_path)
    output_dir = tmp_path / "out"

    first = _prepare(h5_path, csv_path, output_dir)
    assert "cached" not in first
    assert HINT not in first

    second = _prepare(h5_path, csv_path, output_dir)
    assert "Using 1 cached projection" in second
    assert f"--refetch projections {HINT}" in second


def test_rerun_with_refetch_prints_no_hint(tmp_path):
    h5_path, csv_path = _inputs(tmp_path)
    output_dir = tmp_path / "out"
    _prepare(h5_path, csv_path, output_dir)

    rerun = _prepare(h5_path, csv_path, output_dir, "--refetch", "projections")
    assert "cached" not in rerun
    assert HINT not in rerun


def test_no_keep_tmp_rerun_prints_no_hint(tmp_path):
    h5_path, csv_path = _inputs(tmp_path)
    output_dir = tmp_path / "out"
    _prepare(h5_path, csv_path, output_dir, "--no-keep-tmp")

    assert HINT not in _prepare(h5_path, csv_path, output_dir, "--no-keep-tmp")


def test_rerun_reusing_only_the_annotation_cache_prints_the_hint(tmp_path, monkeypatch):
    _serve_uniprot(monkeypatch)
    h5_path, _ = _inputs(tmp_path)
    output_dir = tmp_path / "out"

    assert HINT not in _prepare(h5_path, "gene_name", output_dir)

    # Another projection, so the annotation cache is the only reuse.
    second = _prepare(h5_path, "gene_name", output_dir, method="pca3")
    assert "Using cached annotations" in second
    assert "cached projection" not in second
    assert f"--refetch annotations {HINT}" in second


class TestAnnotationCacheHits:
    """An annotation hit is a requested value served by the cache."""

    @staticmethod
    def _write_cache(path, identifiers, columns=("gene_name", "protein_name")):
        frame = pd.DataFrame(
            [
                {"identifier": i, **{c: _uniprot_row(i)[c] for c in columns}}
                for i in identifiers
            ]
        )
        frame.attrs = dict(annotation_cache_version_attrs())
        frame.to_parquet(path, index=False)

    @staticmethod
    def _hits(headers, annotations, path):
        hits = record_cache_hits()
        fetch_annotations(headers, annotations, cache_path=path)
        return hits

    def test_no_cache_file(self, tmp_path, monkeypatch):
        _serve_uniprot(monkeypatch)
        assert not self._hits(["P1"], ["gene_name"], tmp_path / "cache.parquet")

    def test_full_cache_hit(self, tmp_path, monkeypatch):
        path = tmp_path / "cache.parquet"
        self._write_cache(path, ["P1"])
        _serve_uniprot(monkeypatch)
        assert self._hits(["P1"], ["gene_name"], path) == ["annotations"]

    def test_fill_in_reuses_the_cached_rows(self, tmp_path, monkeypatch):
        path = tmp_path / "cache.parquet"
        self._write_cache(path, ["P1"])
        _serve_uniprot(monkeypatch)
        assert self._hits(["P1", "P2"], ["gene_name"], path) == ["annotations"]

    def test_a_source_fetched_again_is_not_reuse(self, tmp_path, monkeypatch):
        # The cache lacks protein_name, so UniProt is fetched for every
        # protein and the cached gene_name is replaced, not reused.
        path = tmp_path / "cache.parquet"
        self._write_cache(path, ["P1"], columns=("gene_name",))
        _serve_uniprot(monkeypatch)
        assert not self._hits(["P1"], ["gene_name", "protein_name"], path)

    def test_a_cache_without_the_runs_proteins_is_not_reuse(
        self, tmp_path, monkeypatch
    ):
        path = tmp_path / "cache.parquet"
        self._write_cache(path, ["P9"])
        _serve_uniprot(monkeypatch)
        assert not self._hits(["P1"], ["gene_name"], path)


def test_a_cached_query_fasta_is_a_hit(tmp_path):
    fasta = query_cache_path(tmp_path, "family:globin")
    fasta.parent.mkdir(parents=True)
    fasta.write_text(">sp|P1|A\nMKV\n")

    hits = record_cache_hits()
    resolve_query_fasta("family:globin", tmp_path, frozenset())
    assert hits == ["query"]


def test_a_cached_similarity_matrix_is_a_hit(tmp_path):
    np.save(tmp_path / "similarity_matrix.npy", np.eye(2))
    np.save(tmp_path / "similarity_headers.npy", np.array(["P1", "P2"]))

    hits = record_cache_hits()
    compute_similarity(tmp_path / "unused.fasta", ["P1", "P2"], cache_dir=tmp_path)
    assert hits == ["similarity"]


def test_cached_embeddings_are_a_hit(tmp_path, monkeypatch):
    import protspace.data.loaders.fasta as fasta_module

    # An embedding cache the stub leaves untouched, as a full resume does.
    (tmp_path / "prot_t5.h5").write_bytes(b"cached")
    monkeypatch.setattr(
        fasta_module, "embed_fasta", lambda *_a, **_kw: SimpleNamespace()
    )

    hits = record_cache_hits()
    _embed_all(["prot_t5"], tmp_path / "seq.fasta", tmp_path, None, [])
    assert hits == ["embed"]


def test_every_noted_stage_is_a_refetch_token():
    # The hint passes the noted stages to --refetch, so each must parse.
    src = Path(__file__).parents[1] / "src" / "protspace"
    noted = {
        stage
        for path in src.rglob("*.py")
        for stage in re.findall(r'note_cache_hit\("(\w+)"\)', path.read_text())
    }
    assert noted == {"query", "embed", "similarity", "annotations", "projections"}
    assert noted <= REFETCH_STAGES | set(REFETCH_SHORTHANDS)
