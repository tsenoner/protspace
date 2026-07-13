from protspace.utils.add_annotation_style import (
    _to_display_value,
    compute_value_frequencies,
)
from protspace.utils.arrow_reader import ArrowReader
from protspace.visualization.plotting import create_plot, prepare_dataframe


def test_display_decodes_encoded_name():
    # one hit, encoded ';' in the name, with a score suffix
    raw = "1.10.10.10 (Ribosomal Protein L15%3B Chain: K)|50.2"
    assert _to_display_value(raw) == ["1.10.10.10 (Ribosomal Protein L15; Chain: K)"]


def test_display_multi_hit_and_plain():
    raw = "A;B|EXP"
    assert _to_display_value(raw) == ["A", "B"]


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
