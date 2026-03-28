"""Tests for data formatters."""

from protspace.data.io.formatters import DataFormatter, ProteinAnnotations


class TestDataFormatterToDataframe:
    def test_basic(self):
        proteins = [
            ProteinAnnotations("P1", {"family": "kinase", "organism": "human"}),
            ProteinAnnotations("P2", {"family": "phosphatase", "organism": "mouse"}),
        ]
        df = DataFormatter.to_dataframe(proteins)
        assert list(df.columns) == ["identifier", "family", "organism"]
        assert len(df) == 2
        assert df.iloc[0]["identifier"] == "P1"
        assert df.iloc[1]["family"] == "phosphatase"

    def test_empty_list(self):
        df = DataFormatter.to_dataframe([])
        assert list(df.columns) == ["identifier"]
        assert len(df) == 0

    def test_missing_annotation_key(self):
        proteins = [
            ProteinAnnotations("P1", {"a": "1", "b": "2"}),
            ProteinAnnotations("P2", {"a": "3"}),  # missing "b"
        ]
        df = DataFormatter.to_dataframe(proteins)
        assert df.iloc[1]["b"] == ""


class TestDataFormatterToDictList:
    def test_basic(self):
        proteins = [
            ProteinAnnotations("P1", {"family": "kinase"}),
        ]
        result = DataFormatter.to_dict_list(proteins)
        assert result == [{"identifier": "P1", "family": "kinase"}]

    def test_empty(self):
        assert DataFormatter.to_dict_list([]) == []
