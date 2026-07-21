"""Advisory warnings + palette contract for `protspace style`.

Covers three things:
- the numeric-column warning (issue #67) — the CLI styling model is
  categorical-only while the web frontend bins numeric columns into gradients, so
  per-value colors/shapes set via the CLI are silently dropped;
- the `selectedPaletteId` validation warning (gradient/unknown id → resets to
  kellys in the frontend);
- a pinned contract keeping the Python palette-id catalog reconciled with the
  frontend source of truth (see the section at the bottom of this file).
"""

import logging

import pyarrow as pa

from protspace.data.annotations.encoding import stamp_format_version
from protspace.data.io.bundle import extract_bundle_to_dir, write_bundle
from protspace.utils.add_annotation_style import (
    _CATEGORICAL_PALETTE_IDS,
    _GRADIENT_PALETTE_IDS,
    _warn_if_bad_palette,
    _warn_if_numeric,
    add_annotation_styles_bundle,
    add_annotation_styles_parquet,
    generate_template,
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


# --- pinned contract: keep the Python palette catalog in sync with the frontend ---
#
# The authoritative source is the web frontend:
#   packages/utils/src/visualization/color-scheme.ts (COLOR_SCHEMES)
#   packages/utils/src/visualization/numeric-binning.ts
#                                                   (GRADIENT_COLOR_SCHEME_IDS)
# These pins make the Python copy a deliberate, reviewed value: changing a palette
# id trips a test, prompting a matching update to docs/styling.md (Color palettes)
# and a re-check against the frontend. The test compares the catalog to a literal
# copy here, so it guards accidental in-repo edits — it cannot read the frontend
# and does not detect drift from the source of truth.

_EXPECTED_CATEGORICAL_PALETTE_IDS = {
    "kellys",
    "okabeIto",
    "tolBright",
    "set2",
    "dark2",
    "tableau10",
}
_EXPECTED_GRADIENT_PALETTE_IDS = {"batlow", "viridis", "cividis", "inferno", "plasma"}


def test_categorical_palette_ids_pinned():
    assert set(_CATEGORICAL_PALETTE_IDS) == _EXPECTED_CATEGORICAL_PALETTE_IDS


def test_gradient_palette_ids_pinned():
    assert set(_GRADIENT_PALETTE_IDS) == _EXPECTED_GRADIENT_PALETTE_IDS


def test_palette_id_sets_are_disjoint():
    assert _CATEGORICAL_PALETTE_IDS.isdisjoint(_GRADIENT_PALETTE_IDS)


def test_palette_defaults_belong_to_their_sets():
    # Frontend defaults: categorical → 'kellys', numeric gradient → 'batlow'.
    assert "kellys" in _CATEGORICAL_PALETTE_IDS
    assert "batlow" in _GRADIENT_PALETTE_IDS
