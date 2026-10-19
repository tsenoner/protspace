"""Tests for FASTA parsing utilities."""

from pathlib import Path

import pytest

from protspace.data.io.fasta import is_fasta_file, parse_fasta


class TestParseFasta:
    """Test parse_fasta function."""

    @pytest.mark.parametrize(
        "text,expected",
        [
            pytest.param(
                ">P01308 Insulin\nMKSGS\nLFVLL\n>P01315 IGF1\nMEKKAL\n",
                {"P01308": "MKSGSLFVLL", "P01315": "MEKKAL"},
                id="basic",
            ),
            pytest.param(
                ">P01308\nAAAA\n>P01315\nBBBB\n>P01308\nCCCC\n",
                {"P01308": "AAAA", "P01315": "BBBB"},
                id="duplicate_header_keeps_first",
            ),
            pytest.param(
                ">P01308\nAAAA\n>P01308\nCCCC\n>P01315\nBBBB\n",
                {"P01308": "AAAA", "P01315": "BBBB"},
                id="duplicate_header_mid_file_keeps_first",
            ),
            pytest.param(
                ">P01308\nAAAA\n>EMPTY\n>P01315\nBBBB\n",
                {"P01308": "AAAA", "P01315": "BBBB"},
                id="empty_sequence_skipped",
            ),
            pytest.param(
                ">P01308\nAAAA\nBBBB\nCCCC\n",
                {"P01308": "AAAABBBBCCCC"},
                id="multiline_concatenated",
            ),
            pytest.param("", {}, id="empty_file"),
            pytest.param(
                ">sp|P01308|INS_HUMAN Insulin OS=Homo sapiens\nMKSGS\n",
                {"sp|P01308|INS_HUMAN": "MKSGS"},
                id="header_is_first_word",
            ),
            pytest.param(
                ">P01308\nAAAA   \nBBBB\t\n",
                {"P01308": "AAAABBBB"},
                id="trailing_whitespace_stripped",
            ),
        ],
    )
    def test_parse_fasta(self, tmp_path, text, expected):
        fasta = tmp_path / "seqs.fasta"
        fasta.write_text(text)

        assert parse_fasta(fasta) == expected


class TestIsFastaFile:
    """Test is_fasta_file extension detection."""

    @pytest.mark.parametrize("ext", [".fasta", ".fa", ".faa"])
    def test_fasta_extensions(self, ext):
        """Test recognised FASTA extensions."""
        assert is_fasta_file(Path(f"sequences{ext}")) is True

    @pytest.mark.parametrize("ext", [".h5", ".hdf5", ".csv", ".txt", ".json"])
    def test_non_fasta_extensions(self, ext):
        """Test non-FASTA extensions are rejected."""
        assert is_fasta_file(Path(f"data{ext}")) is False

    def test_case_insensitive(self):
        """Test case-insensitive extension matching."""
        assert is_fasta_file(Path("seqs.FASTA")) is True
        assert is_fasta_file(Path("seqs.Fa")) is True
