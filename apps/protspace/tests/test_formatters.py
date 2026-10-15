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

    def test_key_only_on_a_later_record_is_kept(self):
        """Schema is the union of all records, not just the first one.

        Unresolved identifiers are appended first and get no taxonomy keys, so
        deriving the schema from record 0 silently dropped every column that
        only resolved proteins carry.
        """
        proteins = [
            ProteinAnnotations("unresolved", {"organism_id": ""}),
            ProteinAnnotations("P01308", {"organism_id": "9606", "genus": "Homo"}),
        ]
        df = DataFormatter.to_dataframe(proteins)
        assert list(df.columns) == ["identifier", "organism_id", "genus"]
        assert df["genus"].tolist() == ["", "Homo"]


class TestDataFormatterToDictList:
    def test_basic(self):
        proteins = [
            ProteinAnnotations("P1", {"family": "kinase"}),
        ]
        result = DataFormatter.to_dict_list(proteins)
        assert result == [{"identifier": "P1", "family": "kinase"}]

    def test_empty(self):
        assert DataFormatter.to_dict_list([]) == []
