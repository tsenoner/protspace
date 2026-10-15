"""`protspace export` and `read_bundle_table`: a bundle as one TSV table."""

import pandas as pd
import pyarrow as pa
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.encoding import stamp_format_version
from protspace.data.io.bundle import read_bundle_table, write_bundle
from tests.cli_output import plain


def _bundle(tmp_path, *, id_col="protein_id"):
    """Three proteins: scored, encoded and multi-hit cells, an EAT trio, a cluster
    column, and a 2D projection that does not place p2."""
    annotations = stamp_format_version(
        pa.table(
            {
                id_col: ["p0", "p1", "p2"],
                "fam": ["Kunitz%3B BPTI|0.9", "", "A|EXP;B|0.5"],
                "fam__pred_value": [None, "Kunitz%3B BPTI", None],
                "fam__pred_confidence": pa.array([None, 0.75, None], pa.float32()),
                "fam__pred_source": [None, "p0", None],
                "cluster_elbow_UMAP 2": ["cluster 0", "cluster 0", "cluster 1"],
            }
        )
    )
    metadata = pa.table({"projection_name": ["UMAP 2"], "dimensions": [2]})
    coordinates = pa.table(
        {
            "projection_name": ["UMAP 2", "UMAP 2"],
            "identifier": ["p0", "p1"],
            "x": pa.array([1.5, -2.0], pa.float32()),
            "y": pa.array([0.25, 3.0], pa.float32()),
        }
    )
    path = tmp_path / "data.parquetbundle"
    write_bundle([annotations, metadata, coordinates], path)
    return path


def _export(*args):
    return CliRunner().invoke(app, ["export", *map(str, args)], env={"COLUMNS": "200"})


def test_read_bundle_table_holds_display_values_in_bundle_order(tmp_path):
    table = read_bundle_table(_bundle(tmp_path))
    assert list(table.columns) == [
        "protein_id",
        "fam",
        "fam__pred_value",
        "fam__pred_confidence",
        "fam__pred_source",
        "cluster_elbow_UMAP 2",
    ]
    assert table["protein_id"].tolist() == ["p0", "p1", "p2"]
    # Score and evidence suffixes dropped, percent-encoding decoded, hits joined.
    assert table["fam"].tolist() == ["Kunitz; BPTI", "", "A;B"]
    assert table.loc[1, "fam__pred_value"] == "Kunitz; BPTI"
    assert table.loc[1, "fam__pred_source"] == "p0"
    assert table["fam__pred_confidence"].tolist()[1] == pytest.approx(0.75)
    assert pd.isna(table.loc[0, "fam__pred_confidence"])
    assert table["cluster_elbow_UMAP 2"].tolist() == ["cluster 0"] * 2 + ["cluster 1"]


def test_read_bundle_table_adds_the_coordinates_asked_for(tmp_path):
    table = read_bundle_table(_bundle(tmp_path), ["UMAP 2"])
    assert list(table.columns[:3]) == ["protein_id", "UMAP 2_x", "UMAP 2_y"]
    assert "UMAP 2_z" not in table.columns
    assert table["UMAP 2_x"].tolist()[:2] == [1.5, -2.0]
    assert table["UMAP 2_y"].tolist()[:2] == [0.25, 3.0]
    # p2 is not placed: no coordinates, annotations still there.
    assert pd.isna(table.loc[2, "UMAP 2_x"])
    assert table.loc[2, "fam"] == "A;B"


def test_read_bundle_table_writes_no_z_for_a_legacy_3d_projection(tmp_path):
    annotations = stamp_format_version(pa.table({"protein_id": ["p0"]}))
    metadata = pa.table({"projection_name": ["PCA 3"], "dimensions": [3]})
    coordinates = pa.table(
        {
            "projection_name": ["PCA 3"],
            "identifier": ["p0"],
            "x": pa.array([1.0], pa.float32()),
            "y": pa.array([2.0], pa.float32()),
            "z": pa.array([3.0], pa.float32()),
        }
    )
    path = tmp_path / "data.parquetbundle"
    write_bundle([annotations, metadata, coordinates], path)
    table = read_bundle_table(path, ["PCA 3"])
    assert list(table.columns) == ["protein_id", "PCA 3_x", "PCA 3_y"]


def test_read_bundle_table_names_the_id_column_protein_id(tmp_path):
    table = read_bundle_table(_bundle(tmp_path, id_col="identifier"))
    assert table.columns[0] == "protein_id"
    assert "identifier" not in table.columns


def test_cli_export_writes_a_tsv(tmp_path):
    out = tmp_path / "out" / "space.tsv"
    result = _export(_bundle(tmp_path), out, "-p", "UMAP 2")
    assert result.exit_code == 0, result.output
    assert "Saved 3 proteins" in result.output

    lines = out.read_text().splitlines()
    assert lines[0].split("\t")[:4] == ["protein_id", "UMAP 2_x", "UMAP 2_y", "fam"]
    table = pd.read_csv(out, sep="\t", keep_default_na=False)
    assert table["fam"].tolist() == ["Kunitz; BPTI", "", "A;B"]
    assert table["UMAP 2_x"].tolist() == ["1.5", "-2.0", ""]  # p2 unplaced


def test_cli_export_unknown_projection_is_a_usage_error(tmp_path):
    out = tmp_path / "space.tsv"
    result = _export(_bundle(tmp_path), out, "-p", "UMAP 3")
    assert result.exit_code == 2
    output = plain(result.output)
    assert "'UMAP 3'" in output
    assert "'UMAP 2'" in output  # the names it does hold
    assert not out.exists()


def test_cli_export_unreadable_bundle_is_a_usage_error(tmp_path):
    bad = tmp_path / "bad.parquetbundle"
    bad.write_bytes(b"not a bundle")
    result = _export(bad, tmp_path / "space.tsv")
    assert result.exit_code == 2
    assert "cannot export" in plain(result.output)


def test_data_format_guide_snippet_runs(tmp_path, monkeypatch):
    """docs/guide/data-format.md's "Read a Bundle in Python" snippet, as written."""
    import re
    from pathlib import Path

    guide = Path(__file__).parents[3] / "docs" / "guide" / "data-format.md"
    section = guide.read_text().split("## Read a Bundle in Python", 1)[1]
    (snippet,) = re.findall(r"```python\n(.*?)```", section.split("\n## ", 1)[0], re.S)

    _bundle(tmp_path)  # writes data.parquetbundle, as the snippet reads
    monkeypatch.chdir(tmp_path)
    namespace = {}
    exec(compile(snippet, str(guide), "exec"), namespace)

    assert namespace["members"].to_dict() == {
        "cluster 0": ["p0", "p1"],
        "cluster 1": ["p2"],
    }
    assert (tmp_path / "data.tsv").exists()
    assert namespace["statistics"] is None
