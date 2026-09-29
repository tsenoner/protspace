"""The annotation cache is persisted after each fetched source, not once at the end.

Sources finish hours apart at Swiss-Prot scale: UniProt in about an hour, TED in
18-40 hours. A single write after the last source throws every finished source
away when a later one crashes, so each source fetched over the network is
checkpointed as soon as it completes. All HTTP is mocked.
"""

import pandas as pd
import pytest

from protspace.data.annotations.manager import ProteinAnnotationManager
from protspace.data.annotations.retrievers.interpro_retriever import (
    InterProRetriever,
)
from protspace.data.annotations.retrievers.ted_retriever import TedRetriever
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.processors.pipeline import PipelineConfig, ReductionPipeline

CACHE_NAME = "all_annotations.parquet"
NOTHING_TO_FETCH = {
    "uniprot": False,
    "taxonomy": False,
    "interpro": False,
    "ted": False,
    "biocentral": False,
}


def _uniprot_row(gene_name: str) -> dict:
    return {
        "gene_name": gene_name,
        "protein_name": f"{gene_name} protein",
        "uniprot_kb_id": f"{gene_name}_HUMAN",
        "organism_id": "9606",
        "sequence": "MALWMRLLPL",
    }


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


def _serve_uniprot(monkeypatch, gene_names: dict[str, str], calls: list):
    def fetch(retriever):
        calls.append(("uniprot", list(retriever.headers)))
        return [
            ProteinAnnotations(identifier=h, annotations=_uniprot_row(gene_names[h]))
            for h in retriever.headers
        ]

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)


def _serve_interpro(monkeypatch, values: dict[str, dict], calls: list, on_fetch=None):
    def fetch(retriever):
        calls.append(("interpro", list(retriever.headers)))
        if on_fetch is not None:
            on_fetch()
        return [
            ProteinAnnotations(identifier=h, annotations=dict(values[h]))
            for h in retriever.headers
        ]

    monkeypatch.setattr(InterProRetriever, "fetch_annotations", fetch)


def _read_cache(cache_path) -> pd.DataFrame | None:
    return pd.read_parquet(cache_path) if cache_path.exists() else None


class TestInterruptedRun:
    def test_an_interrupt_during_ted_keeps_uniprot_and_interpro_cached(
        self, tmp_path, monkeypatch
    ):
        """A crash in hour 20 of TED must not cost the hour of UniProt."""
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01308": "INS"}, calls)
        _serve_interpro(monkeypatch, {"P01308": {"pfam": "PF00049|1.0"}}, calls)

        def interrupted(_retriever):
            raise KeyboardInterrupt

        monkeypatch.setattr(TedRetriever, "fetch_annotations", interrupted)
        annotations = ["gene_name", "pfam", "ted_domains"]

        with pytest.raises(KeyboardInterrupt):
            _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        cached = pd.read_parquet(tmp_path / CACHE_NAME)
        assert cached["gene_name"].tolist() == ["INS"]
        assert cached["pfam"].tolist() == ["PF00049|1.0"]
        assert "ted_domains" not in cached.columns

        # The rerun fetches TED and nothing else.
        calls.clear()

        def ted(retriever):
            calls.append(("ted", list(retriever.headers)))
            return [
                ProteinAnnotations(identifier=h, annotations={"ted_domains": "-|90.0"})
                for h in retriever.headers
            ]

        monkeypatch.setattr(TedRetriever, "fetch_annotations", ted)

        result = _pipeline(tmp_path, annotations)._fetch_annotations(["P01308"])

        assert calls == [("ted", ["P01308"])]
        assert result["ted_domains"].tolist() == ["-|90.0"]
        assert result["pfam"].tolist() == ["PF00049|1.0"]


class TestLaterSourceIncomplete:
    def test_a_later_failed_source_leaves_the_earlier_sources_cached(
        self, tmp_path, monkeypatch
    ):
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01308": "INS"}, calls)

        def ted_down(_retriever):
            raise RuntimeError("AlphaFold DB unavailable")

        monkeypatch.setattr(TedRetriever, "fetch_annotations", ted_down)
        cache_path = tmp_path / CACHE_NAME

        ProteinAnnotationManager(
            headers=["P01308"],
            annotations=["gene_name", "ted_domains"],
            output_path=cache_path,
        ).to_pd()

        cached = pd.read_parquet(cache_path)
        assert cached["gene_name"].tolist() == ["INS"]
        assert "ted_domains" not in cached.columns

    def test_a_refreshed_source_survives_a_later_source_the_cache_protects(
        self, tmp_path, monkeypatch
    ):
        """The final write declines when a failed source shadows cached columns.

        It is right to keep the cached TED values then, but the UniProt values
        this run fetched before TED failed must not be thrown away with them.
        """
        cache_path = tmp_path / CACHE_NAME
        cached = pd.DataFrame(
            {
                "identifier": ["P01308"],
                **{k: [v] for k, v in _uniprot_row("OLD").items()},
                "ted_domains": ["-|80.0"],
            }
        )
        cached.to_parquet(cache_path, index=False)
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01308": "NEW"}, calls)

        def ted_down(_retriever):
            raise RuntimeError("AlphaFold DB unavailable")

        monkeypatch.setattr(TedRetriever, "fetch_annotations", ted_down)

        ProteinAnnotationManager(
            headers=["P01308"],
            annotations=["gene_name", "ted_domains"],
            output_path=cache_path,
            cached_data=cached,
            sources_to_fetch={**NOTHING_TO_FETCH, "uniprot": True, "ted": True},
        ).to_pd()

        on_disk = pd.read_parquet(cache_path)
        assert on_disk["gene_name"].tolist() == ["NEW"]
        # TED never completed, so its cached values stay as they were.
        assert on_disk["ted_domains"].tolist() == ["-|80.0"]


class TestPendingSources:
    def test_a_pending_source_keeps_its_cached_columns(self, tmp_path, monkeypatch):
        """Adding `smart` to a cache holding `pfam` must not drop `pfam` early.

        The checkpoint after UniProt is written before InterPro runs, so the
        InterPro columns in it can only come from the cache.
        """
        cache_path = tmp_path / CACHE_NAME
        cached = pd.DataFrame(
            {
                "identifier": ["P01308"],
                **{k: [v] for k, v in _uniprot_row("OLD").items()},
                "pfam": ["PF00049|1.0"],
            }
        )
        cached.to_parquet(cache_path, index=False)
        seen_by_interpro: dict = {}
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01308": "NEW"}, calls)
        _serve_interpro(
            monkeypatch,
            {"P01308": {"pfam": "PF00049|1.0", "smart": "SM00078|2.0"}},
            calls,
            on_fetch=lambda: seen_by_interpro.update(cache=pd.read_parquet(cache_path)),
        )

        ProteinAnnotationManager(
            headers=["P01308"],
            annotations=["gene_name", "pfam", "smart"],
            output_path=cache_path,
            cached_data=cached,
            sources_to_fetch={**NOTHING_TO_FETCH, "uniprot": True, "interpro": True},
        ).to_pd()

        checkpoint = seen_by_interpro["cache"]
        assert checkpoint["gene_name"].tolist() == ["NEW"]
        assert checkpoint["pfam"].tolist() == ["PF00049|1.0"]
        final = pd.read_parquet(cache_path)
        assert final["smart"].tolist() == ["SM00078|2.0"]

    def test_new_rows_wait_for_the_sources_that_fill_them_in(
        self, tmp_path, monkeypatch
    ):
        """A row written before InterPro filled it in would cache an empty pfam."""
        cache_path = tmp_path / CACHE_NAME
        cached = pd.DataFrame(
            {
                "identifier": ["P01308"],
                **{k: [v] for k, v in _uniprot_row("INS").items()},
                "pfam": ["PF00049|1.0"],
            }
        )
        cached.to_parquet(cache_path, index=False)
        seen_by_interpro: dict = {}
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01315": "IGF"}, calls)
        _serve_interpro(
            monkeypatch,
            {"P01315": {"pfam": "PF00050|3.0"}},
            calls,
            on_fetch=lambda: seen_by_interpro.update(cache=pd.read_parquet(cache_path)),
        )

        ProteinAnnotationManager(
            headers=["P01308", "P01315"],
            annotations=["gene_name", "pfam"],
            output_path=cache_path,
            cached_data=cached,
            sources_to_fetch=dict(NOTHING_TO_FETCH),
        ).to_pd()

        assert calls == [("uniprot", ["P01315"]), ("interpro", ["P01315"])]
        assert seen_by_interpro["cache"]["identifier"].tolist() == ["P01308"]
        final = pd.read_parquet(cache_path).set_index("identifier")
        assert final.loc["P01315", "pfam"] == "PF00050|3.0"
        assert final.loc["P01315", "gene_name"] == "IGF"

    def test_new_rows_are_written_when_no_pending_source_is_cached(
        self, tmp_path, monkeypatch
    ):
        """A source with no cached column has nothing to wait for.

        InterPro is fetched for every protein here and the cache holds none of
        its columns, so the checkpoint after UniProt carries the new protein.
        """
        cache_path = tmp_path / CACHE_NAME
        cached = pd.DataFrame(
            {
                "identifier": ["P01308"],
                **{k: [v] for k, v in _uniprot_row("INS").items()},
            }
        )
        cached.to_parquet(cache_path, index=False)
        seen_by_interpro: dict = {}
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01315": "IGF"}, calls)
        _serve_interpro(
            monkeypatch,
            {"P01308": {"pfam": "PF00049|1.0"}, "P01315": {"pfam": "PF00050|3.0"}},
            calls,
            on_fetch=lambda: seen_by_interpro.update(cache=pd.read_parquet(cache_path)),
        )

        ProteinAnnotationManager(
            headers=["P01308", "P01315"],
            annotations=["gene_name", "pfam"],
            output_path=cache_path,
            cached_data=cached,
            sources_to_fetch={**NOTHING_TO_FETCH, "interpro": True},
        ).to_pd()

        checkpoint = seen_by_interpro["cache"].set_index("identifier")
        assert checkpoint.loc["P01315", "gene_name"] == "IGF"
        assert "pfam" not in checkpoint.columns

    def test_a_checkpoint_with_every_row_waiting_leaves_the_cache_alone(
        self, tmp_path, monkeypatch
    ):
        """Nothing this run fetched may be written yet, so nothing is written.

        UniProt is fetched for the one new protein, which then waits for
        InterPro. Writing the rest -- no rows -- would lose the cached ones.
        """
        cache_path = tmp_path / CACHE_NAME
        cached = pd.DataFrame(
            {"identifier": ["OLD1"], "gene_name": ["OLD"], "pfam": ["PF00001|1.0"]}
        )
        cached.to_parquet(cache_path, index=False)
        seen_by_interpro: dict = {}
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01308": "INS"}, calls)
        _serve_interpro(
            monkeypatch,
            {"P01308": {"pfam": "PF00049|1.0"}},
            calls,
            on_fetch=lambda: seen_by_interpro.update(cache=pd.read_parquet(cache_path)),
        )

        ProteinAnnotationManager(
            headers=["P01308"],
            annotations=["gene_name", "pfam"],
            output_path=cache_path,
            cached_data=cached,
            sources_to_fetch={**NOTHING_TO_FETCH, "uniprot": True},
        ).to_pd()

        pd.testing.assert_frame_equal(seen_by_interpro["cache"], cached)


class TestCacheWarnings:
    def test_a_cache_warning_is_logged_once_per_run(
        self, tmp_path, monkeypatch, caplog
    ):
        """Checkpoints apply the final write's rules, not its warnings again."""

        def uniprot_down(_retriever):
            raise RuntimeError("UniProt unavailable")

        monkeypatch.setattr(UniProtRetriever, "fetch_annotations", uniprot_down)
        calls: list = []
        _serve_interpro(monkeypatch, {"P01308": {"pfam": "PF00049|1.0"}}, calls)
        monkeypatch.setattr(
            TedRetriever,
            "fetch_annotations",
            lambda retriever: [
                ProteinAnnotations(identifier=h, annotations={"ted_domains": "-|90"})
                for h in retriever.headers
            ],
        )

        ProteinAnnotationManager(
            headers=["P01308"],
            annotations=["gene_name", "pfam", "ted_domains"],
            output_path=tmp_path / CACHE_NAME,
            sequences={"P01308": "MALWMRLLPL"},
        ).to_pd()

        assert caplog.text.count("Caching annotations at") == 1
        cached = pd.read_parquet(tmp_path / CACHE_NAME)
        assert cached["ted_domains"].tolist() == ["-|90"]
        assert "gene_name" not in cached.columns


class TestNothingWritten:
    def test_a_full_cache_hit_writes_nothing(self, tmp_path, monkeypatch):
        cache_path = tmp_path / CACHE_NAME
        pd.DataFrame(
            {
                "identifier": ["P01308"],
                **{k: [v] for k, v in _uniprot_row("INS").items()},
                "pfam": ["PF00049|1.0"],
            }
        ).to_parquet(cache_path, index=False)
        before = cache_path.stat().st_mtime_ns

        def no_fetch(*_args, **_kwargs):
            raise AssertionError("a full cache hit must not fetch")

        monkeypatch.setattr(UniProtRetriever, "fetch_annotations", no_fetch)
        monkeypatch.setattr(InterProRetriever, "fetch_annotations", no_fetch)

        _pipeline(tmp_path, ["gene_name", "pfam"])._fetch_annotations(["P01308"])

        assert cache_path.stat().st_mtime_ns == before
        assert sorted(p.name for p in tmp_path.iterdir()) == [CACHE_NAME]

    def test_no_output_path_writes_no_checkpoint(self, tmp_path, monkeypatch):
        calls: list = []
        _serve_uniprot(monkeypatch, {"P01308": "INS"}, calls)
        _serve_interpro(monkeypatch, {"P01308": {"pfam": "PF00049|1.0"}}, calls)
        monkeypatch.chdir(tmp_path)

        result = ProteinAnnotationManager(
            headers=["P01308"], annotations=["gene_name", "pfam"]
        ).to_pd()

        assert result["pfam"].tolist() == ["PF00049|1.0"]
        assert list(tmp_path.iterdir()) == []
