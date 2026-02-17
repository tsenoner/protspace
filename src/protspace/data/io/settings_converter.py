"""Bidirectional conversion between settings_json and visualization_state.

*settings_json* is the richer format stored inside a parquetbundle's 4th part.
It is keyed by annotation name and contains per-category color, shape, zOrder,
plus UI preferences (maxVisibleValues, sortMode, hiddenValues, etc.).

*visualization_state* is the flat format consumed by the Dash web app::

    {
        "annotation_colors": {"annotation_name": {"value": "rgba(...)"}},
        "marker_shapes":     {"annotation_name": {"value": "circle"}},
    }
"""

import re

NA_COLOR = "#C0C0C0"  # light gray for missing / <NA> values


def _hex_to_rgba(hex_color: str, alpha: float = 0.8) -> str:
    """Convert ``#RRGGBB`` to ``rgba(R, G, B, alpha)``."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return f"rgba({r}, {g}, {b}, {alpha})"


def _rgba_to_hex(rgba_str: str) -> str:
    """Convert ``rgba(R, G, B, A)`` to ``#RRGGBB``."""
    match = re.match(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", rgba_str)
    if not match:
        return rgba_str  # return as-is if already hex or unrecognized
    r, g, b = int(match.group(1)), int(match.group(2)), int(match.group(3))
    return f"#{r:02X}{g:02X}{b:02X}"


def settings_to_visualization_state(settings: dict) -> dict:
    """Convert *settings_json* to *visualization_state*.

    Args:
        settings: Settings dict keyed by annotation name, each containing a
            ``categories`` mapping with ``color`` (hex) and ``shape`` entries.

    Returns:
        ``{"annotation_colors": {...}, "marker_shapes": {...}}``
    """
    annotation_colors: dict[str, dict[str, str]] = {}
    marker_shapes: dict[str, dict[str, str]] = {}

    for annotation_name, annotation_settings in settings.items():
        categories = annotation_settings.get("categories", {})
        if not categories:
            continue

        colors: dict[str, str] = {}
        shapes: dict[str, str] = {}

        for value, cat_info in categories.items():
            color = cat_info.get("color", "")
            if color:
                colors[value] = _hex_to_rgba(color) if color.startswith("#") else color
            shape = cat_info.get("shape", "")
            if shape:
                shapes[value] = shape

        if colors:
            annotation_colors[annotation_name] = colors
        if shapes:
            marker_shapes[annotation_name] = shapes

    return {
        "annotation_colors": annotation_colors,
        "marker_shapes": marker_shapes,
    }


def _sort_values_for_zorder(
    values: set[str],
    sort_mode: str,
    frequencies: dict[str, int] | None,
) -> list[str]:
    """Return *values* ordered according to *sort_mode*.

    NA-like values (``""``, ``"<NA>"``, ``"NaN"``) are always placed last
    regardless of sort mode.

    Args:
        values: The set of category values.
        sort_mode: One of ``"size-desc"``, ``"size-asc"``, ``"alpha-asc"``,
            ``"alpha-desc"``, ``"manual"``.
        frequencies: Mapping ``{value: count}``.  Required for size-based
            modes; ignored for alphabetical / manual modes.
    """
    na_labels = {"", "<NA>", "NaN"}
    regular = sorted(v for v in values if v not in na_labels)
    na_present = sorted(v for v in values if v in na_labels)

    if sort_mode in ("size-desc", "size-asc") and frequencies:
        regular.sort(
            key=lambda v: frequencies.get(v, 0),
            reverse=(sort_mode == "size-desc"),
        )
    elif sort_mode == "alpha-desc":
        regular.sort(reverse=True)
    # else: alpha-asc (default alphabetical) or manual → keep alphabetical

    return regular + na_present


def visualization_state_to_settings(
    viz_state: dict,
    existing_settings: dict | None = None,
    value_frequencies: dict[str, dict[str, int]] | None = None,
    style_overrides: dict[str, dict] | None = None,
) -> dict:
    """Convert *visualization_state* back to *settings_json*.

    When *existing_settings* is provided, UI-only fields (maxVisibleValues,
    sortMode, hiddenValues, etc.) are preserved from it.  Otherwise sensible
    defaults are used.

    Args:
        viz_state: ``{"annotation_colors": {...}, "marker_shapes": {...}}``
        existing_settings: Optional prior settings to merge with.
        value_frequencies: Optional ``{annotation_name: {value: count}}``
            used to assign zOrder when sortMode is size-based.
        style_overrides: Optional ``{annotation_name: {key: value}}`` with
            settings-level keys (``sortMode``, ``maxVisibleValues``, etc.)
            from the user's styles input.

    Returns:
        Settings dict keyed by annotation name.
    """
    annotation_colors = viz_state.get("annotation_colors", {})
    marker_shapes = viz_state.get("marker_shapes", {})

    # Collect all annotation names referenced in either dict
    all_annotations = set(annotation_colors.keys()) | set(marker_shapes.keys())

    settings: dict = {}
    for annotation_name in all_annotations:
        colors = annotation_colors.get(annotation_name, {})
        shapes = marker_shapes.get(annotation_name, {})

        # Start from existing settings if available
        if existing_settings and annotation_name in existing_settings:
            ann_settings = dict(existing_settings[annotation_name])
            existing_categories = dict(ann_settings.get("categories", {}))
        else:
            ann_settings = {
                "includeShapes": bool(shapes),
                "shapeSize": 30,
                "sortMode": "size-desc",
                "hiddenValues": [],
                "enableDuplicateStackUI": False,
                "selectedPaletteId": "kellys",
            }
            existing_categories = {}

        # Apply style overrides from user input
        _SETTINGS_KEYS = {
            "sortMode", "maxVisibleValues", "shapeSize",
            "hiddenValues", "selectedPaletteId",
        }
        if style_overrides and annotation_name in style_overrides:
            for key, val in style_overrides[annotation_name].items():
                if key in _SETTINGS_KEYS:
                    ann_settings[key] = val

        # Determine sort mode and frequencies for this annotation
        sort_mode = ann_settings.get("sortMode", "size-desc")
        freqs = (
            value_frequencies.get(annotation_name)
            if value_frequencies
            else None
        )

        # Build categories from colors and shapes
        categories: dict = {}
        all_values = set(colors.keys()) | set(shapes.keys())

        ordered_values = _sort_values_for_zorder(all_values, sort_mode, freqs)

        for i, value in enumerate(ordered_values):
            cat = dict(existing_categories.get(value, {}))
            cat["zOrder"] = i

            color = colors.get(value, cat.get("color", ""))
            if color:
                cat["color"] = _rgba_to_hex(color) if "rgba" in str(color) else color

            shape = shapes.get(value, cat.get("shape", "circle"))
            cat["shape"] = shape

            categories[value] = cat

        # Ensure <NA> / empty values always get light gray
        for na_label in ("", "<NA>", "NaN"):
            if na_label in categories:
                categories[na_label].setdefault("color", NA_COLOR)

        ann_settings["categories"] = categories
        # Set maxVisibleValues to actual category count
        ann_settings.setdefault("maxVisibleValues", 10)
        if shapes:
            ann_settings["includeShapes"] = True

        settings[annotation_name] = ann_settings

    return settings
