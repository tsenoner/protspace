"""Tests for settings_converter — color conversion, sorting, and state conversion."""

import pytest

from protspace.data.io.settings_converter import (
    _hex_to_rgba,
    _rgba_to_hex,
    _sort_values_for_zorder,
    settings_to_visualization_state,
    visualization_state_to_settings,
)

# ---------------------------------------------------------------------------
# _hex_to_rgba
# ---------------------------------------------------------------------------


class TestHexToRgba:
    def test_basic(self):
        assert _hex_to_rgba("#FF0000") == "rgba(255, 0, 0, 0.8)"

    def test_black(self):
        assert _hex_to_rgba("#000000") == "rgba(0, 0, 0, 0.8)"

    def test_white(self):
        assert _hex_to_rgba("#FFFFFF") == "rgba(255, 255, 255, 0.8)"

    def test_custom_alpha(self):
        assert _hex_to_rgba("#00FF00", alpha=1.0) == "rgba(0, 255, 0, 1.0)"

    def test_lowercase_hex(self):
        assert _hex_to_rgba("#ff8800") == "rgba(255, 136, 0, 0.8)"

    def test_no_hash_prefix(self):
        assert _hex_to_rgba("FF0000") == "rgba(255, 0, 0, 0.8)"


# ---------------------------------------------------------------------------
# _rgba_to_hex
# ---------------------------------------------------------------------------


class TestRgbaToHex:
    def test_basic(self):
        assert _rgba_to_hex("rgba(255, 0, 0, 0.8)") == "#FF0000"

    def test_black(self):
        assert _rgba_to_hex("rgba(0, 0, 0, 1.0)") == "#000000"

    def test_rgb_no_alpha(self):
        assert _rgba_to_hex("rgb(128, 64, 32)") == "#804020"

    def test_hex_passthrough(self):
        assert _rgba_to_hex("#FF0000") == "#FF0000"

    def test_unrecognized_passthrough(self):
        assert _rgba_to_hex("not-a-color") == "not-a-color"

    def test_roundtrip(self):
        original = "#A1CAF1"
        assert _rgba_to_hex(_hex_to_rgba(original)) == original


# ---------------------------------------------------------------------------
# _sort_values_for_zorder
# ---------------------------------------------------------------------------


class TestSortValuesForZorder:
    @pytest.fixture
    def values(self):
        return {"Alpha", "Charlie", "Bravo", "<NA>"}

    @pytest.fixture
    def frequencies(self):
        return {"Alpha": 50, "Bravo": 100, "Charlie": 10}

    def test_alpha_asc(self, values):
        result = _sort_values_for_zorder(values, "alpha-asc", None)
        assert result == ["Alpha", "Bravo", "Charlie", "<NA>"]

    def test_alpha_desc(self, values):
        result = _sort_values_for_zorder(values, "alpha-desc", None)
        assert result == ["Charlie", "Bravo", "Alpha", "<NA>"]

    def test_size_desc(self, values, frequencies):
        result = _sort_values_for_zorder(values, "size-desc", frequencies)
        assert result == ["Bravo", "Alpha", "Charlie", "<NA>"]

    def test_size_asc(self, values, frequencies):
        result = _sort_values_for_zorder(values, "size-asc", frequencies)
        assert result == ["Charlie", "Alpha", "Bravo", "<NA>"]

    def test_na_always_last(self):
        values = {"X", "", "<NA>", "NaN", "A"}
        result = _sort_values_for_zorder(values, "alpha-asc", None)
        assert result[-3:] == sorted(["", "<NA>", "NaN"])
        assert result[:2] == ["A", "X"]

    def test_manual_is_alphabetical(self, values):
        result = _sort_values_for_zorder(values, "manual", None)
        assert result == ["Alpha", "Bravo", "Charlie", "<NA>"]

    def test_empty(self):
        assert _sort_values_for_zorder(set(), "alpha-asc", None) == []

    def test_size_without_frequencies_falls_back(self):
        values = {"B", "A"}
        result = _sort_values_for_zorder(values, "size-desc", None)
        assert result == ["A", "B"]  # alphabetical fallback


# ---------------------------------------------------------------------------
# settings_to_visualization_state
# ---------------------------------------------------------------------------


class TestSettingsToVisualizationState:
    def test_basic(self):
        settings = {
            "family": {
                "categories": {
                    "kinase": {"color": "#FF0000", "shape": "circle"},
                    "phosphatase": {"color": "#00FF00", "shape": "square"},
                }
            }
        }
        result = settings_to_visualization_state(settings)
        colors = result["annotation_colors"]["family"]
        shapes = result["marker_shapes"]["family"]
        assert colors["kinase"] == "rgba(255, 0, 0, 0.8)"
        assert colors["phosphatase"] == "rgba(0, 255, 0, 0.8)"
        assert shapes["kinase"] == "circle"
        assert shapes["phosphatase"] == "square"

    def test_empty_categories(self):
        result = settings_to_visualization_state({"empty": {"categories": {}}})
        assert result == {"annotation_colors": {}, "marker_shapes": {}}

    def test_no_categories_key(self):
        result = settings_to_visualization_state({"other": {"sortMode": "alpha-asc"}})
        assert result == {"annotation_colors": {}, "marker_shapes": {}}

    def test_empty_settings(self):
        result = settings_to_visualization_state({})
        assert result == {"annotation_colors": {}, "marker_shapes": {}}

    def test_color_only_no_shape(self):
        settings = {"ann": {"categories": {"val": {"color": "#123456"}}}}
        result = settings_to_visualization_state(settings)
        assert "ann" in result["annotation_colors"]
        assert "ann" not in result["marker_shapes"]

    def test_rgba_color_passed_through(self):
        settings = {"ann": {"categories": {"val": {"color": "rgba(1, 2, 3, 0.5)"}}}}
        result = settings_to_visualization_state(settings)
        assert result["annotation_colors"]["ann"]["val"] == "rgba(1, 2, 3, 0.5)"


# ---------------------------------------------------------------------------
# visualization_state_to_settings (basic paths)
# ---------------------------------------------------------------------------


class TestVisualizationStateToSettings:
    def test_basic_roundtrip(self):
        settings_in = {
            "family": {
                "categories": {
                    "kinase": {"color": "#FF0000", "shape": "circle"},
                }
            }
        }
        viz = settings_to_visualization_state(settings_in)
        settings_out = visualization_state_to_settings(viz)
        cat = settings_out["family"]["categories"]["kinase"]
        assert cat["color"] == "#FF0000"
        assert cat["shape"] == "circle"
        assert "zOrder" in cat

    def test_na_gets_gray(self):
        viz = {
            "annotation_colors": {
                "ann": {"val": "rgba(255,0,0,0.8)", "<NA>": "rgba(192,192,192,0.8)"}
            },
            "marker_shapes": {},
        }
        result = visualization_state_to_settings(viz)
        cats = result["ann"]["categories"]
        # NA values are stored under __NA__ key (frontend internal format)
        assert cats["__NA__"]["color"] == "#C0C0C0"

    def test_defaults_when_no_existing(self):
        viz = {
            "annotation_colors": {"ann": {"A": "rgba(255,0,0,0.8)"}},
            "marker_shapes": {},
        }
        result = visualization_state_to_settings(viz)
        assert result["ann"]["sortMode"] == "size-desc"
        assert result["ann"]["hiddenValues"] == []

    def test_preserves_existing_settings(self):
        existing = {
            "ann": {
                "sortMode": "alpha-asc",
                "shapeSize": 50,
                "categories": {},
            }
        }
        viz = {
            "annotation_colors": {"ann": {"A": "rgba(255,0,0,0.8)"}},
            "marker_shapes": {},
        }
        result = visualization_state_to_settings(viz, existing_settings=existing)
        assert result["ann"]["sortMode"] == "alpha-asc"
        assert result["ann"]["shapeSize"] == 50

    def test_style_overrides(self):
        viz = {
            "annotation_colors": {"ann": {"A": "rgba(255,0,0,0.8)"}},
            "marker_shapes": {},
        }
        overrides = {"ann": {"sortMode": "alpha-desc", "maxVisibleValues": 5}}
        result = visualization_state_to_settings(viz, style_overrides=overrides)
        assert result["ann"]["sortMode"] == "alpha-desc"
        assert result["ann"]["maxVisibleValues"] == 5
