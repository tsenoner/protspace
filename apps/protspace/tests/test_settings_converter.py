"""Tests for settings_converter — color conversion, sorting, and state conversion."""

import copy

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


# ---------------------------------------------------------------------------
# Frontend (nested) settings shape — tsenoner/protspace#303 follow-up
# ---------------------------------------------------------------------------


def _frontend_settings() -> dict:
    """Part 4 exactly as the web frontend's createSettingsParquet writes it."""
    return {
        "legendSettings": {
            "organism": {
                "maxVisibleValues": 10,
                "shapeSize": 24,
                "sortMode": "size-desc",
                "hiddenValues": [],
                "categories": {
                    "Human": {"zOrder": 0, "color": "#F3C300", "shape": "circle"},
                    "Mouse": {"zOrder": 1, "color": "#875692", "shape": "square"},
                },
                "enableDuplicateStackUI": False,
                "selectedPaletteId": "kellys",
            }
        },
        "exportOptions": {},
        "publishState": {"title": "demo"},
        "eatOverlayEnabled": False,
        "eatConfidenceThreshold": 0.5,
    }


class TestFrontendSettingsShape:
    """The frontend writes a nested envelope; Python used to assume the flat shape.

    Iterating it hit ``False.get("categories")`` -> AttributeError, which
    ArrowReader swallowed, so every legend colour/shape vanished silently.
    """

    def test_reads_colors_and_shapes_from_the_nested_envelope(self):
        state = settings_to_visualization_state(_frontend_settings())
        assert state["annotation_colors"] == {
            "organism": {
                "Human": "rgba(243, 195, 0, 0.8)",
                "Mouse": "rgba(135, 86, 146, 0.8)",
            }
        }
        assert state["marker_shapes"] == {
            "organism": {"Human": "circle", "Mouse": "square"}
        }

    def test_flat_python_shape_still_works(self):
        flat = _frontend_settings()["legendSettings"]
        assert settings_to_visualization_state(flat)["annotation_colors"] == {
            "organism": {
                "Human": "rgba(243, 195, 0, 0.8)",
                "Mouse": "rgba(135, 86, 146, 0.8)",
            }
        }

    def test_scalar_entry_does_not_blank_the_legend(self):
        flat = _frontend_settings()["legendSettings"] | {"eatOverlayEnabled": False}
        assert "organism" in settings_to_visualization_state(flat)["annotation_colors"]

    def test_restyling_preserves_the_frontend_envelope(self):
        """`protspace style` on a frontend export must not drop publishState/EAT."""
        original = _frontend_settings()
        viz = settings_to_visualization_state(original)
        result = visualization_state_to_settings(viz, original)

        assert result["publishState"] == {"title": "demo"}
        assert result["eatOverlayEnabled"] is False
        assert result["eatConfidenceThreshold"] == 0.5
        # UI-only fields survive because existing_settings was unwrapped.
        organism = result["legendSettings"]["organism"]
        assert organism["shapeSize"] == 24
        assert organism["selectedPaletteId"] == "kellys"
        assert sorted(organism["categories"]) == ["Human", "Mouse"]

    def test_flat_input_still_returns_the_flat_shape(self):
        flat = _frontend_settings()["legendSettings"]
        viz = settings_to_visualization_state(flat)
        result = visualization_state_to_settings(viz, flat)
        assert "legendSettings" not in result
        assert "organism" in result

    def test_flat_map_with_a_legendSettings_named_annotation_is_not_unwrapped(self):
        """Annotation names come from user CSV headers, so the collision is possible.

        Unwrapping here would hand back one annotation's own entry as the whole
        map and silently blank every legend.
        """
        flat = {
            "legendSettings": {
                "sortMode": "alpha-asc",
                "shapeSize": 30,
                "categories": {
                    "a": {"zOrder": 0, "color": "#FF0000", "shape": "circle"}
                },
            },
            "organism": {
                "sortMode": "size-desc",
                "categories": {
                    "Human": {"zOrder": 0, "color": "#00FF00", "shape": "square"}
                },
            },
        }
        colors = settings_to_visualization_state(flat)["annotation_colors"]
        assert colors == {
            "legendSettings": {"a": "rgba(255, 0, 0, 0.8)"},
            "organism": {"Human": "rgba(0, 255, 0, 0.8)"},
        }

    def test_flat_map_is_not_unwrapped_just_because_a_sibling_name_collides(self):
        """Envelope sibling names are plausible CSV headers too.

        A flat map whose columns happen to be `legendSettings` + `publishState`
        satisfies the sibling check, so the inner shape has to settle it: here the
        value under `legendSettings` is one annotation's own settings entry, which
        a real envelope's annotation-keyed map never looks like.
        """
        flat = {
            "legendSettings": {
                "sortMode": "alpha-asc",
                "categories": {
                    "a": {"zOrder": 0, "color": "#FF0000", "shape": "circle"}
                },
            },
            "publishState": {
                "categories": {
                    "Human": {"zOrder": 0, "color": "#00FF00", "shape": "square"}
                }
            },
        }
        colors = settings_to_visualization_state(flat)["annotation_colors"]
        assert colors == {
            "legendSettings": {"a": "rgba(255, 0, 0, 0.8)"},
            "publishState": {"Human": "rgba(0, 255, 0, 0.8)"},
        }

    def test_restyling_keeps_annotations_the_viz_state_cannot_carry(self):
        """A numeric annotation is invisible to `settings_to_visualization_state`.

        The frontend persists numeric categories with empty color/shape, which that
        function filters out, so the rebuilt map never mentions them. Replacing the
        envelope's legendSettings wholesale would drop their numericSettings,
        palette and hidden values — the loss this envelope handling exists to stop.
        """
        plddt = {
            "categories": {"70": {"zOrder": 0, "color": "", "shape": ""}},
            "numericSettings": {"binningStrategy": "quantile", "reverseGradient": True},
            "selectedPaletteId": "viridis",
            "hiddenValues": ["__NA__"],
            "maxVisibleValues": 8,
        }
        original = _frontend_settings()
        original["legendSettings"]["plddt"] = copy.deepcopy(plddt)

        viz = settings_to_visualization_state(original)
        assert "plddt" not in viz["annotation_colors"]

        result = visualization_state_to_settings(viz, original)
        assert result["legendSettings"]["plddt"] == plddt
        assert "organism" in result["legendSettings"]

    def test_envelope_still_detected_when_its_single_annotation_is_named_legendSettings(
        self,
    ):
        """The reverse collision: a genuine envelope keyed by that same name."""
        nested = {
            "legendSettings": {
                "legendSettings": {
                    "sortMode": "alpha-asc",
                    "categories": {
                        "a": {"zOrder": 0, "color": "#FF0000", "shape": "circle"}
                    },
                }
            },
            "exportOptions": {},
        }
        colors = settings_to_visualization_state(nested)["annotation_colors"]
        assert colors == {"legendSettings": {"a": "rgba(255, 0, 0, 0.8)"}}
