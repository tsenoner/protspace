"""Tests for parquetbundle settings serialization."""

from protspace.data.io.bundle import create_settings_parquet, read_settings_from_bytes


class TestSettingsRoundtrip:
    def test_simple_dict(self):
        original = {"key": "value", "number": 42}
        data = create_settings_parquet(original)
        assert isinstance(data, bytes)
        result = read_settings_from_bytes(data)
        assert result == original

    def test_nested_dict(self):
        original = {
            "family": {
                "categories": {
                    "kinase": {"color": "#FF0000", "zOrder": 0},
                },
                "sortMode": "size-desc",
            }
        }
        data = create_settings_parquet(original)
        result = read_settings_from_bytes(data)
        assert result == original

    def test_empty_dict(self):
        data = create_settings_parquet({})
        result = read_settings_from_bytes(data)
        assert result == {}

    def test_list_values(self):
        original = {"hiddenValues": ["a", "b"], "nested": [1, 2, 3]}
        data = create_settings_parquet(original)
        result = read_settings_from_bytes(data)
        assert result == original
