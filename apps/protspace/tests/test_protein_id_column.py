"""One protein ID column name, ``protein_id``, in every table protspace writes (#552).

A v3 reader takes the ID column from the manifest's ``idColumn``. A table without a
manifest is keyed on ``protein_id``, else ``identifier``, the name older releases
wrote; reading ``identifier`` from a user's own file (a directory part, an
annotation parquet) logs the ``LEGACY_ID_COLUMN`` deprecation warning, removed in
5.0.0 with the fallback.
"""

import json
import logging

import h5py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.encoding import stamp_format_version
from protspace.data.io import bundle_v3
from protspace.data.io.bundle import (
    PARQUET_BUNDLE_DELIMITER,
    read_bundle_contents,
    read_tables,
    write_bundle,
)
from protspace.data.io.ids import PROTEIN_ID_COLUMN, with_protein_id
from protspace.data.io.writers import AnnotationWriter, ProteinAnnotations
from protspace.data.processors.base_processor import BaseProcessor
from protspace.deprecations import DEPRECATIONS, LEGACY_ID_COLUMN
from protspace.utils.arrow_reader import ArrowReader
from tests.bundle_v3_helpers import manifest_of, parts_of

IDS = [f"p{i}" for i in range(30)]
_REMOVAL = DEPRECATIONS[LEGACY_ID_COLUMN]


_MARKER = "Reading `identifier` as the ID column is deprecated"


def _legacy_id_warnings(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if _MARKER in r.getMessage()]


def _cli_warnings(result) -> list[str]:
    """The deprecation lines a command printed (its logging replaces caplog's handler)."""
    return [line for line in result.output.splitlines() if _MARKER in line]


def _tables(id_column: str = PROTEIN_ID_COLUMN):
    """Annotations and long projections keyed on *id_column*, as a pipeline built them."""
    annotations = stamp_format_version(
        pa.table({id_column: IDS, "grp": ["a", "b"] * (len(IDS) // 2)})
    )
    metadata = pa.table(
        {"projection_name": ["PCA 2"], "dimensions": [2], "info_json": ["{}"]}
    )
    data = pa.table(
        {
            "projection_name": ["PCA 2"] * len(IDS),
            id_column: IDS,
            "x": np.arange(len(IDS), dtype=np.float32),
            "y": np.zeros(len(IDS), dtype=np.float32),
            "z": pa.nulls(len(IDS), pa.float32()),
        }
    )
    return annotations, metadata, data


def _h5(path, ids=IDS):
    rng = np.random.default_rng(0)
    with h5py.File(path, "w") as f:
        f.attrs["model_name"] = "esm2_8m"
        for pid in ids:
            f.create_dataset(pid, data=rng.normal(size=6).astype(np.float32))
    return path


def _old_directory(tmp_path):
    """A projections directory as `protspace project` wrote it before 4.17.0."""
    directory = tmp_path / "proj"
    directory.mkdir()
    _, metadata, data = _tables("identifier")
    pq.write_table(metadata, directory / "projections_metadata.parquet")
    pq.write_table(data, directory / "projections_data.parquet")
    return directory


def _with_id_column(bundle: bytes, name: str) -> bytes:
    """*bundle* with part 1's ID column renamed *name*, manifest included, as an
    older web export (``identifier``) or another writer would have stored it."""
    parts = bundle.split(PARQUET_BUNDLE_DELIMITER)
    table = bundle_v3.read_part(parts[0])
    manifest = manifest_of(parts[0])
    manifest["idColumn"] = name
    metadata = {
        **table.schema.metadata,
        bundle_v3.MANIFEST_KEY: json.dumps(manifest).encode(),
    }
    renamed = table.rename_columns(
        [name if c == PROTEIN_ID_COLUMN else c for c in table.column_names]
    ).replace_schema_metadata(metadata)
    parts[0] = bundle_v3.write_part(renamed)
    return PARQUET_BUNDLE_DELIMITER.join(parts)


# --------------------------------------------------------------------------- #
# what is written
# --------------------------------------------------------------------------- #


def test_the_shared_name_is_protein_id():
    assert PROTEIN_ID_COLUMN == "protein_id"


@pytest.mark.parametrize("given", ["protein_id", "identifier"])
def test_a_bundle_is_written_keyed_on_protein_id(tmp_path, given):
    path = tmp_path / "b.parquetbundle"
    write_bundle(list(_tables(given)), path)

    part1 = parts_of(path)[0]
    assert manifest_of(part1)["idColumn"] == PROTEIN_ID_COLUMN
    assert bundle_v3.read_part(part1).column_names[0] == PROTEIN_ID_COLUMN


def test_the_pipeline_tables_are_keyed_on_protein_id():
    processor = BaseProcessor({}, {})
    reductions = [
        {
            "name": "PCA 2",
            "dimensions": 2,
            "info": {},
            "data": np.zeros((2, 2), dtype=np.float32),
        }
    ]
    tables = processor.create_output(
        pd.DataFrame({PROTEIN_ID_COLUMN: ["P1", "P2"], "grp": ["a", "b"]}),
        reductions,
        ["P1", "P2"],
    )
    assert tables["protein_annotations"].column_names[0] == PROTEIN_ID_COLUMN
    assert PROTEIN_ID_COLUMN in tables["projections_data"].column_names
    assert "identifier" not in tables["projections_data"].column_names


def test_an_unbundled_directory_is_keyed_on_protein_id(tmp_path):
    out = tmp_path / "out"
    annotations, metadata, data = _tables()
    BaseProcessor({}, {}).save_output(
        {
            "protein_annotations": annotations,
            "projections_metadata": metadata,
            "projections_data": data,
        },
        out,
        bundled=False,
    )
    for name in ("selected_annotations.parquet", "projections_data.parquet"):
        columns = pq.read_schema(out / name).names
        assert PROTEIN_ID_COLUMN in columns and "identifier" not in columns, name


@pytest.mark.parametrize("suffix", ["parquet", "csv"])
def test_annotate_output_is_keyed_on_protein_id(tmp_path, suffix):
    path = tmp_path / f"ann.{suffix}"
    proteins = [ProteinAnnotations("P1", {"family": "kinase"})]
    write = getattr(AnnotationWriter(), f"write_{suffix}")
    write(proteins, path, apply_transforms=False)
    frame = pd.read_parquet(path) if suffix == "parquet" else pd.read_csv(path)
    assert list(frame.columns) == [PROTEIN_ID_COLUMN, "family"]


def test_the_decoded_tables_are_keyed_on_protein_id(tmp_path):
    path = tmp_path / "b.parquetbundle"
    write_bundle(list(_tables()), path)

    contents = read_bundle_contents(path)
    assert contents.annotations.column_names[0] == PROTEIN_ID_COLUMN
    assert contents.projections.column_names == [
        "projection_name",
        PROTEIN_ID_COLUMN,
        "x",
        "y",
        "z",
    ]


# --------------------------------------------------------------------------- #
# v3: the manifest names the column
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("stored", ["identifier", "accession"])
def test_a_v3_reader_takes_the_column_the_manifest_names(tmp_path, stored):
    path = tmp_path / "b.parquetbundle"
    write_bundle(list(_tables()), path)
    renamed = _with_id_column(path.read_bytes(), stored)

    annotations, _, projections = read_tables(renamed)
    assert annotations.column_names[0] == PROTEIN_ID_COLUMN
    assert stored not in annotations.column_names
    assert annotations.column(PROTEIN_ID_COLUMN).to_pylist() == IDS
    assert projections.column(PROTEIN_ID_COLUMN).to_pylist() == IDS


def test_a_manifest_id_beside_a_protein_id_annotation_is_refused(tmp_path):
    path = tmp_path / "b.parquetbundle"
    write_bundle(list(_tables()), path)
    parts = path.read_bytes().split(PARQUET_BUNDLE_DELIMITER)
    manifest = manifest_of(parts[0])
    manifest["idColumn"] = "accession"
    manifest["columns"][PROTEIN_ID_COLUMN] = manifest["columns"]["grp"]
    table = bundle_v3.read_part(parts[0])
    table = table.append_column("accession", table.column(PROTEIN_ID_COLUMN))
    table = table.replace_schema_metadata(
        {**table.schema.metadata, bundle_v3.MANIFEST_KEY: json.dumps(manifest).encode()}
    )
    parts[0] = bundle_v3.write_part(table)

    with pytest.raises(ValueError, match="beside an annotation named 'protein_id'"):
        read_tables(PARQUET_BUNDLE_DELIMITER.join(parts))


# --------------------------------------------------------------------------- #
# tables without a manifest: protein_id, else identifier (until 5.0.0)
# --------------------------------------------------------------------------- #


def test_with_protein_id_keeps_the_stamp_and_leaves_protein_id_alone():
    annotations, _, _ = _tables("identifier")
    renamed = with_protein_id(annotations)
    assert renamed.column_names[0] == PROTEIN_ID_COLUMN
    assert renamed.schema.metadata == annotations.schema.metadata

    both = annotations.append_column(PROTEIN_ID_COLUMN, annotations.column(0))
    assert with_protein_id(both) is both


def test_an_old_projections_directory_is_bundled_with_one_warning(tmp_path):
    directory = _old_directory(tmp_path)
    annotations, _, _ = _tables()
    pq.write_table(annotations, tmp_path / "ann.parquet")
    out = tmp_path / "out.parquetbundle"

    result = CliRunner().invoke(
        app,
        ["bundle", "-p", str(directory), "-a", str(tmp_path / "ann.parquet")]
        + ["-o", str(out)],
    )
    assert result.exit_code == 0, result.output
    warnings = _cli_warnings(result)
    assert len(warnings) == 1
    assert "projections_data.parquet" in warnings[0]
    assert _REMOVAL.remove_in in warnings[0]
    assert manifest_of(parts_of(out)[0])["idColumn"] == PROTEIN_ID_COLUMN
    assert read_tables(out)[2].column(PROTEIN_ID_COLUMN).to_pylist() == IDS


def test_old_annotate_output_keys_the_bundle_with_one_warning(tmp_path):
    directory = tmp_path / "proj"
    directory.mkdir()
    annotations, metadata, data = _tables()
    pq.write_table(metadata, directory / "projections_metadata.parquet")
    pq.write_table(data, directory / "projections_data.parquet")
    pq.write_table(_tables("identifier")[0], tmp_path / "ann.parquet")
    out = tmp_path / "out.parquetbundle"

    result = CliRunner().invoke(
        app,
        ["bundle", "-p", str(directory), "-a", str(tmp_path / "ann.parquet")]
        + ["-o", str(out)],
    )
    assert result.exit_code == 0, result.output
    warnings = _cli_warnings(result)
    assert len(warnings) == 1 and "ann.parquet" in warnings[0]
    bundled = read_tables(out)[0]
    assert bundled.column(PROTEIN_ID_COLUMN).to_pylist() == IDS
    assert "identifier" not in bundled.column_names


def test_a_table_with_both_names_keys_on_protein_id_without_a_warning(tmp_path):
    directory = tmp_path / "proj"
    directory.mkdir()
    _, metadata, data = _tables()
    pq.write_table(metadata, directory / "projections_metadata.parquet")
    pq.write_table(data, directory / "projections_data.parquet")
    aliases = [f"alias-{i}" for i in IDS]
    pq.write_table(
        pa.table({"identifier": aliases, PROTEIN_ID_COLUMN: IDS}),
        tmp_path / "ann.parquet",
    )
    out = tmp_path / "out.parquetbundle"

    result = CliRunner().invoke(
        app,
        ["bundle", "-p", str(directory), "-a", str(tmp_path / "ann.parquet")]
        + ["-o", str(out)],
    )
    assert result.exit_code == 0, result.output
    assert _cli_warnings(result) == []
    bundled = read_tables(out)[0].to_pandas().set_index(PROTEIN_ID_COLUMN)
    assert bundled.loc[IDS[1], "identifier"] == aliases[1]


def test_stats_reads_an_old_projections_directory_with_one_warning(tmp_path):
    directory = _old_directory(tmp_path)
    h5 = _h5(tmp_path / "emb.h5")

    result = CliRunner().invoke(
        app,
        ["stats", "-i", str(h5), "-p", str(directory)]
        + ["-o", str(tmp_path / "s.parquet")],
    )
    assert result.exit_code == 0, result.output
    warnings = _cli_warnings(result)
    assert len(warnings) == 1 and "projections_data.parquet" in warnings[0]


def test_arrow_reader_reads_an_old_directory_with_a_warning_per_file(tmp_path, caplog):
    directory = _old_directory(tmp_path)
    pq.write_table(_tables("identifier")[0], directory / "selected_annotations.parquet")

    with caplog.at_level(logging.WARNING):
        reader = ArrowReader(directory)
    assert sorted(reader.get_protein_ids()) == sorted(IDS)
    assert len(_legacy_id_warnings(caplog)) == 2


def test_a_legacy_bundle_warns_for_its_format_only(tmp_path, caplog):
    path = tmp_path / "legacy.parquetbundle"
    annotations, metadata, data = _tables("identifier")
    path.write_bytes(
        PARQUET_BUNDLE_DELIMITER.join(
            bundle_v3.write_part(t) for t in (annotations, metadata, data)
        )
    )

    with caplog.at_level(logging.WARNING):
        read_annotations, _, projections = read_tables(path)
    assert read_annotations.column_names[0] == PROTEIN_ID_COLUMN
    assert projections.column(PROTEIN_ID_COLUMN).to_pylist() == IDS
    assert _legacy_id_warnings(caplog) == []
    assert any("v1/v2 parquetbundle" in r.getMessage() for r in caplog.records)


def test_an_old_annotation_cache_is_reused_without_a_warning(
    tmp_path, monkeypatch, caplog
):
    from protspace.data.annotations.manager import ProteinAnnotationManager
    from protspace.data.processors.pipeline import PipelineConfig, ReductionPipeline

    cached = pd.DataFrame(
        {
            "identifier": ["P1", "P2"],
            "protein_name": ["a", "b"],
            "gene_name": ["g", "h"],
            "uniprot_kb_id": ["u", "v"],
        }
    )
    cached.to_parquet(tmp_path / "all_annotations.parquet")

    def unexpected_fetch(_manager):
        pytest.fail("a cache covering every requested identifier should be reused")

    monkeypatch.setattr(ProteinAnnotationManager, "to_pd", unexpected_fetch)
    pipeline = ReductionPipeline(
        PipelineConfig(
            methods=[],
            output_path=None,
            keep_tmp=True,
            intermediate_dir=tmp_path,
            annotations=["protein_name"],
        )
    )
    with caplog.at_level(logging.WARNING):
        result = pipeline._fetch_annotations(["P2", "P1"])
    assert result[PROTEIN_ID_COLUMN].tolist() == ["P1", "P2"]
    assert result["protein_name"].tolist() == ["a", "b"]
    assert _legacy_id_warnings(caplog) == []
