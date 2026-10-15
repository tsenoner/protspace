"""ArrowReader reads a .parquetbundle directly, and refuses a path that holds
no ProtSpace data instead of reading it as an empty dataset."""

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protspace.data.annotations.encoding import stamp_format_version
from protspace.data.io.bundle import extract_bundle_to_dir, write_bundle
from protspace.utils.arrow_reader import ArrowReader

SETTINGS = {"cath": {"categories": {"a": {"color": "#ff0000", "shape": "circle"}}}}


@pytest.fixture
def bundle(tmp_path):
    path = tmp_path / "data.parquetbundle"
    write_bundle(
        [
            stamp_format_version(
                pa.table({"protein_id": ["P1", "P2"], "cath": ["a", "b"]})
            ),
            pa.table(
                {"projection_name": ["pca2"], "dimensions": [2], "info_json": ["{}"]}
            ),
            pa.table(
                {
                    "projection_name": ["pca2", "pca2"],
                    "identifier": ["P1", "P2"],
                    "x": [0.0, 1.0],
                    "y": [0.0, 1.0],
                    "z": [None, None],
                }
            ),
        ],
        path,
        settings=SETTINGS,
    )
    return path


def test_bundle_reads_like_its_extracted_directory(bundle, tmp_path):
    from_bundle = ArrowReader(bundle)
    from_dir = ArrowReader(extract_bundle_to_dir(bundle, tmp_path / "out"))

    assert from_bundle.get_data() == from_dir.get_data()
    assert from_bundle.settings == from_dir.settings == SETTINGS
    assert sorted(from_bundle.get_protein_ids()) == ["P1", "P2"]
    assert from_bundle.get_projection_names() == ["pca2"]
    assert from_bundle.get_format_version() == 2


def test_file_that_is_not_a_bundle_is_rejected(tmp_path):
    other = tmp_path / "selected_annotations.parquet"
    pq.write_table(pa.table({"protein_id": ["P1"]}), other)
    with pytest.raises(ValueError, match="parquetbundle"):
        ArrowReader(other)


def test_missing_path_is_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        ArrowReader(tmp_path / "missing")


def test_directory_without_core_tables_is_rejected(tmp_path):
    pq.write_table(pa.table({"x": [1]}), tmp_path / "statistics.parquet")
    with pytest.raises(ValueError, match="contains none of"):
        ArrowReader(tmp_path)


def test_annotations_only_directory_still_loads(tmp_path):
    pq.write_table(
        pa.table({"protein_id": ["P1", "P2"], "cath": ["a", "b"]}),
        tmp_path / "selected_annotations.parquet",
    )
    reader = ArrowReader(tmp_path)
    assert sorted(reader.get_protein_ids()) == ["P1", "P2"]
    assert reader.get_projection_names() == []


def test_directory_save_reloads_with_its_data_and_restyled_colours(bundle, tmp_path):
    """`protspace style` on an unbundled parquet directory: what `save_data`
    writes reads back as annotations, projections and styles, not empty."""
    reader = ArrowReader(extract_bundle_to_dir(bundle, tmp_path / "in"))
    reader.update_annotation_color("cath", "b", "#00ff00")
    reader.save_data(tmp_path / "out")

    reloaded = ArrowReader(tmp_path / "out")
    assert reloaded.get_data() == reader.get_data()
    assert reloaded.get_protein_annotations("P2") == {"cath": "b"}
    assert reloaded.get_projection_names() == ["pca2"]
    assert reloaded.get_annotation_colors("cath")["b"] == "#00ff00"


def test_bundle_saves_to_a_directory_that_reads_back_alike(bundle, tmp_path):
    from_bundle = ArrowReader(bundle)
    from_bundle.save_data(tmp_path / "saved")

    assert ArrowReader(tmp_path / "saved").get_data() == from_bundle.get_data()


def test_bundle_save_without_an_output_directory_is_refused(bundle):
    """The default target is where the data came from; for a bundle that is a
    file, so there is nowhere to write the parquet tables, and the bundle is
    left untouched."""
    before = bundle.read_bytes()
    with pytest.raises(ValueError, match="output directory"):
        ArrowReader(bundle).save_data()
    assert bundle.read_bytes() == before


def test_dict_reader_save_is_refused_before_anything_is_written(tmp_path):
    reader = ArrowReader({"protein_data": {}, "projections": []})
    with pytest.raises(ValueError, match="parquet"):
        reader.save_data()
    with pytest.raises(ValueError, match="parquet"):
        reader.save_data(tmp_path / "out")
    assert not (tmp_path / "out").exists()
