"""Tests for UniProt query FASTA downloads and publication."""

import gzip
import os
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


def _mock_download(monkeypatch, fasta: str) -> None:
    response = _Response(gzip.compress(fasta.encode()))
    monkeypatch.setattr(query_module.requests, "get", lambda *args, **kwargs: response)


def test_query_uniprot_does_not_publish_unvalidated_fasta(tmp_path, monkeypatch):
    target = tmp_path / "query.fasta"
    _mock_download(monkeypatch, ">P1\nAAAA\n>P2\nCCCC\n")
    monkeypatch.setattr(
        query_module, "extract_identifiers_from_fasta", lambda _path: ["P1"]
    )

    with pytest.raises(ValueError, match="do not match the download"):
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
