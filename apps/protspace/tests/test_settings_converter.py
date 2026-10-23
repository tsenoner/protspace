"""Tests for settings_converter — color conversion, sorting, and state conversion."""

import copy

import pytest

from protspace.data.io.settings_converter import (
    _hex_to_rgba,
    _rgba_to_hex,
    _sort_values_for_zorder,
    is_frontend_envelope,
    settings_to_visualization_state,
    visualization_state_to_settings,
)

# ---------------------------------------------------------------------------
# _hex_to_rgba
# ---------------------------------------------------------------------------


class TestHexToRgba:
    @pytest.mark.parametrize(
        "hex_color,expected",
        [
            ("#FF0000", "rgba(255, 0, 0, 0.8)"),
            ("#000000", "rgba(0, 0, 0, 0.8)"),
            ("#FFFFFF", "rgba(255, 255, 255, 0.8)"),
            ("#ff8800", "rgba(255, 136, 0, 0.8)"),
            ("FF0000", "rgba(255, 0, 0, 0.8)"),
        ],
        ids=["red", "black", "white", "lowercase", "no_hash_prefix"],
    )
    def test_default_alpha(self, hex_color, expected):
        assert _hex_to_rgba(hex_color) == expected

    def test_custom_alpha(self):
        assert _hex_to_rgba("#00FF00", alpha=1.0) == "rgba(0, 255, 0, 1.0)"


# ---------------------------------------------------------------------------
# _rgba_to_hex
# ---------------------------------------------------------------------------


class TestRgbaToHex:
    @pytest.mark.parametrize(
        "color,expected",
        [
            ("rgba(255, 0, 0, 0.8)", "#FF0000"),
            ("rgba(0, 0, 0, 1.0)", "#000000"),
            ("rgb(128, 64, 32)", "#804020"),
            ("#FF0000", "#FF0000"),
            ("not-a-color", "not-a-color"),
        ],
        ids=["rgba", "black", "rgb_no_alpha", "hex_passthrough", "unrecognized"],
    )
    def test_conversion(self, color, expected):
        assert _rgba_to_hex(color) == expected

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

    def test_any_missing_spelling_sorts_last(self):
        # The web reads every one of these as N/A, in any case.
        result = _sort_values_for_zorder({"X", "N/A", "null", "A"}, "alpha-asc", None)
        assert result == ["A", "X", "N/A", "null"]

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

    @pytest.mark.parametrize(
        "settings",
        [
            {"empty": {"categories": {}}},
            {"other": {"sortMode": "alpha-asc"}},
            {},
        ],
        ids=["empty_categories", "no_categories_key", "empty_settings"],
    )
    def test_nothing_to_style_gives_empty_state(self, settings):
        result = settings_to_visualization_state(settings)
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

    def test_na_color_is_stored_under_the_na_key(self):
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

    def test_every_na_spelling_is_one_na_category(self):
        # The web draws all of these as its one N/A entry, keyed __NA__; the
        # stored __NA__ wins over a spelling of it.
        viz = {
            "annotation_colors": {
                "ann": {
                    "A": "#00FF00",
                    "N/A": "#FF0000",
                    "": "#0000FF",
                    "__NA__": "#111111",
                    "<NA>": "#222222",
                }
            },
            "marker_shapes": {"ann": {"null": "diamond"}},
        }
        cats = visualization_state_to_settings(viz)["ann"]["categories"]
        assert cats.keys() == {"A", "__NA__"}
        assert cats["__NA__"]["color"] == "#111111"
        assert cats["__NA__"]["shape"] == "diamond"
        assert cats["__NA__"]["zOrder"] == 1  # last

    def test_na_spellings_count_as_one_category_when_sorting_by_size(self):
        result = visualization_state_to_settings(
            {"annotation_colors": {}, "marker_shapes": {}},
            value_frequencies={"ann": {"A": 3, "B": 2, "N/A": 1, "": 2}},
            style_overrides={"ann": {"sortMode": "size-desc"}},
        )
        cats = result["ann"]["categories"]
        assert {k: v["zOrder"] for k, v in cats.items()} == {
            "A": 0,
            "B": 1,
            "__NA__": 2,
        }

    def test_hidden_na_is_named_as_the_web_names_it(self):
        result = visualization_state_to_settings(
            {"annotation_colors": {"ann": {"A": "#00FF00"}}, "marker_shapes": {}},
            style_overrides={"ann": {"hiddenValues": ["A", "N/A", "", "__NA__"]}},
        )
        assert result["ann"]["hiddenValues"] == ["A", "__NA__"]

    def test_stored_hidden_na_is_renamed_when_only_colours_change(self):
        # A bundle styled before the fold stored the data's own N/A spelling.
        existing = {"ann": {"hiddenValues": ["None", "A"], "categories": {}}}
        result = visualization_state_to_settings(
            {"annotation_colors": {"ann": {"A": "#00FF00"}}, "marker_shapes": {}},
            existing_settings=existing,
        )
        assert result["ann"]["hiddenValues"] == ["__NA__", "A"]

    def test_defaults_when_no_existing(self):
        viz = {
            "annotation_colors": {"ann": {"A": "rgba(255,0,0,0.8)"}},
            "marker_shapes": {},
        }
        result = visualization_state_to_settings(viz)
        assert result["ann"]["sortMode"] == "size-desc"
        assert result["ann"]["hiddenValues"] == []
        assert result["ann"]["shapeSize"] == 10

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


class TestMissingSpellingsAreOneCategory:
    """The web shows every missing spelling as one N/A category, keyed ``__NA__``."""

    @pytest.mark.parametrize("spelling", ["N/A", "null", "NA", " none "])
    def test_any_missing_spelling_is_keyed_na(self, spelling):
        viz = {
            "annotation_colors": {"ann": {"A": "#FF0000", spelling: "#010203"}},
            "marker_shapes": {},
        }
        cats = visualization_state_to_settings(viz)["ann"]["categories"]
        assert set(cats) == {"A", "__NA__"}
        assert cats["__NA__"]["color"] == "#010203"

    def test_several_spellings_give_one_category_with_contiguous_zorder(self):
        viz = {
            "annotation_colors": {"ann": {"A": "#FF0000", "": "#010101"}},
            "marker_shapes": {"ann": {"N/A": "square", "null": "diamond"}},
        }
        cats = visualization_state_to_settings(viz)["ann"]["categories"]
        assert set(cats) == {"A", "__NA__"}
        assert sorted(cat["zOrder"] for cat in cats.values()) == [0, 1]
        assert cats["__NA__"]["color"] == "#010101"
        # The first spelling in sorted order wins, never set-iteration order.
        assert cats["__NA__"]["shape"] == "square"

    def test_the_stored_na_category_keeps_its_fields(self):
        existing = {"ann": {"categories": {"__NA__": {"zOrder": 3, "shape": "square"}}}}
        viz = {"annotation_colors": {"ann": {"": "#222222"}}, "marker_shapes": {}}
        cats = visualization_state_to_settings(viz, existing_settings=existing)["ann"][
            "categories"
        ]
        assert cats["__NA__"] == {"zOrder": 0, "color": "#222222", "shape": "square"}

    def test_pinning_na_by_two_spellings_pins_it_once(self):
        result = visualization_state_to_settings(
            {"annotation_colors": {}, "marker_shapes": {}},
            value_frequencies={"ann": {"A": 3, "B": 2, "": 1, "N/A": 1}},
            style_overrides={"ann": {"pinnedValues": ["A", "null", ""]}},
        )
        cats = result["ann"]["categories"]
        assert set(cats) == {"A", "__NA__"}
        assert cats["A"]["zOrder"] == 0
        assert cats["__NA__"] == {"zOrder": 1, "color": "#DDDDDD", "shape": "circle"}

    def test_rest_fill_never_counts_na_as_a_value(self):
        result = visualization_state_to_settings(
            {"annotation_colors": {}, "marker_shapes": {}},
            value_frequencies={"ann": {"A": 3, "N/A": 9, "B": 2}},
            style_overrides={
                "ann": {"pinnedValues": ["__REST__", ""], "maxVisibleValues": 3}
            },
        )
        cats = result["ann"]["categories"]
        order = sorted(cats, key=lambda key: cats[key]["zOrder"])
        assert order == ["A", "B", "__NA__"]


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
        "eatOutcome": "dim",
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
        assert result["eatOutcome"] == "dim"
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


def test_is_frontend_envelope_needs_the_nested_shape_and_a_sibling():
    legends = {"organism": {"categories": {}}}
    assert is_frontend_envelope({"legendSettings": legends, "exportOptions": {}})
    assert is_frontend_envelope(
        {"legendSettings": legends, "eatConfidenceThreshold": 0.5}
    )
    assert is_frontend_envelope({"legendSettings": legends, "eatOutcome": "dim"})
    assert not is_frontend_envelope(legends)  # the flat Python shape
    assert not is_frontend_envelope({"legendSettings": legends})  # no sibling
    # A flat map whose columns are called legendSettings and exportOptions.
    assert not is_frontend_envelope(
        {"legendSettings": {"categories": {}}, "exportOptions": {"categories": {}}}
    )
    assert not is_frontend_envelope(None)
