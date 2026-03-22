"""Tests for FASTA parsing utilities."""

import tempfile
from pathlib import Path

import pytest

from src.protspace.data.io.fasta import FASTA_EXTENSIONS, is_fasta_file, parse_fasta


class TestParseFasta:
    """Test parse_fasta function."""

    def test_basic_parsing(self):
        """Test basic FASTA parsing with two sequences."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".fasta", delete=False) as f:
            f.write(">P01308 Insulin\nMKSGS\nLFVLL\n>P01315 IGF1\nMEKKAL\n")
            f.flush()

            result = parse_fasta(Path(f.name))

        assert result == {"P01308": "MKSGSLFVLL", "P01315": "MEKKAL"}

    def test_duplicate_headers(self):
        """Test that duplicate headers keep first occurrence."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".fasta", delete=False) as f:
            f.write(">P01308\nAAAA\n>P01315\nBBBB\n>P01308\nCCCC\n")
            f.flush()

            result = parse_fasta(Path(f.name))

        assert result == {"P01308": "AAAA", "P01315": "BBBB"}

    def test_empty_sequences_skipped(self):
        """Test that entries with empty sequences are skipped."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".fasta", delete=False) as f:
            f.write(">P01308\nAAAA\n>EMPTY\n>P01315\nBBBB\n")
            f.flush()

            result = parse_fasta(Path(f.name))

        assert result == {"P01308": "AAAA", "P01315": "BBBB"}

    def test_multiline_sequences(self):
        """Test multi-line sequences are concatenated."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".fasta", delete=False) as f:
            f.write(">P01308\nAAAA\nBBBB\nCCCC\n")
            f.flush()

            result = parse_fasta(Path(f.name))

        assert result == {"P01308": "AAAABBBBCCCC"}

    def test_empty_file(self):
        """Test empty file returns empty dict."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".fasta", delete=False) as f:
            f.write("")
            f.flush()

            result = parse_fasta(Path(f.name))

        assert result == {}

    def test_header_whitespace_extraction(self):
        """Test that only first word after > is used as header."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".fasta", delete=False) as f:
            f.write(">sp|P01308|INS_HUMAN Insulin OS=Homo sapiens\nMKSGS\n")
            f.flush()

            result = parse_fasta(Path(f.name))

        assert "sp|P01308|INS_HUMAN" in result
        assert result["sp|P01308|INS_HUMAN"] == "MKSGS"

    def test_trailing_whitespace_stripped(self):
        """Test that trailing whitespace in sequence lines is stripped."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".fasta", delete=False) as f:
            f.write(">P01308\nAAAA   \nBBBB\t\n")
            f.flush()

            result = parse_fasta(Path(f.name))

        assert result == {"P01308": "AAAABBBB"}


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

    def test_fasta_extensions_constant(self):
        """Verify the FASTA_EXTENSIONS set."""
        assert FASTA_EXTENSIONS == {".fasta", ".fa", ".faa"}
