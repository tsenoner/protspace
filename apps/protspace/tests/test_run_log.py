"""The UniProt release behind a run's annotations: on the cache and in run.log.

The release is read from the `X-UniProt-Release` header of the UniProt
responses, which `UniProtRetriever` collects on its `releases` set. These tests
stub that attribute on a mocked fetch, so they need no network.
"""

from datetime import UTC, datetime
from unittest.mock import Mock

import h5py
import numpy as np
import pandas as pd
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.encoding import annotation_cache_version_attrs
from protspace.data.annotations.manager import (
    UNIPROT_RELEASE_ATTR,
    ProteinAnnotationManager,
)
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.processors.pipeline import (
    MethodSpec,
    PipelineConfig,
    ReductionPipeline,
)

CACHE_NAME = "all_annotations.parquet"
_MISSING = object()


def _row(identifier: str) -> dict:
    return {
        "gene_name": f"G_{identifier}",
        "protein_name": f"Protein {identifier}",
        "uniprot_kb_id": f"{identifier}_HUMAN",
        "organism_id": "9606",
    }


def _serve_uniprot(monkeypatch, release, calls=None):
    """Answer every UniProt fetch; *release* is what the responses reported.

    A string is one observed release, a set is taken as is, ``_MISSING``
    removes the attribute, and anything else (a ``Mock``) is set verbatim.
    """

    def fetch(retriever):
        if calls is not None:
            calls.append(list(retriever.headers))
        if release is _MISSING:
            if hasattr(retriever, "releases"):
                del retriever.releases
        elif isinstance(release, str):
            retriever.releases = {release}
        else:
            retriever.releases = release
        return [
            ProteinAnnotations(identifier=h, annotations=_row(h))
            for h in retriever.headers
        ]

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)


def _forbid_uniprot(monkeypatch):
    def fail(_retriever):
        raise AssertionError("UniProt must not be called")

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fail)


def _pipeline(cache_dir, annotations=("gene_name",), **overrides):
    settings = {"keep_tmp": True, **overrides}
    return ReductionPipeline(
        PipelineConfig(
            methods=[],
            output_path=None,
            intermediate_dir=cache_dir,
            annotations=list(annotations),
            **settings,
        )
    )


def _cache_frame(identifiers, release=None) -> pd.DataFrame:
    df = pd.DataFrame([{"identifier": i, **_row(i)} for i in identifiers])
    df.attrs = dict(annotation_cache_version_attrs())
    if release is not None:
        df.attrs[UNIPROT_RELEASE_ATTR] = release
    return df


def _write_cache(cache_dir, identifiers, release=None):
    _cache_frame(identifiers, release).to_parquet(cache_dir / CACHE_NAME, index=False)


def _stamp(cache_dir):
    return pd.read_parquet(cache_dir / CACHE_NAME).attrs.get(UNIPROT_RELEASE_ATTR)


class TestCacheStamp:
    def test_a_full_fetch_stamps_the_release(self, tmp_path, monkeypatch):
        _serve_uniprot(monkeypatch, "2026_03")
        pipeline = _pipeline(tmp_path)

        pipeline._fetch_annotations(["P1"])

        assert _stamp(tmp_path) == "2026_03"
        assert pipeline.uniprot_releases == {"2026_03"}

    def test_a_fill_in_adds_its_release_to_the_cached_one(self, tmp_path, monkeypatch):
        _write_cache(tmp_path, ["P1"], release="2026_02")
        calls: list = []
        _serve_uniprot(monkeypatch, "2026_03", calls)
        pipeline = _pipeline(tmp_path)

        pipeline._fetch_annotations(["P1", "P2"])

        assert calls == [["P2"]]
        assert _stamp(tmp_path) == "2026_02,2026_03"
        assert pipeline.uniprot_releases == {"2026_02", "2026_03"}

    def test_a_refetch_replaces_the_stamp(self, tmp_path, monkeypatch):
        _write_cache(tmp_path, ["P1"], release="2026_02")
        _serve_uniprot(monkeypatch, "2026_03")
        pipeline = _pipeline(tmp_path, refetch_stages=frozenset({"uniprot"}))

        pipeline._fetch_annotations(["P1"])

        assert _stamp(tmp_path) == "2026_03"
        assert pipeline.uniprot_releases == {"2026_03"}

    def test_rows_kept_from_the_cache_keep_their_release(self, tmp_path, monkeypatch):
        """Fetching part of the cache leaves the other rows' values as they were."""
        _serve_uniprot(monkeypatch, "2026_03")
        cache_path = tmp_path / CACHE_NAME

        ProteinAnnotationManager(
            headers=["P1"],
            annotations=["gene_name"],
            output_path=cache_path,
            cached_data=_cache_frame(["P1", "P2"], release="2026_02"),
        ).to_pd()

        cached = pd.read_parquet(cache_path)
        assert set(cached["identifier"]) == {"P1", "P2"}
        assert cached.attrs[UNIPROT_RELEASE_ATTR] == "2026_02,2026_03"

    def test_an_unstamped_cache_contributes_unknown(self, tmp_path, monkeypatch):
        _write_cache(tmp_path, ["P1"])
        _serve_uniprot(monkeypatch, "2026_03")
        pipeline = _pipeline(tmp_path)

        pipeline._fetch_annotations(["P1", "P2"])

        assert _stamp(tmp_path) == "2026_03,unknown"
        assert pipeline.uniprot_releases == {"2026_03", "unknown"}

    @pytest.mark.parametrize(
        "release", [set(), Mock(), _MISSING], ids=["no-header", "mock", "missing"]
    )
    def test_no_observed_release_writes_no_stamp(self, tmp_path, monkeypatch, release):
        _serve_uniprot(monkeypatch, release)
        pipeline = _pipeline(tmp_path)

        pipeline._fetch_annotations(["P1"])

        assert _stamp(tmp_path) is None
        assert pipeline.uniprot_releases == {"unknown"}


class TestRunReleases:
    def test_a_cache_served_run_reports_the_cached_release(self, tmp_path, monkeypatch):
        _write_cache(tmp_path, ["P1"], release="2026_03")
        _forbid_uniprot(monkeypatch)
        pipeline = _pipeline(tmp_path)

        pipeline._fetch_annotations(["P1"])

        assert pipeline.uniprot_releases == {"2026_03"}

    def test_an_unstamped_cache_served_run_reports_unknown(self, tmp_path, monkeypatch):
        _write_cache(tmp_path, ["P1"])
        _forbid_uniprot(monkeypatch)
        pipeline = _pipeline(tmp_path)

        pipeline._fetch_annotations(["P1"])

        assert pipeline.uniprot_releases == {"unknown"}

    def test_a_run_without_a_cache_reports_what_it_fetched(self, tmp_path, monkeypatch):
        _serve_uniprot(monkeypatch, "2026_03")
        pipeline = _pipeline(tmp_path, keep_tmp=False)

        pipeline._fetch_annotations(["P1"])

        assert pipeline.uniprot_releases == {"2026_03"}
        assert not (tmp_path / CACHE_NAME).exists()

    def test_csv_only_annotations_use_no_uniprot_release(self, tmp_path, monkeypatch):
        _forbid_uniprot(monkeypatch)
        csv = tmp_path / "labels.csv"
        pd.DataFrame({"identifier": ["P1"], "group": ["a"]}).to_csv(csv, index=False)
        pipeline = _pipeline(tmp_path, annotations=[str(csv)])

        pipeline._fetch_annotations(["P1"])

        assert pipeline.uniprot_releases == set()


class TestRunLogLine:
    @staticmethod
    def _log(tmp_path, releases):
        from protspace.cli.prepare import _write_run_log
        from protspace.data.embedding.biocentral import EmbedConfig

        _write_run_log(
            output_dir=tmp_path,
            ts_start=datetime.now(UTC),
            duration=1.0,
            query=None,
            input_specs=[],
            embedders=[],
            embed_config=EmbedConfig(),
            pipeline_config=PipelineConfig(
                methods=[MethodSpec("pca", 2)], output_path=tmp_path
            ),
            similarity=False,
            scores=True,
            output_path=tmp_path,
            n_proteins=1,
            n_embedding_sets=1,
            uniprot_releases=releases,
        )
        text = (tmp_path / "run.log").read_text()
        section = text.split("## Annotations\n", 1)[1].split("\n\n", 1)[0]
        return section.splitlines()

    @pytest.mark.parametrize(
        "releases,expected",
        [
            ({"2026_03"}, "2026_03"),
            ({"2026_03", "2026_02"}, "2026_02, 2026_03"),
            ({"2026_03", "unknown"}, "2026_03, unknown"),
            ({"unknown"}, "unknown"),
            (set(), "none"),
        ],
    )
    def test_the_line_states_the_releases(self, tmp_path, releases, expected):
        assert f"uniprot_release: {expected}" in self._log(tmp_path, releases)


class TestPrepareRunLog:
    @staticmethod
    def _h5(tmp_path, headers):
        path = tmp_path / "emb.h5"
        rng = np.random.default_rng(0)
        with h5py.File(path, "w") as f:
            for h in headers:
                f.create_dataset(h, data=rng.normal(size=8).astype(np.float32))
        return path

    @staticmethod
    def _prepare(h5_path, output_dir):
        return CliRunner().invoke(
            app,
            [
                "prepare",
                "-i",
                f"{h5_path}:E",
                "-a",
                "gene_name",
                "-m",
                "pca2",
                "-o",
                str(output_dir),
            ],
        )

    @staticmethod
    def _release_lines(output_dir):
        return [
            line
            for line in (output_dir / "run.log").read_text().splitlines()
            if line.startswith("uniprot_release:")
        ]

    def test_prepare_logs_the_release_fetched_and_then_cached(
        self, tmp_path, monkeypatch
    ):
        h5_path = self._h5(tmp_path, ["P1", "P2", "P3"])
        output_dir = tmp_path / "out"
        _serve_uniprot(monkeypatch, "2026_03")

        first = self._prepare(h5_path, output_dir)
        assert first.exit_code == 0, first.output

        _forbid_uniprot(monkeypatch)
        second = self._prepare(h5_path, output_dir)
        assert second.exit_code == 0, second.output

        assert self._release_lines(output_dir) == [
            "uniprot_release: 2026_03",
            "uniprot_release: 2026_03",
        ]
