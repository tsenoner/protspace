"""A source that did not finish never costs the sources that did.

When a source loses data and the cache already holds current values for its
columns, those values are protected: this run's empty placeholders must not
replace them. Protecting them used to mean skipping the whole write, which also
threw away every other source the run finished, such as an 18-40 hour TED pass
lost to one InterPro batch. The cache now keeps the failed source's cached
values and saves the finished sources next to them. All HTTP is mocked.
"""

import pandas as pd

from protspace.data.annotations.encoding import (
    ANNOTATION_CACHE_VERSION,
    ANNOTATION_CACHE_VERSION_ATTR,
    annotation_cache_version_attrs,
    read_annotation_cache_version,
)
from protspace.data.annotations.manager import (
    UNIPROT_RELEASE_ATTR,
    ProteinAnnotationManager,
)
from protspace.data.annotations.retrievers.interpro_retriever import (
    InterProRetriever,
)
from protspace.data.annotations.retrievers.ted_retriever import TedRetriever
from protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.processors.pipeline import PipelineConfig, ReductionPipeline
from tests.prep_source import biocentral_down_patterns

CACHE_NAME = "all_annotations.parquet"
CACHED_PFAM = "PF00049 (Insulin)|1.0"


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


def _uniprot_row(gene_name: str, sequence: str = "MALWMRLLPL") -> dict:
    return {
        "gene_name": gene_name,
        "protein_name": f"{gene_name} protein",
        "uniprot_kb_id": f"{gene_name}_HUMAN",
        "organism_id": "9606",
        "sequence": sequence,
    }


def _write_cache(cache_dir, rows: dict[str, dict], version=None, release=None):
    cached = pd.DataFrame(
        [{"identifier": identifier, **values} for identifier, values in rows.items()]
    )
    cached.attrs = (
        annotation_cache_version_attrs()
        if version is None
        else {ANNOTATION_CACHE_VERSION_ATTR: version}
    )
    if release:
        cached.attrs[UNIPROT_RELEASE_ATTR] = release
    cached.to_parquet(cache_dir / CACHE_NAME, index=False)
    return cached


def _read_cache(cache_dir) -> pd.DataFrame:
    return pd.read_parquet(cache_dir / CACHE_NAME)


def _serve_uniprot(monkeypatch, gene_names: dict[str, str], calls: list, lost=()):
    """UniProt answers every identifier but those in *lost*, whose batch fails."""

    def fetch(retriever):
        calls.append(("uniprot", list(retriever.headers)))
        rows = []
        for h in retriever.headers:
            if h in lost:
                retriever.failed_batch_count += 1
                rows.append(
                    ProteinAnnotations(
                        identifier=h, annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, "")
                    )
                )
            else:
                rows.append(
                    ProteinAnnotations(
                        identifier=h, annotations=_uniprot_row(gene_names[h])
                    )
                )
        return rows

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)


def _lose_an_interpro_batch(monkeypatch, calls: list):
    """InterPro answers, but one of its batches was lost after every retry."""

    def fetch(retriever):
        calls.append(("interpro", list(retriever.headers)))
        retriever.failed_batch_count = 1
        return [
            ProteinAnnotations(
                identifier=h, annotations=dict.fromkeys(retriever.annotations, "")
            )
            for h in retriever.headers
        ]

    monkeypatch.setattr(InterProRetriever, "fetch_annotations", fetch)


def _serve_interpro(monkeypatch, calls: list):
    def fetch(retriever):
        calls.append(("interpro", list(retriever.headers)))
        return [
            ProteinAnnotations(
                identifier=h,
                annotations={"pfam": CACHED_PFAM, "smart": "SM00078|2.0"},
            )
            for h in retriever.headers
        ]

    monkeypatch.setattr(InterProRetriever, "fetch_annotations", fetch)


def _serve_ted(monkeypatch, calls: list):
    def fetch(retriever):
        calls.append(("ted", list(retriever.headers)))
        return [
            ProteinAnnotations(identifier=h, annotations={"ted_domains": "-|90.0"})
            for h in retriever.headers
        ]

    monkeypatch.setattr(TedRetriever, "fetch_annotations", fetch)


class TestAFailedSourceKeepsItsCachedValues:
    def test_a_lost_interpro_batch_does_not_cost_a_finished_ted_pass(
        self, tmp_path, monkeypatch
    ):
        _write_cache(tmp_path, {"P01308": {**_uniprot_row("INS"), "pfam": CACHED_PFAM}})
        calls: list = []
        _serve_uniprot(monkeypatch, {}, calls)
        _lose_an_interpro_batch(monkeypatch, calls)
        _serve_ted(monkeypatch, calls)
        annotations = ["gene_name", "pfam", "smart", "ted_domains"]

        _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        cache = _read_cache(tmp_path)
        assert cache["ted_domains"].tolist() == ["-|90.0"]
        # InterPro did not finish: the value it already held is kept, and the
        # column it was to add is left for the next run to fetch.
        assert cache["pfam"].tolist() == [CACHED_PFAM]
        assert "smart" not in cache.columns
        assert cache["gene_name"].tolist() == ["INS"]
        assert read_annotation_cache_version(cache) == ANNOTATION_CACHE_VERSION

        calls.clear()
        _serve_interpro(monkeypatch, calls)
        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        assert calls == [("interpro", ["P01308"])]
        assert result["ted_domains"].tolist() == ["-|90.0"]
        assert result["smart"].tolist() == ["SM00078|2.0"]

    def test_a_protein_the_failed_source_never_covered_is_not_written(
        self, tmp_path, monkeypatch
    ):
        """Without a cached value to keep, the new protein's row would be empty."""
        _write_cache(tmp_path, {"P01308": {**_uniprot_row("INS"), "pfam": CACHED_PFAM}})
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01315": "IGF"}, calls)
        _lose_an_interpro_batch(monkeypatch, calls)
        _serve_ted(monkeypatch, calls)
        annotations = ["gene_name", "pfam", "ted_domains"]

        _pipeline(tmp_path, annotations)._fetch_annotations(["P01308", "P01315"])

        cache = _read_cache(tmp_path).set_index("identifier")
        assert cache.index.tolist() == ["P01308"]
        assert cache.loc["P01308", "pfam"] == CACHED_PFAM
        assert cache.loc["P01308", "ted_domains"] == "-|90.0"

        calls.clear()
        _serve_interpro(monkeypatch, calls)
        result = _pipeline(tmp_path, annotations)._fetch_annotations(
            ["P01308", "P01315"]
        )

        assert calls == [
            ("uniprot", ["P01315"]),
            ("interpro", ["P01315"]),
            ("ted", ["P01315"]),
        ]
        assert result.set_index("identifier").loc["P01315", "pfam"] == CACHED_PFAM

    def test_kept_uniprot_values_keep_the_release_they_came_from(
        self, tmp_path, monkeypatch
    ):
        _write_cache(tmp_path, {"P01308": _uniprot_row("INS")}, release="2026_01")
        calls: list = []
        _serve_uniprot(monkeypatch, {}, calls, lost={"P01308"})
        _serve_ted(monkeypatch, calls)

        _pipeline(tmp_path, ["gene_name", "ec", "ted_domains"])._fetch_annotations(
            ["P01308"]
        )

        cache = _read_cache(tmp_path)
        assert cache["ted_domains"].tolist() == ["-|90.0"]
        assert cache["gene_name"].tolist() == ["INS"]
        assert "ec" not in cache.columns
        assert cache.attrs[UNIPROT_RELEASE_ATTR] == "2026_01"

    def test_nothing_is_rewritten_when_no_other_source_finished(
        self, tmp_path, monkeypatch
    ):
        cached = _write_cache(
            tmp_path, {"P01308": {**_uniprot_row("INS"), "pfam": CACHED_PFAM}}
        )
        before = (tmp_path / CACHE_NAME).stat().st_mtime_ns
        calls: list = []
        _serve_uniprot(monkeypatch, {}, calls)
        _lose_an_interpro_batch(monkeypatch, calls)

        _pipeline(tmp_path, ["gene_name", "pfam", "smart"])._fetch_annotations(
            ["P01308"]
        )

        assert calls == [("interpro", ["P01308"])]
        assert (tmp_path / CACHE_NAME).stat().st_mtime_ns == before
        pd.testing.assert_frame_equal(_read_cache(tmp_path), cached)

    def test_an_explicit_refetch_still_drops_what_it_could_not_replace(
        self, tmp_path, monkeypatch
    ):
        _write_cache(
            tmp_path,
            {
                "P01308": {
                    **_uniprot_row("INS"),
                    "pfam": CACHED_PFAM,
                    "ted_domains": "-|80.0",
                }
            },
        )
        _lose_an_interpro_batch(monkeypatch, [])
        _serve_ted(monkeypatch, [])

        ProteinAnnotationManager(
            headers=["P01308"],
            annotations=["gene_name", "pfam", "ted_domains"],
            output_path=tmp_path / CACHE_NAME,
            cached_data=_read_cache(tmp_path).drop(columns=["pfam", "ted_domains"]),
            sources_to_fetch={
                "uniprot": False,
                "taxonomy": False,
                "interpro": True,
                "ted": True,
                "biocentral": False,
            },
            protect_cached_columns=False,
        ).to_pd()

        cache = _read_cache(tmp_path)
        assert "pfam" not in cache.columns
        assert cache["ted_domains"].tolist() == ["-|90.0"]


SEQUENCES = {"P01308": "MALWMRLLPL", "P01315": "MGKISSLPTQ"}


def _serve_interpro_by_sequence(monkeypatch, calls: list):
    """InterPro finds a match for every protein it was given a sequence for."""

    def fetch(retriever):
        calls.append(("interpro", sorted(retriever.sequences)))
        return [
            ProteinAnnotations(
                identifier=h,
                annotations={"pfam": CACHED_PFAM if retriever.sequences.get(h) else ""},
            )
            for h in retriever.headers
        ]

    monkeypatch.setattr(InterProRetriever, "fetch_annotations", fetch)


def _serve_uniprot_sequences(monkeypatch, lost=(), sequences=SEQUENCES):
    def fetch(retriever):
        rows = []
        for h in retriever.headers:
            if h in lost:
                retriever.failed_batch_count += 1
                rows.append(
                    ProteinAnnotations(
                        identifier=h, annotations=dict.fromkeys(UNIPROT_ANNOTATIONS, "")
                    )
                )
            else:
                rows.append(
                    ProteinAnnotations(
                        identifier=h,
                        annotations=_uniprot_row(h, sequence=sequences.get(h, "")),
                    )
                )
        return rows

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)


class TestSequencesLostWithAUniProtBatch:
    """InterPro and Biocentral look proteins up by the sequence UniProt supplies.

    A protein whose UniProt batch was lost has no sequence, so these sources
    return nothing for it -- an empty value that must not be cached as "no
    match", or no later run would ever look it up again.
    """

    def test_interpro_is_not_cached_for_proteins_it_had_no_sequence_for(
        self, tmp_path, monkeypatch
    ):
        calls: list = []
        _serve_uniprot_sequences(monkeypatch, lost={"P01315"})
        _serve_interpro_by_sequence(monkeypatch, calls)
        headers = ["P01308", "P01315"]

        manager = ProteinAnnotationManager(
            headers=headers,
            annotations=["gene_name", "pfam"],
            output_path=tmp_path / CACHE_NAME,
        )
        manager.to_pd()

        assert manager.incomplete_sources == {"uniprot", "interpro"}

        calls.clear()
        _serve_uniprot_sequences(monkeypatch)
        result = _pipeline(tmp_path, ["gene_name", "pfam"])._fetch_annotations(headers)

        assert calls == [("interpro", headers)]
        assert result.set_index("identifier").loc["P01315", "pfam"] == CACHED_PFAM

    def test_biocentral_is_not_cached_for_proteins_it_had_no_sequence_for(
        self, tmp_path, monkeypatch, caplog
    ):
        from protspace.data.annotations.retrievers.biocentral_retriever import (
            BiocentralPredictionRetriever,
        )

        _serve_uniprot_sequences(monkeypatch, lost={"P01315"})
        monkeypatch.setattr(
            BiocentralPredictionRetriever,
            "fetch_annotations",
            lambda retriever: [
                ProteinAnnotations(
                    identifier=h,
                    annotations={
                        "predicted_membrane": "Soluble"
                        if retriever.sequences.get(h)
                        else ""
                    },
                )
                for h in retriever.headers
            ],
        )

        manager = ProteinAnnotationManager(
            headers=["P01308", "P01315"],
            annotations=["gene_name", "predicted_membrane"],
            output_path=tmp_path / CACHE_NAME,
        )
        manager.to_pd()

        assert manager.incomplete_sources == {"uniprot", "biocentral"}
        # The prep service reads these substrings as a Biocentral outage; a
        # coverage gap must not read as one.
        down_patterns = biocentral_down_patterns()
        report = [
            r.getMessage() for r in caplog.records if "no sequence" in r.getMessage()
        ]
        assert report
        assert not any(p in report[0].lower() for p in down_patterns)

    def test_sequences_from_the_fasta_keep_interpro_cacheable(
        self, tmp_path, monkeypatch
    ):
        calls: list = []
        _serve_uniprot_sequences(monkeypatch, lost={"P01315"})
        _serve_interpro_by_sequence(monkeypatch, calls)
        _serve_ted(monkeypatch, calls)

        manager = ProteinAnnotationManager(
            headers=["P01308", "P01315"],
            annotations=["gene_name", "pfam", "ted_domains"],
            output_path=tmp_path / CACHE_NAME,
            sequences=SEQUENCES,
        )
        manager.to_pd()

        assert manager.incomplete_sources == {"uniprot"}
        cache = _read_cache(tmp_path).set_index("identifier")
        assert cache.loc["P01315", "pfam"] == CACHED_PFAM

    def test_a_protein_uniprot_has_no_sequence_for_is_a_real_absence(
        self, tmp_path, monkeypatch
    ):
        """With every UniProt batch answered, a missing sequence is genuine."""
        calls: list = []
        _serve_uniprot_sequences(monkeypatch, sequences={"P01308": "MALWMRLLPL"})
        _serve_interpro_by_sequence(monkeypatch, calls)

        manager = ProteinAnnotationManager(
            headers=["P01308", "P01315"],
            annotations=["gene_name", "pfam"],
            output_path=tmp_path / CACHE_NAME,
        )
        manager.to_pd()

        assert manager.incomplete_sources == set()
        assert _read_cache(tmp_path).set_index("identifier").loc["P01315", "pfam"] == ""
