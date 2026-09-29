"""Caches written before the family and InterPro fixes are refreshed, not reused.

Cache version 1 stored ``protein_families`` cut at the first ``.`` (and
section qualifiers as families), and gave InterPro values to only one of the
proteins sharing a sequence. Neither can be repaired locally, so a run that
requests those columns refetches their source once; a run that does not drops
them. All HTTP is mocked.
"""

import pandas as pd
import pytest
import requests

from protspace.data.annotations.encoding import (
    ANNOTATION_CACHE_VERSION,
    ANNOTATION_CACHE_VERSION_ATTR,
    CACHE_SEMANTICS_CHANGES,
    read_annotation_cache_version,
)
from protspace.data.annotations.retrievers.interpro_retriever import (
    INTERPRO_ANNOTATIONS,
    InterProRetriever,
)
from protspace.data.annotations.retrievers.ted_retriever import TedRetriever
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.processors.pipeline import PipelineConfig, ReductionPipeline

CACHE_NAME = "all_annotations.parquet"
LEGACY_FAMILY = "Major facilitator superfamily (TC 2|ISS"
CURRENT_FAMILY = "Major facilitator superfamily (TC 2.A.1) family|ISS"
LEGACY_PFAM = "PF00001 (Legacy)|1.0"
CURRENT_PFAM = "PF00049 (Insulin)|1.0"


def _pipeline(cache_dir, annotations):
    return ReductionPipeline(
        PipelineConfig(
            methods=[],
            output_path=None,
            keep_tmp=True,
            intermediate_dir=cache_dir,
            annotations=annotations,
        )
    )


def _write_v1_cache(cache_dir, **extra) -> None:
    """A cache written by the version before the family and InterPro fixes."""
    cached = pd.DataFrame(
        {
            "identifier": ["P01308"],
            "gene_name": ["CACHED_GENE"],
            "protein_name": ["Cached protein"],
            "uniprot_kb_id": ["INS_HUMAN"],
            "organism_id": ["9606"],
            "sequence": ["MALWMRLLPL"],
            "protein_families": [LEGACY_FAMILY],
            "pfam": [LEGACY_PFAM],
            "ted_domains": ["3.40.50.2000|94.2"],
            **{column: [value] for column, value in extra.items()},
        }
    )
    cached.attrs = {ANNOTATION_CACHE_VERSION_ATTR: 1}
    cached.to_parquet(cache_dir / CACHE_NAME, index=False)


def _read_cache(cache_dir) -> pd.DataFrame:
    return pd.read_parquet(cache_dir / CACHE_NAME)


def _serve_uniprot(monkeypatch, calls: list):
    def fetch(retriever):
        calls.append("uniprot")
        return [
            ProteinAnnotations(
                identifier=h,
                annotations={
                    "gene_name": "INS",
                    "protein_name": "Insulin",
                    "uniprot_kb_id": "INS_HUMAN",
                    "organism_id": "9606",
                    "sequence": "MALWMRLLPL",
                    "protein_families": CURRENT_FAMILY,
                },
            )
            for h in retriever.headers
        ]

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)


def _serve_interpro(monkeypatch, calls: list):
    def fetch(retriever):
        calls.append(("interpro", dict(retriever.sequences)))
        return [
            ProteinAnnotations(identifier=h, annotations={"pfam": CURRENT_PFAM})
            for h in retriever.headers
        ]

    monkeypatch.setattr(InterProRetriever, "fetch_annotations", fetch)


def _lose_uniprot_batches(monkeypatch, calls: list):
    """Every UniProt batch fails, through the real retriever."""
    from protspace.data.annotations.retrievers import uniprot_retriever

    def fail_batch(_accessions, **_kwargs):
        calls.append("uniprot")
        raise RuntimeError("temporary UniProt failure")

    monkeypatch.setattr(uniprot_retriever, "_fetch_many_accessions", fail_batch)


def _lose_interpro_batches(monkeypatch, calls: list):
    """Every InterPro POST fails, through the real retriever."""
    from protspace.data.annotations.retrievers import interpro_retriever

    def fail_post(*_args, **_kwargs):
        calls.append("interpro")
        raise requests.exceptions.ConnectionError("temporary InterPro failure")

    monkeypatch.setattr(interpro_retriever, "post_with_retry", fail_post)


def _values(frame: pd.DataFrame, column: str) -> list:
    """*column*'s values, or none when a failed source left it out entirely."""
    return frame[column].tolist() if column in frame.columns else []


def _forbid_ted(monkeypatch):
    def fetch(_retriever):
        raise AssertionError("cached TED values are current and must be reused")

    monkeypatch.setattr(TedRetriever, "fetch_annotations", fetch)


def _holds_stale_value_as_current(cache: pd.DataFrame, column: str) -> bool:
    return (
        column in cache.columns
        and read_annotation_cache_version(cache) >= ANNOTATION_CACHE_VERSION
    )


class TestVersionTable:
    def test_version_2_covers_protein_families_and_every_interpro_column(self):
        """encoding.py spells the InterPro columns out; they must not drift apart."""
        assert CACHE_SEMANTICS_CHANGES[2] == frozenset(
            {"protein_families", *INTERPRO_ANNOTATIONS}
        )

    def test_the_current_version_includes_the_fix(self):
        assert ANNOTATION_CACHE_VERSION >= 2


class TestRequestedColumnsAreRefreshed:
    def test_protein_families_refetches_uniprot_once(self, tmp_path, monkeypatch):
        _write_v1_cache(tmp_path)
        calls: list = []
        _serve_uniprot(monkeypatch, calls)
        _forbid_ted(monkeypatch)
        annotations = ["protein_families", "ted_domains"]

        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        assert calls == ["uniprot"]
        assert result["protein_families"].tolist() == [CURRENT_FAMILY]
        assert result["ted_domains"].tolist() == ["3.40.50.2000|94.2"]
        cache = _read_cache(tmp_path)
        assert read_annotation_cache_version(cache) == ANNOTATION_CACHE_VERSION
        assert cache["protein_families"].tolist() == [CURRENT_FAMILY]

        # Stamped current, so the next run reuses it without a request.
        calls.clear()
        again = _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        assert calls == []
        assert again["protein_families"].tolist() == [CURRENT_FAMILY]

    def test_pfam_refetches_interpro_once_and_reuses_uniprot(
        self, tmp_path, monkeypatch
    ):
        _write_v1_cache(tmp_path)
        calls: list = []
        _serve_uniprot(monkeypatch, calls)
        _serve_interpro(monkeypatch, calls)
        annotations = ["gene_name", "pfam"]

        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        assert [c if isinstance(c, str) else c[0] for c in calls] == ["interpro"]
        # InterPro was given the cached sequence to look up.
        assert calls[0][1] == {"P01308": "MALWMRLLPL"}
        assert result["pfam"].tolist() == [CURRENT_PFAM]
        assert result["gene_name"].tolist() == ["CACHED_GENE"]
        cache = _read_cache(tmp_path)
        assert read_annotation_cache_version(cache) == ANNOTATION_CACHE_VERSION
        assert cache["pfam"].tolist() == [CURRENT_PFAM]

        calls.clear()
        _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        assert calls == []

    def test_pfam_refresh_fetches_sequences_the_cache_lacks(
        self, tmp_path, monkeypatch
    ):
        """InterPro is looked up by sequence; without one it returns nothing.

        Reusing the cached UniProt values of a cache that holds no ``sequence``
        would hand InterPro nothing to look up, and its empty result would be
        stamped current.
        """
        _write_v1_cache(tmp_path)
        cache = _read_cache(tmp_path).drop(columns=["sequence"])
        cache.attrs = {ANNOTATION_CACHE_VERSION_ATTR: 1}
        cache.to_parquet(tmp_path / CACHE_NAME, index=False)
        calls: list = []
        _serve_uniprot(monkeypatch, calls)
        _serve_interpro(monkeypatch, calls)

        result = _pipeline(tmp_path, ["pfam"])._fetch_annotations(["P01308"])

        assert calls[0] == "uniprot"
        assert calls[1] == ("interpro", {"P01308": "MALWMRLLPL"})
        assert result["pfam"].tolist() == [CURRENT_PFAM]


class TestUnrequestedColumnsAreDropped:
    def test_a_run_served_from_the_cache_fetches_nothing(self, tmp_path, monkeypatch):
        _write_v1_cache(tmp_path)
        calls: list = []
        _serve_uniprot(monkeypatch, calls)
        _serve_interpro(monkeypatch, calls)
        _forbid_ted(monkeypatch)

        result = _pipeline(tmp_path, ["gene_name", "ted_domains"])._fetch_annotations(
            ["P01308"]
        )

        assert calls == []
        assert "protein_families" not in result.columns
        assert "pfam" not in result.columns
        assert result["ted_domains"].tolist() == ["3.40.50.2000|94.2"]

    def test_a_cache_rewritten_for_other_columns_leaves_them_out(
        self, tmp_path, monkeypatch
    ):
        _write_v1_cache(tmp_path)
        calls: list = []
        _serve_uniprot(monkeypatch, calls)
        _serve_interpro(monkeypatch, calls)
        _forbid_ted(monkeypatch)

        def biocentral(retriever):
            calls.append("biocentral")
            return [
                ProteinAnnotations(
                    identifier=h, annotations={"predicted_membrane": "Soluble"}
                )
                for h in retriever.headers
            ]

        from protspace.data.annotations.retrievers.biocentral_retriever import (
            BiocentralPredictionRetriever,
        )

        monkeypatch.setattr(
            BiocentralPredictionRetriever, "fetch_annotations", biocentral
        )

        _pipeline(
            tmp_path, ["gene_name", "ted_domains", "predicted_membrane"]
        )._fetch_annotations(["P01308"])

        assert calls == ["biocentral"]
        cache = _read_cache(tmp_path)
        assert read_annotation_cache_version(cache) == ANNOTATION_CACHE_VERSION
        assert "protein_families" not in cache.columns
        assert "pfam" not in cache.columns
        assert cache["gene_name"].tolist() == ["CACHED_GENE"]


class TestFailedRefresh:
    def test_a_lost_interpro_batch_keeps_the_stale_pfam_uncertified(
        self, tmp_path, monkeypatch
    ):
        _write_v1_cache(tmp_path)
        calls: list = []
        _serve_uniprot(monkeypatch, calls)
        _lose_interpro_batches(monkeypatch, calls)

        result = _pipeline(tmp_path, ["gene_name", "pfam"])._fetch_annotations(
            ["P01308"]
        )

        assert calls == ["interpro"]
        assert LEGACY_PFAM not in _values(result, "pfam")
        assert not _holds_stale_value_as_current(_read_cache(tmp_path), "pfam")

        # The next run tries InterPro again.
        calls.clear()
        _serve_interpro(monkeypatch, calls)
        again = _pipeline(tmp_path, ["gene_name", "pfam"])._fetch_annotations(
            ["P01308"]
        )

        assert [c[0] for c in calls] == ["interpro"]
        assert again["pfam"].tolist() == [CURRENT_PFAM]

    def test_a_lost_uniprot_batch_keeps_the_stale_family_uncertified(
        self, tmp_path, monkeypatch
    ):
        _write_v1_cache(tmp_path)
        calls: list = []
        _lose_uniprot_batches(monkeypatch, calls)

        result = _pipeline(
            tmp_path, ["gene_name", "protein_families"]
        )._fetch_annotations(["P01308"])

        assert calls == ["uniprot"]
        assert LEGACY_FAMILY not in _values(result, "protein_families")
        # Values the refresh did not question survive its failure.
        assert result["gene_name"].tolist() == ["CACHED_GENE"]
        assert not _holds_stale_value_as_current(
            _read_cache(tmp_path), "protein_families"
        )

        calls.clear()
        _serve_uniprot(monkeypatch, calls)
        again = _pipeline(
            tmp_path, ["gene_name", "protein_families"]
        )._fetch_annotations(["P01308"])

        assert calls == ["uniprot"]
        assert again["protein_families"].tolist() == [CURRENT_FAMILY]

    def test_a_lost_uniprot_batch_does_not_cost_a_finished_ted_pass(
        self, tmp_path, monkeypatch
    ):
        """The stale family is not a value to protect, so TED is still saved.

        Counting the stale column as protected made every write of the run
        stand down, leaving the version-1 cache in place: the next run then
        repeated the refresh and the whole TED pass.
        """
        _write_v1_cache(tmp_path)
        cache = _read_cache(tmp_path).drop(columns=["ted_domains"])
        cache.attrs = {ANNOTATION_CACHE_VERSION_ATTR: 1}
        cache.to_parquet(tmp_path / CACHE_NAME, index=False)
        calls: list = []
        _lose_uniprot_batches(monkeypatch, calls)

        def ted(retriever):
            calls.append("ted")
            return [
                ProteinAnnotations(identifier=h, annotations={"ted_domains": "-|90.0"})
                for h in retriever.headers
            ]

        monkeypatch.setattr(TedRetriever, "fetch_annotations", ted)
        annotations = ["gene_name", "protein_families", "ted_domains"]

        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        assert calls == ["uniprot", "ted"]
        assert result["gene_name"].tolist() == ["CACHED_GENE"]
        cache = _read_cache(tmp_path)
        assert cache["ted_domains"].tolist() == ["-|90.0"]
        # The values the refresh did not question are kept; the stale family
        # is not, so nothing stale is stamped current.
        assert cache["gene_name"].tolist() == ["CACHED_GENE"]
        assert not _holds_stale_value_as_current(cache, "protein_families")
        assert "pfam" not in cache.columns

        # The next run refreshes UniProt and reuses TED.
        calls.clear()
        _serve_uniprot(monkeypatch, calls)
        _forbid_ted(monkeypatch)
        again = _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        assert calls == ["uniprot"]
        assert again["protein_families"].tolist() == [CURRENT_FAMILY]
        assert again["ted_domains"].tolist() == ["-|90.0"]


@pytest.mark.parametrize("column", sorted(INTERPRO_ANNOTATIONS))
def test_every_interpro_column_is_stale_in_a_v1_cache(column):
    from protspace.data.annotations.encoding import stale_cache_columns

    cache = pd.DataFrame({"identifier": ["P01308"], column: [""]})
    cache.attrs = {ANNOTATION_CACHE_VERSION_ATTR: 1}

    assert stale_cache_columns(cache) == {column}
