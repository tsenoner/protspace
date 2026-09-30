"""Caches written before a semantics fix are refreshed, not reused.

Cache version 1 stored ``protein_families`` cut at the first ``.`` (and
section qualifiers as families), and gave InterPro values to only one of the
proteins sharing a sequence. Version 2 stored ``root`` as the deepest unranked
clade and a TMbed negative as ``none``. A run that requests such a column
refetches its source once; a run that does not drops it. All HTTP is mocked.
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


# --- Cache version 3: the taxonomy root and the TMbed negative ---------------
#
# Version 2 stored `root` as the lineage's deepest unranked clade ("melanogaster
# subgroup" for the fly) and a TMbed negative as "none", which both readers take
# for a missing value. The refresh refetches exactly the two sources that own
# them, taxonomy and Biocentral, and reuses every other source.

FLY = {
    "root": "cellular organisms",
    "domain": "Eukaryota",
    "kingdom": "Metazoa",
    "phylum": "Arthropoda",
    "class": "Insecta",
    "order": "Diptera",
    "family": "Drosophilidae",
    "genus": "Drosophila",
    "species": "Drosophila melanogaster",
}
BIOCENTRAL = {
    "predicted_membrane": "Soluble",
    "predicted_subcellular_location": "Cytoplasm",
    "predicted_signal_peptide": "False",
    "predicted_transmembrane": "non-transmembrane",
}
V3_ANNOTATIONS = [
    "gene_name",
    "pfam",
    "ted_domains",
    "root",
    "species",
    "predicted_membrane",
    "predicted_transmembrane",
]


def _write_v2_cache(cache_dir, *, drop=(), version=2, **extra) -> None:
    """A fly protein cached by the version before the root and TMbed fixes."""
    cached = pd.DataFrame(
        {
            "identifier": ["P02299"],
            "gene_name": ["CACHED_GENE"],
            "protein_name": ["Histone H3"],
            "uniprot_kb_id": ["H3_DROME"],
            "organism_id": ["7227"],
            "sequence": ["MARTKQTARK"],
            "pfam": [CURRENT_PFAM],
            "ted_domains": ["3.40.50.2000|94.2"],
            "root": ["melanogaster subgroup"],
            "species": ["Drosophila melanogaster"],
            "predicted_membrane": ["Soluble"],
            "predicted_transmembrane": ["none"],
            **{column: [value] for column, value in extra.items()},
        }
    ).drop(columns=list(drop))
    cached.attrs = {ANNOTATION_CACHE_VERSION_ATTR: version}
    cached.to_parquet(cache_dir / CACHE_NAME, index=False)


FLY_UNIPROT = {
    "gene_name": "His3",
    "protein_name": "Histone H3",
    "uniprot_kb_id": "H3_DROME",
    "organism_id": "7227",
    "sequence": "MARTKQTARK",
    "keyword": "Nucleosome core",
}


def _serve_fly_uniprot(monkeypatch, calls: list, requested: list | None = None):
    """UniProt answers for the fly protein, with whatever fields it is asked for."""

    def fetch(retriever):
        calls.append("uniprot")
        if requested is not None:
            requested.append(set(retriever.annotations))
        return [
            ProteinAnnotations(
                identifier=h,
                annotations={
                    a: FLY_UNIPROT.get(a, "")
                    for a in retriever.annotations
                    if a != "accession"  # the identifier, not a column
                },
            )
            for h in retriever.headers
        ]

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)


def _serve_taxonomy(monkeypatch, calls: list, requested: list | None = None):
    from protspace.data.annotations.retrievers.taxonomy_retriever import (
        TaxonomyRetriever,
    )

    def fetch(retriever):
        calls.append(("taxonomy", list(retriever.taxon_ids)))
        if requested is not None:
            requested.append(set(retriever.annotations))
        return {
            tid: {"annotations": {a: FLY[a] for a in retriever.annotations}}
            for tid in retriever.taxon_ids
        }

    monkeypatch.setattr(TaxonomyRetriever, "fetch_annotations", fetch)


def _serve_biocentral(
    monkeypatch, calls: list, *, fail: bool = False, requested: list | None = None
):
    from protspace.data.annotations.retrievers.biocentral_retriever import (
        BiocentralPredictionRetriever,
    )

    def fetch(retriever):
        calls.append(("biocentral", dict(retriever.sequences)))
        if requested is not None:
            requested.append(set(retriever.annotations))
        if fail:
            raise RuntimeError("Biocentral is down")
        return [
            ProteinAnnotations(
                identifier=h,
                annotations={a: BIOCENTRAL[a] for a in retriever.annotations},
            )
            for h in retriever.headers
        ]

    monkeypatch.setattr(BiocentralPredictionRetriever, "fetch_annotations", fetch)


def _forbid(monkeypatch, retriever_cls, name):
    def fetch(_retriever):
        raise AssertionError(f"{name} values are current and must be reused")

    monkeypatch.setattr(retriever_cls, "fetch_annotations", fetch)


def _forbid_all_but_taxonomy_and_biocentral(monkeypatch):
    _forbid(monkeypatch, UniProtRetriever, "UniProt")
    _forbid(monkeypatch, InterProRetriever, "InterPro")
    _forbid(monkeypatch, TedRetriever, "TED")


def _sources(calls: list) -> list[str]:
    return [c if isinstance(c, str) else c[0] for c in calls]


class TestVersion3:
    def test_version_3_covers_root_and_predicted_transmembrane(self):
        assert CACHE_SEMANTICS_CHANGES[3] == frozenset(
            {"root", "predicted_transmembrane"}
        )
        assert ANNOTATION_CACHE_VERSION >= 3

    def test_a_v2_cache_refetches_taxonomy_and_biocentral_once_and_nothing_else(
        self, tmp_path, monkeypatch
    ):
        _write_v2_cache(tmp_path)
        calls: list = []
        _forbid_all_but_taxonomy_and_biocentral(monkeypatch)
        _serve_taxonomy(monkeypatch, calls)
        _serve_biocentral(monkeypatch, calls)

        result = _pipeline(tmp_path, V3_ANNOTATIONS)._fetch_annotations(["P02299"])

        # Taxonomy looked up the cached organism, Biocentral the cached sequence.
        assert calls == [
            ("taxonomy", [7227]),
            ("biocentral", {"P02299": "MARTKQTARK"}),
        ]
        assert result["root"].tolist() == ["cellular organisms"]
        assert result["predicted_transmembrane"].tolist() == ["non-transmembrane"]
        # Every other source's value is the cached one.
        assert result["gene_name"].tolist() == ["CACHED_GENE"]
        assert result["pfam"].tolist() == [CURRENT_PFAM]
        assert result["ted_domains"].tolist() == ["3.40.50.2000|94.2"]
        cache = _read_cache(tmp_path)
        assert read_annotation_cache_version(cache) == ANNOTATION_CACHE_VERSION
        assert cache["root"].tolist() == ["cellular organisms"]
        assert cache["predicted_transmembrane"].tolist() == ["non-transmembrane"]

        # Stamped current, so the next run reuses it without a request.
        calls.clear()
        again = _pipeline(tmp_path, V3_ANNOTATIONS)._fetch_annotations(["P02299"])

        assert calls == []
        assert again["root"].tolist() == ["cellular organisms"]
        assert again["predicted_transmembrane"].tolist() == ["non-transmembrane"]

    @pytest.mark.parametrize(
        ("column", "source"),
        [("root", "taxonomy"), ("predicted_transmembrane", "biocentral")],
    )
    def test_each_column_refreshes_only_its_own_source(
        self, tmp_path, monkeypatch, column, source
    ):
        _write_v2_cache(tmp_path)
        calls: list = []
        _forbid_all_but_taxonomy_and_biocentral(monkeypatch)
        _serve_taxonomy(monkeypatch, calls)
        _serve_biocentral(monkeypatch, calls)

        _pipeline(tmp_path, ["gene_name", column])._fetch_annotations(["P02299"])

        assert _sources(calls) == [source]

    def test_a_run_without_them_fetches_nothing(self, tmp_path, monkeypatch):
        _write_v2_cache(tmp_path)
        calls: list = []
        _forbid_all_but_taxonomy_and_biocentral(monkeypatch)
        _serve_taxonomy(monkeypatch, calls)
        _serve_biocentral(monkeypatch, calls)
        annotations = ["gene_name", "species", "predicted_membrane"]

        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P02299"])

        assert calls == []
        assert result["species"].tolist() == ["Drosophila melanogaster"]
        assert result["predicted_membrane"].tolist() == ["Soluble"]

    def test_a_run_without_them_leaves_them_out_of_the_cache_it_writes(
        self, tmp_path, monkeypatch
    ):
        """The drop itself, which only a run that writes the cache exercises.

        `keyword` is not cached, so UniProt is fetched and the cache rewritten;
        taxonomy and Biocentral ride along from the cache, and without the
        version-3 entry their stale columns would ride along as current.
        """
        _write_v2_cache(tmp_path)
        calls: list = []
        _serve_fly_uniprot(monkeypatch, calls)
        _forbid(monkeypatch, InterProRetriever, "InterPro")
        _forbid(monkeypatch, TedRetriever, "TED")
        _serve_taxonomy(monkeypatch, calls)
        _serve_biocentral(monkeypatch, calls)
        annotations = ["keyword", "species", "predicted_membrane"]

        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P02299"])

        assert calls == ["uniprot"]
        assert result["keyword"].tolist() == ["Nucleosome core"]
        cache = _read_cache(tmp_path)
        assert read_annotation_cache_version(cache) == ANNOTATION_CACHE_VERSION
        assert "root" not in cache.columns
        assert "predicted_transmembrane" not in cache.columns
        # The columns the fix did not touch are cached as they were.
        assert cache["species"].tolist() == ["Drosophila melanogaster"]
        assert cache["predicted_membrane"].tolist() == ["Soluble"]

    def test_the_root_refresh_fetches_the_organism_the_cache_lacks(
        self, tmp_path, monkeypatch
    ):
        """Taxonomy is looked up by organism; without one it finds nothing.

        Reusing the cached UniProt values of a cache that holds no
        ``organism_id`` would hand the taxonomy lookup nothing, and its empty
        result would be stamped current.
        """
        _write_v2_cache(tmp_path, drop=["organism_id"])
        calls: list = []
        _serve_uniprot(monkeypatch, calls)
        _serve_taxonomy(monkeypatch, calls)
        _forbid(monkeypatch, InterProRetriever, "InterPro")

        result = _pipeline(tmp_path, ["root"])._fetch_annotations(["P02299"])

        assert calls == ["uniprot", ("taxonomy", [9606])]
        assert result["root"].tolist() == ["cellular organisms"]

    def test_a_failed_biocentral_refresh_keeps_the_stale_none_uncertified(
        self, tmp_path, monkeypatch
    ):
        _write_v2_cache(tmp_path)
        calls: list = []
        _forbid_all_but_taxonomy_and_biocentral(monkeypatch)
        _serve_biocentral(monkeypatch, calls, fail=True)
        annotations = ["gene_name", "predicted_membrane", "predicted_transmembrane"]

        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P02299"])

        assert _sources(calls) == ["biocentral"]
        assert "none" not in _values(result, "predicted_transmembrane")
        cache = _read_cache(tmp_path)
        assert not _holds_stale_value_as_current(cache, "predicted_transmembrane")
        # The column the refresh did not question keeps its cached value.
        assert cache["predicted_membrane"].tolist() == ["Soluble"]

        # The next run asks Biocentral again.
        calls.clear()
        _serve_biocentral(monkeypatch, calls)
        again = _pipeline(tmp_path, annotations)._fetch_annotations(["P02299"])

        assert _sources(calls) == ["biocentral"]
        assert again["predicted_transmembrane"].tolist() == ["non-transmembrane"]

    def test_the_biocentral_refresh_fetches_the_sequence_the_cache_lacks(
        self, tmp_path, monkeypatch
    ):
        """Biocentral predicts from the sequence; without one it predicts nothing.

        A cache first written for columns that need no sequence has no
        `sequence` column. Refreshed from it without a FASTA, Biocentral would
        be handed no sequence, return empty predictions without failing, and
        the empties would be stamped current in place of the cached values.
        """
        _write_v2_cache(tmp_path, drop=["sequence"])
        calls: list = []
        _serve_fly_uniprot(monkeypatch, calls)
        _forbid(monkeypatch, InterProRetriever, "InterPro")
        _forbid(monkeypatch, TedRetriever, "TED")
        _serve_biocentral(monkeypatch, calls)
        annotations = ["predicted_membrane", "predicted_transmembrane"]

        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P02299"])

        assert calls == ["uniprot", ("biocentral", {"P02299": "MARTKQTARK"})]
        assert result["predicted_transmembrane"].tolist() == ["non-transmembrane"]
        assert result["predicted_membrane"].tolist() == ["Soluble"]
        cache = _read_cache(tmp_path)
        assert read_annotation_cache_version(cache) == ANNOTATION_CACHE_VERSION
        assert cache["predicted_transmembrane"].tolist() == ["non-transmembrane"]
        assert cache["sequence"].tolist() == ["MARTKQTARK"]

    def test_a_fasta_spares_the_biocentral_refresh_the_uniprot_pass(
        self, tmp_path, monkeypatch
    ):
        from protspace.data.annotations.cache import fetch_annotations
        from protspace.data.annotations.configuration import AnnotationConfiguration

        _write_v2_cache(tmp_path, drop=["sequence"])
        calls: list = []
        _forbid(monkeypatch, UniProtRetriever, "UniProt")
        _forbid(monkeypatch, InterProRetriever, "InterPro")
        _forbid(monkeypatch, TedRetriever, "TED")
        _serve_biocentral(monkeypatch, calls)
        annotations = AnnotationConfiguration(
            ["predicted_membrane", "predicted_transmembrane"]
        ).user_annotations

        fetched = fetch_annotations(
            ["P02299"],
            annotations,
            sequences={"P02299": "MARTKQTARKS"},
            cache_path=tmp_path / CACHE_NAME,
        )

        assert calls == [("biocentral", {"P02299": "MARTKQTARKS"})]
        assert fetched.frame["predicted_transmembrane"].tolist() == [
            "non-transmembrane"
        ]


class TestBiocentralNeedsASequence:
    """Biocentral is looked up by sequence, like InterPro, on any run.

    A cache first written without InterPro or Biocentral columns holds no
    `sequence`. A later run adding a Biocentral column without a FASTA used to
    reuse that cache's UniProt values, hand Biocentral no sequence, and cache
    the empty predictions it returned as current.
    """

    def test_a_cache_without_sequences_fetches_them_from_uniprot(
        self, tmp_path, monkeypatch
    ):
        _write_v2_cache(
            tmp_path,
            drop=["sequence", "predicted_membrane", "predicted_transmembrane"],
            version=ANNOTATION_CACHE_VERSION,
        )
        calls: list = []
        _serve_fly_uniprot(monkeypatch, calls)
        _forbid(monkeypatch, InterProRetriever, "InterPro")
        _forbid(monkeypatch, TedRetriever, "TED")
        _serve_biocentral(monkeypatch, calls)

        result = _pipeline(tmp_path, ["predicted_membrane"])._fetch_annotations(
            ["P02299"]
        )

        assert calls == ["uniprot", ("biocentral", {"P02299": "MARTKQTARK"})]
        assert result["predicted_membrane"].tolist() == ["Soluble"]
        assert _read_cache(tmp_path)["predicted_membrane"].tolist() == ["Soluble"]

    def test_a_fasta_with_every_sequence_needs_no_uniprot(self, tmp_path, monkeypatch):
        from protspace.data.annotations.cache import fetch_annotations
        from protspace.data.annotations.configuration import AnnotationConfiguration

        _write_v2_cache(
            tmp_path,
            drop=["sequence", "predicted_membrane", "predicted_transmembrane"],
            version=ANNOTATION_CACHE_VERSION,
        )
        calls: list = []
        _forbid(monkeypatch, UniProtRetriever, "UniProt")
        _serve_biocentral(monkeypatch, calls)

        fetched = fetch_annotations(
            ["P02299"],
            AnnotationConfiguration(["predicted_membrane"]).user_annotations,
            sequences={"P02299": "MARTKQTARKS"},
            cache_path=tmp_path / CACHE_NAME,
        )

        assert calls == [("biocentral", {"P02299": "MARTKQTARKS"})]
        assert fetched.frame["predicted_membrane"].tolist() == ["Soluble"]
