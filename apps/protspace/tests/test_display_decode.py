import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from protspace.data.annotations.encoding import encode_field, stamp_format_version
from protspace.data.io.bundle import extract_bundle_to_dir, write_bundle
from protspace.utils.add_annotation_style import (
    _to_display_value,
    add_annotation_styles_bundle,
    add_annotation_styles_parquet,
    compute_value_frequencies,
    generate_template,
)
from protspace.utils.arrow_reader import ArrowReader
from protspace.visualization.plotting import create_plot, prepare_dataframe


def _write_annotation_dir(directory: Path, column: str, cell: str) -> None:
    """Write a minimal stamped v2 annotations parquet dir (one protein)."""
    directory.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        stamp_format_version(pa.table({"protein_id": ["P1"], column: [cell]})),
        directory / "selected_annotations.parquet",
    )


def test_display_decodes_encoded_name():
    # one hit, encoded ';' in the name, with a score suffix
    raw = "1.10.10.10 (Ribosomal Protein L15%3B Chain: K)|50.2"
    assert _to_display_value(raw) == ["1.10.10.10 (Ribosomal Protein L15; Chain: K)"]


def test_display_multi_hit_and_plain():
    raw = "A;B|EXP"
    assert _to_display_value(raw) == ["A", "B"]


def test_to_display_value_multi_hit_scored_keeps_all_hits():
    """A multi-hit score-bearing cell keeps every hit as one category: the
    ``|suffix`` is trimmed per hit (after the ``;`` split), not once on the
    whole cell — otherwise the first hit's ``|`` swallows hits 2+."""
    from protspace.data.annotations.encoding import to_display_value

    # GO with evidence, InterPro with scores — both common multi-hit cells
    assert (
        to_display_value("apoptotic process|IDA;signal transduction|IEA")
        == "apoptotic process;signal transduction"
    )
    assert to_display_value("IPR001 (Kinase)|0.9;IPR002 (SH2)|0.8") == (
        "IPR001 (Kinase);IPR002 (SH2)"
    )
    # single-hit and no-suffix cells unchanged
    assert to_display_value("cluster 3|0.53") == "cluster 3"
    assert to_display_value("A;B") == "A;B"


def test_display_decode_gated_off_leaves_percent_literal():
    """A legacy (v1) value with a literal ``%XX`` is NOT rewritten when decoding
    is gated off — the marker the PR added exists so display code can branch."""
    raw = "weird%1Fname"
    assert _to_display_value(raw, decode=False) == ["weird%1Fname"]
    assert _to_display_value(raw, decode=True) == ["weird\x1fname"]


def _make_reader(cell_value, *, format_version=2):
    """Build a minimal in-memory ArrowReader (dict-backed) for one protein."""
    data = {
        "protein_data": {
            "P1": {"annotations": {"cath": cell_value}},
        },
        "projections": [
            {
                "name": "pca2",
                "dimensions": 2,
                "data": [{"identifier": "P1", "coordinates": {"x": 0.0, "y": 0.0}}],
            }
        ],
    }
    if format_version is not None:
        data["format_version"] = format_version
    return ArrowReader(data)


def test_prepare_dataframe_decodes_annotation_value_for_serve_viewer():
    """The Dash `serve` viewer must decode v2 cells (and trim the score suffix)
    before they reach plotly.

    Guards against the raw percent-encoded cell leaking into the
    legend/hover/color column that ``create_plot`` builds on top of
    ``prepare_dataframe``'s output.
    """
    encoded_cell = "G3DSA:1.10 (Ribosomal Protein L15%3B Chain: K)|50.2"
    reader = _make_reader(encoded_cell)

    df = prepare_dataframe(reader, "pca2", "cath")
    value = df["cath"].iloc[0]

    assert value == "G3DSA:1.10 (Ribosomal Protein L15; Chain: K)"
    assert "%3B" not in value
    assert ";" in value
    assert "|" not in value  # score suffix trimmed


def test_prepare_dataframe_preserves_all_hits_of_multi_hit_scored_cell():
    """The serve plot must keep every hit of a multi-hit scored cell as one
    category (regression: the whole-cell ``|`` trim dropped hits 2+)."""
    reader = _make_reader("apoptotic process|IDA;signal transduction|IEA")
    df = prepare_dataframe(reader, "pca2", "cath")
    assert df["cath"].iloc[0] == "apoptotic process;signal transduction"


def test_prepare_dataframe_does_not_decode_v1_bundle():
    """A v1 (unstamped) bundle whose name legitimately holds a literal ``%XX``
    is left untouched — decoding is gated on ``format_version >= 2``."""
    reader = _make_reader("legacy%1Fname", format_version=1)
    df = prepare_dataframe(reader, "pca2", "cath")
    assert df["cath"].iloc[0] == "legacy%1Fname"


def test_serve_user_color_survives_for_encoded_name():
    """Regression for the color-drop bug: a name containing ';' encodes to a
    different wire value, but a user's color (stored under the display value)
    must still be applied by the plot — not overridden by a default."""
    encoded_cell = "GO:1 (foo%3B bar)"  # display: "GO:1 (foo; bar)"
    reader = _make_reader(encoded_cell)

    display_value = "GO:1 (foo; bar)"
    user_color = "rgba(10, 20, 30, 0.8)"
    reader.update_annotation_color("cath", display_value, user_color)

    fig, _ = create_plot(reader, "pca2", "cath")

    # The custom legend trace for this category must carry the user's color.
    legend_colors = {
        tr.name: tr.marker.color
        for tr in fig.data
        if getattr(tr, "showlegend", False) and tr.name
    }
    assert legend_colors.get(display_value) == user_color


def test_compute_value_frequencies_respects_version_gate():
    """`compute_value_frequencies` decodes only for v2 readers."""
    v2 = _make_reader("weird%1Fname", format_version=2)
    v1 = _make_reader("weird%1Fname", format_version=1)
    assert "weird\x1fname" in compute_value_frequencies(v2)["cath"]
    assert "weird%1Fname" in compute_value_frequencies(v1)["cath"]


def test_style_template_roundtrips_for_encoded_name_parquet(tmp_path):
    """A styles file built from `generate_template` (decoded keys) applies
    cleanly via `style` for a name containing a reserved char: the display
    value is the canonical style key, not the raw percent-encoded wire cell."""
    display_name = "1.10.10.10 (Foo; Bar)"  # legitimate ';' in the name
    src = tmp_path / "data"
    _write_annotation_dir(src, "cath", encode_field(display_name))

    # the template exposes the DECODED name
    template = generate_template(str(src))
    assert display_name in template["cath"]["colors"]

    # styling by that decoded name succeeds and is stored under it
    out = tmp_path / "styled"
    add_annotation_styles_parquet(
        str(src), {"cath": {"colors": {display_name: "#ff0000"}}}, str(out)
    )
    viz = json.loads((out / "visualization_state.json").read_text())
    assert viz["annotation_colors"]["cath"][display_name] == "#ff0000"

    # the raw percent-encoded wire cell is no longer a valid style key
    with pytest.raises(ValueError):
        add_annotation_styles_parquet(
            str(src),
            {"cath": {"colors": {encode_field(display_name): "#00ff00"}}},
            str(tmp_path / "bad"),
        )


def test_style_bundle_roundtrips_for_encoded_name(tmp_path):
    """The primary `style` path (bundle) applies a decoded-name color without
    the pre-fix ValueError, and it round-trips back under the display key."""
    display_name = "GO:1 (foo; bar)"
    enc = encode_field(display_name)
    ann = stamp_format_version(
        pa.table({"protein_id": ["P1", "P2"], "go_bp": [enc, enc]})
    )
    meta = pa.table(
        {"projection_name": ["pca2"], "dimensions": [2], "info_json": ["{}"]}
    )
    data = pa.table(
        {
            "projection_name": ["pca2", "pca2"],
            "identifier": ["P1", "P2"],
            "x": [0.0, 1.0],
            "y": [0.0, 1.0],
            "z": [None, None],
        }
    )
    src = tmp_path / "d.parquetbundle"
    write_bundle([ann, meta, data], src)

    out = tmp_path / "styled.parquetbundle"
    add_annotation_styles_bundle(
        str(src), {"go_bp": {"colors": {display_name: "#123456"}}}, str(out)
    )

    styled = ArrowReader(Path(extract_bundle_to_dir(out)))
    colors = styled.get_annotation_colors("go_bp")
    # keyed by the decoded display name; #123456 is normalized to its rgba form
    assert display_name in colors
    assert "18, 52, 86" in colors[display_name]
