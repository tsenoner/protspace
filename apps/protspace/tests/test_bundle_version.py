"""The ``protspace_format_version=2`` cell-grammar stamp and where it is read.

A v3 bundle part carries no grammar stamp (the reader stamps v2 on what it
decodes), so the stamp is checked where it still means something: on the
tables the writers hand to ``write_bundle`` and on standalone parquet outputs
(``annotate``, ``ArrowReader.save_data``). The standalone ``protspace bundle``
subcommand reads a pre-existing annotations parquet and decides its cell
grammar from the stamp (read before the id-column rename drops it; none means
plain v1 text) before handing it to write_bundle.
"""

import io
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from protspace.data.annotations.encoding import FORMAT_VERSION_KEY
from protspace.data.io.bundle import read_tables
from protspace.data.processors.base_processor import BaseProcessor


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


def test_prepare_pipeline_bundle_round_trips_annotations(sample_data):
    """End-to-end: create_output -> save_output (bundled) -> read_tables gives
    back the proteins, their annotation cells and their coordinates.
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

        annotations, _metadata, projections = read_tables(bundle_path)

    assert annotations.column("protein_id").to_pylist() == sample_data["headers"]
    assert annotations.column("length").to_pylist() == ["100", "150", "200"]
    assert annotations.column("organism").to_pylist() == ["Homo sapiens"] * 3
    assert projections.column("identifier").to_pylist() == sample_data["headers"]
    coords = np.column_stack(
        [projections.column("x").to_numpy(), projections.column("y").to_numpy()]
    )
    np.testing.assert_allclose(coords, sample_data["embeddings"][:, :2], rtol=1e-6)


def _bundle_via_cli(tmp_path, annotations_table):
    """Run `protspace bundle -a` on ``annotations_table``; return the bundle path.

    ``annotations_table`` is a table to write, or the path of a parquet already
    written (by the pipeline's own writers).
    """
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

    if isinstance(annotations_table, Path):
        annotations_path = annotations_table
    else:
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


def test_cli_bundle_migrates_a_pandas_category_column_as_text(tmp_path):
    """A column saved from pandas with the ``category`` dtype reads back as
    ``dictionary<values=string>``. Its cells are v1 plain text like any other
    string column's, so the migration must reach them: otherwise the label
    ``Membrane (single-pass; type I)`` is split into two hits and a literal
    ``%41`` is percent-decoded to ``A``."""
    import pyarrow as pa

    cells = ["Membrane (single-pass; type I)", "x%41y"]
    table = pa.Table.from_pandas(
        pd.DataFrame({"identifier": ["P1", "P2"], "cat": pd.Categorical(cells)}),
        preserve_index=False,
    )
    assert pa.types.is_dictionary(table.schema.field("cat").type)

    output_path = _bundle_via_cli(tmp_path, table)

    assert _display_labels(output_path, "cat") == cells


def _cache_cells():
    """v2 cells as the annotation emit sites write them into the cache."""
    from protspace.data.annotations.encoding import encode_field

    return [encode_field("Membrane; single-pass"), encode_field("50% x")]


def _display_labels(bundle_path, column):
    from protspace.data.annotations.encoding import decode_field

    cells = read_tables(bundle_path)[0].column(column).to_pylist()
    return [decode_field(cell) for cell in cells]


def test_cli_bundle_passes_the_pipeline_cache_through(tmp_path):
    """`prepare` keeps ``tmp/all_annotations.parquet``, whose cells the emit sites
    already percent-encode. The cache declares that grammar, so `bundle -a`
    does not migrate it a second time (``%3B`` must not become ``%253B``)."""
    from protspace.data.annotations.manager import ProteinAnnotationManager

    cache_path = tmp_path / "all_annotations.parquet"
    manager = ProteinAnnotationManager.__new__(ProteinAnnotationManager)
    manager.output_path = cache_path
    manager._write_cache(
        pd.DataFrame({"identifier": ["P1", "P2"], "note": _cache_cells()})
    )

    assert pq.read_metadata(cache_path).metadata[FORMAT_VERSION_KEY] == b"2"
    output_path = _bundle_via_cli(tmp_path, cache_path)
    assert _display_labels(output_path, "note") == ["Membrane; single-pass", "50% x"]


def test_cli_bundle_reads_an_unstamped_pipeline_cache_as_v2(tmp_path):
    """A cache written before the cache carried the grammar stamp is still the
    pipeline's own v2 output; its cache-version attribute says so."""
    from protspace.data.annotations.encoding import annotation_cache_version_attrs

    cache_path = tmp_path / "all_annotations.parquet"
    df = pd.DataFrame({"identifier": ["P1", "P2"], "note": _cache_cells()})
    df.attrs.update(annotation_cache_version_attrs())
    df.to_parquet(cache_path, index=False)  # as `_write_cache` did, unstamped
    assert FORMAT_VERSION_KEY not in pq.read_metadata(cache_path).metadata

    output_path = _bundle_via_cli(tmp_path, cache_path)
    assert _display_labels(output_path, "note") == ["Membrane; single-pass", "50% x"]


def test_arrow_reader_save_data_keeps_the_grammar_stamp(tmp_path):
    """`save_data` writes the annotations it read; v2 cells stay declared v2, so
    a later `bundle -a` on them does not migrate them again."""
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.utils.arrow_reader import ArrowReader

    source = tmp_path / "in"
    source.mkdir()
    pq.write_table(
        stamp_format_version(pa.table({"protein_id": ["P1"], "note": ["a%3Bb"]})),
        source / "selected_annotations.parquet",
    )
    out = tmp_path / "out"
    ArrowReader(source).save_data(out)

    saved = pq.read_metadata(out / "protein_annotations.parquet").metadata
    assert saved[FORMAT_VERSION_KEY] == b"2"


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


def test_cli_bundle_stores_a_list_column_as_hits(tmp_path):
    """A list column (GO terms as a pandas list) bundled on `main`; it must still
    bundle, one hit per element."""
    import pyarrow as pa

    output_path = _bundle_via_cli(
        tmp_path,
        pa.table(
            {
                "identifier": ["P1", "P2"],
                "go_terms": pa.array([["GO:1", "GO:2"], ["GO:3"]]),
            }
        ),
    )

    assert read_tables(output_path)[0].column("go_terms").to_pylist() == [
        "GO:1;GO:2",
        "GO:3",
    ]


def test_cli_bundle_reports_an_unstorable_column_without_a_traceback(tmp_path):
    import pyarrow as pa
    from typer.testing import CliRunner

    from protspace.cli.app import app

    proj_dir = tmp_path / "projections"
    proj_dir.mkdir()
    pq.write_table(
        pa.table(
            {"projection_name": ["PCA_2"], "dimensions": [2], "info_json": ["{}"]}
        ),
        proj_dir / "projections_metadata.parquet",
    )
    pq.write_table(
        pa.table(
            {
                "projection_name": ["PCA_2"],
                "identifier": ["P1"],
                "x": [0.1],
                "y": [0.2],
            }
        ),
        proj_dir / "projections_data.parquet",
    )
    annotations_path = tmp_path / "annotations.parquet"
    pq.write_table(
        pa.table({"identifier": ["P1"], "odd": pa.array([{"a": 1}])}),
        annotations_path,
    )
    output_path = tmp_path / "out.parquetbundle"

    result = CliRunner().invoke(
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

    assert result.exit_code == 2, result.output
    assert isinstance(result.exception, SystemExit)
    assert "'odd'" in result.output
    assert not output_path.exists()
