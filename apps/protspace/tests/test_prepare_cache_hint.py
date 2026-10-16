"""`prepare` names `--refetch` only when the run reused cached work.

The hint follows the "Using cached ..." warnings, so a fresh run into a new
output directory, which reuses nothing, must not print it. Read from
`result.output`: `setup_logging` replaces the root handlers, so caplog never
sees CLI logs.
"""

import h5py
import numpy as np
import pandas as pd
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.cache import fetch_annotations
from protspace.data.annotations.encoding import annotation_cache_version_attrs
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)

HINT = "--refetch all to recompute everything"


def _uniprot_row(identifier):
    return {
        "gene_name": f"G_{identifier}",
        "protein_name": f"Protein {identifier}",
        "uniprot_kb_id": f"{identifier}_HUMAN",
    }


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
    return CliRunner().invoke(
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
        env={"COLUMNS": "1000"},
    )


def test_fresh_run_prints_no_hint_and_rerun_does(tmp_path):
    h5_path, csv_path = _inputs(tmp_path)
    output_dir = tmp_path / "out"

    first = _prepare(h5_path, csv_path, output_dir)
    assert first.exit_code == 0, first.output
    assert "cached" not in first.output
    assert HINT not in first.output

    second = _prepare(h5_path, csv_path, output_dir)
    assert second.exit_code == 0, second.output
    assert "Using 1 cached projection" in second.output
    assert HINT in second.output


def test_rerun_with_refetch_prints_no_hint(tmp_path):
    h5_path, csv_path = _inputs(tmp_path)
    output_dir = tmp_path / "out"
    assert _prepare(h5_path, csv_path, output_dir).exit_code == 0

    rerun = _prepare(h5_path, csv_path, output_dir, "--refetch", "projections")
    assert rerun.exit_code == 0, rerun.output
    assert "cached" not in rerun.output
    assert HINT not in rerun.output


def test_no_keep_tmp_rerun_prints_no_hint(tmp_path):
    h5_path, csv_path = _inputs(tmp_path)
    output_dir = tmp_path / "out"
    assert _prepare(h5_path, csv_path, output_dir, "--no-keep-tmp").exit_code == 0

    rerun = _prepare(h5_path, csv_path, output_dir, "--no-keep-tmp")
    assert rerun.exit_code == 0, rerun.output
    assert HINT not in rerun.output


def test_rerun_reusing_only_the_annotation_cache_prints_the_hint(tmp_path, monkeypatch):
    def fetch(retriever):
        retriever.releases = {"2026_03"}
        return [
            ProteinAnnotations(identifier=h, annotations=_uniprot_row(h))
            for h in retriever.headers
        ]

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)
    h5_path, _ = _inputs(tmp_path)
    output_dir = tmp_path / "out"

    first = _prepare(h5_path, "gene_name", output_dir)
    assert first.exit_code == 0, first.output
    assert HINT not in first.output

    # Another projection, so the annotation cache is the only reuse.
    second = _prepare(h5_path, "gene_name", output_dir, method="pca3")
    assert second.exit_code == 0, second.output
    assert "Using cached annotations" in second.output
    assert "cached projection" not in second.output
    assert HINT in second.output


class TestAnnotationFetchFromCache:
    """`AnnotationFetch.from_cache`: requested values served by the cache."""

    @staticmethod
    def _serve(monkeypatch):
        def fetch(retriever):
            return [
                ProteinAnnotations(identifier=h, annotations=_uniprot_row(h))
                for h in retriever.headers
            ]

        monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)

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

    def test_no_cache_file(self, tmp_path, monkeypatch):
        self._serve(monkeypatch)
        fetched = fetch_annotations(
            ["P1"], ["gene_name"], cache_path=tmp_path / "cache.parquet"
        )
        assert not fetched.from_cache

    def test_full_cache_hit(self, tmp_path, monkeypatch):
        path = tmp_path / "cache.parquet"
        self._write_cache(path, ["P1"])
        self._serve(monkeypatch)
        assert fetch_annotations(["P1"], ["gene_name"], cache_path=path).from_cache

    def test_fill_in_reuses_the_cached_rows(self, tmp_path, monkeypatch):
        path = tmp_path / "cache.parquet"
        self._write_cache(path, ["P1"])
        self._serve(monkeypatch)
        fetched = fetch_annotations(["P1", "P2"], ["gene_name"], cache_path=path)
        assert fetched.from_cache

    def test_a_source_fetched_again_is_not_reuse(self, tmp_path, monkeypatch):
        # The cache lacks protein_name, so UniProt is fetched for every
        # protein and the cached gene_name is replaced, not reused.
        path = tmp_path / "cache.parquet"
        self._write_cache(path, ["P1"], columns=("gene_name",))
        self._serve(monkeypatch)
        fetched = fetch_annotations(
            ["P1"], ["gene_name", "protein_name"], cache_path=path
        )
        assert not fetched.from_cache

    def test_a_cache_without_the_runs_proteins_is_not_reuse(
        self, tmp_path, monkeypatch
    ):
        path = tmp_path / "cache.parquet"
        self._write_cache(path, ["P9"])
        self._serve(monkeypatch)
        assert not fetch_annotations(["P1"], ["gene_name"], cache_path=path).from_cache
