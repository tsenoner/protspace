"""Tests for UniProt query FASTA downloads and publication."""

import gzip
import os
import random
import stat
from pathlib import Path

import pytest

from protspace.data.loaders import query as query_module


class _Response:
    headers: dict[str, str] = {}

    def __init__(self, content: bytes):
        self.content = content

    def raise_for_status(self) -> None:
        pass

    def iter_content(self, chunk_size: int):
        yield self.content


def _mock_download(monkeypatch, fasta: str, *, truncate: bool = False) -> None:
    payload = gzip.compress(fasta.encode())
    if truncate:
        payload = payload[: len(payload) // 2]
    response = _Response(payload)
    monkeypatch.setattr(query_module.requests, "get", lambda *args, **kwargs: response)


def test_query_uniprot_does_not_publish_a_truncated_download(tmp_path, monkeypatch):
    target = tmp_path / "query.fasta"
    # Incompressible residues, so half the gzip stream still decompresses to
    # something: extraction fails after writing part of its output.
    residues = random.Random(0).choices("ACDEFGHIKLMNPQRSTVWY", k=200_000)
    fasta = "".join(
        f">P{i}\n{''.join(residues[i * 1000 : (i + 1) * 1000])}\n" for i in range(200)
    )
    _mock_download(monkeypatch, fasta, truncate=True)

    with pytest.raises(EOFError):
        query_module.query_uniprot("family:globin", save_to=target)

    assert list(tmp_path.iterdir()) == []


def test_query_uniprot_atomically_publishes_complete_fasta(tmp_path, monkeypatch):
    target = tmp_path / "query.fasta"
    fasta = ">sp|P1|ONE Protein one\nAAAA\n>P2 Protein two\nCCCC\n"
    _mock_download(monkeypatch, fasta)

    identifiers, path = query_module.query_uniprot("family:globin", save_to=target)

    assert identifiers == ["P1", "P2"]
    assert path == target
    assert target.read_text() == fasta
    assert list(tmp_path.iterdir()) == [target]


def test_query_uniprot_publishes_fasta_with_process_umask(tmp_path, monkeypatch):
    target = tmp_path / "query.fasta"
    _mock_download(monkeypatch, ">P1\nAAAA\n")
    previous_umask = os.umask(0o027)

    try:
        query_module.query_uniprot("family:globin", save_to=target)
    finally:
        os.umask(previous_umask)

    assert stat.S_IMODE(target.stat().st_mode) == 0o640


# ---------------------------------------------------------------------------
# Retained query FASTA ownership
# ---------------------------------------------------------------------------


def _recording_download(monkeypatch, fasta=">P1\nAAAA\n"):
    """Record every query that reaches query_uniprot, and write its FASTA."""
    downloaded = []

    def fake_query_uniprot(query, *, save_to=None):
        downloaded.append(query)
        save_to.parent.mkdir(parents=True, exist_ok=True)
        save_to.write_text(fasta)
        return ["P1"], save_to

    monkeypatch.setattr(query_module, "query_uniprot", fake_query_uniprot)
    return downloaded


def test_a_second_query_does_not_reuse_the_first_query_fasta(tmp_path, monkeypatch):
    downloaded = _recording_download(monkeypatch)

    _, first = query_module.resolve_query_fasta("family:globin", tmp_path, frozenset())
    _, second = query_module.resolve_query_fasta(
        "family:phosphatase", tmp_path, frozenset()
    )

    assert downloaded == ["family:globin", "family:phosphatase"]
    assert first != second


def test_the_same_query_reuses_its_retained_fasta(tmp_path, monkeypatch):
    downloaded = _recording_download(monkeypatch)
    query = "family:globin"

    _, first = query_module.resolve_query_fasta(query, tmp_path, frozenset())
    headers, again = query_module.resolve_query_fasta(query, tmp_path, frozenset())

    assert downloaded == [query]
    assert again == first
    assert headers == ["P1"]


def test_refetch_query_downloads_again(tmp_path, monkeypatch):
    downloaded = _recording_download(monkeypatch)
    query = "family:globin"

    query_module.resolve_query_fasta(query, tmp_path, frozenset())
    query_module.resolve_query_fasta(query, tmp_path, frozenset({"query"}))

    assert downloaded == [query, query]
