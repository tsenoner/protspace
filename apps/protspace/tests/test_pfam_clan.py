"""Tests for Pfam CLAN annotation transformer."""

from unittest.mock import patch

from src.protspace.data.annotations.transformers.interpro_transforms import (
    InterProTransformer,
    _parse_pfam_clans_tsv,
)


class TestPfamClanTransformer:
    """Test Pfam CLAN mapping from Pfam accessions to clan IDs."""

    MOCK_MAPPING = {
        "PF00102": "CL0031 (Phosphatase)",
        "PF00481": "CL0238 (PP2C)",
        "PF00041": "CL0159 (E-set)",
        "PF06602": "CL0031 (Phosphatase)",
    }

    def test_single_pfam_with_clan(self):
        result = InterProTransformer.transform_pfam_clan(
            "PF00102 (Y_phosphatase)", self.MOCK_MAPPING
        )
        assert result == "CL0031 (Phosphatase)"

    def test_multiple_pfam_different_clans(self):
        result = InterProTransformer.transform_pfam_clan(
            "PF00041 (fn3);PF00102 (Y_phosphatase)", self.MOCK_MAPPING
        )
        # Sorted output
        assert "CL0031 (Phosphatase)" in result
        assert "CL0159 (E-set)" in result

    def test_multiple_pfam_same_clan(self):
        """Two Pfam families in the same clan should produce one entry."""
        result = InterProTransformer.transform_pfam_clan(
            "PF00102 (Y_phosphatase);PF06602 (Myotub-related)", self.MOCK_MAPPING
        )
        assert result == "CL0031 (Phosphatase)"

    def test_pfam_without_clan(self):
        """Pfam family not in any clan → empty string."""
        result = InterProTransformer.transform_pfam_clan(
            "PF99999 (Unknown)", self.MOCK_MAPPING
        )
        assert result == ""

    def test_empty_pfam_value(self):
        result = InterProTransformer.transform_pfam_clan("", self.MOCK_MAPPING)
        assert result == ""

    def test_pfam_with_scores(self):
        """Pfam values with score format should still extract accessions."""
        result = InterProTransformer.transform_pfam_clan(
            "PF00102 (Y_phosphatase)|50.2;PF00481 (PP2C)|60.5", self.MOCK_MAPPING
        )
        assert "CL0031 (Phosphatase)" in result
        assert "CL0238 (PP2C)" in result


class TestParsePfamClansTsv:
    """Test TSV parsing logic."""

    def test_parse_tsv(self, tmp_path):
        tsv_content = (
            "PF00001\tCL0192\tGPCR_A\t7tm_1\t7 transmembrane receptor\n"
            "PF00004\tCL0023\tP-loop_NTPase\tAAA\tATPase family\n"
            "PF00015\t\t\tMCPsignal\tChemotaxis domain\n"  # No clan
        )
        tsv_file = tmp_path / "pfam_clans.tsv"
        tsv_file.write_text(tsv_content)

        mapping = _parse_pfam_clans_tsv(tsv_file)

        assert mapping["PF00001"] == "CL0192 (GPCR_A)"
        assert mapping["PF00004"] == "CL0023 (P-loop_NTPase)"
        assert "PF00015" not in mapping  # No clan → not in mapping
