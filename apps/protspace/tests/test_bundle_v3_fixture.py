"""The golden v3 bundle both languages read.

``packages/core/src/components/data-loader/utils/__fixtures__/v3-sample.parquetbundle``
is committed binary: Python writes it (``scripts/generate_v3_fixture.py``) and
vitest reads it, so it is the only place the two v3 implementations meet.  These
tests keep the committed bytes and the generator from drifting apart, and pin the
exact cells the browser side asserts on -- a fixture nobody reads back in Python
is a fixture that silently rots.

The drift guard compares the **encoded** parts, not only the decoded tables.  A
decoded comparison is blind to every encoder change the decoder symmetrically
undoes, and dictionary order is exactly that: drop the encoder's
descending-frequency sort and ``read_tables`` still hands back the same cells,
while the browser's legend and every colour in it silently reorder.

Regenerate with ``uv run python scripts/generate_v3_fixture.py``.
"""

import importlib.util
import io
import json
import sys
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protspace.data.io.bundle import (
    PARQUET_BUNDLE_DELIMITER,
    read_settings_from_bundle,
    read_tables,
)
from protspace.data.io.bundle_v3 import MANIFEST_KEY, decode_v3, encode_v3

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "core"
    / "src"
    / "components"
    / "data-loader"
    / "utils"
    / "__fixtures__"
    / "v3-sample.parquetbundle"
)

#: ``packages/core``.  The only legitimate reason for the fixture to be absent is
#: that the browser workspace is not checked out at all (a Python-only source
#: distribution); a *deleted* fixture inside a present workspace is a deleted
#: contract and must fail, not skip.
_BROWSER_PACKAGE = FIXTURE.parents[5]

_SPEC = importlib.util.spec_from_file_location(
    "generate_v3_fixture",
    Path(__file__).parent.parent / "scripts" / "generate_v3_fixture.py",
)
generator = importlib.util.module_from_spec(_SPEC)
sys.modules["generate_v3_fixture"] = generator
_SPEC.loader.exec_module(generator)

pytestmark = pytest.mark.skipif(
    not _BROWSER_PACKAGE.is_dir(), reason="packages/core is not checked out"
)

#: The one label in the fixture whose UTF-8 byte length is not its character
#: count, which is what forces the browser off its pure-ASCII dictionary path.
NON_ASCII_LABEL = generator.PFAM_NON_ASCII_LABEL


def _table(part: bytes) -> pa.Table:
    return pq.read_table(io.BytesIO(part))


def _manifest(part: bytes) -> dict:
    return json.loads(pq.read_metadata(io.BytesIO(part)).metadata[MANIFEST_KEY])


def _payload_map(part: bytes) -> dict[str, bytes]:
    """Part 6 as the ``name -> bytes`` map the browser builds from it."""
    table = _table(part)
    return dict(
        zip(
            table.column("name").to_pylist(),
            table.column("data").to_pylist(),
            strict=True,
        )
    )


def _i32(payloads: dict[str, bytes], name: str) -> list[int]:
    return np.frombuffer(payloads[name], "<i4").tolist()


def _labels(payloads: dict[str, bytes], name: str) -> list[str]:
    """Decode one dictionary payload the way the browser does: by byte length."""
    blob = payloads[f"dict:{name}"]
    ends = np.cumsum(_i32(payloads, f"dict:{name}:len"))
    return [
        blob[end - length : end].decode()
        for length, end in zip(_i32(payloads, f"dict:{name}:len"), ends, strict=True)
    ]


@pytest.fixture(scope="module")
def parts() -> list[bytes]:
    return FIXTURE.read_bytes().split(PARQUET_BUNDLE_DELIMITER)


@pytest.fixture(scope="module")
def payloads(parts) -> dict[str, bytes]:
    return _payload_map(parts[5])


@pytest.fixture(scope="module")
def tables():
    return read_tables(FIXTURE)


def test_the_fixture_is_committed():
    """A missing fixture is a deleted contract, not a reason to skip.

    Every other test here depends on the file, so this one names the failure
    instead of leaving eight identical ``FileNotFoundError`` tracebacks.
    """
    assert FIXTURE.exists(), (
        f"{FIXTURE} is missing while its package is checked out; regenerate it "
        "with `uv run python scripts/generate_v3_fixture.py`"
    )


def test_fixture_is_a_six_part_v3_container(parts):
    assert len(parts) == 6
    # No settings, no statistics -- the two zero-byte slots are what keeps the
    # payloads part at index five, where the browser reads it positionally.
    assert parts[3] == b"" and parts[4] == b""
    assert read_settings_from_bundle(FIXTURE) is None

    footer = pq.read_metadata(io.BytesIO(parts[0])).metadata
    assert footer[b"protspace_format_version"] == b"3"
    assert _table(parts[5]).column_names == ["name", "data"]


def test_manifest_declares_every_kind_the_reader_dispatches_on(parts):
    manifest = _manifest(parts[0])

    assert manifest["idColumn"] == "protein_id"
    assert manifest["projections"] == [
        {"name": "pca2", "dimension": 2},
        {"name": "umap3", "dimension": 3},
    ]
    assert manifest["columns"] == {
        "cath": {"kind": "multi", "sourceType": "string", "scores": True},
        "go_bp": {"kind": "multi", "sourceType": "string", "evidence": True},
        # The only column that declares both payload families, so the encoder and
        # the reader cross that pair on real bytes exactly here.
        "pfam": {
            "kind": "multi",
            "sourceType": "string",
            "scores": True,
            "evidence": True,
        },
        "kingdom": {"kind": "categorical", "sourceType": "string"},
        "reviewed": {"kind": "categorical", "sourceType": "string"},
        "predicted_tm": {"kind": "categorical", "sourceType": "string"},
        "length": {"kind": "numeric", "numericType": "int", "sourceType": "string"},
        "hydrophobicity": {
            "kind": "numeric",
            "numericType": "float",
            "sourceType": "string",
        },
        "kingdom__pred_value": {"kind": "categorical", "sourceType": "string"},
        "kingdom__pred_confidence": {
            "kind": "numeric",
            "numericType": "float",
            "sourceType": "float",
        },
        "kingdom__pred_source": {"kind": "categorical", "sourceType": "string"},
    }


def test_part_one_is_the_physical_v3_schema(parts):
    schema = pq.read_schema(io.BytesIO(parts[0]))

    # Multi columns become a hit count; categoricals a code; numerics a double.
    assert schema.names == [
        "protein_id",
        "cath__count",
        "go_bp__count",
        "pfam__count",
        "kingdom",
        "reviewed",
        "predicted_tm",
        "length",
        "hydrophobicity",
        "kingdom__pred_value",
        "kingdom__pred_confidence",
        "kingdom__pred_source",
    ]
    # hyparquet only hands back typed arrays for REQUIRED flat columns.
    assert all(not field.nullable for field in schema)


def test_dictionaries_are_ordered_by_descending_frequency(parts, payloads):
    """Dictionary order is the browser's legend order, so it is part of the contract.

    Both columns below are written so that descending frequency and first
    occurrence DISAGREE.  Nothing else in the fixture can tell the two orderings
    apart, and a decoded comparison never could: the decoder re-joins the same
    cells whichever order the codes are in.
    """
    codes = _table(parts[0]).column("kingdom").to_pylist()

    # Cells: Archaea, Bacteria, Bacteria, <blank>, Bacteria, Eukaryota.
    assert generator.ANNOTATION_CELLS["kingdom"][0] == "Archaea"
    assert _labels(payloads, "kingdom") == ["Bacteria", "Archaea", "Eukaryota"]
    assert codes == [1, 0, 0, -1, 0, 2]  # -1 is the blank cell

    # Cells: False, True, True, False, True, True.
    assert generator.ANNOTATION_CELLS["reviewed"][0] == "False"
    assert _labels(payloads, "reviewed") == ["True", "False"]
    assert _table(parts[0]).column("reviewed").to_pylist() == [1, 0, 0, 1, 0, 0]


def test_dictionary_label_lengths_are_utf8_bytes(payloads):
    """The browser slices ``dict:<col>`` by these lengths, so they must be bytes.

    Every other dictionary in the fixture is pure ASCII, where a byte length and
    a character count are the same number and a reader that confused them would
    still pass.  This label is the one that separates them.
    """
    labels = _labels(payloads, "pfam")
    lengths = _i32(payloads, "dict:pfam:len")

    assert NON_ASCII_LABEL in labels
    at = labels.index(NON_ASCII_LABEL)
    assert lengths[at] == len(NON_ASCII_LABEL.encode()) > len(NON_ASCII_LABEL)
    assert sum(lengths) == len(payloads["dict:pfam"])
    # The two labels after it would shift by the same two bytes if the lengths
    # were counted in characters.
    assert labels[at + 1 :] == ["none", "PF00003 (a|b)"]


def test_payloads_carry_scores_and_evidence_for_one_column(payloads):
    """``pfam`` holds both families at once; every index is per hit, not per row."""
    # 8 hits: P2 has 2, P4 has 3 (one of them the folded ``none``), P5 has 3.
    assert _i32(payloads, "csr:pfam") == [0, 1, 0, 2, 3, 4, 1, 0]
    assert _i32(payloads, "score_count:pfam") == [2, 1, 1, 0, 0, 1, 1, 1]
    assert np.frombuffer(payloads["scores:pfam"], "<f8").tolist() == [
        1e-10,
        2.5,
        0.5,
        0.25,
        3.0,
        62.0,
        2.3e-5,
    ]
    # -1 is "no evidence"; the one evidenced hit is P4's, and it indexes the
    # GLOBAL evidence dictionary that ``go_bp`` filled first.
    assert _i32(payloads, "evidence:pfam") == [-1, -1, -1, 0, -1, -1, -1, -1]
    assert _labels(payloads, "__evidence") == ["IDA", "ECO:0000269", "IEA", "EXP"]

    # The container is faithful: ``none`` is an ordinary label here and the
    # browser is the one that folds it away.
    assert "none" in _labels(payloads, "pfam")


def test_read_tables_gives_back_the_v2_cells_the_generator_started_from(tables):
    annotations, _metadata, _data = tables
    cells = generator.ANNOTATION_CELLS

    assert annotations.column("protein_id").to_pylist() == generator.PROTEIN_IDS
    # P1/P2's cath and go_bp are the v2 golden fixture's own cells: the
    # percent-encoded ';' inside a CATH name survives the hit split, an unnamed
    # bare code stays unnamed, and the '|IDA' evidence suffix round-trips.
    for column in ("cath", "go_bp", "kingdom", "reviewed", "predicted_tm", "length"):
        assert annotations.column(column).to_pylist() == cells[column], column

    # A score only float64 can carry: 1e-200 flushes to zero in float32 and
    # 123456789 re-spells as 1.2345679e+08.
    assert "|1e-200" in annotations.column("cath")[4].as_py()
    assert annotations.column("cath")[2].as_py().endswith("|123456789")

    # Documented non-identities: a float numeric column comes back in its
    # shortest round-trip spelling, and a null string cell as "".
    assert annotations.column("hydrophobicity").to_pylist() == [
        "0.5",
        "-1.25",
        "",
        "3.0",
        "0.001",
        "42.0",
    ]
    assert annotations.column("kingdom__pred_source").to_pylist() == [
        "",
        "Q9XYZ1",
        "",
        "P0A7B8",
        "A0A123",
        "",
    ]
    # sourceType restores the EAT confidence's float32, missing as NaN.
    confidence = annotations.column("kingdom__pred_confidence")
    assert confidence.type == "float"
    assert [confidence[i].as_py() for i in (1, 3, 4)] == [0.875, 0.5, 0.25]


def test_read_tables_re_spells_the_scores_the_decode_is_documented_to_change(tables):
    """``pfam`` is the only column whose cells do not survive verbatim.

    Two spellings change and both are documented in ``docs/guide/data-format.md``:
    ``62.0`` loses its trailing ``.0``, and ``2.3e-5`` is re-spelled by Python's
    float repr, which pads the exponent.  The browser's exporter re-spells the
    same double as ``0.000023``, so this is a genuine cross-language difference
    in the *text* and not in the value.
    """
    annotations, _metadata, _data = tables
    pfam = annotations.column("pfam").to_pylist()

    assert generator.ANNOTATION_CELLS["pfam"][4].endswith(
        "|62.0;PF00001 (7tm%3B1)|2.3e-5"
    )
    assert pfam[4] == "PF00003 (a%7Cb)|3;PF00002|62;PF00001 (7tm%3B1)|2.3e-05"
    # Everything else about the column survives: the evidence suffix next to a
    # score, the non-ASCII label, and the literal ``none`` hit Python must keep.
    assert pfam[3] == f"PF00001 (7tm%3B1)|0.25;{NON_ASCII_LABEL}|IDA;none"
    assert pfam[0] == pfam[2] == pfam[5] == ""


def test_read_tables_rebuilds_both_projections_in_protein_order(tables):
    _annotations, metadata, data = tables

    assert metadata.column("projection_name").to_pylist() == ["pca2", "umap3"]
    assert metadata.column("dimensions").to_pylist() == [2, 3]

    frame = data.to_pandas()
    pca2 = frame[frame.projection_name == "pca2"]
    assert pca2.identifier.tolist() == generator.PROTEIN_IDS
    # P1 and P2 sit where the v2 golden fixture puts them.
    assert pca2[["x", "y"]].values.tolist()[:2] == [[0.0, 0.0], [1.0, 1.0]]
    assert pca2.z.isna().all()  # 2D: no z

    umap3 = frame[frame.projection_name == "umap3"]
    assert umap3[["x", "y", "z"]].values.tolist()[0] == [0.0, 0.25, 0.5]
    # P6 has no umap3 row in the source table at all.  The wide encoding has no
    # way to say "absent", so it fills 0.0 and the round trip fabricates a row at
    # the origin -- the same place the browser renders it.  Pinned, not endorsed.
    assert umap3.identifier.tolist() == generator.PROTEIN_IDS
    assert umap3[["x", "y", "z"]].values.tolist()[-1] == [0.0, 0.0, 0.0]


def test_committed_fixture_still_matches_its_generator(parts, payloads):
    """The committed bytes are what ``scripts/generate_v3_fixture.py`` writes today.

    Compared as encoded columns and payloads rather than as raw bytes: parquet
    embeds the writer version, so a byte comparison would fail on every pyarrow
    bump for no reason.  Compared *encoded* rather than only decoded because the
    decoder undoes most of what the encoder decides -- delete the frequency sort
    and the decoded tables are identical while the browser's legend order, and
    every colour keyed off it, has changed.
    """
    fresh_part1, fresh_part2, fresh_part3, fresh_part6 = encode_v3(
        *generator.source_tables()
    )

    for what, fresh, committed in (
        ("part 1 (annotations)", fresh_part1, parts[0]),
        ("part 2 (projections metadata)", fresh_part2, parts[1]),
        ("part 3 (wide projections)", fresh_part3, parts[2]),
    ):
        # ``DataFrame.equals`` rather than ``==``: the numeric columns carry NaN
        # for a missing cell, which never compares equal to itself.
        first, second = _table(fresh).to_pandas(), _table(committed).to_pandas()
        assert list(first.columns) == list(second.columns), what
        for column in first.columns:
            assert first[column].equals(second[column]), f"{what}: column '{column}'"

    assert _manifest(fresh_part1) == _manifest(parts[0])
    # The payload map, not the part's row order: the browser builds a Map from it,
    # so the names and their bytes are the contract and their order is not.
    assert _payload_map(fresh_part6) == payloads

    for fresh_table, committed in zip(
        decode_v3([fresh_part1, fresh_part2, fresh_part3, fresh_part6]),
        read_tables(FIXTURE),
        strict=True,
    ):
        assert fresh_table.equals(committed)
