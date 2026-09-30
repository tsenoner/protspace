"""Tests for Task E1: format_version=2 stamped into the annotations parquet.

Covers both production write paths:
- BaseProcessor._create_protein_annotations_table (used by `protspace prepare`,
  both bundled and separate-file output).
- The standalone `protspace bundle` subcommand, which reads a pre-existing
  annotations parquet and decides its cell grammar from the stamp (read before
  the id-column rename drops it; none means plain v1 text) before handing it to
  write_bundle.
"""

import io
import tempfile
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from protspace.data.annotations.encoding import FORMAT_VERSION_KEY
from protspace.data.io.bundle import read_bundle, read_tables
from protspace.data.processors.base_processor import BaseProcessor
from tests.test_config import sample_data  # noqa: F401 (pytest fixture)


def test_create_protein_annotations_table_stamps_format_version():
    """Direct unit test of the table factory used by the prepare pipeline."""
    proc = BaseProcessor.__new__(BaseProcessor)  # bypass heavy __init__
    proc.identifier_col = "protein_id"
    tbl = proc._create_protein_annotations_table(
        pd.DataFrame({"protein_id": ["P1"], "cath": ["6.20.10.10"]})
    )

    buf = io.BytesIO()
    pq.write_table(tbl, buf)
    buf.seek(0)

    footer_meta = pq.read_metadata(buf).metadata
    assert footer_meta[FORMAT_VERSION_KEY] == b"2"


def test_prepare_pipeline_bundle_carries_format_version(sample_data):
    """End-to-end: create_output -> save_output (bundled) -> read_bundle ->
    the annotations part's parquet footer carries the stamp.
    """
    from protspace.utils import get_reducers as _get_reducers

    with tempfile.TemporaryDirectory() as tmp:
        temp_path = Path(tmp)
        processor = BaseProcessor({}, _get_reducers())

        output_data = processor.create_output(
            sample_data["metadata"],
            [
                {
                    "name": "PCA_2",
                    "dimensions": 2,
                    "info": {},
                    "data": sample_data["embeddings"][:, :2],
                }
            ],
            sample_data["headers"],
        )

        bundle_path = temp_path / "test.parquetbundle"
        processor.save_output(output_data, bundle_path, bundled=True)

        core_parts, _settings = read_bundle(bundle_path)
        annotations_bytes = core_parts[0]  # protein_annotations is written first

        footer_meta = pq.read_metadata(io.BytesIO(annotations_bytes)).metadata
        assert footer_meta[FORMAT_VERSION_KEY] == b"2"


def _bundle_via_cli(tmp_path, annotations_table):
    """Run `protspace bundle -a` on ``annotations_table``; return the bundle path."""
    import pyarrow as pa
    from typer.testing import CliRunner

    from protspace.cli.app import app

    # Minimal projections_metadata / projections_data / annotations inputs.
    proj_dir = tmp_path / "projections"
    proj_dir.mkdir()

    metadata_df = pd.DataFrame(
        {
            "projection_name": ["PCA_2"],
            "dimensions": [2],
            "info_json": ["{}"],
            "source": [""],
        }
    )
    pq.write_table(
        pa.Table.from_pandas(metadata_df), proj_dir / "projections_metadata.parquet"
    )

    # The long layout `protspace project` actually writes (one row per protein
    # per projection); `bundle` hands this table straight to write_bundle.
    data_df = pd.DataFrame(
        {
            "projection_name": ["PCA_2", "PCA_2"],
            "identifier": ["P1", "P2"],
            "x": [0.1, 0.2],
            "y": [0.3, 0.4],
        }
    )
    pq.write_table(pa.Table.from_pandas(data_df), proj_dir / "projections_data.parquet")

    annotations_path = tmp_path / "annotations.parquet"
    pq.write_table(annotations_table, annotations_path)

    output_path = tmp_path / "out.parquetbundle"

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "bundle",
            "-p",
            str(proj_dir),
            "-a",
            str(annotations_path),
            "-o",
            str(output_path),
        ],
    )
    assert result.exit_code == 0, result.output
    return output_path


def test_cli_bundle_command_stamps_format_version(tmp_path):
    """The standalone `protspace bundle` subcommand reads a pre-existing
    annotations parquet; the tables read back from its bundle are v2 cells.
    """
    import pyarrow as pa

    output_path = _bundle_via_cli(
        tmp_path, pa.table({"identifier": ["P1", "P2"], "cath": ["a", "b"]})
    )

    core_parts, _settings = read_bundle(output_path)
    annotations_bytes = core_parts[0]
    footer_meta = pq.read_metadata(io.BytesIO(annotations_bytes)).metadata
    assert footer_meta[FORMAT_VERSION_KEY] == b"2"


def test_cli_bundle_passes_annotate_output_through(tmp_path):
    """`annotate` output is stamped v2 and already percent-encoded. The stamp is
    read before the `identifier` -> `protein_id` rename drops it, so the cells
    are not migrated a second time (`%3B` would become `%253B`)."""
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version

    cells = ["1.10.490.10 (Superfamily%3B old)|300", "PF1 (100%25 pure)"]
    output_path = _bundle_via_cli(
        tmp_path,
        stamp_format_version(pa.table({"identifier": ["P1", "P2"], "cath": cells})),
    )

    assert read_tables(output_path)[0].column("cath").to_pylist() == cells


def test_cli_bundle_reads_an_unstamped_table_as_plain_v1_text(tmp_path):
    """A hand-made annotations parquet carries no stamp. The CLI decides, at its
    boundary, that such a table is legacy v1 plain text and migrates it, so a
    literal `%` and a `;` inside parentheses keep meaning what the user wrote."""
    import pyarrow as pa

    output_path = _bundle_via_cli(
        tmp_path,
        pa.table(
            {
                "identifier": ["P1", "P2"],
                "note": ["50% identity", "Membrane (single-pass; type I)"],
            }
        ),
    )

    assert read_tables(output_path)[0].column("note").to_pylist() == [
        "50%25 identity",
        "Membrane (single-pass%3B type I)",
    ]


def test_annotate_command_stamps_format_version(tmp_path, monkeypatch):
    """`protspace annotate` writes percent-encoded cells, so its parquet must
    also carry the v2 stamp — a consumer that reads it un-bundled and gates
    decoding on `protspace_format_version` then sees decoded names."""
    import protspace.data.annotations.manager as mgr_mod
    from protspace.cli.app import app

    fasta = tmp_path / "in.fasta"
    fasta.write_text(">P12345\nMKV\n>P67890\nAAA\n")

    class _FakeManager:
        def __init__(self, *args, **kwargs):
            self.incomplete_sources = set()

        def to_pd(self):
            return pd.DataFrame(
                {"identifier": ["P12345", "P67890"], "cath": ["a", "b"]}
            )

    monkeypatch.setattr(mgr_mod, "ProteinAnnotationManager", _FakeManager)

    from typer.testing import CliRunner

    out = tmp_path / "annotations.parquet"
    result = CliRunner().invoke(app, ["annotate", "-i", str(fasta), "-o", str(out)])
    assert result.exit_code == 0, result.output

    footer_meta = pq.read_metadata(str(out)).metadata
    assert footer_meta[FORMAT_VERSION_KEY] == b"2"


def test_arrow_reader_reads_stamp_and_defaults_to_v1(tmp_path):
    """The reader surfaces the stamp so display code can gate v2 decoding, and
    falls back to v1 (no decode) when the stamp is absent."""
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.utils.arrow_reader import ArrowReader

    stamped = tmp_path / "v2"
    stamped.mkdir()
    pq.write_table(
        stamp_format_version(pa.table({"protein_id": ["P1"], "cath": ["x"]})),
        stamped / "selected_annotations.parquet",
    )
    assert ArrowReader(stamped).get_format_version() == 2

    plain = tmp_path / "v1"
    plain.mkdir()
    pq.write_table(
        pa.table({"protein_id": ["P1"], "cath": ["x"]}),
        plain / "selected_annotations.parquet",
    )
    assert ArrowReader(plain).get_format_version() == 1

    # dict input without the marker also defaults to v1
    assert ArrowReader({"protein_data": {}}).get_format_version() == 1
