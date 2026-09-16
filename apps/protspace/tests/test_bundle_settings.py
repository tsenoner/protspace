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


class TestSettingsOnlyRead:
    """``read_settings_from_bundle`` must agree with ``read_bundle``'s second value.

    ``protspace style`` reads settings and nothing else; on a v3 container
    ``read_bundle`` would decode and re-serialize every annotation column first,
    so the settings-only reader exists purely to skip that.  It earns its place
    only while it stays byte-for-byte equivalent to the path it replaced.
    """

    def test_matches_read_bundle_on_v3_legacy_and_absent(self, tmp_path):
        import io

        import pyarrow as pa
        import pyarrow.parquet as pq

        from protspace.data.io.bundle import (
            PARQUET_BUNDLE_DELIMITER,
            read_bundle,
            read_settings_from_bundle,
            write_bundle,
        )

        settings = {"family": {"categories": {"kinase": {"color": "#FF0000"}}}}
        tables = [
            pa.table({"protein_id": ["p0", "p1"], "family": ["kinase", ""]}),
            pa.table({"projection_name": ["pca2"], "dimensions": [2]}),
            pa.table(
                {
                    "projection_name": ["pca2"] * 2,
                    "identifier": ["p0", "p1"],
                    "x": [0.0, 1.0],
                    "y": [2.0, 3.0],
                }
            ),
        ]

        v3 = tmp_path / "v3.parquetbundle"
        write_bundle(tables, v3, settings=settings)

        bare = tmp_path / "bare.parquetbundle"
        write_bundle(tables, bare)

        def serialized(table):
            buf = io.BytesIO()
            pq.write_table(table, buf)
            return buf.getvalue()

        legacy = tmp_path / "legacy.parquetbundle"
        legacy.write_bytes(
            PARQUET_BUNDLE_DELIMITER.join(
                [*(serialized(t) for t in tables), create_settings_parquet(settings)]
            )
        )

        for path, expected in ((v3, settings), (legacy, settings), (bare, None)):
            assert read_settings_from_bundle(path) == expected, path.name
            assert read_settings_from_bundle(path) == read_bundle(path)[1], path.name
