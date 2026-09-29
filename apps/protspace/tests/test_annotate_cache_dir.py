"""`protspace annotate --cache-dir` resumes from, and shares, prepare's annotation cache.

All HTTP is mocked: each retriever's `fetch_annotations` is replaced, and a
source the test says must not be called raises instead.
"""

import pandas as pd
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.cli.common_options import ANNOTATION_SOURCES
from protspace.data.annotations.configuration import SOURCE_ANNOTATIONS
from protspace.data.annotations.encoding import (
    ANNOTATION_CACHE_VERSION,
    ANNOTATION_CACHE_VERSION_ATTR,
)
from protspace.data.annotations.retrievers.interpro_retriever import (
    InterProRetriever,
)
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.processors.pipeline import PipelineConfig, ReductionPipeline

CACHE_NAME = "all_annotations.parquet"
SEQUENCES = {"P01308": "MALWMRLLPL", "P01315": "MGKISSLPTQ"}
GENES = {"P01308": "INS", "P01315": "IGF1"}
PFAM = {"P01308": "PF00049|1.0", "P01315": "PF00050|2.0"}


def _uniprot_row(identifier: str) -> dict:
    gene = GENES[identifier]
    return {
        "gene_name": gene,
        "protein_name": f"{gene} protein",
        "uniprot_kb_id": f"{gene}_HUMAN",
        "organism_id": "9606",
        "sequence": SEQUENCES[identifier],
        "xref_pdb": "True",
    }


@pytest.fixture
def fasta(tmp_path):
    path = tmp_path / "input.fasta"
    path.write_text("".join(f">{h}\n{s}\n" for h, s in SEQUENCES.items()))
    return path


@pytest.fixture
def calls():
    return []


@pytest.fixture
def uniprot(monkeypatch, calls):
    def fetch(retriever):
        calls.append(("uniprot", list(retriever.headers)))
        return [
            ProteinAnnotations(identifier=h, annotations=_uniprot_row(h))
            for h in retriever.headers
        ]

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fetch)


def _serve_interpro(monkeypatch, calls, pfam=PFAM):
    def fetch(retriever):
        calls.append(("interpro", list(retriever.headers)))
        return [
            ProteinAnnotations(identifier=h, annotations={"pfam": pfam[h]})
            for h in retriever.headers
        ]

    monkeypatch.setattr(InterProRetriever, "fetch_annotations", fetch)


def _forbid(monkeypatch, retriever_cls, name):
    def fail(_retriever):
        raise AssertionError(f"{name} must not be called")

    monkeypatch.setattr(retriever_cls, "fetch_annotations", fail)


def _annotate(*args):
    return CliRunner().invoke(app, ["annotate", *map(str, args)])


class TestResume:
    def test_an_interrupted_run_resumes_with_the_remaining_sources(
        self, tmp_path, fasta, uniprot, calls, monkeypatch
    ):
        cache_dir = tmp_path / "cache"
        out = tmp_path / "resumed.parquet"

        def interrupted(_retriever):
            raise KeyboardInterrupt

        monkeypatch.setattr(InterProRetriever, "fetch_annotations", interrupted)
        first = _annotate(
            "-i", fasta, "-a", "gene_name,pfam", "-o", out, "--cache-dir", cache_dir
        )

        assert first.exit_code != 0
        assert not out.exists()
        cached = pd.read_parquet(cache_dir / CACHE_NAME)
        assert cached["gene_name"].tolist() == ["INS", "IGF1"]

        calls.clear()
        _forbid(monkeypatch, UniProtRetriever, "UniProt")
        _serve_interpro(monkeypatch, calls)
        resumed = _annotate(
            "-i", fasta, "-a", "gene_name,pfam", "-o", out, "--cache-dir", cache_dir
        )

        assert resumed.exit_code == 0, resumed.output
        assert calls == [("interpro", ["P01308", "P01315"])]

        # One uninterrupted run, cached elsewhere, writes the same file.
        monkeypatch.undo()
        calls.clear()
        _serve_interpro(monkeypatch, calls)
        monkeypatch.setattr(
            UniProtRetriever,
            "fetch_annotations",
            lambda retriever: [
                ProteinAnnotations(identifier=h, annotations=_uniprot_row(h))
                for h in retriever.headers
            ],
        )
        clean_out = tmp_path / "clean.parquet"
        clean = _annotate(
            "-i",
            fasta,
            "-a",
            "gene_name,pfam",
            "-o",
            clean_out,
            "--cache-dir",
            tmp_path / "clean_cache",
        )
        assert clean.exit_code == 0, clean.output
        pd.testing.assert_frame_equal(pd.read_parquet(out), pd.read_parquet(clean_out))

    def test_added_proteins_are_filled_in(
        self, tmp_path, fasta, uniprot, calls, monkeypatch
    ):
        cache_dir = tmp_path / "cache"
        one = tmp_path / "one.fasta"
        one.write_text(f">P01308\n{SEQUENCES['P01308']}\n")
        assert (
            _annotate(
                "-i",
                one,
                "-a",
                "gene_name",
                "--cache-dir",
                cache_dir,
                "-o",
                tmp_path / "one.parquet",
            ).exit_code
            == 0
        )
        calls.clear()

        result = _annotate(
            "-i",
            fasta,
            "-a",
            "gene_name",
            "-o",
            tmp_path / "two.parquet",
            "--cache-dir",
            cache_dir,
        )

        assert result.exit_code == 0, result.output
        assert calls == [("uniprot", ["P01315"])]
        written = pd.read_parquet(tmp_path / "two.parquet")
        assert written["gene_name"].tolist() == ["INS", "IGF1"]


class TestSharedWithPrepare:
    def test_a_prepare_cache_is_reused_without_any_api_call(
        self, tmp_path, fasta, uniprot, calls, monkeypatch
    ):
        prepare_tmp = tmp_path / "out" / "tmp"
        _serve_interpro(monkeypatch, calls)
        ReductionPipeline(
            PipelineConfig(
                methods=[],
                output_path=None,
                keep_tmp=True,
                intermediate_dir=prepare_tmp,
                annotations=["gene_name", "pfam"],
            )
        )._fetch_annotations(list(SEQUENCES))
        assert (prepare_tmp / CACHE_NAME).exists()

        _forbid(monkeypatch, UniProtRetriever, "UniProt")
        _forbid(monkeypatch, InterProRetriever, "InterPro")
        out = tmp_path / "annotations.parquet"
        result = _annotate(
            "-i", fasta, "-a", "gene_name,pfam", "-o", out, "--cache-dir", prepare_tmp
        )

        assert result.exit_code == 0, result.output
        written = pd.read_parquet(out)
        assert written["identifier"].tolist() == ["P01308", "P01315"]
        assert written["pfam"].tolist() == ["PF00049|1.0", "PF00050|2.0"]

    def test_a_cache_covering_more_proteins_yields_only_the_input_rows(
        self, tmp_path, uniprot, calls, monkeypatch
    ):
        cache_dir = tmp_path / "cache"
        both = tmp_path / "both.fasta"
        both.write_text("".join(f">{h}\n{s}\n" for h, s in SEQUENCES.items()))
        assert (
            _annotate(
                "-i",
                both,
                "-a",
                "gene_name",
                "--cache-dir",
                cache_dir,
                "-o",
                tmp_path / "both.parquet",
            ).exit_code
            == 0
        )

        _forbid(monkeypatch, UniProtRetriever, "UniProt")
        one = tmp_path / "one.fasta"
        one.write_text(f">P01315\n{SEQUENCES['P01315']}\n")
        out = tmp_path / "one.parquet"
        result = _annotate(
            "-i", one, "-a", "gene_name", "-o", out, "--cache-dir", cache_dir
        )

        assert result.exit_code == 0, result.output
        assert pd.read_parquet(out)["identifier"].tolist() == ["P01315"]


class TestRefetch:
    def test_refetch_interpro_fetches_it_again(
        self, tmp_path, fasta, uniprot, calls, monkeypatch
    ):
        cache_dir = tmp_path / "cache"
        _serve_interpro(monkeypatch, calls)
        args = ["-i", fasta, "-a", "gene_name,pfam", "--cache-dir", cache_dir]
        assert _annotate(*args, "-o", tmp_path / "a.parquet").exit_code == 0

        calls.clear()
        _forbid(monkeypatch, UniProtRetriever, "UniProt")
        newer = {h: f"PF99999|{i}.0" for i, h in enumerate(SEQUENCES)}
        _serve_interpro(monkeypatch, calls, pfam=newer)
        out = tmp_path / "b.parquet"
        result = _annotate(*args, "-o", out, "--refetch", "interpro")

        assert result.exit_code == 0, result.output
        assert calls == [("interpro", ["P01308", "P01315"])]
        assert pd.read_parquet(out)["pfam"].tolist() == list(newer.values())
        cached = pd.read_parquet(cache_dir / CACHE_NAME)
        assert cached["pfam"].tolist() == list(newer.values())

    def test_refetch_without_a_cache_dir_is_a_usage_error(
        self, tmp_path, fasta, monkeypatch
    ):
        _forbid(monkeypatch, UniProtRetriever, "UniProt")
        out = tmp_path / "annotations.parquet"

        result = _annotate("-i", fasta, "-o", out, "--refetch", "uniprot")

        assert result.exit_code == 2
        assert "--cache-dir" in result.output
        assert not out.exists()

    @pytest.mark.parametrize("stage", ["embed", "all", "bogus"])
    def test_refetch_accepts_only_annotation_stages(
        self, tmp_path, fasta, monkeypatch, stage
    ):
        _forbid(monkeypatch, UniProtRetriever, "UniProt")

        result = _annotate(
            "-i", fasta, "--cache-dir", tmp_path / "cache", "--refetch", stage
        )

        assert result.exit_code == 2
        assert "Unknown refetch stage" in result.output


class TestNoCacheDir:
    def test_no_cache_file_is_created(self, tmp_path, fasta, uniprot, monkeypatch):
        monkeypatch.chdir(tmp_path)

        result = _annotate("-i", fasta, "-a", "gene_name", "-o", "out.parquet")

        assert result.exit_code == 0, result.output
        assert sorted(p.name for p in tmp_path.rglob("*")) == [
            "input.fasta",
            "out.parquet",
        ]


class TestInternalColumns:
    @pytest.fixture
    def cache_dir(self, tmp_path, fasta, uniprot):
        cache_dir = tmp_path / "cache"
        assert (
            _annotate(
                "-i",
                fasta,
                "-a",
                "gene_name",
                "--cache-dir",
                cache_dir,
                "-o",
                tmp_path / "seed.parquet",
            ).exit_code
            == 0
        )
        cached = pd.read_parquet(cache_dir / CACHE_NAME)
        assert {"organism_id", "sequence"} <= set(cached.columns)
        return cache_dir

    @pytest.mark.parametrize(
        "annotations", [["-a", "gene_name"], []], ids=["explicit", "default"]
    )
    def test_output_from_the_cache_omits_internal_columns(
        self, tmp_path, fasta, cache_dir, annotations
    ):
        out = tmp_path / "out.parquet"

        result = _annotate(
            "-i", fasta, *annotations, "-o", out, "--cache-dir", cache_dir
        )

        assert result.exit_code == 0, result.output
        columns = set(pd.read_parquet(out).columns)
        assert not columns & {"organism_id", "sequence"}

    def test_a_requested_internal_column_is_written(self, tmp_path, fasta, cache_dir):
        out = tmp_path / "out.parquet"

        result = _annotate(
            "-i", fasta, "-a", "gene_name,sequence", "-o", out, "--cache-dir", cache_dir
        )

        assert result.exit_code == 0, result.output
        assert pd.read_parquet(out)["sequence"].tolist() == list(SEQUENCES.values())


class TestLegacyCache:
    def test_a_legacy_cache_is_refreshed(
        self, tmp_path, fasta, uniprot, calls, monkeypatch
    ):
        """Stale columns go through the same refresh as prepare's cache."""
        cache_dir = tmp_path / "cache"
        cache_dir.mkdir()
        pd.DataFrame(
            {
                "identifier": list(SEQUENCES),
                "xref_pdb": ["", ""],
                "gene_name": ["STALE", "STALE"],
                "protein_name": ["", ""],
                "uniprot_kb_id": ["", ""],
            }
        ).to_parquet(cache_dir / CACHE_NAME, index=False)
        out = tmp_path / "out.parquet"

        result = _annotate(
            "-i", fasta, "-a", "xref_pdb", "-o", out, "--cache-dir", cache_dir
        )

        assert result.exit_code == 0, result.output
        assert calls == [("uniprot", ["P01308", "P01315"])]
        assert pd.read_parquet(out)["xref_pdb"].tolist() == ["True", "True"]
        cached = pd.read_parquet(cache_dir / CACHE_NAME)
        assert cached.attrs[ANNOTATION_CACHE_VERSION_ATTR] == ANNOTATION_CACHE_VERSION


def test_refetch_stages_name_every_annotation_source():
    """The CLI's list and the cache's list of sources must not drift apart."""
    assert set(SOURCE_ANNOTATIONS) == ANNOTATION_SOURCES
