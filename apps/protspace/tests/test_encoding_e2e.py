"""Task G2: backend end-to-end round-trip proof for v2 annotation encoding.

Builds a v2 ``.parquetbundle`` whose ``cath`` cell embeds a name containing
the grammar's structural ``;`` separator, writes it through the *real*
``write_bundle``/``read_bundle`` path, and proves:

- the encoded cell survives the bundle boundary byte-for-byte,
- no raw ``;`` sneaks into the parsed-out name (only its ``%3B`` escape),
- the cell therefore stays parseable (splitting on ``;`` yields one hit),
- :func:`decode_field` recovers the exact original name, and
- the annotations part still carries the v2 format-version stamp (Task E1).
"""

import io

import pyarrow as pa
import pyarrow.parquet as pq

from protspace.data.annotations.encoding import (
    FORMAT_VERSION_KEY,
    decode_field,
    encode_field,
    stamp_format_version,
)
from protspace.data.io.bundle import read_bundle, write_bundle


def test_semicolon_name_round_trips_through_bundle(tmp_path):
    name = "Ribosomal Protein L15; Chain: K; domain 2"
    cell = f"G3DSA:1.10.10.10 ({encode_field(name)})|50.2"

    annotations = stamp_format_version(pa.table({"protein_id": ["P1"], "cath": [cell]}))
    metadata = pa.table(
        {"projection_name": ["pca2"], "dimensions": [2], "info_json": ["{}"]}
    )
    data = pa.table(
        {"projection_name": ["pca2"], "identifier": ["P1"], "x": [0.0], "y": [0.0]}
    )

    bundle_path = tmp_path / "roundtrip.parquetbundle"
    write_bundle([annotations, metadata, data], bundle_path)

    core_parts, settings = read_bundle(bundle_path)
    assert settings is None
    assert len(core_parts) == 3

    annotations_bytes = core_parts[0]  # selected_annotations.parquet is written first
    annotations_back = pq.read_table(io.BytesIO(annotations_bytes))

    cell_back = annotations_back.column("cath")[0].as_py()
    assert cell_back == cell  # byte-for-byte through the bundle boundary

    # Recover the parenthesized name from the label (before the '|' score sep).
    label = cell_back.split("|", 1)[0]
    encoded_name = label[label.index("(") + 1 : label.rindex(")")]

    # The hit separator ';' must never appear raw inside the encoded name --
    # only its percent-escape '%3B' may. This is what keeps the cell parseable.
    assert ";" not in encoded_name
    assert "%3B" in encoded_name
    assert len(cell_back.split(";")) == 1  # splitting on ';' still yields one hit

    assert decode_field(encoded_name) == name

    # Ties the round-trip to the format-version stamp (Task E1).
    footer_meta = pq.read_metadata(io.BytesIO(annotations_bytes)).metadata
    assert footer_meta[FORMAT_VERSION_KEY] == b"2"
