"""Tests for CATH names file parsing."""

from src.protspace.data.annotations.retrievers.cath_names import _parse_cath_names


class TestParseCathNames:
    """Test parsing of the CATH names file (CNF 2.0 format)."""

    def test_all_levels(self, tmp_path):
        content = (
            "1                 1oaiA00    :Mainly Alpha\n"
            "2.60              4unuA00    :Sandwich\n"
            "2.60.40           1bqkA00    :Immunoglobulin-like\n"
            "2.60.40.10        4unuA00    :Immunoglobulins\n"
        )
        f = tmp_path / "cath-names.txt"
        f.write_text(content)

        names = _parse_cath_names(f)

        assert names["1"] == "Mainly Alpha"
        assert names["2.60"] == "Sandwich"
        assert names["2.60.40"] == "Immunoglobulin-like"
        assert names["2.60.40.10"] == "Immunoglobulins"

    def test_unnamed_superfamily_has_no_name(self, tmp_path):
        """An unnamed superfamily must NOT inherit the parent topology name (#57)."""
        content = (
            "6.20.10           3s6xC01    :Laminin\n"
            "6.20.10.10        1lmmA01    :\n"
            "6.20.10.20        3s6xC01    :\n"
        )
        f = tmp_path / "cath-names.txt"
        f.write_text(content)

        names = _parse_cath_names(f)

        assert names["6.20.10"] == "Laminin"  # topology keeps its name
        assert "6.20.10.10" not in names  # unnamed → absent (bare code used)
        assert "6.20.10.20" not in names  # siblings stay distinct

    def test_skips_comments_and_empty_lines(self, tmp_path):
        content = (
            "# This is a comment\n\n1                 1oaiA00    :Mainly Alpha\n\n"
        )
        f = tmp_path / "cath-names.txt"
        f.write_text(content)

        names = _parse_cath_names(f)

        assert names == {"1": "Mainly Alpha"}

    def test_named_superfamily_not_overwritten(self, tmp_path):
        """A superfamily with its own name should not be overwritten by parent."""
        content = (
            "2.60.40           1bqkA00    :Immunoglobulin-like\n"
            "2.60.40.10        4unuA00    :Immunoglobulins\n"
        )
        f = tmp_path / "cath-names.txt"
        f.write_text(content)

        names = _parse_cath_names(f)

        assert names["2.60.40.10"] == "Immunoglobulins"
