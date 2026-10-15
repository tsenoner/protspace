"""Advisory warnings + palette contract for `protspace style`.

Covers three things:
- the numeric-column warning (tsenoner/protspace-legacy#67) — the CLI styling model is
  categorical-only while the web frontend bins numeric columns into gradients, so
  per-value colors/shapes set via the CLI are silently dropped;
- the `selectedPaletteId` validation warning (gradient/unknown id → resets to
  kellys in the frontend);
- the palette catalog, generated from contracts/shared-constants.json like the
  web's (see the section below).
"""

import logging

import pyarrow as pa
import pytest

from protspace.data.annotations.encoding import stamp_format_version
from protspace.data.io.bundle import extract_bundle_to_dir, write_bundle
from protspace.utils.add_annotation_style import (
    _CATEGORICAL_PALETTE_IDS,
    _GRADIENT_PALETTE_IDS,
    _resolve_style_value,
    _warn_if_bad_palette,
    _warn_if_numeric,
    add_annotation_styles_bundle,
    add_annotation_styles_parquet,
    generate_template,
    resolve_style_key,
    style_keys,
)


def _make_bundle(tmp_path, ids, annotation_columns):
    """Write a minimal .parquetbundle with the given annotation columns."""
    annotations = stamp_format_version(
        pa.table({"protein_id": list(ids), **annotation_columns})
    )
    n = len(ids)
    meta = pa.table(
        {"projection_name": ["pca2"], "dimensions": [2], "info_json": ["{}"]}
    )
    data = pa.table(
        {
            "projection_name": ["pca2"] * n,
            "identifier": list(ids),
            "x": [0.0] * n,
            "y": [0.0] * n,
            "z": [None] * n,
        }
    )
    path = tmp_path / "data.parquetbundle"
    write_bundle([annotations, meta, data], path)
    return path


# --- _warn_if_numeric unit behavior ---------------------------------------


def test_warn_if_numeric_fires_for_numeric_values(caplog):
    with caplog.at_level(logging.WARNING):
        _warn_if_numeric("length", ["100", "200", "300"])
    assert any(
        "length" in r.message and "categorical-only" in r.message
        for r in caplog.records
    )


def test_warn_if_numeric_silent_for_categorical_values(caplog):
    with caplog.at_level(logging.WARNING):
        _warn_if_numeric("family", ["kinase", "phosphatase"])
    assert caplog.records == []


def test_warn_if_numeric_ignores_na_labels(caplog):
    """NA-like labels must not stop a genuinely numeric column from warning."""
    with caplog.at_level(logging.WARNING):
        _warn_if_numeric("plddt", ["90.1", "72.4", "<NA>", ""])
    assert len(caplog.records) == 1
    # distinct-value count excludes the NA labels
    assert "2 distinct" in caplog.records[0].message


def test_warn_if_numeric_silent_for_empty(caplog):
    with caplog.at_level(logging.WARNING):
        _warn_if_numeric("empty", ["<NA>", ""])
    assert caplog.records == []


# --- wiring through the real code paths -----------------------------------


def test_generate_template_warns_only_on_numeric_column(tmp_path, caplog):
    bundle = _make_bundle(
        tmp_path,
        ["P1", "P2", "P3"],
        {
            "length": ["100", "200", "300"],
            "family": ["kinase", "phosphatase", "kinase"],
        },
    )
    with caplog.at_level(logging.WARNING):
        template = generate_template(str(bundle))

    warned = [r.message for r in caplog.records]
    assert any("length" in m for m in warned)
    assert not any("family" in m for m in warned)
    # the template is still produced for both columns
    assert {"length", "family"} <= set(template)


def test_apply_styles_warns_on_numeric_column(tmp_path, caplog):
    bundle = _make_bundle(tmp_path, ["P1", "P2"], {"length": ["100", "200"]})
    proj_dir = extract_bundle_to_dir(bundle)
    with caplog.at_level(logging.WARNING):
        add_annotation_styles_parquet(
            str(proj_dir),
            {"length": {"colors": {"100": "#111111"}}},
            str(tmp_path / "out"),
        )
    assert any("length" in r.message for r in caplog.records)


# --- _warn_if_bad_palette: selectedPaletteId must be a categorical id ------


def test_bad_palette_silent_for_valid_categorical(caplog):
    with caplog.at_level(logging.WARNING):
        _warn_if_bad_palette("family", {"selectedPaletteId": "okabeIto"})
    assert caplog.records == []


def test_bad_palette_silent_when_absent(caplog):
    with caplog.at_level(logging.WARNING):
        _warn_if_bad_palette("family", {"colors": {"a": "#111111"}})
    assert caplog.records == []


def test_bad_palette_warns_on_gradient_id(caplog):
    with caplog.at_level(logging.WARNING):
        _warn_if_bad_palette("family", {"selectedPaletteId": "viridis"})
    assert len(caplog.records) == 1
    msg = caplog.records[0].message
    assert "viridis" in msg and "gradient" in msg and "kellys" in msg


def test_bad_palette_warns_on_unknown_id(caplog):
    with caplog.at_level(logging.WARNING):
        _warn_if_bad_palette("family", {"selectedPaletteId": "rainbow"})
    assert len(caplog.records) == 1
    assert "rainbow" in caplog.records[0].message


def test_bad_palette_silent_for_non_string_id(caplog):
    """A malformed (non-string) selectedPaletteId must not crash the membership test."""
    with caplog.at_level(logging.WARNING):
        _warn_if_bad_palette("family", {"selectedPaletteId": ["viridis"]})
    assert caplog.records == []


def test_apply_styles_warns_on_gradient_palette_for_categorical(tmp_path, caplog):
    bundle = _make_bundle(tmp_path, ["P1", "P2"], {"family": ["kinase", "phosphatase"]})
    with caplog.at_level(logging.WARNING):
        add_annotation_styles_bundle(
            str(bundle),
            {"family": {"selectedPaletteId": "viridis"}},
            str(tmp_path / "styled.parquetbundle"),
        )
    assert any("family" in r.message and "viridis" in r.message for r in caplog.records)


def test_apply_styles_skips_palette_warning_for_numeric_gradient(tmp_path, caplog):
    """A gradient selectedPaletteId is the valid choice for a numeric column, so the
    categorical-palette warning is suppressed — only the numeric advisory fires."""
    bundle = _make_bundle(
        tmp_path, ["P1", "P2", "P3"], {"length": ["100", "200", "300"]}
    )
    with caplog.at_level(logging.WARNING):
        add_annotation_styles_bundle(
            str(bundle),
            {"length": {"selectedPaletteId": "viridis"}},
            str(tmp_path / "styled.parquetbundle"),
        )
    messages = [r.message for r in caplog.records]
    assert any("length" in m and "categorical-only" in m for m in messages)
    assert not any("kellys" in m for m in messages)


# --- palette catalog --------------------------------------------------------
#
# The ids come from contracts/shared-constants.json, which also generates the web's;
# the generator checks the sets are disjoint and that the numeric default is a
# gradient. This pins the one id the CLI writes and the web falls back to.


def test_kellys_is_a_categorical_palette():
    assert "kellys" in _CATEGORICAL_PALETTE_IDS
    assert "kellys" not in _GRADIENT_PALETTE_IDS


# ---------------------------------------------------------------------------
# Style-key resolution — a styles file's keys vs. the values the bundle holds
# ---------------------------------------------------------------------------


def test_na_style_key_resolves_against_a_null_written_cell():
    # The frontend writer stores a missing categorical cell as parquet NULL, which
    # reads back as the string "None". A styles file naming the N/A group — what
    # `--generate-template` emitted as `__NA__` before that change — must still
    # find it, or `protspace style` aborts on a bundle it produced itself.
    assert _resolve_style_value("__NA__", {"None", "Human"}, "organism") == "None"
    assert _resolve_style_value("<NA>", {"", "Human"}, "organism") == ""


def test_numeric_style_key_resolves_across_the_int_float_spelling():
    # An integral column is stored INT32 now and was stored DOUBLE before, so the
    # same value is keyed '100' in one export and '100.0' in the other.
    assert _resolve_style_value("100.0", {"100", "200"}, "length") == "100"
    assert _resolve_style_value("100", {"100.0", "200.0"}, "length") == "100.0"


def test_unknown_style_key_still_raises():
    with pytest.raises(ValueError, match="does not exist for annotation"):
        _resolve_style_value("Alien", {"Human", "Mouse"}, "organism")


def test_resolve_style_key_answers_what_style_would_accept():
    # The resolver `protspace style` raises on, for a caller that drops the keys
    # it would refuse before styling (the showcase build filters its styles).
    assert resolve_style_key("Human", {"Human", "None"}) == "Human"
    assert resolve_style_key("__NA__", {"None", "Human"}) == "None"
    assert resolve_style_key("100.0", {"100"}) == "100"
    assert resolve_style_key("Alien", {"Human", "Mouse"}) is None
    # Every spelling the web shows as N/A is N/A to `style` too. "none" was kept
    # apart while TMbed wrote its negative that way, but the web always drew it
    # as N/A, so a style on it never applied.
    assert resolve_style_key("__NA__", {"none", "Human"}) == "none"
    assert resolve_style_key("N/A", {"null", "Human"}) == "null"
    assert resolve_style_key("NULL", {"none", "Human"}) == "none"
    assert resolve_style_key("__NA__", {"Human"}) is None  # no missing cell
    # With several N/A spellings in the data, always the same one.
    assert resolve_style_key("N/A", {"None", "", "n/a", "Human"}) == ""


def test_style_keys_are_the_display_values_of_every_cell():
    cells = ["A|IC;B%3Bc|1.0", None, "A", 7]
    assert style_keys(cells) == {"A", "B;c", "None", "7"}
    assert style_keys(["B%3Bc"], decode=False) == {"B%3Bc"}
