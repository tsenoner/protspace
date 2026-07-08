from protspace.utils.add_annotation_style import _to_display_value
from protspace.utils.arrow_reader import ArrowReader
from protspace.visualization.plotting import prepare_dataframe


def test_display_decodes_encoded_name():
    # one hit, encoded ';' in the name, with a score suffix
    raw = "1.10.10.10 (Ribosomal Protein L15%3B Chain: K)|50.2"
    assert _to_display_value(raw) == ["1.10.10.10 (Ribosomal Protein L15; Chain: K)"]


def test_display_multi_hit_and_plain():
    raw = "A;B|EXP"
    assert _to_display_value(raw) == ["A", "B"]


def _make_reader(cell_value):
    """Build a minimal in-memory ArrowReader (dict-backed) for one protein."""
    return ArrowReader(
        {
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
    )


def test_prepare_dataframe_decodes_annotation_value_for_serve_viewer():
    """The Dash `serve` viewer must decode v2 cells before they reach plotly.

    Guards against the raw percent-encoded cell leaking into the
    legend/hover/color column that ``create_plot`` builds on top of
    ``prepare_dataframe``'s output.
    """
    encoded_cell = "G3DSA:1.10 (Ribosomal Protein L15%3B Chain: K)|50.2"
    reader = _make_reader(encoded_cell)

    df = prepare_dataframe(reader, "pca2", "cath")
    value = df["cath"].iloc[0]

    assert value == "G3DSA:1.10 (Ribosomal Protein L15; Chain: K)|50.2"
    assert "%3B" not in value
    assert ";" in value
